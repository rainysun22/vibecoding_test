import { useCallback, useEffect, useState } from "react";
import type { Playbook } from "@openwork/types";
import * as api from "../api";

interface PlaybookPanelProps {
  /** 变更信号：任务完成（新经验固化）时刷新 */
  refreshKey: number;
  onToast: (message: string) => void;
}

/**
 * 经验回放（v0.5，SkillOS / HYPERSKILL 式程序记忆）——
 * 成功任务轨迹蒸馏为 playbook：相似目标自动召回注入规划；
 * 本面板为经验的治理视图（查看 / 复用次数 / 删除低效经验）。
 */
export function PlaybookPanel({ refreshKey, onToast }: PlaybookPanelProps) {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void api
      .listPlaybooks()
      .then(setPlaybooks)
      .catch(() => setPlaybooks([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  if (playbooks.length === 0) return null;

  const remove = async (id: string) => {
    try {
      await api.deletePlaybook(id);
      onToast("经验已删除 —— 相似任务将不再复用该路径");
      refresh();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "删除失败");
    }
  };

  return (
    <div className="playbook-panel">
      <div className="playbook-head">
        <span className="playbook-badge">经验</span>
        <span className="playbook-count">{playbooks.length} 条成功路径</span>
      </div>
      <ul className="playbook-list">
        {playbooks.map((playbook) => (
          <li key={playbook.id} className="playbook-item">
            <button
              className="playbook-summary"
              onClick={() => setExpanded(expanded === playbook.id ? null : playbook.id)}
              title="展开完整路径"
            >
              <span className="playbook-pattern">{playbook.goalPattern}</span>
              <span className="playbook-meta">
                {playbook.steps.length} 步 · 复用 {playbook.useCount} 次
              </span>
            </button>
            {expanded === playbook.id && (
              <div className="playbook-detail">
                <p className="playbook-outcome">{playbook.outcome}</p>
                <ol className="playbook-steps">
                  {playbook.steps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
                <button className="btn ghost small" onClick={() => void remove(playbook.id)}>
                  删除该经验
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
