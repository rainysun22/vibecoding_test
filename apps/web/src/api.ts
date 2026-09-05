import type {
  Checkpoint,
  DeliverableMeta,
  DeliverableVersion,
  ProviderConfig,
  ProviderId,
  ModelInfo,
  Schedule,
  SkillDefinition,
  Task,
  TaskEvent,
  UsageSummary,
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

/* ------------------------------ 技能 / 定时 ------------------------------ */

export function listSkills(): Promise<SkillDefinition[]> {
  return request("/api/skills");
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
