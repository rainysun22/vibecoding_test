import { useEffect, useRef } from "react";
import type { Task, TaskEvent } from "@openwork/types";

/** 实时流式输出（与 App 中的 LiveStream 结构一致） */
interface LiveStream {
  streamId: string;
  text: string;
  done: boolean;
}

interface ActivityStreamProps {
  task: Task | null;
  events: TaskEvent[];
  connected: boolean;
  streams: LiveStream[];
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
  "tool.executed": "🔧",
  "tool.failed": "⚠",
  "deliverable.created": "📦",
  "deliverable.versioned": "⎇",
  "task.resumed": "↻",
  "task.verifying": "🔍",
  "task.completed": "🏁",
  "task.failed": "💥",
  "task.cancelled": "🚫",
  "usage.recorded": "📊",
};

/** 活动流 —— 任务轨迹的可视化回放（N5：全程可审计）+ 实时流式输出 */
export function ActivityStream({ task, events, connected, streams }: ActivityStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastStreamLength = streams[streams.length - 1]?.text.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length, lastStreamLength]);

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
            {events.length === 0 && streams.length === 0 && (
              <div className="stream-empty">等待第一个事件…</div>
            )}
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
            {streams.map((stream) => (
              <div key={stream.streamId} className={`stream-item streaming ${stream.done ? "done" : "active"}`}>
                <span className="stream-icon">{stream.done ? "✓" : "⋯"}</span>
                <div className="stream-content">
                  <div className="stream-title">
                    {stream.done ? "流式输出完成" : "正在实时生成…"}
                    {!stream.done && <span className="stream-time pulse">LIVE</span>}
                  </div>
                  <pre className="stream-detail stream-live-text">{stream.text.slice(-2000)}</pre>
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
