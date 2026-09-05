import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  Checkpoint,
  ClarificationQuestion,
  ConfidenceRecord,
  DeliverableDiff,
  DeliverableMeta,
  KnowledgeDoc,
  KnowledgeRecall,
  Playbook,
  ProviderConfig,
  ProviderId,
  Schedule,
  SkillDefinition,
  SteeringMessage,
  Task,
  TaskEvent,
  UsageSummary,
  UserProfile,
} from "@openwork/types";
import { LLMGateway, type RoutingConfig } from "@openwork/llm-gateway";
import { Storage } from "./storage.js";
import { DeliverableStore } from "./deliverable-store.js";
import { AgentRunner } from "./agent.js";
import { SkillRegistry } from "./skills.js";
import { Scheduler } from "./scheduler.js";
import { EventBus, type RuntimeEventPayload } from "./events.js";
import { buildDeliverableDiff } from "./diff.js";
import { recallKnowledge } from "./knowledge.js";

export interface RuntimeOptions {
  /** 数据目录（本地优先：全部状态落本机） */
  dataDir: string;
  /** 内置技能目录 */
  skillsDir: string;
  /** 自动审批（演示/受信模式）。默认 false —— 语义级审批是核心信任机制 */
  autoApprove?: boolean;
}

/** 委托创建选项 */
export interface CreateTaskOptions {
  skillId?: string;
  autoRun?: boolean;
  revisionOf?: Task["revisionOf"];
  /** v0.4 并行委托：显式分组时 fork 子任务并行执行后聚合 */
  parallelGroups?: string[];
}

/**
 * OpenWorkRuntime —— 组装一切的运行时门面。
 *
 * API 服务器只与它对话；它组装：
 * Storage（持久化）· AgentRunner（plan→act→verify）· LLMGateway（模型中立）
 * · DeliverableStore（成果版本化）· SkillRegistry（技能）· Scheduler（定时委托）
 */
export class OpenWorkRuntime {
  readonly storage: Storage;
  readonly gateway: LLMGateway;
  readonly bus: EventBus = new EventBus();
  private readonly store: DeliverableStore;
  private readonly agent: AgentRunner;
  private readonly skills: SkillRegistry;
  private readonly scheduler: Scheduler;

  constructor(options: RuntimeOptions) {
    this.storage = new Storage(options.dataDir);
    this.store = new DeliverableStore(join(options.dataDir, "deliverables"));
    this.gateway = new LLMGateway();

    // 恢复持久化的模型网关配置
    this.restoreGatewaySettings();
    // 恢复当日预算累计（重启不重置预算周期）+ 惰性清理过期计划缓存
    this.gateway.restoreSpentToday(this.storage.todayUsage().costUSD);
    this.storage.prunePlanCache();

    this.agent = new AgentRunner(
      this.storage,
      this.store,
      this.gateway,
      this.bus,
      { autoApprove: options.autoApprove ?? false },
    );

    this.skills = new SkillRegistry(options.skillsDir, join(options.dataDir, "skills"));
    this.agent.setSkillLookup((id) => this.skills.get(id));

    // fork-join 子任务派生通道：父任务计划阶段回调（隔离的子工作区）
    this.agent.setSubtaskSpawner(async (parentId, goal, index) => {
      await this.createSubtask(parentId, goal, index);
    });

    // 用量台账：结构化落库（成本透明）
    this.bus.subscribe((payload) => {
      if (payload.usage) {
        this.storage.recordUsage(
          payload.usage.model,
          payload.usage.tokens,
          payload.usage.costUSD,
          payload.taskId || undefined,
        );
      }
    });

    this.scheduler = new Scheduler(this.storage, (goal, skillId) => {
      void this.createTask(goal, { skillId });
    });
    this.scheduler.start();

    // 断点恢复：进程重启后从中断处续跑（审批暂停的任务除外）
    this.resumeInterrupted();
  }

  /* ------------------------------ 委托任务 ------------------------------ */

  async createTask(goal: string, options: CreateTaskOptions = {}): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      goal,
      status: "pending",
      skillId: options.skillId,
      revisionOf: options.revisionOf,
      parallelGroups: options.parallelGroups,
      createdAt: now,
      updatedAt: now,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUSD: 0 },
    };
    this.storage.createTask(task);
    this.bus.emit("task.created", {
      type: "task.created",
      taskId: task.id,
      title: options.parallelGroups?.length
        ? `新委托（并行 ×${options.parallelGroups.length}）：${goal.slice(0, 60)}`
        : `新委托：${goal.slice(0, 60)}`,
      at: now,
    });

    if (options.autoRun !== false) {
      void this.agent.run(task.id).catch(() => {
        // 错误已在 agent 内落库并广播
      });
    }
    return task;
  }

  /**
   * 并行委托：目标含多个独立子对象时 fork 多个子任务（v0.4）。
   * 未显式分组时按分隔词自动切分（、/，/，以及/和/与/vs）。
   */
  async createParallelTask(goal: string, groups?: string[]): Promise<Task> {
    const parts = groups ?? splitParallelGoal(goal);
    if (parts.length < 2) {
      return this.createTask(goal); // 不可切分：退化为普通委托
    }
    return this.createTask(goal, { parallelGroups: parts });
  }

  /** 子任务派生（fork-join）：独立运行，完成后回调父任务聚合 */
  private async createSubtask(parentId: string, goal: string, index: number): Promise<void> {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      goal: `并行子委托 ${index}：${goal}`,
      status: "pending",
      parentTaskId: parentId,
      batchIndex: index,
      createdAt: now,
      updatedAt: now,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUSD: 0 },
    };
    this.storage.createTask(task);
    void this.agent.run(task.id).catch(() => {
      // 错误已在 agent 内落库并广播；子任务失败不阻断兄弟任务
    });
  }

  /** 父任务的子任务清单（工作区隔离视图） */
  listSubtasks(parentId: string): Task[] {
    return this.storage.listSubtasks(parentId);
  }

  getTask(id: string): Task | null {
    return this.storage.getTask(id);
  }

  /**
   * 恢复被中断的任务（进程重启 / 手动续跑）。
   * 任务锁保证与进行中的运行不冲突；等待审批的任务不在此列（那是刻意的暂停）。
   */
  async resumeTask(id: string): Promise<Task | null> {
    const task = this.storage.getTask(id);
    if (!task) return null;
    if (["completed", "failed", "cancelled", "awaiting_approval", "awaiting_clarification"].includes(task.status)) {
      return task; // 终态或等待用户输入（审批/澄清）：无需恢复
    }

    // 续跑事件同时落库（轨迹可回放）并广播（前端实时刷新）
    const event: TaskEvent = {
      id: randomUUID(),
      taskId: id,
      seq: this.storage.nextSeq(id),
      type: "task.resumed",
      title: "断点续跑：从中断处恢复执行",
      createdAt: new Date().toISOString(),
    };
    this.storage.appendEvent(event);
    this.bus.emit("task.resumed", {
      type: "task.resumed",
      taskId: id,
      title: event.title,
      at: event.createdAt,
    });

    void this.agent.run(id).catch(() => {
      // 错误已在 agent 内落库并广播
    });
    return task;
  }

  /** 启动时恢复所有中断任务（v0.3：断点恢复；等待用户输入的不在此列） */
  private resumeInterrupted(): void {
    const interrupted = this.storage
      .listTasks(10_000)
      .filter((t) => !["completed", "failed", "cancelled", "awaiting_approval", "awaiting_clarification"].includes(t.status));
    for (const task of interrupted) {
      void this.resumeTask(task.id);
    }
  }

  listTasks(limit?: number): Task[] {
    return this.storage.listTasks(limit);
  }

  listEvents(taskId: string, afterSeq?: number): TaskEvent[] {
    return this.storage.listEvents(taskId, afterSeq);
  }

  /* ------------------------------ 知识库（v0.4） ------------------------------ */

  /** 新增知识文档（本地优先：内容永不出本机） */
  addKnowledgeDoc(title: string, content: string): KnowledgeDoc {
    const now = new Date().toISOString();
    const doc: KnowledgeDoc & { content: string } = {
      id: randomUUID(),
      title: title.trim() || "未命名文档",
      content,
      sizeChars: content.length,
      createdAt: now,
    };
    this.storage.addKnowledgeDoc(doc);
    return doc;
  }

  listKnowledgeDocs(): KnowledgeDoc[] {
    return this.storage.listKnowledgeDocs();
  }

  deleteKnowledgeDoc(id: string): boolean {
    return this.storage.deleteKnowledgeDoc(id);
  }

  /** 知识召回测试入口（调试 / UI 预览用） */
  recallKnowledgePreview(query: string): KnowledgeRecall[] {
    return recallKnowledge(this.storage.allKnowledgeContent(), query);
  }

  /* ------------------------------ 用户画像（v0.4） ------------------------------ */

  getUserProfile(): UserProfile {
    return this.storage.getUserProfile();
  }

  saveUserProfile(profile: UserProfile): UserProfile {
    this.storage.saveUserProfile(profile);
    return this.getUserProfile();
  }

  /* ------------------------------ 中途转向（v0.4） ------------------------------ */

  /** 运行中的任务排队一条用户指令（步骤间隙注入） */
  steerTask(taskId: string, content: string): SteeringMessage {
    const task = this.storage.getTask(taskId);
    if (!task) throw new Error("任务不存在");
    if (["completed", "failed", "cancelled"].includes(task.status)) {
      throw new Error("任务已结束，无法转向（请使用修订功能）");
    }

    const message: SteeringMessage = {
      id: randomUUID(),
      taskId,
      content: content.trim(),
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    this.storage.addSteeringMessage(message);
    this.bus.emit("steering.queued", {
      type: "steering.queued",
      taskId,
      title: `中途指令已排队：${message.content.slice(0, 60)}`,
      at: message.createdAt,
    });
    return message;
  }

  listSteeringMessages(taskId: string): SteeringMessage[] {
    return this.storage.listSteeringMessages(taskId);
  }

  /* ------------------------------ 主动澄清（v0.5） ------------------------------ */

  /** 任务挂起的澄清问题（前端渲染澄清卡） */
  listClarifications(taskId: string): ClarificationQuestion[] {
    return this.storage.listClarificationQuestions(taskId);
  }

  /** 提交澄清答案（或跳过）：注入规划上下文并续跑任务 */
  async submitClarifications(
    taskId: string,
    answers: string[],
    skipped = false,
  ): Promise<Task | null> {
    await this.agent.submitClarifications(taskId, answers, skipped);
    return this.storage.getTask(taskId);
  }

  /* ------------------------------ 置信度传播（v0.5） ------------------------------ */

  /** 任务置信度轨迹（前端置信度条与审计） */
  getTaskConfidence(taskId: string): { taskConfidence: number; steps: ConfidenceRecord[] } | null {
    const task = this.storage.getTask(taskId);
    if (!task) return null;
    const state = (task.runState ?? {}) as {
      taskConfidence?: number;
      confidences?: ConfidenceRecord[];
    };
    return {
      taskConfidence: state.taskConfidence ?? 1,
      steps: state.confidences ?? [],
    };
  }

  /* ------------------------------ 经验回放（v0.5） ------------------------------ */

  /** 已固化的成功经验库（前端 playbook 视图） */
  listPlaybooks(): Playbook[] {
    return this.storage.listPlaybooks();
  }

  /** 删除经验（用户治理低效 playbook） */
  deletePlaybook(id: string): boolean {
    return this.storage.deletePlaybook(id);
  }

  /* ------------------------------ 审批 ------------------------------ */

  listPendingCheckpoints(): Checkpoint[] {
    return this.storage.listPendingCheckpoints();
  }

  async decideCheckpoint(
    checkpointId: string,
    decision: "approve" | "reject",
    comment?: string,
  ): Promise<Checkpoint | null> {
    const checkpoint = this.storage.getCheckpoint(checkpointId);
    if (!checkpoint || checkpoint.status !== "pending") return null;

    const updated = this.storage.decideCheckpoint(
      checkpointId,
      decision === "approve" ? "approved" : "rejected",
      comment,
    );

    if (decision === "approve") {
      await this.agent.resumeApproved(checkpoint.taskId);
    } else {
      this.agent.rejectTask(checkpoint.taskId, comment);
    }
    return updated;
  }

  /* ------------------------------ 成果 ------------------------------ */

  listDeliverables(limit?: number): DeliverableMeta[] {
    return this.storage.listDeliverables(limit);
  }

  getDeliverable(id: string): DeliverableMeta | null {
    return this.storage.getDeliverable(id);
  }

  readDeliverable(
    id: string,
    version?: number,
  ): { meta: DeliverableMeta; data: Buffer; extension: string } | null {
    const meta = this.storage.getDeliverable(id);
    if (!meta) return null;
    const targetVersion = version ?? meta.version;
    const extension = this.store.extensionFor(meta.format);
    if (!this.store.exists(id)) return null;
    const data = this.store.read(id, targetVersion, extension);
    return { meta: { ...meta, version: targetVersion }, data, extension };
  }

  listVersions(deliverableId: string) {
    return this.storage.listVersions(deliverableId);
  }

  /** 修订委托：基于既有成果 + 反馈生成新版本（成果 git 化闭环） */
  async reviseDeliverable(id: string, feedback: string): Promise<Task> {
    const meta = this.storage.getDeliverable(id);
    if (!meta) throw new Error("成果不存在");
    if (!this.store.exists(id)) throw new Error("成果文件缺失，无法修订");

    return this.createTask(`修订成果「${meta.title}」`, {
      revisionOf: { deliverableId: id, feedback },
    });
  }

  /** 版本间结构化对比（基于版本源 Markdown，与导出格式无关） */
  diffDeliverable(id: string, from: number, to: number): DeliverableDiff {
    const meta = this.storage.getDeliverable(id);
    if (!meta) throw new Error("成果不存在");

    const versions = this.storage.listVersions(id).map((v) => v.version);
    if (!versions.includes(from) || !versions.includes(to)) {
      throw new Error(`版本不存在：可用版本 ${versions.join(", ")}`);
    }

    const oldText = this.store.readSource(id, from) ?? "";
    const newText = this.store.readSource(id, to) ?? "";
    if (!oldText && !newText) {
      throw new Error("该成果版本缺少源文本（旧版本数据），无法对比");
    }
    return buildDeliverableDiff(id, from, to, oldText, newText);
  }

  /* ------------------------------ 技能 ------------------------------ */

  listSkills(): SkillDefinition[] {
    return this.skills.list();
  }

  /** 从 YAML 内容安装技能（写入用户技能目录并热加载） */
  installSkillYaml(content: string): SkillDefinition {
    return this.skills.install(content, join(this.storage.dataDir, "skills"));
  }

  /** 从 URL 安装第三方技能（技能市场的最小实现） */
  async installSkillFromUrl(url: string): Promise<SkillDefinition> {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    return this.installSkillYaml(await response.text());
  }

  /* ------------------------------ 调度 ------------------------------ */

  listSchedules(): Schedule[] {
    return this.storage.listSchedules();
  }

  createSchedule(goal: string, cron: string, skillId?: string): Schedule {
    return this.scheduler.create(goal, cron, skillId);
  }

  toggleSchedule(id: string, enabled: boolean): void {
    this.scheduler.toggle(id, enabled);
  }

  deleteSchedule(id: string): void {
    this.scheduler.remove(id);
  }

  /* ------------------------------ 模型网关 ------------------------------ */

  listProviderConfigs(): ProviderConfig[] {
    return this.gateway.providerConfigs();
  }

  async configureProvider(
    id: ProviderId,
    config: Partial<ProviderConfig>,
  ): Promise<ProviderConfig> {
    const saved = this.gateway.configure(id, config);
    this.persistGatewaySettings();
    return saved;
  }

  availableModels() {
    return this.gateway.availableModels();
  }

  setDefaultModels(defaultModel: string, plannerModel?: string): void {
    this.gateway.defaultModel = defaultModel;
    this.gateway.plannerModel = plannerModel ?? defaultModel;
    this.storage.setSetting("defaultModel", defaultModel);
    this.storage.setSetting("plannerModel", this.gateway.plannerModel);
  }

  /* ------------------------------ 成本路由 ------------------------------ */

  /** 当前路由策略（本地优先 / 预算上限） */
  getRouting(): RoutingConfig {
    return this.gateway.routing;
  }

  setRouting(patch: Partial<RoutingConfig>): RoutingConfig {
    const next = this.gateway.setRouting(patch);
    this.storage.setSetting("routing", JSON.stringify(next));
    return next;
  }

  async testProvider(id: ProviderId): Promise<boolean> {
    return this.gateway.testProvider(id);
  }

  private persistGatewaySettings(): void {
    for (const config of this.gateway.providerConfigs()) {
      this.storage.setSetting(`provider:${config.id}`, JSON.stringify(config));
    }
  }

  private restoreGatewaySettings(): void {
    for (const config of this.gateway.providerConfigs()) {
      const raw = this.storage.getSetting(`provider:${config.id}`);
      if (!raw) continue;
      try {
        this.gateway.configure(config.id, JSON.parse(raw) as ProviderConfig);
      } catch {
        // 忽略损坏的配置
      }
    }
    const defaultModel = this.storage.getSetting("defaultModel");
    if (defaultModel) {
      this.gateway.defaultModel = defaultModel;
      this.gateway.plannerModel = this.storage.getSetting("plannerModel") ?? defaultModel;
    }
    const routing = this.storage.getSetting("routing");
    if (routing) {
      try {
        this.gateway.setRouting(JSON.parse(routing) as Partial<RoutingConfig>);
      } catch {
        // 忽略损坏的配置
      }
    }
  }

  /* ------------------------------ 统计 ------------------------------ */

  usageSummary(): UsageSummary {
    const { totalTokens, totalCostUSD, byModel } = this.storage.usageSummary();
    return {
      totalTasks: this.storage.listTasks(10_000).length,
      totalTokens,
      totalCostUSD,
      todayCostUSD: this.storage.todayUsage().costUSD,
      byProvider: byModel,
    };
  }

  /* ------------------------------ 订阅 ------------------------------ */

  subscribe(listener: (payload: RuntimeEventPayload) => void): () => void {
    return this.bus.subscribe(listener);
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  shutdown(): void {
    this.scheduler.stopAll();
    this.storage.close();
  }
}

/* ------------------------------ 辅助函数 ------------------------------ */

/** 目标切分：按分隔词拆出并行子目标（2-5 组才值得 fork；否则退化为单任务） */
function splitParallelGoal(goal: string): string[] {
  const parts = goal
    .split(/[、，,]|以及|和|与(?=[^（(]*[、，,，]|$)|\bversus\b|\bvs\.?\b/gi)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  return parts.length >= 2 && parts.length <= 5 ? parts : [goal];
}
