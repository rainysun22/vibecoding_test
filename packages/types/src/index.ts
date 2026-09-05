/**
 * OpenWork 共享类型 —— 全系统的统一词汇表。
 *
 * 设计原则：
 * - 模型中立：LLM 层不绑定任何厂商
 * - 成果优先：一切任务最终收敛为可带走的开放格式成果物
 * - 语义级审批：信任粒度在"关键节点/成果版本"，而非每个工具调用
 */

/* ============================== LLM Gateway ============================== */

/** 对话角色 */
export type ChatRole = "system" | "user" | "assistant";

/** 统一对话消息（模型中立协议） */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** 完成请求（流式/非流式统一入口） */
export interface CompletionRequest {
  messages: ChatMessage[];
  /** 目标模型 ID，如 "openai/gpt-4o"、"ollama/qwen3" */
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Token 用量（成本核算与限额的基础） */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 本次调用估算成本（USD），按模型定价计算 */
  costUSD: number;
}

/** 完成响应 */
export interface CompletionResponse {
  content: string;
  model: string;
  usage: TokenUsage;
  finishReason?: string;
}

/** 流式增量块 */
export interface StreamChunk {
  delta: string;
  done: boolean;
  usage?: TokenUsage;
}

/** 提供商身份 */
export type ProviderId =
  | "mock"
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "qwen"
  | "ollama";

/** 提供商运行时配置（密钥仅存本地，永不外发） */
export interface ProviderConfig {
  id: ProviderId;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  /** 已配置即可用（用于 UI 展示连通状态） */
  connected: boolean;
}

/** 模型元信息（成本路由依据） */
export interface ModelInfo {
  /** 完整模型 ID："{provider}/{model}" */
  id: string;
  provider: ProviderId;
  label: string;
  /** 输入价格 USD / 1M tokens */
  inputPricePerMTok: number;
  /** 输出价格 USD / 1M tokens */
  outputPricePerMTok: number;
  contextWindow: number;
  /** 能力分级：planner 用强模型，执行可用经济模型 */
  tier: "flagship" | "balanced" | "economy" | "local";
}

/* ============================== Tasks ============================== */

export type TaskStatus =
  | "pending"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

/** 任务事件（活动流的统一记录，可回放 = 任务轨迹审计） */
export interface TaskEvent {
  id: string;
  taskId: string;
  seq: number;
  type: TaskEventType;
  title: string;
  detail?: string;
  createdAt: string;
}

export type TaskEventType =
  | "task.created"
  | "task.planning"
  | "plan.ready"
  | "checkpoint.requested"
  | "checkpoint.approved"
  | "checkpoint.rejected"
  | "step.started"
  | "step.completed"
  | "step.failed"
  | "tool.executed"
  | "tool.failed"
  | "deliverable.created"
  | "deliverable.versioned"
  | "task.resumed"
  | "task.verifying"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  | "usage.recorded"
  /* v0.4：知识库 / 画像 / 引用 / 并行委托 */
  | "knowledge.recalled"
  | "subtask.spawned"
  | "subtask.completed"
  | "task.synthesizing"
  | "sources.cited";

/** 一句话委托 */
export interface Task {
  id: string;
  goal: string;
  status: TaskStatus;
  skillId?: string;
  /** 修订委托：基于既有成果 + 反馈生成新版本（成果 git 化闭环） */
  revisionOf?: {
    deliverableId: string;
    feedback: string;
  };
  /** 并行委托：父任务 ID（子任务由父任务派生，独立运行后聚合） */
  parentTaskId?: string;
  /** 并行批次内的序号（1 起，用于稳定排序） */
  batchIndex?: number;
  /** 并行父任务的子目标清单（确定性 fork 计划的依据） */
  parallelGroups?: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  usage: TokenUsage;
}

/* ============================== Plan ============================== */

/** 计划步骤类型（synthesize：并行子成果聚合，仅 fork-join 计划使用） */
export type PlanStepKind = "research" | "draft" | "deliver" | "synthesize";

/** Agent 生成的执行计划 */
export interface PlanStep {
  id: string;
  kind: PlanStepKind;
  title: string;
  /** 给执行模型的结构化指令 */
  instruction: string;
  /** 期望的成果格式（仅 deliver 步骤使用） */
  outputFormat?: DeliverableFormat;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  result?: string;
}

export interface Plan {
  taskId: string;
  summary: string;
  steps: PlanStep[];
  createdAt: string;
}

/* ============================== Checkpoints ============================== */

/**
 * 语义级审批：一次审"一版计划/一版成果"，而非逐工具确认。
 * N4 真需求 —— 在正确粒度上放手。
 */
export interface Checkpoint {
  id: string;
  taskId: string;
  /** 审批对象语义类型 */
  kind: "plan" | "deliverable" | "custom";
  title: string;
  /** 待审内容（计划 JSON / 成果摘要等） */
  payload: string;
  status: "pending" | "approved" | "rejected";
  decidedAt?: string;
  comment?: string;
  createdAt: string;
}

/* ============================== Deliverables ============================== */

/** 开放格式优先 —— 成果必须可带走（N1 真需求） */
export type DeliverableFormat = "markdown" | "html" | "docx" | "xlsx" | "pptx";

export interface DeliverableMeta {
  id: string;
  taskId: string;
  title: string;
  format: DeliverableFormat;
  /** 当前版本号，从 1 开始 */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 版本记录（成果 git 化的最小实现：内容寻址 + 版本链 + 可回滚） */
export interface DeliverableVersion {
  version: number;
  /** 内容 SHA-256，用于完整性校验与去重 */
  contentHash: string;
  sizeBytes: number;
  taskId: string;
  note?: string;
  createdAt: string;
}

/* ============================== Deliverable Diff ============================== */

/** 结构化 diff 行（统一视图：上下文行 + 新增行 + 删除行） */
export interface DiffLine {
  type: "ctx" | "add" | "del";
  text: string;
  /** 旧版本行号（del/ctx 行有值） */
  oldNo?: number;
  /** 新版本行号（add/ctx 行有值） */
  newNo?: number;
}

/** 两个版本间的结构化对比（git 化体验） */
export interface DeliverableDiff {
  deliverableId: string;
  from: number;
  to: number;
  /** 行级 diff（基于版本源 Markdown，与导出格式无关） */
  lines: DiffLine[];
  stat: { added: number; removed: number; unchanged: number };
}

/* ============================== Tools ============================== */

/** 研究数据源材料（网页抓取 / 本地文件读取的产物） */
export interface SourceMaterial {
  kind: "web" | "file";
  source: string;
  content: string;
}

/* ============================== Knowledge Base ============================== */

/** 个人知识库文档（本地优先：内容永不出本机，Agent 按相关性召回注入） */
export interface KnowledgeDoc {
  id: string;
  title: string;
  /** 内容字符数（列表展示，避免整表回传） */
  sizeChars: number;
  createdAt: string;
}

/** 知识召回结果（带分数与片段，供审计展示） */
export interface KnowledgeRecall {
  docId: string;
  title: string;
  /** bigram 重叠得分（0-1，越高越相关） */
  score: number;
  /** 命中片段（命中位置附近的窗口） */
  snippet: string;
}

/* ============================== User Profile ============================== */

/** 用户画像（Claude Cowork 式"入职培训"：一次填写，每次委托自动生效） */
export interface UserProfile {
  /** 我是谁：身份 / 业务背景 / 所在行业 */
  about?: string;
  /** 工作偏好：流程 / 结构 / 重点取舍 */
  preferences?: string;
  /** 表达风格：语气 / 受众 / 文风 */
  voice?: string;
  updatedAt?: string;
}

/* ============================== Skills ============================== */

/** 技能：YAML 定义的可复用委托模板（N6 真需求：开放格式、可移植） */
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  /** 附加到 system 的提示词模板，支持 {{goal}} 占位 */
  systemPrompt?: string;
  /** 期望产出格式 */
  outputFormat: DeliverableFormat;
  /** 计划生成的额外约束 */
  planHints?: string;
  /** 建议模型分层（成本路由） */
  suggestedTier?: ModelInfo["tier"];
  builtin?: boolean;
}

/* ============================== Schedules ============================== */

/** 定时委托：cron 表达式驱动，本地优先运行 */
export interface Schedule {
  id: string;
  goal: string;
  skillId?: string;
  cron: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
}

/* ============================== Gateway / Stats ============================== */

/** 用量统计（成本透明：N2 真需求） */
export interface UsageSummary {
  totalTasks: number;
  totalTokens: number;
  totalCostUSD: number;
  /** 今日累计成本（预算控制依据；按服务器本地日期结算） */
  todayCostUSD?: number;
  byProvider: Record<string, { tokens: number; costUSD: number; calls: number }>;
}

export interface ApiError {
  error: string;
  message: string;
}
