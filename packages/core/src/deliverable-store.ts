import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DeliverableMeta, DeliverableVersion } from "@openwork/types";
import type { GenerateOutput } from "@openwork/deliverables";

/**
 * 成果文件仓库 —— 「成果 git 化」的最小实现：
 * 内容寻址（SHA-256）+ 版本链 + 任意版本可回读。
 * 文件落在本机 data/deliverables/ 下，永不离开用户设备（N3 真需求）。
 */
export class DeliverableStore {
  constructor(private readonly baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
  }

  /** 保存新成果（或新版本），返回版本记录 */
  save(
    meta: DeliverableMeta,
    output: GenerateOutput,
    note?: string,
    sourceMarkdown?: string,
  ): DeliverableVersion {
    const contentHash = sha256(output.data);
    const sizeBytes = output.data.length;

    const version: DeliverableVersion = {
      version: meta.version,
      contentHash,
      sizeBytes,
      taskId: meta.taskId,
      note,
      createdAt: new Date().toISOString(),
    };

    const dir = join(this.baseDir, meta.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `v${meta.version}.${output.extension}`), output.data);
    // 内容寻址副本（相同内容天然去重的审计锚点）
    writeFileSync(join(dir, `${contentHash}.${output.extension}`), output.data);
    // 版本源 Markdown：修订与 diff 的统一文本基础（与导出格式解耦）
    if (sourceMarkdown !== undefined) {
      writeFileSync(join(dir, `v${meta.version}.source.md`), sourceMarkdown, "utf-8");
    }
    // 记录当前版本指针，语义对齐 git HEAD
    writeFileSync(join(dir, "HEAD"), `v${meta.version}`);

    return version;
  }

  /** 读取指定版本内容 */
  read(deliverableId: string, version: number, extension: string): Buffer {
    const path = join(this.baseDir, deliverableId, `v${version}.${extension}`);
    return readFileSync(path);
  }

  /** 读取指定版本的源 Markdown（版本 diff 与修订的工作基础） */
  readSource(deliverableId: string, version: number): string | null {
    const path = join(this.baseDir, deliverableId, `v${version}.source.md`);
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  }

  /** 读取当前（HEAD）版本 */
  readHead(deliverableId: string, version: number, extension: string): Buffer {
    return this.read(deliverableId, version, extension);
  }

  extensionFor(format: DeliverableMeta["format"]): string {
    return format === "markdown" ? "md" : format;
  }

  exists(deliverableId: string): boolean {
    return existsSync(join(this.baseDir, deliverableId));
  }
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
