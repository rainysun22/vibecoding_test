/**
 * 上下文压缩（Context Compaction）—— 步骤历史要点化（v0.5）。
 *
 * 论文依据 arXiv:2606.10209：长程任务的上下文持续膨胀导致 context rot
 * （注意力稀释、召回劣化），应把远期历史压缩为要点骨架、近期保持全文，
 * 形成信息密度分层。
 *
 * 设计：确定性抽取式压缩（零 LLM 成本、无信息幻觉——只做保留与截断）。
 * 优先保留结构行（标题/列表/表格行），不足时回退原文截断。
 */

/** 单个步骤压缩后的目标预算（字符） */
const COMPACT_BUDGET = 1200;

export function compactStepResult(result: string, budget = COMPACT_BUDGET): string {
  if (result.length <= budget) return result;

  const lines = result.split("\n").map((l) => l.trim());
  const structural = lines.filter(
    (l) =>
      /^#{1,4} \S/.test(l) || // Markdown 标题
      /^(?:[-*]|\d+\.) \S/.test(l) || // 列表项
      /^\|.+\|/.test(l), // 表格行
  );

  let digest = structural.join("\n");
  if (digest.length > budget) {
    // 结构行仍超预算：按序截断（开头的骨架信息密度最高）
    digest = digest.slice(0, budget);
  } else if (digest.length < budget / 4) {
    // 结构行过少（散文式产出）：回退原文截断
    digest = result.slice(0, budget);
  }

  return `【已压缩：原 ${result.length} 字符 → ${digest.length}】\n${digest}`;
}
