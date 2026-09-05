import type {
  CompletionRequest,
  CompletionResponse,
  ModelInfo,
  StreamChunk,
} from "@openwork/types";
import type { LLMProvider } from "../provider.js";

/**
 * Mock Provider —— 零依赖离线演示与 CI 验证。
 * 依据请求内容确定性地生成计划/正文/验证 JSON，让全流程
 * 在无任何 API 密钥下端到端可用（本地优先的极致形态）。
 */
export class MockProvider implements LLMProvider {
  readonly id = "mock" as const;
  readonly label = "Mock (离线演示)";

  listModels(): ModelInfo[] {
    return [
      {
        id: "mock/mock-agent",
        provider: "mock",
        label: "Mock Agent (离线)",
        inputPricePerMTok: 0,
        outputPricePerMTok: 0,
        contextWindow: 128_000,
        tier: "economy",
      },
    ];
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const content = this.synthesize(request);
    // 模拟网络与生成延迟
    await sleep(120 + Math.random() * 200);
    const promptTokens = roughTokens(
      request.messages.map((m) => m.content).join("\n"),
    );
    const completionTokens = roughTokens(content);
    return {
      content,
      model: request.model,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costUSD: 0,
      },
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const content = this.synthesize(request);
    const chunks = splitReadable(content, 24);
    for (const chunk of chunks) {
      await sleep(18);
      yield { delta: chunk, done: false };
    }
    const promptTokens = roughTokens(
      request.messages.map((m) => m.content).join("\n"),
    );
    const completionTokens = roughTokens(content);
    yield {
      delta: "",
      done: true,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costUSD: 0,
      },
    };
  }

  async testConnection(): Promise<boolean> {
    return true;
  }

  /** 依据 system 指令中的任务标记生成对应结构化输出 */
  private synthesize(request: CompletionRequest): string {
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    const userText = lastUser?.content ?? "";
    const goal = extractGoal(userText);
    const systemText = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");

    if (systemText.includes("PLANNER")) return mockPlan(goal);
    if (systemText.includes("VERIFIER")) return mockVerdict(goal, userText);
    if (systemText.includes("REFINER")) return mockRefine(userText, goal);
    if (systemText.includes("SYNTHESIZER")) return mockSynthesis(userText, goal);
    if (systemText.includes("TITLE_MAKER")) return `「${goal}」深度成果报告`;
    if (systemText.includes("RESEARCHER")) return mockResearch(goal, userText);
    return mockBody(goal, systemText, userText);
  }
}

/** 聚合输出：回显子任务清单（集成测试可断言 fork-join 链路） */
function mockSynthesis(userText: string, goal: string): string {
  const groups = [...userText.matchAll(/【子任务 (\d+)：(.+?)】/g)].map(
    (m) => `${m[1]}. ${m[2]}`,
  );
  if (groups.length === 0) {
    return `# 「${goal}」聚合报告\n\n（无子任务成果可聚合）`;
  }
  return [
    `# 「${goal}」聚合报告`,
    "",
    ...groups.map((g) => `## ${g}\n\n（本节由对应子任务成果聚合而成，去除重复并统一口径）`),
    "",
    "以上内容经 SYNTHESIZER 聚合：独立调研 → 统一正文。",
  ].join("\n");
}

/** 研究输出：命中知识库时回显（集成测试可断言召回注入链路） */
function mockResearch(goal: string, userText: string): string {
  const hits = [...userText.matchAll(/【个人知识库：(.+?)（相关度 \d+%）】/g)].map((m) => m[1]);
  const header = hits.length > 0 ? `- 知识库命中：${hits.join("、")}` : "";
  const base = [
    `# 研究笔记：${goal}`,
    "",
    "## 背景与现状",
    "- 该领域正处于快速演进期，核心驱动因素包括技术成熟度提升与用户预期变化。",
    "- 头部玩家已形成差异化格局，但开放中立方案仍属稀缺。",
    "",
    "## 关键要点",
    "1. **结构趋势**：从问答式交互转向任务式交付，成果物成为核心价值锚点。",
    "2. **成本结构**：多模型路由与本地模型可显著降低边际成本。",
    "3. **信任机制**：语义级审批优于逐 token 审批，兼顾效率与可控。",
  ];
  if (header) base.splice(2, 0, header);
  return base.join("\n");
}

/* ----------------------------- 确定性合成 ----------------------------- */

function extractGoal(text: string): string {
  const match = text.match(/委托目标[:：]\s*(.+)/);
  if (match?.[1]) return match[1].trim().slice(0, 80);
  return text.replace(/\s+/g, " ").trim().slice(0, 80) || "未命名目标";
}

function mockPlan(goal: string): string {
  // 对比类目标 → 双研究步骤（两侧并行调研），用于演示/验证 research 并行执行
  if (/对比|比较|versus|\bvs\.?\b/i.test(goal)) {
    return JSON.stringify(
      {
        summary: `围绕「${goal}」的双侧调研-对比撰写-交付计划`,
        steps: [
          {
            kind: "research",
            title: "调研甲方主题",
            instruction: `围绕「${goal}」中的第一个对象收集要点：定位、优势、风险。`,
          },
          {
            kind: "research",
            title: "调研乙方主题",
            instruction: `围绕「${goal}」中的第二个对象收集要点：定位、优势、风险。`,
          },
          {
            kind: "draft",
            title: "撰写对比正文",
            instruction: `基于两侧研究笔记，围绕「${goal}」撰写结构完整的对比分析正文。使用 Markdown。`,
          },
          {
            kind: "deliver",
            title: "生成最终成果文件",
            instruction: `将正文整理为最终交付成果，标题聚焦「${goal}」。`,
          },
        ],
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      summary: `围绕「${goal}」生成结构化成果物的研究-撰写-交付计划`,
      steps: [
        {
          kind: "research",
          title: "调研核心主题与关键数据",
          instruction: `围绕「${goal}」收集要点：背景、现状、关键数据、趋势。输出为要点式研究笔记。`,
        },
        {
          kind: "draft",
          title: "撰写正文初稿",
          instruction: `基于研究笔记，围绕「${goal}」撰写结构完整、观点清晰的正文（含引言、主体、结论）。使用 Markdown。`,
        },
        {
          kind: "deliver",
          title: "生成最终成果文件",
          instruction: `将正文整理为最终交付成果，标题聚焦「${goal}」。`,
        },
      ],
    },
    null,
    2,
  );
}

function mockBody(goal: string, systemText: string, userText?: string): string {
  // 正文回显中途转向指令（集成测试可断言 steering 注入链路）
  const steering = [...(userText ?? "").matchAll(/用户中途补充指令[^\n]*\n([\s\S]*?)(?=\n\n|$)/g)]
    .flatMap((m) => m[1]!.split("\n"))
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  const steeringNote =
    steering.length > 0 ? `> 已落实用户中途指令：${steering.join("；")}` : "";

  // 正文回显澄清答案（集成测试可断言 clarification 注入链路）
  const clarified = [...(userText ?? "").matchAll(/问：(.+?)\n答：(.+)/g)].map((m) => m[2]!.trim());
  const clarifyNote = clarified.length > 0 ? `> 已落实澄清要求：${clarified.join("；")}` : "";

  const title = `「${goal}」深度成果报告`;
  return [
    `# ${title}`,
    "",
    "> 由 OpenWork Agent 离线演示引擎生成 —— 配置任一真实模型提供商后，本文将由所选模型实时撰写。",
    ...(steeringNote ? ["", steeringNote] : []),
    ...(clarifyNote ? ["", clarifyNote] : []),
    "",
    "## 一、引言",
    "",
    `围绕「${goal}」，本报告从背景、现状与趋势三个维度展开分析，力求给出结构完整、观点清晰、可被直接使用的成果内容。`,
    "",
    "## 二、核心分析",
    "",
    "### 2.1 背景",
    "",
    "任务式 AI 交付正从「对话生成」演进为「成果交付」：用户委托目标，系统负责拆解、执行、校验并产出开放格式文件。这一范式转变对开放性、成本与信任提出了新的要求。",
    "",
    "### 2.2 现状",
    "",
    "- **生态格局**：主流产品闭源且深度绑定各自生态，中立方案稀缺。",
    "- **成本曲线**：多模型分层路由已成降本主流路径，本地模型承担长尾任务。",
    "- **信任设计**：语义级审批（一次审一版成果）逐步取代逐工具确认。",
    "",
    "### 2.3 趋势",
    "",
    "1. 成果物将全面 git 化：可 diff、可回滚、可审计来源。",
    "2. 技能资产将以开放格式跨平台流通。",
    "3. 本地优先架构与云端协同将长期共存。",
    "",
    "## 三、结论",
    "",
    `针对「${goal}」，建议采用「结构化拆解 + 开放格式交付 + 语义级审批」的组合路径，在保证成果质量的同时实现成本与信任的平衡。`,
    "",
    "## 四、附录",
    "",
    "- 生成引擎：OpenWork Mock Provider（离线确定性输出）",
    "- 适用场景：演示、CI、无网络环境",
  ].join("\n");
}

function mockVerdict(goal: string, userText: string): string {
  // 精炼闭环的确定性触发：目标含「精炼/revise」标记 → 初检 revise；
  // 重写后的正文带【已精炼】标记 → 复检 pass（测试可断言批判-精炼循环）
  const refined = userText.includes("【已精炼】");
  const wantsRefine = /精炼|需改进|revise/i.test(goal);
  if (wantsRefine && !refined) {
    return JSON.stringify(
      {
        verdict: "revise",
        score: 61,
        strengths: ["结构基本完整"],
        issues: [
          "引言未点明委托背景，需补充目标语境",
          "核心论据缺少数据支撑，需补齐关键数字",
          "结论过于笼统，需给出可执行建议",
        ],
      },
      null,
      2,
    );
  }
  return JSON.stringify(
    {
      verdict: "pass",
      score: 88,
      strengths: [
        "结构完整：引言-分析-结论-附录齐备",
        "内容与委托目标「" + goal + "」直接相关",
        "使用开放 Markdown 格式，可无损迁移",
      ],
      issues: ["离线演示内容为模板生成，接入真实模型后质量将进一步提升"],
    },
    null,
    2,
  );
}

/** 精炼输出：回显批评条目（集成测试可断言批评注入链路），带复检识别标记 */
function mockRefine(userText: string, goal: string): string {
  const critiqueBlock = userText.split("校验批评")[1] ?? "";
  const issues = [...critiqueBlock.matchAll(/^\d+\.\s*(.+)$/gm)].map((m) => m[1]!.trim());
  const applied =
    issues.length > 0
      ? issues.map((issue, i) => `${i + 1}. 已落实：${issue}`).join("\n")
      : "（无批评条目）";
  return [
    `# 「${goal}」深度成果报告（精炼版）`,
    "",
    "> 【已精炼】本轮正文依据校验批评逐条改写。",
    "",
    "## 批评落实清单",
    "",
    applied,
    "",
    "## 精炼后正文",
    "",
    "围绕委托目标的结构完整分析，论据补齐数据支撑，结论给出可执行建议。",
  ].join("\n");
}

/* ----------------------------- 工具函数 ----------------------------- */

function roughTokens(text: string): number {
  // 粗略估算：中文约 1 字/token，英文约 4 字符/token
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const other = text.length - cjk;
  return cjk + Math.ceil(other / 4);
}

function splitReadable(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
