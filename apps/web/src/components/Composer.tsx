import { useState } from "react";
import type { SkillDefinition } from "@openwork/types";

interface ComposerProps {
  skills: SkillDefinition[];
  onSubmit: (goal: string, skillId?: string) => Promise<void>;
  onError: (message: string) => void;
}

const QUICK_GOALS = [
  "写一份 AI 工作台竞品分析报告",
  "生成本周行业动态 PPT",
  "整理产品调研数据表格",
];

/** 一句话委托输入 —— 「对话即交付」的入口 */
export function Composer({ skills, onSubmit, onError }: ComposerProps) {
  const [goal, setGoal] = useState("");
  const [skillId, setSkillId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (text: string) => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(text.trim(), skillId || undefined);
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
        <select value={skillId} onChange={(event) => setSkillId(event.target.value)} title="选择技能（决定成果格式）">
          <option value="">自动 · Markdown</option>
          {skills.map((skill) => (
            <option key={skill.id} value={skill.id}>
              {skill.name} · .{skill.outputFormat}
            </option>
          ))}
        </select>
        <button
          className="btn primary"
          disabled={!goal.trim() || submitting}
          onClick={() => void submit(goal)}
        >
          {submitting ? "创建中…" : "发起委托 ⏎"}
        </button>
      </div>
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
