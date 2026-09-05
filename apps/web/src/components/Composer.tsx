import { useState } from "react";
import type { SkillDefinition } from "@openwork/types";

interface ComposerProps {
  skills: SkillDefinition[];
  onSubmit: (goal: string, skillId?: string) => Promise<void>;
  onParallelSubmit: (goal: string) => Promise<void>;
  onError: (message: string) => void;
}

const QUICK_GOALS = [
  "写一份 AI 工作台竞品分析报告",
  "生成本周行业动态 PPT",
  "整理产品调研数据表格",
];

/** 一句话委托输入 —— 「对话即交付」的入口 */
export function Composer({ skills, onSubmit, onParallelSubmit, onError }: ComposerProps) {
  const [goal, setGoal] = useState("");
  const [skillId, setSkillId] = useState("");
  const [parallel, setParallel] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (text: string) => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      if (parallel) {
        await onParallelSubmit(text.trim());
      } else {
        await onSubmit(text.trim(), skillId || undefined);
      }
      setGoal("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "创建委托失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="composer">
      <div className="composer-head">一句话委托</div>
      <textarea
        value={goal}
        placeholder="描述你的目标，例如：写一份 2026 新能源汽车市场分析报告…"
        rows={3}
        onChange={(event) => setGoal(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            void submit(goal);
          }
        }}
      />
      <div className="composer-controls">
        <select
          value={skillId}
          onChange={(event) => setSkillId(event.target.value)}
          title="选择技能（决定成果格式）"
          disabled={parallel}
        >
          <option value="">自动 · Markdown</option>
          {skills.map((skill) => (
            <option key={skill.id} value={skill.id}>
              {skill.name} · .{skill.outputFormat}
            </option>
          ))}
        </select>
        <button
          className={`btn ${parallel ? "primary" : "ghost"} ${parallel ? "parallel-on" : ""}`}
          onClick={() => setParallel((v) => !v)}
          title="并行委托：按分隔词拆分子目标，多 Agent 独立执行后聚合（v0.4 fork-join）"
        >
          ⇶ 并行 {parallel ? "开" : "关"}
        </button>
        <button
          className="btn primary"
          disabled={!goal.trim() || submitting}
          onClick={() => void submit(goal)}
        >
          {submitting ? "创建中…" : "发起委托 ⏎"}
        </button>
      </div>
      {parallel && (
        <p className="composer-parallel-hint">
          并行模式：目标按「、/，/以及/和/与/vs」拆为多个子委托，各自独立研究撰写，完成后自动聚合成一份成果
        </p>
      )}
      <div className="composer-quick">
        {QUICK_GOALS.map((quick) => (
          <button key={quick} className="chip" onClick={() => setGoal(quick)}>
            {quick}
          </button>
        ))}
      </div>
    </div>
  );
}
