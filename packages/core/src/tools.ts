import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import type { SourceMaterial } from "@openwork/types";

/**
 * Research 工具箱 —— 让研究步骤拥有真实数据源（v0.3 能力扩展）。
 *
 * 设计要点：
 * 1. 来源显式化：URL / 文件路径只从「用户目标 + 已审批计划指令」中提取，
 *    不由模型自由编造 —— 用户审阅过的内容即是授权边界（语义级信任）。
 * 2. 本地优先：文件读取发生在用户自己的机器上，内容永不上传。
 * 3. 失败不致命：单个来源获取失败只记录事件，不阻断整个步骤。
 */

/** 抓取正文上限（字符）：避免巨型页面淹没上下文 */
const WEB_CONTENT_LIMIT = 20_000;
/** 本地文件读取上限（字节）：防误读超大文件 */
const FILE_SIZE_LIMIT = 500_000;
/** 单个步骤最多使用的来源数 */
const MAX_SOURCES_PER_STEP = 5;

/** URL 字符黑名单：空白/引号/括号/中文标点（中文语境下 URL 不会包含这些） */
const URL_PATTERN = /https?:\/\/[^\s"'<>)\]`，。；：、！？…（）“”‘’【】《》]+/g;
/** 文件路径：绝对路径 / ~/ 开头 / ./ ../ 开头（排除普通 URL 里的斜杠） */
const FILE_PATTERN = /(?:^|[\s（("'，,])((?:\/[\w.\-]+){2,}|~\/[\w.\-/.]+|\.{1,2}\/[\w.\-/.]+)/g;

/** 从文本中提取 http(s) URL（去重，保持出现顺序） */
export function extractUrls(text: string): string[] {
  const urls = text.match(URL_PATTERN) ?? [];
  return [...new Set(urls.map((u) => u.replace(/[.,;:!?]$/, "")))];
}

/** 从文本中提取本地文件路径（去重，保持出现顺序） */
export function extractFilePaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(FILE_PATTERN)) {
    const raw = (match[1] ?? "").replace(/[.,;:!?，。]$/, "");
    if (raw.length > 1 && !raw.startsWith("//")) paths.push(raw);
  }
  return [...new Set(paths)];
}

/** 抓取网页并抽取正文文本（去脚本/样式/标签，压缩空白） */
export async function fetchWebPage(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "OpenWork-Agent/0.3 (+local-first research tool)" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const type = response.headers.get("content-type") ?? "";
  const body = await response.text();
  const text = type.includes("html") ? htmlToText(body) : body;
  return text.slice(0, WEB_CONTENT_LIMIT);
}

/** 读取本地文本文件（大小受控；目录/二进制拒绝） */
export async function readLocalFile(path: string): Promise<string> {
  const resolved = path.startsWith("~/")
    ? `${process.env.HOME ?? ""}${path.slice(1)}`
    : path;

  const info = await stat(resolved).catch(() => {
    throw new Error(`文件不存在：${path}`);
  });
  if (!info.isFile()) throw new Error(`不是普通文件：${path}`);
  if (info.size > FILE_SIZE_LIMIT) throw new Error(`文件过大（${info.size} 字节）：${path}`);

  const buffer = await readFile(resolved);
  return buffer.toString("utf-8").slice(0, WEB_CONTENT_LIMIT);
}

/**
 * 汇集研究材料：目标 + 指令中显式引用的 URL 与文件路径。
 * 单个来源失败返回 null（由调用方记录事件并继续）。
 */
export async function gatherSources(
  goal: string,
  instruction: string,
): Promise<{ materials: SourceMaterial[]; failures: { source: string; error: string }[] }> {
  const urls = extractUrls(`${goal}\n${instruction}`).slice(0, MAX_SOURCES_PER_STEP);
  const files = extractFilePaths(`${goal}\n${instruction}`).slice(0, MAX_SOURCES_PER_STEP);

  const materials: SourceMaterial[] = [];
  const failures: { source: string; error: string }[] = [];

  for (const url of urls) {
    try {
      materials.push({ kind: "web", source: url, content: await fetchWebPage(url) });
    } catch (error) {
      failures.push({ source: url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const file of files) {
    try {
      materials.push({ kind: "file", source: file, content: await readLocalFile(file) });
    } catch (error) {
      failures.push({ source: file, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { materials, failures };
}

/** 把研究材料渲染为 prompt 段落 */
export function renderSourcesForPrompt(materials: SourceMaterial[]): string {
  if (materials.length === 0) return "";
  return materials
    .map(
      (m) =>
        `【参考来源：${m.source}】\n${m.content.slice(0, WEB_CONTENT_LIMIT)}`,
    )
    .join("\n\n---\n\n");
}

/* ------------------------------ 内部工具 ------------------------------ */

/** HTML → 纯文本：去 script/style，标签转空格，压缩连续空行 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}
