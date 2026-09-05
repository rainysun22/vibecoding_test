import { useState } from "react";
import type { Checkpoint } from "@openwork/types";

interface ApprovalCardProps {
  checkpoint: Checkpoint;
  onDecide: (id: string, decision: "approve" | "reject", comment?: string) => void;
}

/** 语义级审批卡片：一次审「一版计划 / 一版成果」，而非逐工具确认 */
export function ApprovalCard({ checkpoint, onDecide }: ApprovalCardProps) {
  const [comment, setComment] = useState("");
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={`approval-card ${checkpoint.kind}`}>
      <button className="approval-head" onClick={() => setExpanded(!expanded)}>
        <span className="approval-kind">
          {checkpoint.kind === "plan" ? "🗺 计划审批" : "📦 成果审批"}
        </span>
        <span className="approval-title">{checkpoint.title}</span>
        <span className="approval-toggle">{expanded ? "收起" : "展开"}</span>
      </button>

      {expanded && (
        <>
          <pre className="approval-payload">{checkpoint.payload}</pre>
          <input
            className="approval-comment"
            placeholder="审批意见（可选）"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="approval-actions">
            <button
              className="btn ok"
              onClick={() => onDecide(checkpoint.id, "approve", comment || undefined)}
            >
              ✓ 批准
            </button>
            <button
              className="btn err"
              onClick={() => onDecide(checkpoint.id, "reject", comment || undefined)}
            >
              ✗ 拒绝
            </button>
          </div>
        </>
      )}
    </div>
  );
}
