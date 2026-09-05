import type { FastifyInstance } from "fastify";
import type { OpenWorkRuntime } from "@openwork/core";
import type { ProviderId } from "@openwork/types";

/**
 * REST API 路由 —— 面向前端的完整控制面。
 *
 * 资源：tasks（委托）· checkpoints（审批）· deliverables（成果）
 *      · skills（技能）· schedules（定时）· providers（模型）· events（SSE 实时流）
 */
export async function registerRoutes(app: FastifyInstance, runtime: OpenWorkRuntime): Promise<void> {
  /* ------------------------------ 委托任务 ------------------------------ */

  app.post<{ Body: { goal: string; skillId?: string; autoApprove?: boolean } }>(
    "/api/tasks",
    async (request, reply) => {
      const { goal, skillId } = request.body ?? { goal: "" };
      if (!goal?.trim()) {
        return reply.status(400).send({ error: "invalid_request", message: "委托目标不能为空" });
      }
      const task = await runtime.createTask(goal.trim(), { skillId });
      return reply.status(201).send(task);
    },
  );

  app.get("/api/tasks", async (request) => {
    const limit = Number((request.query as { limit?: string }).limit ?? 50);
    return runtime.listTasks(Number.isFinite(limit) ? limit : 50);
  });

  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
    const task = runtime.getTask(request.params.id);
    if (!task) return reply.status(404).send({ error: "not_found", message: "任务不存在" });
    const events = runtime.listEvents(task.id);
    const deliverables = runtime.listDeliverables().filter((d) => d.taskId === task.id);
    return { ...task, events, deliverables };
  });

  app.get<{ Params: { id: string } }>("/api/tasks/:id/events", async (request) => {
    const query = request.query as { after?: string };
    return runtime.listEvents(request.params.id, Number(query.after ?? 0) || 0);
  });

  /* ------------------------------ 审批 ------------------------------ */

  app.get("/api/checkpoints", async () => runtime.listPendingCheckpoints());

  app.post<{ Params: { id: string }; Body: { decision: string; comment?: string } }>(
    "/api/checkpoints/:id",
    async (request, reply) => {
      const { decision, comment } = request.body ?? { decision: "" };
      if (decision !== "approve" && decision !== "reject") {
        return reply
          .status(400)
          .send({ error: "invalid_request", message: "decision 必须是 approve 或 reject" });
      }
      const checkpoint = await runtime.decideCheckpoint(request.params.id, decision, comment);
      if (!checkpoint) {
        return reply.status(404).send({ error: "not_found", message: "审批点不存在或已处理" });
      }
      return checkpoint;
    },
  );

  /* ------------------------------ 成果 ------------------------------ */

  app.get("/api/deliverables", async (request) => {
    const limit = Number((request.query as { limit?: string }).limit ?? 100);
    return runtime.listDeliverables(Number.isFinite(limit) ? limit : 100);
  });

  app.get<{ Params: { id: string } }>("/api/deliverables/:id", async (request, reply) => {
    const meta = runtime.getDeliverable(request.params.id);
    if (!meta) return reply.status(404).send({ error: "not_found", message: "成果不存在" });
    return { ...meta, versions: runtime.listVersions(meta.id) };
  });

  app.get<{ Params: { id: string }; Querystring: { version?: string; preview?: string } }>(
    "/api/deliverables/:id/download",
    async (request, reply) => {
      const file = runtime.readDeliverable(request.params.id, Number(request.query.version ?? 0) || undefined);
      if (!file) {
        return reply.status(404).send({ error: "not_found", message: "成果文件不存在" });
      }
      const filename = `${file.meta.title.replace(/[\\/:*?"<>|]/g, "_")}-v${file.meta.version}.${file.extension}`;
      reply.header(
        "content-type",
        file.meta.format === "markdown"
          ? "text/markdown; charset=utf-8"
          : file.meta.format === "html"
            ? "text/html; charset=utf-8"
            : "application/octet-stream",
      );
      reply.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return reply.send(file.data);
    },
  );

  app.get<{ Params: { id: string }; Querystring: { version?: string } }>(
    "/api/deliverables/:id/preview",
    async (request, reply) => {
      const file = runtime.readDeliverable(request.params.id, Number(request.query.version ?? 0) || undefined);
      if (!file) {
        return reply.status(404).send({ error: "not_found", message: "成果文件不存在" });
      }
      if (file.meta.format === "markdown") {
        reply.type("text/plain; charset=utf-8");
        return reply.send(file.data.toString("utf-8"));
      }
      if (file.meta.format === "html") {
        reply.type("text/html; charset=utf-8");
        return reply.send(file.data);
      }
      return reply.status(415).send({
        error: "unsupported_preview",
        message: `格式 ${file.meta.format} 暂不支持在线预览，请下载查看`,
      });
    },
  );

  /* ------------------------------ 技能 ------------------------------ */

  app.get("/api/skills", async () => runtime.listSkills());

  /* ------------------------------ 定时委托 ------------------------------ */

  app.get("/api/schedules", async () => runtime.listSchedules());

  app.post<{ Body: { goal: string; cron: string; skillId?: string } }>(
    "/api/schedules",
    async (request, reply) => {
      const { goal, cron, skillId } = request.body ?? { goal: "", cron: "" };
      if (!goal?.trim() || !cron?.trim()) {
        return reply
          .status(400)
          .send({ error: "invalid_request", message: "goal 与 cron 不能为空" });
      }
      try {
        return reply.status(201).send(runtime.createSchedule(goal.trim(), cron.trim(), skillId));
      } catch {
        return reply.status(400).send({ error: "invalid_cron", message: "cron 表达式不合法" });
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: { enabled: boolean } }>(
    "/api/schedules/:id",
    async (request, reply) => {
      const { enabled } = request.body ?? { enabled: true };
      runtime.toggleSchedule(request.params.id, Boolean(enabled));
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string } }>("/api/schedules/:id", async (request) => {
    runtime.deleteSchedule(request.params.id);
    return { ok: true };
  });

  /* ------------------------------ 模型网关 ------------------------------ */

  app.get("/api/providers", async () => runtime.listProviderConfigs());

  app.put<{ Params: { id: string }; Body: { apiKey?: string; baseUrl?: string; enabled?: boolean } }>(
    "/api/providers/:id",
    async (request, reply) => {
      const providerId = request.params.id as ProviderId;
      const config = await runtime.configureProvider(providerId, request.body ?? {});
      return reply.send(config);
    },
  );

  app.post<{ Params: { id: string } }>("/api/providers/:id/test", async (request) => {
    const ok = await runtime.testProvider(request.params.id as ProviderId);
    return { connected: ok };
  });

  app.get("/api/models", async () => runtime.availableModels());

  app.put<{ Body: { defaultModel: string; plannerModel?: string } }>(
    "/api/models/default",
    async (request) => {
      const { defaultModel, plannerModel } = request.body ?? { defaultModel: "" };
      runtime.setDefaultModels(defaultModel, plannerModel);
      return { defaultModel, plannerModel: plannerModel ?? defaultModel };
    },
  );

  /* ------------------------------ 成本路由 ------------------------------ */

  app.get("/api/models/routing", async () => runtime.getRouting());

  app.put<{
    Body: { preferLocal?: boolean; localModel?: string | null; dailyBudgetUSD?: number };
  }>("/api/models/routing", async (request) => {
    const { preferLocal, localModel, dailyBudgetUSD } = request.body ?? {};
    return runtime.setRouting({
      ...(preferLocal !== undefined ? { preferLocal: Boolean(preferLocal) } : {}),
      ...(localModel !== undefined ? { localModel: localModel || null } : {}),
      ...(dailyBudgetUSD !== undefined ? { dailyBudgetUSD: Math.max(0, Number(dailyBudgetUSD) || 0) } : {}),
    });
  });

  /* ------------------------------ 统计 ------------------------------ */

  app.get("/api/stats", async () => runtime.usageSummary());

  app.get("/api/health", async () => ({
    status: "ok",
    product: "OpenWork",
    version: "0.1.0",
    time: new Date().toISOString(),
  }));

  /* ------------------------------ SSE 实时流 ------------------------------ */

  app.get<{ Querystring: { taskId?: string } }>("/api/events", async (request, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(`retry: 3000\n\n`);
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ connected: true })}\n\n`);

    const taskId = request.query.taskId;
    const unsubscribe = runtime.subscribe((payload) => {
      if (taskId && payload.taskId && payload.taskId !== taskId) return;
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(`: ping\n\n`);
    }, 15_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
