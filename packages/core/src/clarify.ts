/**
 * 主动澄清（Ask-before-you-act）—— 规划前的歧义检测与问题生成（v0.5）。
 *
 * 论文依据：
 * - arXiv:2512.04068：澄清的价值取决于「预期信息增益」—— 只有猜测成本高的歧义才值得打断用户
 * - arXiv:2605.07937：过度提问（over-asking）比漏问更伤信任——宁缺勿滥
 *
 * 设计：确定性启发式（零 LLM 成本、零延迟、可测试）。
 * 只在高置信歧义信号下触发：目标过短 / 纯动词短语无主题 / 模糊量词；
 * 具体性信号（数字、URL、文件路径、足够长的主题）反向抵扣。
 */

export interface ClarifyQuestionDraft {
  question: string;
  /** 为什么问（预期信息增益说明，展示给用户） */
  rationale: string;
}

/** 模糊量词 / 放弃决策的表述 */
const VAGUE_PATTERN = /(随便|看着办|差不多就行|大概|哪些一些|一些|几个|什么的|你定|你决定|都行|无所谓)/;
/** 轻动词前缀（礼貌性修饰，无信息量） */
const LIGHT_PREFIX = /^(请|帮我|麻烦|帮忙|给我|来)/;
/** 交付物名词（出现不等于歧义，但只剩它们就是） */
const DELIVERABLE_PATTERN = /(报告|总结|分析|方案|文章|指南|大纲|简介|材料|文档|演示文稿|清单|简报|白皮书|ppt)/gi;
/** 轻动词短语（写一份 / 做个 / 整理一下 等） */
const LIGHT_VERB_PATTERN = /(写|做|搞|弄|整|出|生成|制作|总结|整理|分析|输出|来)一?[份个篇点张下]?(?:一下)?/g;

/**
 * 检测委托目标是否需要规划前澄清。
 * 返回问题列表；空数组 = 目标足够明确，无需打断用户。
 */
export function detectClarificationNeed(goal: string): ClarifyQuestionDraft[] {
  const trimmed = goal.trim();
  if (trimmed.length === 0) return [];

  const compact = trimmed.replace(/\s+/g, "");
  let score = 0;

  // 信号 1：目标过短 —— 上下文不足以确定主题与范围
  const terse = compact.length < 8;
  if (terse) score += 2;

  // 信号 2：模糊量词 / 放弃决策的表述（猜测错误成本高）
  const vague = VAGUE_PATTERN.test(trimmed);
  if (vague) score += 2;

  // 信号 3：剥掉轻动词与交付物名词后没有实质主题（纯动词短语）
  const subject = trimmed
    .replace(LIGHT_PREFIX, "")
    .replace(LIGHT_VERB_PATTERN, "")
    .replace(DELIVERABLE_PATTERN, "")
    .replace(/[\s的的了呢吧。！!?？，,]/g, "");
  const noSubject = compact.length < 24 && subject.length < 2;
  if (noSubject) score += 2;

  // 反向信号：具体性（数字、URL、路径、足够长的主题）—— 信息增益不足以支撑打断
  const specific = /\d/.test(trimmed) || /https?:\/\//.test(trimmed) || /\/|\./.test(compact.slice(1));
  if (specific || compact.length > 20) score -= 2;

  if (score < 2) return [];

  const questions: ClarifyQuestionDraft[] = [];
  if (terse) {
    questions.push({
      question: "这个委托的核心主题与对象是什么？（例如：面向谁、关于哪个领域或产品）",
      rationale: "目标过于简短，无法确定研究主题与范围",
    });
  }
  if (noSubject) {
    questions.push({
      question: "期望的成果形态与深度？（如：简报 / 详尽报告 / 大纲，篇幅大约多少）",
      rationale: "未指明交付物形态，无法确定步骤结构与输出格式",
    });
  }
  if (vague) {
    questions.push({
      question: "「随便 / 都行」类表述下是否有必须满足的硬性要求？（范围、口径、必须包含的内容）",
      rationale: "存在放弃决策的表述，猜测错误的返工成本高",
    });
  }
  if (questions.length === 0) return [];

  return questions.slice(0, 3);
}
