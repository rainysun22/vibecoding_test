import type {
  Checkpoint,
  ClarificationQuestion,
  ConfidenceRecord,
  DeliverableDiff,
  DeliverableMeta,
  DeliverableVersion,
  KnowledgeDoc,
  KnowledgeRecall,
  Playbook,
  ProviderConfig,
  ProviderId,
  ModelInfo,
  Schedule,
  SkillDefinition,
  SteeringMessage,
  Task,
  TaskEvent,
  UsageSummary,
  UserProfile,
} from "@openwork/types";

/**
 * API 客户端 —— 与 Fastify 服务端的 REST + SSE 契约一一对应。
 * 开发模式经 Vite 代理，生产模式同源直连（单进程自托管）。
 */

const BASE = import.meta.env.DEV ? "" : "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `请求失败（${response.status}）`);
  }
  return response.json() as Promise<T>;
}

/* ------------------------------ 委托任务 ------------------------------ */

export function createTask(goal: string, skillId?: string): Promise<Task> {
  return request("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ goal, skillId: skillId || undefined }),
  });
}

/** 并行委托：fork 子任务独立执行后聚合（v0.4） */
export function createParallelTask(goal: string, groups?: string[]): Promise<Task> {
  return request("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ goal, parallel: true, groups }),
  });
}

export function listTasks(limit = 50): Promise<Task[]> {
  return request(`/api/tasks?limit=${limit}`);
}

export interface TaskDetail extends Task {
  events: TaskEvent[];
  deliverables: DeliverableMeta[];
}

export function getTask(id: string): Promise<TaskDetail> {
  return request(`/api/tasks/${id}`);
}

/** 断点续跑：恢复中断的任务 */
export function resumeTask(id: string): Promise<Task> {
  return request(`/api/tasks/${id}/resume`, { method: "POST" });
}

/** 中途转向：运行中任务排队用户指令（v0.4） */
export function steerTask(id: string, content: string): Promise<SteeringMessage> {
  return request(`/api/tasks/${id}/steer`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function listSteeringMessages(id: string): Promise<SteeringMessage[]> {
  return request(`/api/tasks/${id}/steering`);
}

/** 并行委托的子任务清单（v0.4） */
export function listSubtasks(id: string): Promise<Task[]> {
  return request(`/api/tasks/${id}/subtasks`);
}

/* ------------------------------ 主动澄清（v0.5） ------------------------------ */

/** 任务挂起的澄清问题（澄清卡渲染） */
export function listClarifications(id: string): Promise<ClarificationQuestion[]> {
  return request(`/api/tasks/${id}/clarifications`);
}

/** 提交澄清答案（按问题顺序）或跳过（按现有信息继续） */
export function submitClarifications(
  id: string,
  answers: string[],
  skip = false,
): Promise<Task> {
  return request(`/api/tasks/${id}/clarifications`, {
    method: "POST",
    body: JSON.stringify(skip ? { skip: true } : { answers }),
  });
}

/* ------------------------------ 置信度传播（v0.5） ------------------------------ */

export interface TaskConfidence {
  taskConfidence: number | null;
  steps: ConfidenceRecord[];
}

/** 任务/步骤置信度轨迹（置信度条渲染） */
export function getTaskConfidence(id: string): Promise<TaskConfidence> {
  return request(`/api/tasks/${id}/confidence`);
}

/* ------------------------------ 经验回放（v0.5） ------------------------------ */

/** 已固化的成功经验库（playbook 视图） */
export function listPlaybooks(): Promise<Playbook[]> {
  return request("/api/playbooks");
}

export function deletePlaybook(id: string): Promise<{ ok: boolean }> {
  return request(`/api/playbooks/${id}`, { method: "DELETE" });
}

/* ------------------------------ 审批 ------------------------------ */

export function listPendingCheckpoints(): Promise<Checkpoint[]> {
  return request("/api/checkpoints");
}

export function decideCheckpoint(
  id: string,
  decision: "approve" | "reject",
  comment?: string,
): Promise<Checkpoint> {
  return request(`/api/checkpoints/${id}`, {
    method: "POST",
    body: JSON.stringify({ decision, comment }),
  });
}

/* ------------------------------ 成果 ------------------------------ */

export function listDeliverables(limit = 100): Promise<DeliverableMeta[]> {
  return request(`/api/deliverables?limit=${limit}`);
}

export interface DeliverableDetail extends DeliverableMeta {
  versions: DeliverableVersion[];
}

export function getDeliverable(id: string): Promise<DeliverableDetail> {
  return request(`/api/deliverables/${id}`);
}

export function deliverableDownloadUrl(id: string, version?: number): string {
  return `${BASE}/api/deliverables/${id}/download${version ? `?version=${version}` : ""}`;
}

export async function previewDeliverable(id: string, version?: number): Promise<string> {
  const response = await fetch(
    `${BASE}/api/deliverables/${id}/preview${version ? `?version=${version}` : ""}`,
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "暂不支持该格式预览");
  }
  return response.text();
}

/** 版本间结构化对比（v0.3：成果 diff） */
export function getDeliverableDiff(id: string, from: number, to: number): Promise<DeliverableDiff> {
  return request(`/api/deliverables/${id}/diff?from=${from}&to=${to}`);
}

/** 修订委托：基于反馈生成新版本（v0.3） */
export function reviseDeliverable(id: string, feedback: string): Promise<Task> {
  return request(`/api/deliverables/${id}/revise`, {
    method: "POST",
    body: JSON.stringify({ feedback }),
  });
}

/* ------------------------------ 知识库（v0.4） ------------------------------ */

export function listKnowledgeDocs(): Promise<KnowledgeDoc[]> {
  return request("/api/knowledge");
}

export function addKnowledgeDoc(title: string, content: string): Promise<KnowledgeDoc> {
  return request("/api/knowledge", {
    method: "POST",
    body: JSON.stringify({ title, content }),
  });
}

export function deleteKnowledgeDoc(id: string): Promise<{ ok: boolean }> {
  return request(`/api/knowledge/${id}`, { method: "DELETE" });
}

/** 知识召回预览：查询会命中哪些私有文档 */
export function recallKnowledgePreview(query: string): Promise<KnowledgeRecall[]> {
  return request(`/api/knowledge/recall?q=${encodeURIComponent(query)}`);
}

/* ------------------------------ 用户画像（v0.4） ------------------------------ */

export function getUserProfile(): Promise<UserProfile> {
  return request("/api/profile");
}

export function saveUserProfile(profile: UserProfile): Promise<UserProfile> {
  return request("/api/profile", {
    method: "PUT",
    body: JSON.stringify(profile),
  });
}

/* ------------------------------ 技能 / 定时 ------------------------------ */

export function listSkills(): Promise<SkillDefinition[]> {
  return request("/api/skills");
}

/** 技能市场（最小实现）：从 URL 或 YAML 内容安装第三方技能 */
export function installSkill(source: { url?: string; content?: string }): Promise<SkillDefinition> {
  return request("/api/skills/install", {
    method: "POST",
    body: JSON.stringify(source),
  });
}

export function listSchedules(): Promise<Schedule[]> {
  return request("/api/schedules");
}

export function createSchedule(goal: string, cron: string, skillId?: string): Promise<Schedule> {
  return request("/api/schedules", {
    method: "POST",
    body: JSON.stringify({ goal, cron, skillId }),
  });
}

export function toggleSchedule(id: string, enabled: boolean): Promise<{ ok: boolean }> {
  return request(`/api/schedules/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export function deleteSchedule(id: string): Promise<{ ok: boolean }> {
  return request(`/api/schedules/${id}`, { method: "DELETE" });
}

/* ------------------------------ 模型网关 ------------------------------ */

export function listProviders(): Promise<ProviderConfig[]> {
  return request("/api/providers");
}

export function configureProvider(
  id: ProviderId,
  config: Partial<Pick<ProviderConfig, "apiKey" | "baseUrl" | "enabled">>,
): Promise<ProviderConfig> {
  return request(`/api/providers/${id}`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export function testProvider(id: ProviderId): Promise<{ connected: boolean }> {
  return request(`/api/providers/${id}/test`, { method: "POST" });
}

export function listModels(): Promise<ModelInfo[]> {
  return request("/api/models");
}

export function setDefaultModels(
  defaultModel: string,
  plannerModel?: string,
): Promise<{ defaultModel: string }> {
  return request("/api/models/default", {
    method: "PUT",
    body: JSON.stringify({ defaultModel, plannerModel }),
  });
}

/* ------------------------------ 成本路由 ------------------------------ */

/** 路由策略（与 @openwork/llm-gateway 的 RoutingConfig 保持结构一致） */
export interface RoutingConfig {
  preferLocal: boolean;
  localModel: string | null;
  dailyBudgetUSD: number;
}

export function getRouting(): Promise<RoutingConfig> {
  return request("/api/models/routing");
}

export function setRouting(patch: Partial<RoutingConfig>): Promise<RoutingConfig> {
  return request("/api/models/routing", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

/* ------------------------------ 统计 ------------------------------ */

export function usageStats(): Promise<UsageSummary> {
  return request("/api/stats");
}

/* ------------------------------ SSE 实时流 ------------------------------ */

export interface LiveEvent {
  type: string;
  taskId?: string;
  title?: string;
  detail?: string;
  at: string;
  /** 流式增量（type === "step.streaming"）：同 streamId 的 delta 按序拼接 */
  streamId?: string;
  delta?: string;
  streamDone?: boolean;
}

/** 订阅全局实时事件流；返回退订函数 */
export function subscribeEvents(onEvent: (event: LiveEvent) => void): () => void {
  const source = new EventSource("/api/events");
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as LiveEvent);
    } catch {
      // 忽略无法解析的心跳等非 JSON 帧
    }
  };
  return () => source.close();
}
