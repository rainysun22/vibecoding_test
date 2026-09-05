import { useEffect, useState } from "react";
import type { SteeringMessage, Task } from "@openwork/types";
import * as api from "../api";

interface SteeringBarProps {
  task: Task | null;
  onToast: (message: string) => void;
}

/**
 * 中途转向（v0.4，AgentGUI 式排队转向）——
 * 任务运行期间随时下达修正指令：不打断当前步骤，在步骤间隙注入后续执行。
 */
export function SteeringBar({ task, onToast }: SteeringBarProps) {
  const [content, setContent] = useState("");
  const [messages, setMessages] = useState<SteeringMessage[]>([]);
  const [sending, setSending] = useState(false);

  const runnable = Boolean(
    task && ["pending", "planning", "executing", "verifying"].includes(task.status),
  );

  useEffect(() => {
    if (!task) {
      setMessages([]);
      return;
    }
    void api
      .listSteeringMessages(task.id)
      .then(setMessages)
      .catch(() => setMessages([]));
  }, [task, task?.status]);

  const send = async () => {
    if (!task || !content.trim() || sending) return;
    setSending(true);
    try {
      await api.steerTask(task.id, content.trim());
      setMessages(await api.listSteeringMessages(task.id).catch(() => []));
      setContent("");
      onToast("指令已排队 —— 将在当前步骤完成后注入");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "转向失败");
    } finally {
      setSending(false);
    }
  };

  if (!task) return null;

  return (
    <div className="steering-bar">
      {runnable ? (
        <>
          <div className="steering-input-row">
            <input
              value={content}
              placeholder="中途转向：补充要求、修正方向…（不打断执行）"
              onChange={(event) => setContent(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button className="btn primary" disabled={!content.trim() || sending} onClick={() => void send()}>
              {sending ? "…" : "注入 ↵"}
            </button>
          </div>
          {messages.length > 0 && (
            <ul className="steering-list">
              {messages.map((message) => (
                <li key={message.id} className={`steering-item ${message.status}`}>
                  <span className="steering-status">
                    {message.status === "queued" ? "⏳ 排队中" : message.status === "injected" ? "✅ 已注入" : "○ 作废"}
                  </span>
                  <span className="steering-content">{message.content}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="steering-idle">
          {task.status === "awaiting_approval"
            ? "任务等待审批中 —— 通过后可继续转向"
            : "任务已结束 —— 修正请使用成果「修订」功能"}
        </p>
      )}
    </div>
  );
}
