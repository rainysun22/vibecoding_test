import type { KnowledgeRecall } from "@openwork/types";

/**
 * 知识召回引擎 —— 个人知识库的相关性检索（MemX 式本地优先设计）。
 *
 * 设计要点：
 * 1. 零依赖：bigram 重叠打分（中英文通吃），无需向量库与 embedding API
 * 2. 低置信拒绝：最高分低于阈值时宁可不召回（MemX 核心结论——
 *    无答案时伪造召回比漏召回更伤信任）
 * 3. 片段摘取：命中位置附近开窗，注入 prompt 的只是相关段落而非全文
 */

/** 召回分数低于此值视为无关（0-1） */
const RECALL_THRESHOLD = 0.12;
/** 最多召回的文档数 */
const MAX_RECALL_DOCS = 3;
/** 命中片段窗口（字符） */
const SNIPPET_WINDOW = 600;

/** 文本 → bigram 集合（中文按字、英文按词内字符对；数字串保留） */
export function bigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  const grams = new Set<string>();
  // 先按词切分：拉丁词保持整体参与 bigram，CJK 逐字滑窗
  const tokens = normalized.match(/[\u4e00-\u9fff]|[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    if (/^[\u4e00-\u9fff]$/.test(token)) continue; // 单个汉字由滑窗处理
    if (token.length === 1) grams.add(token);
    for (let i = 0; i < token.length - 1; i++) grams.add(token.slice(i, i + 2));
  }
  // CJK 连续段：逐字 bigram
  const cjkRuns = normalized.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length - 1; i++) grams.add(run.slice(i, i + 2));
  }
  return grams;
}

/** 查询与文档的 bigram 重叠率（Jaccard 式：重叠 / 查询规模） */
export function overlapScore(queryGrams: Set<string>, docGrams: Set<string>): number {
  if (queryGrams.size === 0) return 0;
  let hits = 0;
  for (const gram of queryGrams) {
    if (docGrams.has(gram)) hits += 1;
  }
  return hits / queryGrams.size;
}

/** 找到首个命中 bigram 的位置，取窗口片段 */
function snippetAround(content: string, queryGrams: Set<string>): string {
  const lower = content.toLowerCase();
  for (let i = 0; i < lower.length - 1; i++) {
    const pair = lower.slice(i, i + 2);
    if (queryGrams.has(pair)) {
      const start = Math.max(0, i - Math.floor(SNIPPET_WINDOW / 2));
      const end = Math.min(content.length, start + SNIPPET_WINDOW);
      const prefix = start > 0 ? "…" : "";
      const suffix = end < content.length ? "…" : "";
      return `${prefix}${content.slice(start, end).trim()}${suffix}`;
    }
  }
  return content.slice(0, SNIPPET_WINDOW);
}

/**
 * 召回与查询相关的知识库文档。
 * 返回按分数降序的命中列表；最高分低于阈值时返回空（低置信拒绝）。
 */
export function recallKnowledge(
  docs: { id: string; title: string; content: string }[],
  query: string,
): KnowledgeRecall[] {
  const queryGrams = bigrams(query);
  if (queryGrams.size === 0 || docs.length === 0) return [];

  const scored = docs
    .map((doc) => {
      // 标题命中加权：标题相关性强于正文泛匹配
      const titleGrams = bigrams(doc.title);
      const bodyScore = overlapScore(queryGrams, bigrams(doc.content));
      const titleScore = overlapScore(queryGrams, titleGrams);
      return {
        docId: doc.id,
        title: doc.title,
        score: Math.min(1, bodyScore + titleScore * 0.5),
        snippet: snippetAround(doc.content, queryGrams),
      };
    })
    .filter((r) => r.score >= RECALL_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECALL_DOCS);

  // 低置信拒绝：最好的文档都不够相关 → 不注入任何内容
  return scored;
}

/** 把召回结果渲染为 prompt 段落（供 research/draft 步骤注入） */
export function renderKnowledgeForPrompt(recalls: KnowledgeRecall[]): string {
  if (recalls.length === 0) return "";
  return recalls
    .map((r) => `【个人知识库：${r.title}（相关度 ${(r.score * 100).toFixed(0)}%）】\n${r.snippet}`)
    .join("\n\n---\n\n");
}
