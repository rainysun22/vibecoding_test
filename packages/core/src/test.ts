import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenWorkRuntime } from "./index.js";
import { diffText } from "./diff.js";
import { extractUrls, extractFilePaths } from "./tools.js";
import { scoreStepConfidence } from "./confidence.js";
import { compactStepResult } from "./context.js";

/** 内置技能目录：仓库根 /skills（相对 dist 定位，避免依赖 cwd） */
const SKILLS_DIR = fileURLToPath(new URL("../../../skills", import.meta.url));

async function withRuntime<T>(
  autoApprove: boolean,
  fn: (runtime: OpenWorkRuntime) => Promise<T>,
): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), "openwork-test-"));
  const runtime = new OpenWorkRuntime({
    dataDir,
    skillsDir: SKILLS_DIR,
    autoApprove,
  });
  try {
    return await fn(runtime);
  } finally {
    runtime.shutdown();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("等待超时");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function testAutoApproveFlow(): Promise<void> {
  await withRuntime(true, async (runtime) => {
    const task = await runtime.createTask("写一份AI工作台市场分析");
    assert.ok(task.id);

    await waitFor(() => runtime.getTask(task.id)?.status === "completed");
    const final = runtime.getTask(task.id)!;
    assert.equal(final.status, "completed");
    assert.ok(final.usage.totalTokens > 0, "用量应被记录");

    // 成果已生成
    const deliverables = runtime.listDeliverables();
    assert.equal(deliverables.length, 1);
    assert.equal(deliverables[0]!.format, "markdown");
    assert.equal(deliverables[0]!.taskId, task.id);

    // 成果可读取
    const file = runtime.readDeliverable(deliverables[0]!.id);
    assert.ok(file);
    assert.ok(file.data.length > 100);
    assert.ok(file.data.includes("OpenWork"));

    // 任务轨迹完整
    const events = runtime.listEvents(task.id);
    const types = events.map((e) => e.type);
    assert.ok(types.includes("task.planning"));
    assert.ok(types.includes("plan.ready"));
    assert.ok(types.includes("deliverable.created"));
    assert.ok(types.includes("task.completed"));
    console.log(`  ✓ 自动审批全流程：${events.length} 个事件，成果 ${file.data.length} 字节`);
  });
}

async function testManualApprovalFlow(): Promise<void> {
  await withRuntime(false, async (runtime) => {
    const task = await runtime.createTask("写一份AI工作台市场分析");

    // 等待计划审批 checkpoint
    await waitFor(() => runtime.getTask(task.id)?.status === "awaiting_approval");
    let checkpoints = runtime.listPendingCheckpoints();
    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0]!.kind, "plan");

    // 批准计划
    await runtime.decideCheckpoint(checkpoints[0]!.id, "approve");

    // 等待成果审批 checkpoint
    await waitFor(() => runtime.getTask(task.id)?.status === "awaiting_approval");
    checkpoints = runtime.listPendingCheckpoints();
    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0]!.kind, "deliverable");

    // 批准成果
    await runtime.decideCheckpoint(checkpoints[0]!.id, "approve");
    await waitFor(() => runtime.getTask(task.id)?.status === "completed");

    console.log("  ✓ 手动审批全流程：计划审批 → 执行 → 成果审批 → 完成");
  });
}

async function testRejectFlow(): Promise<void> {
  await withRuntime(false, async (runtime) => {
    const task = await runtime.createTask("写一份AI工作台市场分析");
    await waitFor(() => runtime.getTask(task.id)?.status === "awaiting_approval");
    const [checkpoint] = runtime.listPendingCheckpoints();
    await runtime.decideCheckpoint(checkpoint!.id, "reject", "计划不合适");

    const final = runtime.getTask(task.id);
    assert.equal(final?.status, "cancelled");
    console.log("  ✓ 拒绝审批：任务终止");
  });
}

async function testSkillFlow(): Promise<void> {
  await withRuntime(true, async (runtime) => {
    const skills = runtime.listSkills();
    assert.ok(skills.length >= 3, "内置技能应至少 3 个");
    const docxSkill = skills.find((s) => s.id === "write-report-docx");
    assert.ok(docxSkill, "应存在 docx 报告技能");

    const task = await runtime.createTask("写一份AI工作台市场分析", {
      skillId: "write-report-docx",
    });
    await waitFor(() => runtime.getTask(task.id)?.status === "completed");

    const deliverables = runtime.listDeliverables().filter((d) => d.taskId === task.id);
    assert.equal(deliverables.length, 1);
    assert.equal(deliverables[0]!.format, "docx");
    const file = runtime.readDeliverable(deliverables[0]!.id);
    assert.equal(file?.data[0], 0x50); // ZIP 魔数
    console.log("  ✓ 技能驱动交付：docx 成果生成");
  });
}

async function testUsageSummary(): Promise<void> {
  await withRuntime(true, async (runtime) => {
    const task = await runtime.createTask("写一份AI工作台市场分析");
    await waitFor(() => runtime.getTask(task.id)?.status === "completed");
    const summary = runtime.usageSummary();
    assert.ok(summary.totalTokens > 0);
    assert.equal(summary.totalCostUSD, 0); // mock 免费
    assert.ok(summary.todayCostUSD !== undefined);
    console.log(`  ✓ 用量统计：${summary.totalTokens} tokens`);
  });
}

/** v0.2：计划缓存 —— 相同目标第二次委托命中缓存，跳过 planning 调用 */
async function testPlanCache(): Promise<void> {
  await withRuntime(true, async (runtime) => {
    const goal = "写一份量子计算入门指南";
    const first = await runtime.createTask(goal);
    await waitFor(() => runtime.getTask(first.id)?.status === "completed");

    const second = await runtime.createTask(`  ${goal.toUpperCase()}  `); // 归一化后同键
    await waitFor(() => runtime.getTask(second.id)?.status === "completed");

    const events = runtime.listEvents(second.id);
    const planReady = events.find((e) => e.type === "plan.ready");
    assert.ok(planReady?.title.includes("缓存命中"), `应命中计划缓存，实际：${planReady?.title}`);
    assert.ok(runtime.listDeliverables().length >= 2);
    console.log("  ✓ 计划缓存：相似目标复用历史计划");
  });
}

/** v0.2：并行执行 —— 对比类计划的双 research 步骤并发运行 */
async function testParallelResearch(): Promise<void> {
  await withRuntime(true, async (runtime) => {
    const task = await runtime.createTask("对比 React 与 Vue 的工程实践");
    await waitFor(() => runtime.getTask(task.id)?.status === "completed");

    const events = runtime.listEvents(task.id);
    const titles = events.map((e) => e.title);
    assert.ok(titles.some((t) => t.includes("并行执行 2 个研究步骤")), "应出现并行执行事件");
    assert.equal(runtime.listDeliverables().length, 1);
    console.log("  ✓ 并行执行：双研究步骤并发完成");
  });
}

/** v0.2：流式输出 —— SSE 侧收到增量与结束帧 */
async function testStreamingEvents(): Promise<void> {
  await withRuntime(true, async (runtime) => {
    const seen: { delta: string; done: boolean }[] = [];
    const unsubscribe = runtime.subscribe((payload) => {
      if (payload.type === "step.streaming" && payload.streamId) {
        seen.push({ delta: payload.delta ?? "", done: Boolean(payload.streamDone) });
      }
    });

    const task = await runtime.createTask("写一份流式输出验证报告");
    await waitFor(() => runtime.getTask(task.id)?.status === "completed");
    unsubscribe();

    assert.ok(seen.some((s) => s.delta.length > 0), "应收到流式增量");
    assert.ok(seen.some((s) => s.done), "应收到流结束帧");
    console.log(`  ✓ 流式输出：${seen.length} 帧增量直达订阅端`);
  });
}

/** v0.2：成本路由 —— 设置持久化并可恢复 */
async function testRoutingPersistence(): Promise<void> {
  await withRuntime(true, async (runtime) => {
    runtime.setRouting({ preferLocal: true, localModel: "ollama/qwen3:8b", dailyBudgetUSD: 5 });
    assert.deepEqual(runtime.getRouting(), {
      preferLocal: true,
      localModel: "ollama/qwen3:8b",
      dailyBudgetUSD: 5,
    });
    console.log("  ✓ 成本路由：策略设置与读取一致（持久化经 settings 表）");
  });
}

/** v0.3：diff 引擎 —— LCS 行级对比的正确性 */
async function testDiffEngine(): Promise<void> {
  const { lines, stat } = diffText("a\nb\nc", "a\nx\nc\nd");
  // LCS = [a, c] → del b, add x, add d
  assert.deepEqual(
    lines.map((l) => `${l.type}:${l.text}`),
    ["ctx:a", "del:b", "add:x", "ctx:c", "add:d"],
  );
  assert.deepEqual(stat, { added: 2, removed: 1, unchanged: 2 });

  // 行号：上下文行双号齐全，增删行各有其号
  const ctxLine = lines.find((l) => l.type === "ctx" && l.text === "c")!;
  assert.equal(ctxLine.oldNo, 3);
  assert.equal(ctxLine.newNo, 3);
  const addLine = lines.find((l) => l.type === "add" && l.text === "d")!;
  assert.equal(addLine.newNo, 4);

  // 完全一致 → 全上下文
  const same = diffText("x\ny", "x\ny");
  assert.equal(same.stat.added, 0);
  assert.equal(same.stat.removed, 0);
  console.log("  ✓ diff 引擎：LCS 行级对比（增/删/上下文与行号）");
}

/** v0.3：工具系统 —— URL/路径提取 + 本地文件研究数据源 */
async function testTools(): Promise<void> {
  // URL 提取：去重 + 尾部标点剥离
  const urls = extractUrls("参考 https://a.com/x 与 http://b.com/page.html，以及 https://a.com/x。");
  assert.deepEqual(urls, ["https://a.com/x", "http://b.com/page.html"]);

  // 文件路径提取：绝对路径 / ~/ 前缀 / 相对路径
  const paths = extractFilePaths("读取 /tmp/openwork-test/notes.txt 和 ~/docs/data.csv，还有 ./local.md");
  assert.deepEqual(paths, ["/tmp/openwork-test/notes.txt", "~/docs/data.csv", "./local.md"]);

  // 本地文件作为研究数据源（完整链路：goal 带路径 → tool.executed 事件落库）
  await withRuntime(true, async (runtime) => {
    const materialPath = join(runtime.storage.dataDir, "materials.md");
    writeFileSync(materialPath, "# 材料\n- OpenWork 采纳率 62%\n- 边际成本下降 40%", "utf-8");

    const task = await runtime.createTask(`结合 ${materialPath} 写一份要点总结`);
    await waitFor(() => runtime.getTask(task.id)?.status === "completed");

    const events = runtime.listEvents(task.id);
    const toolEvent = events.find((e) => e.type === "tool.executed");
    assert.ok(toolEvent, "应出现 tool.executed 事件");
    assert.ok(toolEvent!.detail?.includes(materialPath), "事件应记录数据源路径");
    console.log("  ✓ 工具系统：本地文件研究数据源 + 审计事件");
  });
}

/** v0.3：修订流程 —— 反馈生成新版本 + 版本 diff */
async function testRevisionFlow(): Promise<void> {
  await withRuntime(true, async (runtime) => {
    const task = await runtime.createTask("写一份AI工作台市场分析");
    await waitFor(() => runtime.getTask(task.id)?.status === "completed");
    const [deliverable] = runtime.listDeliverables();
    assert.ok(deliverable);

    const revision = await runtime.reviseDeliverable(deliverable.id, "补充竞品对比章节，语气更正式");
    assert.ok(revision.revisionOf?.deliverableId === deliverable.id, "修订任务应关联原成果");
    await waitFor(() => runtime.getTask(revision.id)?.status === "completed");

    // 版本链：主任务（初稿+审计）基础上追加修订版
  const versions = runtime.listVersions(deliverable.id);
  assert.equal(versions.length, 3);
  const last = versions[versions.length - 1]!;
  assert.equal(last.version, 3);
  assert.equal(last.note, "补充竞品对比章节，语气更正式");
  assert.equal(runtime.getDeliverable(deliverable.id)!.version, 3);

  // 版本事件落库
  const events = runtime.listEvents(revision.id);
  assert.ok(events.some((e) => e.type === "deliverable.versioned"), "应出现版本化事件");

  // 版本 diff：相邻两版有实际变更（审计版 → 修订版）
  const diff = runtime.diffDeliverable(deliverable.id, 2, 3);
  assert.ok(diff.stat.added + diff.stat.removed > 0, "两版应有内容差异");
  assert.equal(diff.from, 2);
  assert.equal(diff.to, 3);
  assert.ok(diff.lines.some((l) => l.type === "add" || l.type === "del"));

    // diff 校验：不存在的版本应报错
    assert.throws(() => runtime.diffDeliverable(deliverable.id, 1, 99), /版本不存在/);
    console.log(`  ✓ 修订流程：v2 生成（+${diff.stat.added}/−${diff.stat.removed} 行）+ 版本 diff`);
  });
}

/** v0.3：断点恢复 —— 手动续跑 + 进程重启自动恢复 */
async function testResumeFlows(): Promise<void> {
  // 手动续跑：autoRun=false 的任务挂起后恢复
  await withRuntime(true, async (runtime) => {
    const task = await runtime.createTask("写一份手动续跑验证", { autoRun: false });
    assert.equal(runtime.getTask(task.id)?.status, "pending");

    await runtime.resumeTask(task.id);
    await waitFor(() => runtime.getTask(task.id)?.status === "completed");
    assert.ok(
      runtime.listEvents(task.id).some((e) => e.type === "task.resumed"),
      "应记录续跑事件",
    );
    console.log("  ✓ 断点恢复：手动续跑到完成");
  });

  // 进程重启：新 Runtime 启动时自动恢复中断任务
  const dataDir = mkdtempSync(join(tmpdir(), "openwork-restart-"));
  const first = new OpenWorkRuntime({ dataDir, skillsDir: SKILLS_DIR, autoApprove: true });
  const task = await first.createTask("写一份重启恢复验证", { autoRun: false });
  assert.equal(first.getTask(task.id)?.status, "pending");
  first.shutdown();

  const second = new OpenWorkRuntime({ dataDir, skillsDir: SKILLS_DIR, autoApprove: true });
  try {
    await waitFor(() => second.getTask(task.id)?.status === "completed");
    assert.equal(second.getTask(task.id)?.status, "completed");
    assert.ok(
      second.listEvents(task.id).some((e) => e.type === "task.resumed"),
      "重启后应自动续跑并留痕",
    );
    console.log("  ✓ 断点恢复：进程重启后自动续跑");
  } finally {
    second.shutdown();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

/** v0.3：技能安装 —— YAML 热加载 + 校验 */
async function testSkillInstall(): Promise<void> {
  await withRuntime(true, async (runtime) => {
    const yaml = [
      "id: test-custom-skill",
      "name: 测试技能",
      "description: 安装验证用技能",
      "outputFormat: html",
    ].join("\n");
    const skill = runtime.installSkillYaml(yaml);
    assert.equal(skill.id, "test-custom-skill");
    assert.ok(runtime.listSkills().some((s) => s.id === "test-custom-skill"));

    assert.throws(() => runtime.installSkillYaml("id: bad\nname: 缺字段"), /不完整/);
    assert.throws(
      () =>
        runtime.installSkillYaml(
          "id: bad-format\nname: x\ndescription: x\noutputFormat: exe",
        ),
      /outputFormat 非法/,
    );
    console.log("  ✓ 技能安装：YAML 校验 + 热加载");
  });
}

/** v0.5：主动澄清 —— 歧义目标规划前挂起提问，答案注入后续跑 */
async function testClarificationFlow(): Promise<void> {
  // 明确目标：不应触发澄清（宁缺勿滥——过度提问比漏问更伤信任）
  await withRuntime(true, async (runtime) => {
    const clear = await runtime.createTask("写一份AI工作台市场分析");
    await waitFor(() => runtime.getTask(clear.id)?.status === "completed");
    assert.equal(
      runtime.listClarifications(clear.id).length,
      0,
      "明确目标不应触发澄清",
    );
  });

  // 歧义目标：规划前挂起澄清 → 提交答案 → 注入续跑 → 完成
  await withRuntime(true, async (runtime) => {
    const task = await runtime.createTask("写个报告");
    await waitFor(() => runtime.getTask(task.id)?.status === "awaiting_clarification");

    const questions = runtime.listClarifications(task.id);
    assert.ok(questions.length >= 1, "应生成澄清问题");
    assert.ok(questions.every((q) => q.status === "pending"), "问题应为待答状态");
    assert.ok(
      runtime.listEvents(task.id).some((e) => e.type === "clarification.requested"),
      "应记录澄清请求事件",
    );

    const answers = questions.map(
      (q, i) =>
        i === 0 ? "AI 工作台行业趋势，面向企业决策者" : "详尽深度报告，包含数据与案例",
    );
    await runtime.submitClarifications(task.id, answers);
    await waitFor(() => runtime.getTask(task.id)?.status === "completed");

    assert.ok(
      runtime.listClarifications(task.id).every((q) => q.status === "answered"),
      "答案应全部落库",
    );
    assert.ok(
      runtime.listEvents(task.id).some((e) => e.type === "clarification.answered"),
      "应记录澄清回答事件",
    );

    // 澄清答案确实注入了写作链路（mock 回显验证注入闭环）
    const [deliverable] = runtime
      .listDeliverables()
      .filter((d) => d.taskId === task.id);
    const file = deliverable ? runtime.readDeliverable(deliverable.id) : null;
    assert.ok(
      file?.data.toString().includes("已落实澄清要求"),
      "澄清答案应注入写作上下文",
    );
    console.log(`  ✓ 主动澄清：${questions.length} 问挂起 → 答案注入 → 完成`);
  });

  // 跳过澄清：按现有信息继续规划
  await withRuntime(true, async (runtime) => {
    const task = await runtime.createTask("随便写点东西");
    await waitFor(() => runtime.getTask(task.id)?.status === "awaiting_clarification");
    await runtime.submitClarifications(task.id, [], true);
    await waitFor(() => runtime.getTask(task.id)?.status === "completed");
    assert.ok(
      runtime.listEvents(task.id).some((e) => e.type === "clarification.skipped"),
      "应记录跳过事件",
    );
    console.log("  ✓ 主动澄清：跳过后按现有信息完成");
  });
}

/** v0.5：步骤置信度传播 —— 每步打分 + 任务级传播 + 校验聚焦 */
async function testConfidencePropagation(): Promise<void> {
  // 评分函数单元行为：结构完整有数据 → 高置信；短且对冲 → 低置信
  const high = scoreStepConfidence(
    [
      "# 研究笔记：AI 工作台市场分析",
      "",
      "## 背景与现状",
      "- 2024 年全球 AI 工作台市场规模约 120 亿美元，年增长率 35%",
      "- 头部玩家已形成差异化格局：微软 Copilot 深度绑定 Office 生态，OpenAI 依托 ChatGPT 入口",
      "- 开放中立方案仍属稀缺，本地优先架构开始获得企业采购关注",
      "- 典型客户画像：知识工作者密集型团队，月活 5000 人以上的中大型组织",
      "",
      "## 关键数据",
      "| 指标 | 2023 | 2024 | 2025E |",
      "| --- | --- | --- | --- |",
      "| 市场规模（亿美元） | 65 | 120 | 190 |",
      "| 付费渗透率 | 8% | 15% | 24% |",
      "| 平均客单价（美元/年） | 240 | 280 | 320 |",
      "",
      "## 趋势判断",
      "1. 任务式交付将取代对话式生成成为主流交互范式",
      "2. 成本敏感客户会优先选择多模型路由 + 本地模型的混合架构",
      "3. 语义级审批（一次审一版成果）将逐步取代逐工具确认的交互模式",
      "4. 技能资产以开放格式跨平台流通将成为生态分水岭",
    ].join("\n"),
  );
  assert.ok(high >= 0.8, `结构完整的产出应高置信（实际 ${(high * 100).toFixed(0)}%）`);

  const low = scoreStepConfidence("这个问题我无法确定，也许需要更多资料，暂时缺少信息。");
  assert.ok(low < 0.6, `对冲短输出应低置信（实际 ${(low * 100).toFixed(0)}%）`);

  // 集成：任务执行全程记录置信度轨迹并传播到任务级
  await withRuntime(true, async (runtime) => {
    const task = await runtime.createTask("写一份AI工作台市场分析");
    await waitFor(() => runtime.getTask(task.id)?.status === "completed");

    const confidence = runtime.getTaskConfidence(task.id);
    assert.ok(confidence, "应返回置信度轨迹");
    assert.ok(
      confidence!.steps.length >= 2,
      "research 与 draft 步骤都应被打分",
    );
    // 乘性传播：任务置信度 = 各步骤置信度之积
    const product = confidence!.steps.reduce((acc, s) => acc * s.confidence, 1);
    assert.ok(
      Math.abs(product - confidence!.taskConfidence) < 1e-9,
      "任务置信度应为步骤置信度乘积",
    );
    assert.ok(
      runtime.listEvents(task.id).some((e) => e.type === "confidence.updated"),
      "应记录置信度更新事件",
    );
    assert.ok(
      confidence!.taskConfidence > 0.5,
      "正常产出任务置信度应保持健康",
    );
    console.log(
      `  ✓ 置信度传播：${confidence!.steps.length} 步打分，任务置信度 ${(confidence!.taskConfidence * 100).toFixed(0)}%`,
    );
  });
}

/** v0.5：经验回放 —— 成功轨迹蒸馏入库 + 相似任务召回注入规划器 */
async function testPlaybookReplay(): Promise<void> {
  await withRuntime(true, async (runtime) => {
    // 首个任务：无经验可召回，成功后蒸馏入库
    const first = await runtime.createTask("写一份量子计算行业研究");
    await waitFor(() => runtime.getTask(first.id)?.status === "completed");

    assert.equal(runtime.listPlaybooks().length, 1, "成功任务应蒸馏出 playbook");
    const [playbook] = runtime.listPlaybooks();
    assert.ok(playbook!.steps.length >= 2, "playbook 应包含成功路径骨架");
    assert.ok(playbook!.outcome.length > 0, "playbook 应包含成功要点");
    assert.ok(
      runtime.listEvents(first.id).some((e) => e.type === "playbook.saved"),
      "应记录经验固化事件",
    );

    // 相似任务：召回注入规划器 + 计数增长
    const second = await runtime.createTask("写一份量子计算技术调研");
    await waitFor(() => runtime.getTask(second.id)?.status === "completed");

    assert.ok(
      runtime.listEvents(second.id).some((e) => e.type === "playbook.recalled"),
      "相似任务应召回历史经验",
    );
    assert.equal(
      runtime.listPlaybooks().length,
      2,
      "不同目标应新增经验（大粒度去重）",
    );

    // 同目标重复成功：合并刷新而非重复入库，且召回计数增长
    const repeat = await runtime.createTask("写一份量子计算行业研究");
    await waitFor(() => runtime.getTask(repeat.id)?.status === "completed");
    const playbooks = runtime.listPlaybooks();
    assert.equal(
      playbooks.filter((p) => p.goalPattern === "写一份量子计算行业研究").length,
      1,
      "同目标重复成功应合并刷新",
    );
    const reused = playbooks.find((p) => p.goalPattern === "写一份量子计算行业研究")!;
    assert.ok(reused.useCount >= 1, "召回应累计使用次数");

    // 用户治理：删除经验
    assert.ok(runtime.deletePlaybook(reused.id), "应可删除经验");
    assert.ok(
      !runtime.listPlaybooks().some((p) => p.id === reused.id),
      "删除后不应存在",
    );
    console.log(`  ✓ 经验回放：蒸馏入库 → 相似召回 → 去重刷新 → 治理删除`);
  });
}

/** v0.5：上下文压缩 —— 远期步骤要点化（结构行保留 + 预算控制） */
async function testContextCompaction(): Promise<void> {
  // 短产出不动
  const short = "# 笔记\n- 要点一";
  assert.equal(compactStepResult(short), short, "预算内不应压缩");

  // 长结构化产出：保留骨架（标题/列表/表格），压缩后带标记且在预算附近
  const long = [
    "# 研究笔记：长期任务上下文管理",
    "",
    ...Array.from({ length: 40 }, (_, i) => `第 ${i} 段散文内容。`.repeat(20)),
    "## 关键要点",
    ...Array.from(
      { length: 24 },
      (_, i) => `- 要点${i + 1}：长程任务的远期历史应要点化以对抗注意力稀释`,
    ),
    "| 指标 | v1 | v2 |",
    "| --- | --- | --- |",
    "| 上下文长度 | 40k | 12k |",
  ].join("\n");
  const compacted = compactStepResult(long);
  assert.ok(compacted.startsWith("【已压缩："), "压缩后应带标记");
  assert.ok(compacted.length < long.length / 2, "压缩应显著缩减体量");
  assert.ok(compacted.includes("## 关键要点"), "结构行应保留");
  assert.ok(compacted.includes("| 指标 | v1 | v2 |"), "表格行应保留");

  // 散文式长产出（结构行过少）：回退原文截断，仍有标记
  const prose = "这是一段很长的散文内容，没有任何结构。".repeat(100);
  const compactedProse = compactStepResult(prose);
  assert.ok(compactedProse.startsWith("【已压缩："), "散文超限也应压缩");
  assert.ok(compactedProse.length <= 1300, "截断后应在预算附近");
  console.log(
    `  ✓ 上下文压缩：${long.length.toLocaleString()} → ${compacted.length.toLocaleString()} 字符（骨架保留）`,
  );
}

/** v0.5：批判-精炼循环 —— revise 判定 → 带批评重写 → 版本化 → 复检通过 */
async function testRefineLoop(): Promise<void> {
  await withRuntime(true, async (runtime) => {
    // 目标含「精炼」：mock VERIFIER 初检 revise（含 3 条结构化批评），复检 pass
    const task = await runtime.createTask("写一份需要精炼的市场报告");
    await waitFor(() => runtime.getTask(task.id)?.status === "completed");

    const events = runtime.listEvents(task.id);
    const types = events.map((e) => e.type);
    assert.ok(types.includes("refine.looping"), "应记录精炼循环启动事件");
    assert.ok(types.includes("refine.completed"), "应记录精炼完成事件");
    assert.ok(types.includes("deliverable.versioned"), "精炼应产出成果新版本");

    const looping = events.find((e) => e.type === "refine.looping")!;
    assert.ok(
      (looping.detail ?? "").includes("引言未点明委托背景"),
      "循环事件应携带结构化批评",
    );

    // 成果版本链：v1 初稿 → v2 精炼版 → v3 证据审计版（git 化 diff 的基础）
    const [deliverable] = runtime
      .listDeliverables()
      .filter((d) => d.taskId === task.id);
    assert.ok(deliverable, "应存在成果");
    assert.equal(deliverable.version, 3, "精炼后为 v2、证据审计追加 v3");
    const versions = runtime.listVersions(deliverable.id);
    assert.equal(versions.length, 3, "应有三条版本记录");
    assert.ok(
      versions.some((v) => v.version === 3 && (v.note ?? "").includes("证据审计")),
      "最新版本应为证据审计版",
    );

    const file = runtime.readDeliverable(deliverable.id)!;
    assert.ok(
      file.data.toString().includes("【已精炼】"),
      "成果应为精炼后正文",
    );
    assert.ok(
      file.data.toString().includes("已落实："),
      "批评条目应被逐条落实回显",
    );
    assert.ok(
      file.data.toString().includes("证据审计"),
      "审计附录应追加到最终成果",
    );

    // 复检通过：最终校验结论为 pass
    const source = file.data.toString();
    assert.ok(!source.includes("待改进正文"), "精炼输出不应残留提示词结构");
    console.log("  ✓ 批判-精炼：revise 判定 → 3 条批评重写 → v2 版本化 → 复检通过");
  });
}

async function main(): Promise<void> {
  await testAutoApproveFlow();
  await testManualApprovalFlow();
  await testRejectFlow();
  await testSkillFlow();
  await testUsageSummary();
  await testPlanCache();
  await testParallelResearch();
  await testStreamingEvents();
  await testRoutingPersistence();
  await testDiffEngine();
  await testTools();
  await testRevisionFlow();
  await testResumeFlows();
  await testSkillInstall();
  await testClarificationFlow();
  await testConfidencePropagation();
  await testPlaybookReplay();
  await testContextCompaction();
  await testRefineLoop();
  console.log("core: 全部测试通过");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
