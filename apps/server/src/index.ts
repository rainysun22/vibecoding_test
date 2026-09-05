import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenWorkRuntime } from "@openwork/core";
import { registerRoutes } from "./routes.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  autoApprove?: boolean;
}

export async function createServer(options: ServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 4765);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const rootDir = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const dataDir = options.dataDir ?? resolve(rootDir, "data");
  const skillsDir = resolve(rootDir, "skills");

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  await app.register(cors, { origin: true });

  const runtime = new OpenWorkRuntime({
    dataDir,
    skillsDir,
    autoApprove: options.autoApprove ?? process.env.OPENWORK_AUTO_APPROVE === "1",
  });

  await registerRoutes(app, runtime);

  // 生产模式：内联托管已构建的前端（单进程自托管）
  const webDist = resolve(rootDir, "apps/web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api")) {
        reply.status(404).send({ error: "not_found", message: "接口不存在" });
      } else {
        reply.sendFile("index.html");
      }
    });
  }

  const shutdown = async () => {
    runtime.shutdown();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return {
    app,
    runtime,
    start: () =>
      app.listen({ port, host }).then(() => {
        app.log.info(`OpenWork 服务已启动: http://${host}:${port}`);
        app.log.info(`数据目录（本地优先）: ${dataDir}`);
      }),
  };
}

// 直接运行入口：node dist/index.js
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const moduleSelf = fileURLToPath(import.meta.url);
if (invokedPath === moduleSelf) {
  createServer()
    .then((server) => server.start())
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
