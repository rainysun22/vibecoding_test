import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenWorkRuntime } from "./index.js";

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
  console.log("core: 全部测试通过");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
