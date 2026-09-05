/**
 * 步骤置信度启发式评分（v0.5）。
 *
 * 论文依据 arXiv:2604.23505：Agent 每步产出的不确定性应被显式量化，
 * 并向任务级传播 —— 低置信不是失败，而是「需要复核」的信号。
 *
 * 评分维度（确定性启发式，零 LLM 成本）：
 * 1. 体量：过短的产出可疑（敷衍或截断）
 * 2. 结构：Markdown 标题/列表/表格体现完整的组织
 * 3. 证据：数字密度反映具体性
 * 4. 对冲：不确定表述密度拉低置信
 * 5. 失败标记：显式错误词直接重罚
 */

/** 步骤置信度低于此值触发重采样（每步至多一次） */
export const RESAMPLE_THRESHOLD = 0.4;
/** 步骤置信度低于此值进入校验重点名单 */
export const WEAK_STEP_THRESHOLD = 0.6;

export function scoreStepConfidence(result: string): number {
  let score = 0.75; // 基线：结构合格的正常产出

  // 体量信号
  if (result.length < 150) score -= 0.35;
  else if (result.length < 400) score -= 0.15;
  else if (result.length > 1200) score += 0.1;

  // 结构信号
  const headers = (result.match(/^#{1,4} \S/gm) ?? []).length;
  const listItems = (result.match(/^\s*(?:[-*]|\d+\.) \S/gm) ?? []).length;
  if (headers >= 2) score += 0.1;
  if (listItems >= 3) score += 0.05;
  if (/^\|.+\|/m.test(result)) score += 0.05; // 表格

  // 证据信号：数字密度
  const numbers = (result.match(/\d+/g) ?? []).length;
  if (numbers >= 3) score += 0.05;

  // 对冲信号：不确定表述
  const hedges = (result.match(/无法|未能|不确定|可能存在|也许|似乎|暂无|缺少|不足|待确认/g) ?? []).length;
  score -= Math.min(0.3, hedges * 0.06);

  // 失败标记
  if (/任务失败|执行出错|无法完成|error occurred/i.test(result)) score -= 0.4;

  return Math.max(0, Math.min(1, score));
}
