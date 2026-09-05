import { createHash, randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type {
  Checkpoint,
  DeliverableMeta,
  Plan,
  PlanStep,
  SkillDefinition,
  Task,
  TaskEvent,
  TokenUsage,
} from "@openwork/types";
import type { CompletionRequest } from "@openwork/types";
import type { LLMGateway } from "@openwork/llm-gateway";
import { generateDeliverable } from "@openwork/deliverables";
import type { GenerateInput, GenerateOutput } from "@openwork/deliverables";
import { Storage } from "./storage.js";
import { DeliverableStore } from "./deliverable-store.js";
import type { EventBus } from "./events.js";

/**
 * Agent 运行核心 —— plan → act → verify 循环。
 *
 * 设计要点：
 * 1. 可恢复执行：运行状态持久化于 tasks.run_state，审批通过或进程重启后从断点续跑
 * 2. 语义级审批（N4 真需求）：仅在「计划」与「最终成果」两个粒度设置 checkpoint
 * 3. 任务轨迹（N5 真需求）：每一步落为 TaskEvent，可完整回放与审计
 * 4. 用量归集：每次 LLM 调用的 token 与成本实时累计回任务台账
 */

interface RunState {
  phase: "planning" | "executing" | "verifying" | "done";
  plan: Plan | null;
  stepIndex: number;
  stepResults: string[];
  draft: string | null;
  deliverableId: string | null;
  verification: string | null;
  deliverableApproved: boolean;
}

const emptyState = (): RunState => ({
  phase: "planning",
  plan: null,
  stepIndex: 0,
  stepResults: [],
  draft: null,
  deliverableId: null,
  verification: null,
  deliverableApproved: false,
});

/** 流式增量节流间隔：兼顾首字延迟与 SSE 帧数 */
const STREAM_FLUSH_MS = 100;
/** worker 生成成果的超时保护 */
const WORKER_TIMEOUT_MS = 60_000;
/** 重格式（需 zip 打包，值得移出主线程） */
const HEAVY_FORMATS = new Set(["docx", "xlsx", "pptx"]);

export interface AgentOptions {
  /** 自动审批（演示/受信场景）。默认 false —— 语义级审批是核心信任机制 */
  autoApprove: boolean;
}

export class AgentRunner {
  constructor(
    private readonly storage: Storage,
    private readonly store: DeliverableStore,
    private readonly gateway: LLMGateway,
    private readonly bus: EventBus,
    private readonly options: AgentOptions,
  ) {}

  /* ------------------------------ 主循环 ------------------------------ */

  /** 运行任务直至完成或被审批阻塞 */
  async run(taskId: string): Promise<void> {
    const task = this.storage.getTask(taskId);
    if (!task) return;
    if (["completed", "failed", "cancelled", "awaiting_approval"].includes(task.status)) return;

    const state = (task.runState as RunState | null) ?? emptyState();

    try {
      if (state.phase === "planning") {
        await this.phasePlan(task, state);
        if (this.isPaused(task.id)) return; // 计划等待审批
      }
      if (state.phase === "executing") {
        await this.phaseExecute(task, state);
      }
      if (state.phase === "verifying") {
        await this.phaseVerify(task, state);
        if (this.isPaused(task.id)) return; // 成果等待审批
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitEvent(taskId, "task.failed", "任务失败", message);
      this.storage.updateTask(taskId, { status: "failed", error: message });
      throw error;
    }
  }

  /** 任务是否已暂停于审批点 */
  private isPaused(taskId: string): boolean {
    return this.storage.getTask(taskId)?.status === "awaiting_approval";
  }

  /* ------------------------------ 阶段：计划 ------------------------------ */

  private async phasePlan(task: Task, state: RunState): Promise<void> {
    this.storage.updateTask(task.id, { status: "planning" });
    this.emitEvent(task.id, "task.planning", "正在拆解委托目标");

    const skill = task.skillId ? this.lookupSkill?.(task.skillId) : undefined;
    const skillSection = skill
      ? `技能约束：${skill.name} —— ${skill.description}\n期望产出格式：${skill.outputFormat}${skill.planHints ? `\n计划提示：${skill.planHints}` : ""}`
      : "";

    // 计划缓存：相似目标直接复用历史计划（省一次强模型调用，v0.2 成本优化）
    const cacheKey = planCacheKey(task.goal, task.skillId);
    const cached = this.storage.getPlanCache(cacheKey);

    let plan: Plan;
    if (cached) {
      plan = parsePlan(cached.planJson, task.id); // 复用解析器：重置步骤状态并兜底校验
    } else {
      const planJson = await this.llm(
        task.id,
        "PLANNER",
        [
          {
            role: "user",
            content: `委托目标：${task.goal}\n${skillSection}\n请生成执行计划。`,
          },
        ],
        "planning",
      );
      plan = parsePlan(planJson, task.id);
      this.storage.putPlanCache(cacheKey, JSON.stringify(plan));
    }

    state.plan = plan;
    this.persist(task.id, state, "planning");
    this.emitEvent(
      task.id,
      "plan.ready",
      cached
        ? `计划就绪（缓存命中 ×${cached.hits}）：${plan.steps.length} 个步骤`
        : `计划就绪：${plan.steps.length} 个步骤`,
      plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join("\n"),
    );

    if (this.options.autoApprove) {
      this.emitEvent(task.id, "checkpoint.approved", "自动审批（受信模式）：计划通过");
      state.phase = "executing";
      this.persist(task.id, state, "executing");
      return;
    }

    const checkpoint = this.createCheckpoint(
      task.id,
      "plan",
      "审批执行计划",
      formatPlanForReview(plan),
    );
    state.phase = "executing";
    this.storage.updateTask(task.id, { runState: state, status: "awaiting_approval" });
    this.emitEvent(task.id, "checkpoint.requested", "等待审批：执行计划", checkpoint.id);
  }

  /* ------------------------------ 阶段：执行 ------------------------------ */

  private async phaseExecute(task: Task, state: RunState): Promise<void> {
    const plan = state.plan;
    if (!plan) throw new Error("缺少执行计划");
    this.storage.updateTask(task.id, { status: "executing" });

    const steps = plan.steps;
    while (state.stepIndex < steps.length) {
      const step = steps[state.stepIndex];
      if (!step) break;

      // 连续 research 步骤并行执行（v0.2 速度优化；研究之间本就无依赖）
      if (step.kind === "research") {
        const batch: PlanStep[] = [];
        while (state.stepIndex + batch.length < steps.length) {
          const next = steps[state.stepIndex + batch.length];
          if (!next || next.kind !== "research") break;
          batch.push(next);
        }

        for (const item of batch) {
          this.emitEvent(task.id, "step.started", `步骤 ${steps.indexOf(item) + 1}/${steps.length}：${item.title}`);
        }
        if (batch.length > 1) {
          this.emitEvent(task.id, "step.started", `并行执行 ${batch.length} 个研究步骤`);
        }

        const results = await Promise.all(batch.map((item) => this.executeStep(task, item, state)));
        batch.forEach((item, index) => {
          const result = results[index]!;
          state.stepResults.push(result);
          item.status = "done";
          item.result = result.slice(0, 500);
          state.stepIndex += 1;
          this.emitEvent(task.id, "step.completed", `完成：${item.title}`, result.slice(0, 200));
        });
        this.persist(task.id, state, "executing");
        continue;
      }

      this.emitEvent(
        task.id,
        "step.started",
        `步骤 ${state.stepIndex + 1}/${steps.length}：${step.title}`,
      );

      const result = await this.executeStep(task, step, state);
      state.stepResults.push(result);
      step.status = "done";
      step.result = result.slice(0, 500);
      state.stepIndex += 1;
      this.persist(task.id, state, "executing");
      this.emitEvent(task.id, "step.completed", `完成：${step.title}`, result.slice(0, 200));
    }

    // 交回主循环调度校验阶段（保持单一控制流，避免重入）
    state.phase = "verifying";
    this.persist(task.id, state, "verifying");
  }

  private async executeStep(task: Task, step: PlanStep, state: RunState): Promise<string> {
    switch (step.kind) {
      case "research": {
        return this.llm(
          task.id,
          "RESEARCHER",
          [
            {
              role: "user",
              content: `委托目标：${task.goal}\n任务：${step.instruction}\n请输出要点式研究笔记（Markdown）。`,
            },
          ],
          "execution",
          { streamId: step.id },
        );
      }
      case "draft": {
        const researchNotes = state.stepResults
          .map((result, index) => ({ result, kind: state.plan?.steps[index]?.kind }))
          .filter((entry) => entry.kind === "research")
          .map((entry) => entry.result)
          .join("\n\n");

        const content = await this.llm(
          task.id,
          "WRITER",
          [
            {
              role: "user",
              content: [
                `委托目标：${task.goal}`,
                researchNotes ? `研究笔记：\n${researchNotes}` : "",
                `任务：${step.instruction}`,
                "请直接输出正文（Markdown，不要输出计划说明）。",
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          ],
          "execution",
          { streamId: step.id },
        );
        state.draft = content;
        return content;
      }
      case "deliver": {
        const draft = state.draft;
        if (!draft) throw new Error("交付步骤缺少正文草稿");
        const format = step.outputFormat ?? "markdown";
        const skill = task.skillId ? this.lookupSkill?.(task.skillId) : undefined;
        const finalFormat = skill?.outputFormat ?? format;
        const title = await this.makeTitle(task.goal);
        const meta = await this.createDeliverable(task, title, finalFormat, draft, step.title);
        state.deliverableId = meta.id;
        this.emitEvent(
          task.id,
          "deliverable.created",
          `成果已交付：${title}（.${finalFormat}）`,
          `版本 v${meta.version} · 开放格式`,
        );
        return `已生成 ${finalFormat} 成果「${title}」`;
      }
    }
  }

  /* ------------------------------ 阶段：校验 ------------------------------ */

  private async phaseVerify(task: Task, state: RunState): Promise<void> {
    // 已校验：处理审批终态
    if (state.verification) {
      if (!this.options.autoApprove && !state.deliverableApproved) return; // 等待审批
      this.finish(task, state);
      return;
    }

    this.storage.updateTask(task.id, { status: "verifying" });
    this.emitEvent(task.id, "task.verifying", "正在校验成果质量");

    const draft = state.draft ?? "";
    const verdict = await this.llm(
      task.id,
      "VERIFIER",
      [
        {
          role: "user",
          content: [
            `委托目标：${task.goal}`,
            `成果正文：\n${draft.slice(0, 8000)}`,
            "请校验成果是否满足委托目标，输出 JSON：{verdict, score, strengths[], issues[]}",
          ].join("\n\n"),
        },
      ],
      "verifying",
    );
    state.verification = verdict;
    this.persist(task.id, state, "verifying");
    this.emitEvent(task.id, "task.verifying", "质量校验完成", verdict.slice(0, 300));

    if (this.options.autoApprove) {
      this.emitEvent(task.id, "checkpoint.approved", "自动审批（受信模式）：成果通过");
      state.deliverableApproved = true;
      this.finish(task, state);
      return;
    }

    const checkpoint = this.createCheckpoint(
      task.id,
      "deliverable",
      "审批最终成果",
      `${draft.slice(0, 4000)}\n\n---\n质量校验：\n${verdict}`,
    );
    this.storage.updateTask(task.id, { runState: state, status: "awaiting_approval" });
    this.emitEvent(task.id, "checkpoint.requested", "等待审批：最终成果", checkpoint.id);
  }

  private finish(task: Task, state: RunState): void {
    state.phase = "done";
    this.storage.updateTask(task.id, {
      runState: state,
      status: "completed",
      completedAt: new Date().toISOString(),
    });
    this.emitEvent(task.id, "task.completed", "任务完成，成果可下载");
  }

  /* ------------------------------ 审批回调 ------------------------------ */

  /** 审批通过：从断点续跑 */
  async resumeApproved(taskId: string): Promise<void> {
    const task = this.storage.getTask(taskId);
    if (!task) return;
    const state = task.runState as RunState | null;
    if (!state) return;

    this.emitEvent(taskId, "checkpoint.approved", "审批通过，继续执行");

    if (state.verification) {
      state.deliverableApproved = true;
      this.finish(task, state);
      return;
    }

    state.phase = "executing";
    this.persist(taskId, state, "executing");
    await this.run(taskId);
  }

  /** 审批拒绝：任务终止（可重新发起） */
  rejectTask(taskId: string, comment?: string): void {
    this.emitEvent(taskId, "checkpoint.rejected", "审批被拒绝", comment);
    this.storage.updateTask(taskId, {
      status: "cancelled",
      error: comment ?? "委托被拒绝",
    });
  }

  /* ------------------------------ 成果生产 ------------------------------ */

  private async createDeliverable(
    task: Task,
    title: string,
    format: DeliverableMeta["format"],
    markdown: string,
    note?: string,
  ): Promise<DeliverableMeta> {
    const now = new Date().toISOString();
    const meta: DeliverableMeta = {
      id: randomUUID(),
      taskId: task.id,
      title,
      format,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const output = await this.generateFile({ title, markdown, format });
    const version = this.store.save(meta, output, note);
    this.storage.createDeliverable(meta, version);
    return meta;
  }

  /**
   * 成果文件生成：docx/xlsx/pptx 等 zip 重格式移入 worker 线程，
   * 避免大文件打包阻塞主事件循环（SSE 心跳与流式输出不受影响）。
   * worker 环境不可用时回退主线程生成。
   */
  private async generateFile(input: GenerateInput): Promise<GenerateOutput> {
    if (!HEAVY_FORMATS.has(input.format)) {
      return generateDeliverable(input);
    }
    try {
      const output = await runWorker<GenerateOutput>(
        new URL("./deliverable-worker.js", import.meta.url),
        { input },
        WORKER_TIMEOUT_MS,
      );
      // worker 传输后 Buffer 退化为 Uint8Array，恢复为 Buffer
      return { ...output, data: Buffer.from(output.data) };
    } catch {
      return generateDeliverable(input);
    }
  }

  private async makeTitle(goal: string): Promise<string> {
    const title = await this.llm(
      "",
      "TITLE_MAKER",
      [{ role: "user", content: `委托目标：${goal}\n请给出不超过 20 字的成果标题，只输出标题本身。` }],
      "execution",
    );
    return title.trim().replace(/^["'「]|["'」]$/g, "").slice(0, 40) || goal.slice(0, 20);
  }

  /* ------------------------------ 技能注入 ------------------------------ */

  private lookupSkill: ((id: string) => SkillDefinition | undefined) | null = null;

  /** Runtime 注入技能查询（保持 Agent 与 SkillRegistry 解耦） */
  setSkillLookup(lookup: (id: string) => SkillDefinition | undefined): void {
    this.lookupSkill = lookup;
  }

  /* ------------------------------ LLM 调用 ------------------------------ */

  private async llm(
    taskId: string,
    marker: string,
    messages: { role: "user" | "assistant"; content: string }[],
    purpose: "planning" | "execution" | "verifying",
    options: { streamId?: string } = {},
  ): Promise<string> {
    const model = this.gateway.modelForPurpose(purpose);
    const request: CompletionRequest = {
      model,
      messages: [{ role: "system", content: systemPrompt(marker) }, ...messages],
      temperature: purpose === "execution" ? 0.7 : 0.2,
    };

    // 流式优先：正文/研究笔记逐字直达前端（首字延迟从秒级降到百毫秒级）
    if (options.streamId) {
      try {
        return await this.streamWithEvents(taskId, options.streamId, model, request);
      } catch {
        // 流式失败（网络/适配器异常）→ 回退非流式，保证结果仍可交付
      }
    }

    const response = await this.gateway.complete(request);
    this.accountUsage(taskId, model, response.usage);
    return response.content;
  }

  /** 流式执行：增量节流后经 EventBus 广播（不落库，避免事件表膨胀） */
  private async streamWithEvents(
    taskId: string,
    streamId: string,
    model: string,
    request: CompletionRequest,
  ): Promise<string> {
    let content = "";
    let pending = "";
    let lastFlush = Date.now();
    let usage: TokenUsage | undefined;

    for await (const chunk of this.gateway.stream(request)) {
      if (chunk.delta) {
        content += chunk.delta;
        pending += chunk.delta;
        const now = Date.now();
        if (now - lastFlush >= STREAM_FLUSH_MS) {
          this.emitStreamDelta(taskId, streamId, pending);
          pending = "";
          lastFlush = now;
        }
      }
      if (chunk.usage) usage = chunk.usage;
      if (chunk.done) break;
    }

    if (pending) this.emitStreamDelta(taskId, streamId, pending);
    this.emitStreamDelta(taskId, streamId, "", true);
    if (usage) this.accountUsage(taskId, model, usage);
    return content;
  }

  private emitStreamDelta(taskId: string, streamId: string, delta: string, done = false): void {
    this.bus.emit("step.streaming", {
      type: "step.streaming",
      taskId,
      title: done ? "流式输出完成" : "流式生成中",
      at: new Date().toISOString(),
      streamId,
      delta,
      streamDone: done,
    });
  }

  /** 用量归集：任务台账累计 + 全局台账广播（成本透明） */
  private accountUsage(taskId: string, model: string, usage: TokenUsage): void {
    if (!taskId) return;
    this.addUsage(taskId, usage);
    this.bus.emit("usage.recorded", {
      type: "usage.recorded",
      taskId,
      title: "用量记录",
      detail: `${usage.totalTokens} tokens · $${usage.costUSD.toFixed(6)} · ${model}`,
      at: new Date().toISOString(),
      usage: {
        model,
        tokens: usage.totalTokens,
        costUSD: usage.costUSD,
      },
    });
  }

  private addUsage(taskId: string, delta: TokenUsage): void {
    const task = this.storage.getTask(taskId);
    if (!task) return;
    this.storage.updateTask(taskId, {
      usage: {
        promptTokens: task.usage.promptTokens + delta.promptTokens,
        completionTokens: task.usage.completionTokens + delta.completionTokens,
        totalTokens: task.usage.totalTokens + delta.totalTokens,
        costUSD: task.usage.costUSD + delta.costUSD,
      },
    });
  }

  /* ------------------------------ 事件与审批 ------------------------------ */

  private persist(taskId: string, state: RunState, status: Task["status"]): void {
    this.storage.updateTask(taskId, { runState: state, status });
  }

  private emitEvent(taskId: string, type: TaskEvent["type"], title: string, detail?: string): void {
    const event: TaskEvent = {
      id: randomUUID(),
      taskId,
      seq: this.storage.nextSeq(taskId),
      type,
      title,
      detail,
      createdAt: new Date().toISOString(),
    };
    this.storage.appendEvent(event);
    this.bus.emit(type, { type, taskId, title, detail, at: event.createdAt });
  }

  private createCheckpoint(
    taskId: string,
    kind: Checkpoint["kind"],
    title: string,
    payload: string,
  ): Checkpoint {
    const checkpoint: Checkpoint = {
      id: randomUUID(),
      taskId,
      kind,
      title,
      payload,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.storage.createCheckpoint(checkpoint);
    return checkpoint;
  }
}

/* ------------------------------ Prompts ------------------------------ */

function systemPrompt(marker: string): string {
  const guidance: Record<string, string> = {
    PLANNER:
      '输出严格的 JSON（无代码块包裹）：{"summary": string, "steps": [{"kind": "research"|"draft"|"deliver", "title": string, "instruction": string, "outputFormat": "markdown"|"html"|"docx"|"xlsx"|"pptx"}]}。3-5 个步骤，必须恰好一个 deliver 步骤置于最后。',
    RESEARCHER: "你是研究员。输出要点式 Markdown 研究笔记：背景、关键要点、可引用数据（含表格）。",
    WRITER: "你是专业撰稿人。输出结构完整的 Markdown 正文：标题层级、段落、列表、表格、引用。语言与委托目标一致。",
    TITLE_MAKER: "只输出标题本身，不超过 20 字。",
    VERIFIER:
      '输出严格的 JSON（无代码块包裹）：{"verdict": "pass"|"revise", "score": number, "strengths": string[], "issues": string[]}',
  };
  return `You are OpenWork Agent [${marker}]. ${guidance[marker] ?? ""}`;
}

/* ------------------------------ 工具函数 ------------------------------ */

/** 计划缓存键：目标归一化（大小写/空白）+ 技能约束 一起哈希 */
function planCacheKey(goal: string, skillId?: string): string {
  const normalized = goal.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(`${normalized}\n${skillId ?? ""}`).digest("hex");
}

/** 在 worker 线程执行任务并取回结果（带超时保护；异常向上抛出由调用方兜底） */
function runWorker<T>(url: URL, data: unknown, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(url, { workerData: data });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`worker 超时（${timeoutMs}ms）`));
    }, timeoutMs);

    worker.on("message", (message: { ok: boolean; output?: T; error?: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (message.ok && message.output !== undefined) resolve(message.output);
      else reject(new Error(message.error ?? "worker 执行失败"));
    });
    worker.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function parsePlan(json: string, taskId: string): Plan {
  const cleaned = extractJson(json);
  let parsed: {
    summary?: string;
    steps?: { kind?: string; title?: string; instruction?: string; outputFormat?: string }[];
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {};
  }

  const kinds = new Set(["research", "draft", "deliver"]);
  const steps: PlanStep[] = (parsed.steps ?? [])
    .filter((s) => s.kind && kinds.has(s.kind) && s.title)
    .map((s, index) => ({
      id: `step-${index + 1}`,
      kind: s.kind as PlanStep["kind"],
      title: s.title!,
      instruction: s.instruction ?? s.title!,
      outputFormat: normalizeFormat(s.outputFormat),
      status: "pending" as const,
    }));

  if (steps.length === 0) {
    // 兜底：无有效步骤时构造最小计划（保证鲁棒性）
    steps.push(
      { id: "step-1", kind: "draft", title: "撰写正文", instruction: "撰写结构完整正文", status: "pending", outputFormat: undefined },
      { id: "step-2", kind: "deliver", title: "生成交付成果", instruction: "生成最终成果文件", status: "pending", outputFormat: "markdown" },
    );
  }

  // 保证最后一个 deliver 步骤存在
  if (!steps.some((s) => s.kind === "deliver")) {
    steps.push({
      id: `step-${steps.length + 1}`,
      kind: "deliver",
      title: "生成交付成果",
      instruction: "生成最终成果文件",
      status: "pending",
      outputFormat: "markdown",
    });
  }

  return {
    taskId,
    summary: parsed.summary ?? "执行计划",
    steps,
    createdAt: new Date().toISOString(),
  };
}

function normalizeFormat(value?: string): PlanStep["outputFormat"] {
  const valid = new Set(["markdown", "html", "docx", "xlsx", "pptx"]);
  return valid.has(value ?? "") ? (value as PlanStep["outputFormat"]) : undefined;
}

function extractJson(text: string): string {
  const withoutFence = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start >= 0 && end > start) return withoutFence.slice(start, end + 1);
  return withoutFence.trim();
}

function formatPlanForReview(plan: Plan): string {
  const lines = plan.steps.map(
    (s, i) =>
      `${i + 1}. [${s.kind}] ${s.title}\n   ${s.instruction}${s.outputFormat ? `（输出 .${s.outputFormat}）` : ""}`,
  );
  return `摘要：${plan.summary}\n\n${lines.join("\n")}`;
}
