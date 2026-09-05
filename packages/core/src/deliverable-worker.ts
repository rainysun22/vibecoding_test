import { parentPort, workerData } from "node:worker_threads";
import { generateDeliverable } from "@openwork/deliverables";
import type { GenerateInput } from "@openwork/deliverables";

/**
 * 成果生成 worker —— docx/xlsx/pptx 等 zip 重格式在独立线程打包，
 * 主事件循环保持空闲（SSE 心跳与流式输出不被大文件阻塞）。
 */
const { input } = workerData as { input: GenerateInput };

void generateDeliverable(input).then(
  (output) => parentPort?.postMessage({ ok: true, output }),
  (error: unknown) =>
    parentPort?.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
);
