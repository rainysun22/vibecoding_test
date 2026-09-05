import { useEffect, useState } from "react";
import type { DeliverableMeta } from "@openwork/types";
import * as api from "../api";

interface DeliverablesPanelProps {
  deliverables: DeliverableMeta[];
  scoped: boolean;
  onToast: (message: string) => void;
}

const FORMAT_ICON: Record<string, string> = {
  markdown: "📝",
  html: "🌐",
  docx: "📄",
  xlsx: "📊",
  pptx: "📽",
};

/** 成果面板 —— 开放格式优先，一切成果可下载带走 */
export function DeliverablesPanel({ deliverables, scoped, onToast }: DeliverablesPanelProps) {
  const [previewing, setPreviewing] = useState<{ id: string; content: string } | null>(null);

  useEffect(() => {
    setPreviewing(null);
  }, [deliverables.map((d) => d.id).join(",")]);

  const openPreview = async (deliverable: DeliverableMeta) => {
    try {
      const content = await api.previewDeliverable(deliverable.id);
      setPreviewing({ id: deliverable.id, content });
    } catch (error) {
      onToast(error instanceof Error ? error.message : "预览失败");
    }
  };

  return (
    <div className="deliverables">
      <div className="list-head">
        成果 {scoped ? "· 当前任务" : "· 全部"}
        <span className="badge muted">{deliverables.length}</span>
      </div>

      {deliverables.length === 0 ? (
        <div className="list-empty">暂无成果 —— 任务完成并通过审批后，成果将出现在这里</div>
      ) : (
        <ul className="deliverable-list">
          {deliverables.map((deliverable) => (
            <li key={deliverable.id} className="deliverable-card">
              <div className="deliverable-info">
                <span className="deliverable-icon">{FORMAT_ICON[deliverable.format] ?? "📦"}</span>
                <div>
                  <div className="deliverable-title" title={deliverable.title}>
                    {deliverable.title}
                  </div>
                  <div className="deliverable-meta">
                    .{deliverable.format} · v{deliverable.version}
                  </div>
                </div>
              </div>
              <div className="deliverable-actions">
                {["markdown", "html"].includes(deliverable.format) && (
                  <button className="btn ghost small" onClick={() => void openPreview(deliverable)}>
                    预览
                  </button>
                )}
                <a
                  className="btn primary small"
                  href={api.deliverableDownloadUrl(deliverable.id)}
                  download
                >
                  下载
                </a>
              </div>
              {previewing?.id === deliverable.id && (
                <pre className="deliverable-preview">{previewing.content}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
