import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  Checkpoint,
  DeliverableMeta,
  DeliverableVersion,
  Schedule,
  Task,
  TaskEvent,
} from "@openwork/types";

/**
 * 本地优先持久化 —— node:sqlite（零原生依赖，数据永不出本机）。
 * Schema 轻量、索引齐全，为后续平滑迁移 Postgres 保持标准 SQL 语义。
 */
export class Storage {
  private readonly db: DatabaseSync;

  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(dataDir, "deliverables"), { recursive: true });
    this.db = new DatabaseSync(join(dataDir, "openwork.db"));
    this.migrate();
  }

  /** 类型化查询收口：node:sqlite 返回弱类型行，统一在此转换 */
  private all<T>(sql: string, ...params: (string | number | null)[]): T[] {
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }

  private one<T>(sql: string, ...params: (string | number | null)[]): T | null {
    return (this.db.prepare(sql).get(...params) as unknown as T) ?? null;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        skill_id TEXT,
        revision_of TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        error TEXT,
        run_state TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);

      CREATE TABLE IF NOT EXISTS task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id, seq);

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        decided_at TEXT,
        comment TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id);

      CREATE TABLE IF NOT EXISTS deliverables (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        title TEXT NOT NULL,
        format TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deliverables_task ON deliverables(task_id);

      CREATE TABLE IF NOT EXISTS deliverable_versions (
        deliverable_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        task_id TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (deliverable_id, version)
      );

      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        skill_id TEXT,
        cron TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        next_run_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        task_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plan_cache (
        goal_hash TEXT PRIMARY KEY,
        plan_json TEXT NOT NULL,
        hits INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.addColumnIfMissing("tasks", "revision_of", "TEXT");
  }

  /** 轻量列迁移：老库升级不丢数据 */
  private addColumnIfMissing(table: string, column: string, ddl: string): void {
    const columns = this.all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!columns.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }

  /* ------------------------------ Usage ------------------------------ */

  recordUsage(model: string, tokens: number, costUSD: number, taskId?: string): void {
    this.db
      .prepare("INSERT INTO usage_log (model, tokens, cost_usd, task_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(model, tokens, costUSD, taskId ?? null, new Date().toISOString());
  }

  usageSummary(): {
    totalTokens: number;
    totalCostUSD: number;
    byModel: Record<string, { tokens: number; costUSD: number; calls: number }>;
  } {
    const rows = this.all<{ model: string; tokens: number; cost: number; calls: number }>(
      `SELECT model, SUM(tokens) AS tokens, SUM(cost_usd) AS cost, COUNT(*) AS calls
       FROM usage_log GROUP BY model`,
    );
    const byModel: Record<string, { tokens: number; costUSD: number; calls: number }> = {};
    let totalTokens = 0;
    let totalCostUSD = 0;
    for (const row of rows) {
      byModel[row.model] = { tokens: row.tokens, costUSD: row.cost, calls: row.calls };
      totalTokens += row.tokens;
      totalCostUSD += row.cost;
    }
    return { totalTokens, totalCostUSD, byModel };
  }

  /** 今日（本地日历日）累计消费 —— 预算控制的持久化依据 */
  todayUsage(): { tokens: number; costUSD: number } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const row = this.one<{ tokens: number; cost: number }>(
      "SELECT COALESCE(SUM(tokens), 0) AS tokens, COALESCE(SUM(cost_usd), 0) AS cost FROM usage_log WHERE created_at >= ?",
      start,
    );
    return { tokens: row?.tokens ?? 0, costUSD: row?.cost ?? 0 };
  }

  /* ------------------------------ Plan Cache ------------------------------ */

  /** 命中计划缓存（相似目标跳过 planning，省一次强模型调用） */
  getPlanCache(goalHash: string): { planJson: string; hits: number } | null {
    const row = this.one<{ plan_json: string; hits: number }>(
      "SELECT plan_json, hits FROM plan_cache WHERE goal_hash = ?",
      goalHash,
    );
    if (!row) return null;
    // LRU 语义：命中即刷新更新时间
    this.db
      .prepare("UPDATE plan_cache SET hits = hits + 1, updated_at = ? WHERE goal_hash = ?")
      .run(new Date().toISOString(), goalHash);
    return { planJson: row.plan_json, hits: row.hits + 1 };
  }

  putPlanCache(goalHash: string, planJson: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO plan_cache (goal_hash, plan_json, hits, created_at, updated_at) VALUES (?, ?, 0, ?, ?)
         ON CONFLICT(goal_hash) DO UPDATE SET plan_json = excluded.plan_json, updated_at = excluded.updated_at`,
      )
      .run(goalHash, planJson, now, now);
  }

  /** 惰性清理过期缓存（默认 30 天未被命中即失效） */
  prunePlanCache(ttlMs = 30 * 24 * 3600 * 1000): number {
    const cutoff = new Date(Date.now() - ttlMs).toISOString();
    return Number(this.db.prepare("DELETE FROM plan_cache WHERE updated_at < ?").run(cutoff).changes);
  }

  /* ------------------------------ Tasks ------------------------------ */

  createTask(task: Task): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, goal, status, skill_id, revision_of, created_at, updated_at, prompt_tokens, completion_tokens, total_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.goal,
        task.status,
        task.skillId ?? null,
        task.revisionOf ? JSON.stringify(task.revisionOf) : null,
        task.createdAt,
        task.updatedAt,
        task.usage.promptTokens,
        task.usage.completionTokens,
        task.usage.totalTokens,
        task.usage.costUSD,
      );
  }

  updateTask(
    id: string,
    patch: Partial<Pick<Task, "status" | "error" | "completedAt">> & {
      runState?: unknown;
      usage?: Task["usage"];
    },
  ): void {
    const current = this.getTask(id);
    if (!current) return;

    const usage = patch.usage ?? current.usage;
    const runState = patch.runState !== undefined ? JSON.stringify(patch.runState) : null;
    this.db
      .prepare(
        `UPDATE tasks SET status = ?, error = ?, completed_at = ?,
         run_state = COALESCE(?, run_state),
         prompt_tokens = ?, completion_tokens = ?, total_tokens = ?, cost_usd = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status ?? current.status,
        patch.error ?? current.error ?? null,
        patch.completedAt ?? current.completedAt ?? null,
        runState,
        usage.promptTokens,
        usage.completionTokens,
        usage.totalTokens,
        usage.costUSD,
        new Date().toISOString(),
        id,
      );
  }

  getTask(id: string): (Task & { runState: unknown }) | null {
    const row = this.one<TaskRow>("SELECT * FROM tasks WHERE id = ?", id);
    return row ? toTask(row) : null;
  }

  listTasks(limit = 50): Task[] {
    return this.all<TaskRow>(
      "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?",
      limit,
    ).map(toTask);
  }

  listTasksByStatus(status: Task["status"]): Task[] {
    return this.all<TaskRow>(
      "SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC",
      status,
    ).map(toTask);
  }

  /* ------------------------------ Events ------------------------------ */

  appendEvent(event: TaskEvent): void {
    this.db
      .prepare(
        `INSERT INTO task_events (id, task_id, seq, type, title, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.taskId,
        event.seq,
        event.type,
        event.title,
        event.detail ?? null,
        event.createdAt,
      );
  }

  listEvents(taskId: string, afterSeq = 0): TaskEvent[] {
    return this.all<EventRow>(
      "SELECT * FROM task_events WHERE task_id = ? AND seq > ? ORDER BY seq",
      taskId,
      afterSeq,
    ).map(toEvent);
  }

  nextSeq(taskId: string): number {
    const row = this.one<{ max_seq: number }>(
      "SELECT COALESCE(MAX(seq), 0) AS max_seq FROM task_events WHERE task_id = ?",
      taskId,
    );
    return (row?.max_seq ?? 0) + 1;
  }

  /* ------------------------------ Checkpoints ------------------------------ */

  createCheckpoint(checkpoint: Checkpoint): void {
    this.db
      .prepare(
        `INSERT INTO checkpoints (id, task_id, kind, title, payload, status, decided_at, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        checkpoint.id,
        checkpoint.taskId,
        checkpoint.kind,
        checkpoint.title,
        checkpoint.payload,
        checkpoint.status,
        checkpoint.decidedAt ?? null,
        checkpoint.comment ?? null,
        checkpoint.createdAt,
      );
  }

  decideCheckpoint(id: string, decision: "approved" | "rejected", comment?: string): Checkpoint | null {
    this.db
      .prepare("UPDATE checkpoints SET status = ?, decided_at = ?, comment = ? WHERE id = ?")
      .run(decision, new Date().toISOString(), comment ?? null, id);
    return this.getCheckpoint(id);
  }

  getCheckpoint(id: string): Checkpoint | null {
    const row = this.one<CheckpointRow>("SELECT * FROM checkpoints WHERE id = ?", id);
    return row ? toCheckpoint(row) : null;
  }

  listPendingCheckpoints(taskId?: string): Checkpoint[] {
    const sql = taskId
      ? "SELECT * FROM checkpoints WHERE task_id = ? AND status = 'pending' ORDER BY created_at"
      : "SELECT * FROM checkpoints WHERE status = 'pending' ORDER BY created_at";
    return this.all<CheckpointRow>(sql, ...(taskId ? [taskId] : [])).map(toCheckpoint);
  }

  /* ------------------------------ Deliverables ------------------------------ */

  createDeliverable(meta: DeliverableMeta, version: DeliverableVersion): void {
    this.db
      .prepare(
        `INSERT INTO deliverables (id, task_id, title, format, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(meta.id, meta.taskId, meta.title, meta.format, meta.version, meta.createdAt, meta.updatedAt);
    this.db
      .prepare(
        `INSERT INTO deliverable_versions (deliverable_id, version, content_hash, size_bytes, task_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        meta.id,
        version.version,
        version.contentHash,
        version.sizeBytes,
        version.taskId,
        version.note ?? null,
        version.createdAt,
      );
  }

  addVersion(deliverableId: string, version: DeliverableVersion): void {
    this.db
      .prepare(
        `INSERT INTO deliverable_versions (deliverable_id, version, content_hash, size_bytes, task_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        deliverableId,
        version.version,
        version.contentHash,
        version.sizeBytes,
        version.taskId,
        version.note ?? null,
        version.createdAt,
      );
    this.db
      .prepare("UPDATE deliverables SET version = ?, updated_at = ? WHERE id = ?")
      .run(version.version, version.createdAt, deliverableId);
  }

  getDeliverable(id: string): DeliverableMeta | null {
    const row = this.one<DeliverableRow>("SELECT * FROM deliverables WHERE id = ?", id);
    return row ? toDeliverable(row) : null;
  }

  listDeliverables(limit = 100): DeliverableMeta[] {
    return this.all<DeliverableRow>(
      "SELECT * FROM deliverables ORDER BY updated_at DESC LIMIT ?",
      limit,
    ).map(toDeliverable);
  }

  listDeliverablesByTask(taskId: string): DeliverableMeta[] {
    return this.all<DeliverableRow>(
      "SELECT * FROM deliverables WHERE task_id = ? ORDER BY updated_at DESC",
      taskId,
    ).map(toDeliverable);
  }

  listVersions(deliverableId: string): DeliverableVersion[] {
    return this.all<VersionRow>(
      "SELECT * FROM deliverable_versions WHERE deliverable_id = ? ORDER BY version",
      deliverableId,
    ).map(toVersion);
  }

  /* ------------------------------ Schedules ------------------------------ */

  createSchedule(schedule: Schedule): void {
    this.db
      .prepare(
        `INSERT INTO schedules (id, goal, skill_id, cron, enabled, last_run_at, next_run_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        schedule.id,
        schedule.goal,
        schedule.skillId ?? null,
        schedule.cron,
        schedule.enabled ? 1 : 0,
        schedule.lastRunAt ?? null,
        schedule.nextRunAt ?? null,
        schedule.createdAt,
      );
  }

  listSchedules(): Schedule[] {
    return this.all<ScheduleRow>("SELECT * FROM schedules ORDER BY created_at").map(toSchedule);
  }

  updateSchedule(id: string, patch: Partial<Pick<Schedule, "enabled" | "lastRunAt" | "nextRunAt">>): void {
    const current = this.one<ScheduleRow>("SELECT * FROM schedules WHERE id = ?", id);
    if (!current) return;
    this.db
      .prepare("UPDATE schedules SET enabled = ?, last_run_at = ?, next_run_at = ? WHERE id = ?")
      .run(
        (patch.enabled ?? current.enabled === 1) ? 1 : 0,
        patch.lastRunAt ?? current.last_run_at,
        patch.nextRunAt ?? current.next_run_at,
        id,
      );
  }

  deleteSchedule(id: string): void {
    this.db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
  }

  /* ------------------------------ Settings ------------------------------ */

  getSetting(key: string): string | null {
    return this.one<{ value: string }>("SELECT value FROM settings WHERE key = ?", key)?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  /* ------------------------------ Stats ------------------------------ */

  close(): void {
    this.db.close();
  }
}

/* ------------------------------ Row 映射 ------------------------------ */

interface TaskRow {
  id: string; goal: string; status: string; skill_id: string | null; revision_of: string | null;
  created_at: string; updated_at: string; completed_at: string | null; error: string | null;
  run_state: string | null; prompt_tokens: number; completion_tokens: number;
  total_tokens: number; cost_usd: number;
}

function toTask(row: TaskRow): Task & { runState: unknown } {
  let revisionOf: Task["revisionOf"];
  if (row.revision_of) {
    try {
      revisionOf = JSON.parse(row.revision_of) as NonNullable<Task["revisionOf"]>;
    } catch {
      // 损坏的修订信息按无修订处理
    }
  }
  return {
    id: row.id,
    goal: row.goal,
    status: row.status as Task["status"],
    skillId: row.skill_id ?? undefined,
    revisionOf,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    error: row.error ?? undefined,
    usage: {
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      costUSD: row.cost_usd,
    },
    runState: row.run_state ? JSON.parse(row.run_state) : null,
  };
}

interface EventRow {
  id: string; task_id: string; seq: number; type: string; title: string;
  detail: string | null; created_at: string;
}

function toEvent(row: EventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    seq: row.seq,
    type: row.type as TaskEvent["type"],
    title: row.title,
    detail: row.detail ?? undefined,
    createdAt: row.created_at,
  };
}

interface CheckpointRow {
  id: string; task_id: string; kind: string; title: string; payload: string;
  status: string; decided_at: string | null; comment: string | null; created_at: string;
}

function toCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind as Checkpoint["kind"],
    title: row.title,
    payload: row.payload,
    status: row.status as Checkpoint["status"],
    decidedAt: row.decided_at ?? undefined,
    comment: row.comment ?? undefined,
    createdAt: row.created_at,
  };
}

interface DeliverableRow {
  id: string; task_id: string; title: string; format: string;
  version: number; created_at: string; updated_at: string;
}

function toDeliverable(row: DeliverableRow): DeliverableMeta {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    format: row.format as DeliverableMeta["format"],
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface VersionRow {
  deliverable_id: string; version: number; content_hash: string; size_bytes: number;
  task_id: string; note: string | null; created_at: string;
}

function toVersion(row: VersionRow): DeliverableVersion {
  return {
    version: row.version,
    contentHash: row.content_hash,
    sizeBytes: row.size_bytes,
    taskId: row.task_id,
    note: row.note ?? undefined,
    createdAt: row.created_at,
  };
}

interface ScheduleRow {
  id: string; goal: string; skill_id: string | null; cron: string;
  enabled: number; last_run_at: string | null; next_run_at: string | null; created_at: string;
}

function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    goal: row.goal,
    skillId: row.skill_id ?? undefined,
    cron: row.cron,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    createdAt: row.created_at,
  };
}
