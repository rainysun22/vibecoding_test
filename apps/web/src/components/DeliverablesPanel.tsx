import { useEffect, useState } from "react";
import type { DeliverableDiff, DeliverableMeta, Task } from "@openwork/types";
import * as api from "../api";

interface DeliverablesPanelProps {
  deliverables: DeliverableMeta[];
  scoped: boolean;
  onToast: (message: string) => void;
  /** 修订任务创建后选中它（跟踪修订过程） */
  onTaskCreated?: (task: Task) => void;
}

const FORMAT_ICON: Record<string, string> = {
  markdown: "📝",
  html: "🌐",
  docx: "📄",
  xlsx: "📊",
  pptx: "📽",
};

/** 成果面板 —— 开放格式优先，一切成果可下载带走；支持版本对比与修订（v0.3） */
export function DeliverablesPanel({ deliverables, scoped, onToast, onTaskCreated }: DeliverablesPanelProps) {
  const [previewing, setPreviewing] = useState<{ id: string; content: string } | null>(null);
  const [diffTarget, setDiffTarget] = useState<DeliverableMeta | null>(null);
  const [revising, setRevising] = useState<DeliverableMeta | null>(null);

  useEffect(() => {
    setPreviewing(null);
    setDiffTarget(null);
    setRevising(null);
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
                    {deliverable.version > 1 && (
                      <span className="version-chain" title="成果版本链：修订生成新版本">
                        ⎇ {deliverable.version} 个版本
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="deliverable-actions">
                {deliverable.version > 1 && (
                  <button
                    className="btn ghost small"
                    onClick={() =>
                      setDiffTarget(diffTarget?.id === deliverable.id ? null : deliverable)
                    }
                  >
                    对比
                  </button>
                )}
                <button
                  className="btn ghost small"
                  onClick={() => setRevising(revising?.id === deliverable.id ? null : deliverable)}
                >
                  修订
                </button>
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

              {revising?.id === deliverable.id && (
                <ReviseForm
                  deliverable={deliverable}
                  onToast={onToast}
                  onTaskCreated={onTaskCreated}
                  onClose={() => setRevising(null)}
                />
              )}

              {diffTarget?.id === deliverable.id && (
                <DiffView deliverable={deliverable} onToast={onToast} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------ 修订表单 ------------------------------ */

function ReviseForm({
  deliverable,
  onToast,
  onTaskCreated,
  onClose,
}: {
  deliverable: DeliverableMeta;
  onToast: (message: string) => void;
  onTaskCreated?: (task: Task) => void;
  onClose: () => void;
}) {
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!feedback.trim() || submitting) return;
    setSubmitting(true);
    try {
      const task = await api.reviseDeliverable(deliverable.id, feedback.trim());
      onToast(`修订任务已创建 —— 完成后生成 v${deliverable.version + 1}`);
      onTaskCreated?.(task);
      onClose();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "修订失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="revise-form">
      <div className="revise-label">修订反馈（将生成 v{deliverable.version + 1}）</div>
      <textarea
        className="revise-input"
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        placeholder="例如：补充竞品对比章节；语气更正式；数据更新到最新季度…"
        rows={3}
      />
      <div className="revise-actions">
        <button className="btn ghost small" onClick={onClose}>
          取消
        </button>
        <button
          className="btn primary small"
          disabled={!feedback.trim() || submitting}
          onClick={() => void submit()}
        >
          {submitting ? "创建中…" : "发起修订"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ 版本对比视图 ------------------------------ */

function DiffView({
  deliverable,
  onToast,
}: {
  deliverable: DeliverableMeta;
  onToast: (message: string) => void;
}) {
  const [versions, setVersions] = useState<number[]>([]);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(2);
  const [diff, setDiff] = useState<DeliverableDiff | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const detail = await api.getDeliverable(deliverable.id);
        const list = detail.versions.map((v) => v.version).sort((a, b) => a - b);
        setVersions(list);
        setTo(deliverable.version);
        setFrom(list.filter((v) => v < deliverable.version).pop() ?? list[0]!);
      } catch (error) {
        onToast(error instanceof Error ? error.message : "版本信息加载失败");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverable.id]);

  useEffect(() => {
    if (!from || !to || from === to) return;
    void (async () => {
      setLoading(true);
      try {
        setDiff(await api.getDeliverableDiff(deliverable.id, from, to));
      } catch (error) {
        onToast(error instanceof Error ? error.message : "版本对比失败");
        setDiff(null);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverable.id, from, to]);

  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <select value={from} onChange={(event) => setFrom(Number(event.target.value))}>
          {versions.map((v) => (
            <option key={v} value={v}>
              v{v}
            </option>
          ))}
        </select>
        <span className="diff-arrow">→</span>
        <select value={to} onChange={(event) => setTo(Number(event.target.value))}>
          {versions.map((v) => (
            <option key={v} value={v}>
              v{v}
            </option>
          ))}
        </select>
        {diff && (
          <span className="diff-stat">
            <span className="diff-added">+{diff.stat.added}</span>
            <span className="diff-removed">−{diff.stat.removed}</span>
          </span>
        )}
      </div>

      {loading && <div className="diff-loading">正在对比…</div>}
      {diff && (
        <div className="diff-lines">
          {diff.lines.map((line, index) => (
            <div key={index} className={`diff-line ${line.type}`}>
              <span className="diff-no">{line.type === "add" ? line.newNo : line.oldNo ?? ""}</span>
              <span className="diff-sign">{line.type === "add" ? "+" : line.type === "del" ? "−" : " "}</span>
              <span className="diff-text">{line.text || " "}</span>
            </div>
          ))}
          {diff.lines.length === 0 && <div className="diff-loading">两个版本内容完全一致</div>}
        </div>
      )}
    </div>
  );
}
