import type { DeliverableDiff, DiffLine } from "@openwork/types";

/**
 * 行级 diff 引擎 —— 成果 git 化的核心（v0.3：版本间结构化对比）。
 *
 * 经典 LCS（最长公共子序列）回溯：
 * - O(n·m) 动态规划，文档体量（千行级）下瞬间完成
 * - 超大文本自动降级为整块替换，保证永不失控
 */

/** 超过该行数即降级为整块替换（避免极端内存占用） */
const MAX_LCS_LINES = 4_000;

/** 计算两段文本的行级统一 diff */
export function diffText(
  oldText: string,
  newText: string,
): { lines: DiffLine[]; stat: { added: number; removed: number; unchanged: number } } {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  if (oldLines.length > MAX_LCS_LINES || newLines.length > MAX_LCS_LINES) {
    return fallbackDiff(oldLines, newLines);
  }

  const ops = lcsDiffOps(oldLines, newLines);

  const lines: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const op of ops) {
    if (op.type === "ctx") {
      oldNo += 1;
      newNo += 1;
      unchanged += 1;
      lines.push({ type: "ctx", text: op.text, oldNo, newNo });
    } else if (op.type === "del") {
      oldNo += 1;
      removed += 1;
      lines.push({ type: "del", text: op.text, oldNo });
    } else {
      newNo += 1;
      added += 1;
      lines.push({ type: "add", text: op.text, newNo });
    }
  }

  return { lines, stat: { added, removed, unchanged } };
}

/** 组装 DeliverableDiff（from/to 校验由调用方完成） */
export function buildDeliverableDiff(
  deliverableId: string,
  from: number,
  to: number,
  oldText: string,
  newText: string,
): DeliverableDiff {
  const { lines, stat } = diffText(oldText, newText);
  return { deliverableId, from, to, lines, stat };
}

/* ------------------------------ 内部实现 ------------------------------ */

type DiffOp = { type: "ctx" | "del" | "add"; text: string };

/** LCS 动态规划 + 回溯生成编辑序列（先删除后新增的稳定顺序） */
function lcsDiffOps(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;

  // dp[i][j] = oldLines[i..n) 与 newLines[j..m) 的 LCS 长度（尾部对齐便于回溯）
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: "ctx", text: oldLines[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "del", text: oldLines[i]! });
      i += 1;
    } else {
      ops.push({ type: "add", text: newLines[j]! });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "del", text: oldLines[i]! });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "add", text: newLines[j]! });
    j += 1;
  }
  return ops;
}

/** 超大文本降级：整块替换（语义正确，仅粒度变粗） */
function fallbackDiff(
  oldLines: string[],
  newLines: string[],
): { lines: DiffLine[]; stat: { added: number; removed: number; unchanged: number } } {
  const lines: DiffLine[] = [
    { type: "ctx", text: `（文本过大，降级为整块对比）` },
    ...oldLines.map((text, index) => ({ type: "del" as const, text, oldNo: index + 1 })),
    ...newLines.map((text, index) => ({ type: "add" as const, text, newNo: index + 1 })),
  ];
  return {
    lines,
    stat: { added: newLines.length, removed: oldLines.length, unchanged: 0 },
  };
}
