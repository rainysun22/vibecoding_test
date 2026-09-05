import { useEffect, useRef } from "react";
import type { Task, TaskEvent } from "@openwork/types";

interface ActivityStreamProps {
  task: Task | null;
  events: TaskEvent[];
  connected: boolean;
}

const EVENT_ICON: Record<string, string> = {
  "task.created": "✦",
  "task.planning": "🧠",
  "plan.ready": "🗺",
  "checkpoint.requested": "⏸",
  "checkpoint.approved": "✅",
  "checkpoint.rejected": "⛔",
  "step.started": "▸",
  "step.completed": "✓",
  "step.failed": "✗",
  "deliverable.created": "📦",
  "task.verifying": "🔍",
  "task.completed": "🏁",
  "task.failed": "💥",
  "task.cancelled": "🚫",
  "usage.recorded": "📊",
};

/** 活动流 —— 任务轨迹的可视化回放（N5：全程可审计） */
export function ActivityStream({ task, events, connected }: ActivityStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  return (
    <div className="activity-stream">
      <div className="list-head">
        {task ? "活动流 · 任务轨迹" : "活动流"}
        <span className={`live-indicator ${connected ? "on" : ""}`} title={connected ? "实时连接正常" : "等待实时事件"}>
          ● LIVE
        </span>
      </div>

      {!task ? (
        <div className="list-empty">
          选中左侧任务后，这里将逐步回放它的完整执行轨迹：
          <br />
          拆解计划 → 执行步骤 → 质量校验 → 成果交付
        </div>
      ) : (
        <>
          <div className="stream-goal">
            <span className="goal-label">委托目标</span>
            <p>{task.goal}</p>
            {task.error && <p className="stream-error">⚠ {task.error}</p>}
          </div>
          <div className="stream-body">
            {events.length === 0 && <div className="stream-empty">等待第一个事件…</div>}
            {events.map((event) => (
              <div key={event.id} className={`stream-item ${event.type}`}>
                <span className="stream-icon">{EVENT_ICON[event.type] ?? "•"}</span>
                <div className="stream-content">
                  <div className="stream-title">
                    {event.title}
                    <span className="stream-time">
                      {new Date(event.createdAt).toLocaleTimeString("zh-CN")}
                    </span>
                  </div>
                  {event.detail && <pre className="stream-detail">{event.detail}</pre>}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </>
      )}
    </div>
  );
}
