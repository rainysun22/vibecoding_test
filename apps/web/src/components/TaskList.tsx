import type { Task, TaskStatus } from "@openwork/types";

interface TaskListProps {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  pendingCount: number;
  /** 断点续跑（v0.3）：中断任务手动恢复 */
  onResume?: (id: string) => void;
}

const STATUS_META: Record<TaskStatus, { label: string; tone: string }> = {
  pending: { label: "排队中", tone: "muted" },
  planning: { label: "拆解计划", tone: "info" },
  awaiting_clarification: { label: "待澄清", tone: "warn" },
  executing: { label: "执行中", tone: "info" },
  verifying: { label: "校验中", tone: "info" },
  awaiting_approval: { label: "待审批", tone: "warn" },
  completed: { label: "已完成", tone: "ok" },
  failed: { label: "失败", tone: "err" },
  cancelled: { label: "已取消", tone: "muted" },
};

/** 可续跑状态：非终态且非审批暂停（与 Runtime.resumeTask 的判断一致） */
const RESUMABLE: ReadonlySet<TaskStatus> = new Set(["pending", "planning", "executing", "verifying"]);

function formatTime(iso: string): string {
  const date = new Date(iso);
  const diffMinutes = (Date.now() - date.getTime()) / 60_000;
  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${Math.floor(diffMinutes)} 分钟前`;
  if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)} 小时前`;
  return date.toLocaleDateString("zh-CN");
}

export function TaskList({ tasks, selectedId, onSelect, pendingCount, onResume }: TaskListProps) {
  return (
    <div className="task-list">
      <div className="list-head">
        委托任务
        {pendingCount > 0 && <span className="badge warn">{pendingCount} 待审批</span>}
      </div>
      {tasks.length === 0 ? (
        <div className="list-empty">还没有委托 —— 在上方输入一句话开始</div>
      ) : (
        <ul>
          {tasks.map((task) => {
            const meta = STATUS_META[task.status];
            const active = task.id === selectedId;
            const resumable = RESUMABLE.has(task.status);
            return (
              <li key={task.id} className={`task-row ${active ? "active" : ""}`}>
                <button
                  className={`task-item ${active ? "active" : ""}`}
                  onClick={() => onSelect(task.id)}
                >
                  <span className={`status-dot ${meta.tone}`} title={meta.label} />
                  <span className="task-goal">{task.goal}</span>
                  <span className="task-meta">
                    <span className={`badge ${meta.tone}`}>{meta.label}</span>
                    <span className="task-time">{formatTime(task.createdAt)}</span>
                  </span>
                </button>
                {resumable && onResume && (
                  <button
                    className="task-resume"
                    title="从中断处续跑（与进行中的运行互斥，任务锁保证）"
                    onClick={() => onResume(task.id)}
                  >
                    ▶ 续跑
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
