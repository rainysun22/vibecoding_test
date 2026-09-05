import { useEffect, useState } from "react";
import type { ClarificationQuestion, Task } from "@openwork/types";
import * as api from "../api";

interface ClarificationCardProps {
  task: Task | null;
  onAnswered: () => void;
  onToast: (message: string) => void;
}

/**
 * 主动澄清（v0.5，arXiv:2512.04068 / 2605.07937）——
 * 规划前的歧义检测：目标过短 / 模糊量词 / 无实质主题时挂起任务，
 * 向用户提出信息增益最高的问题，答案注入后续规划与执行。
 */
export function ClarificationCard({ task, onAnswered, onToast }: ClarificationCardProps) {
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const awaiting = task?.status === "awaiting_clarification";

  useEffect(() => {
    if (!task || !awaiting) {
      setQuestions([]);
      setAnswers([]);
      return;
    }
    void api
      .listClarifications(task.id)
      .then((list) => {
        const pending = list.filter((q) => q.status === "pending");
        setQuestions(pending);
        setAnswers(pending.map(() => ""));
      })
      .catch(() => setQuestions([]));
  }, [task, task?.status, awaiting]);

  if (!awaiting || questions.length === 0) return null;

  const submit = async (skip = false) => {
    if (!task || submitting) return;
    if (!skip && answers.every((a) => !a.trim())) {
      onToast("请至少回答一个问题，或选择「跳过」");
      return;
    }
    setSubmitting(true);
    try {
      await api.submitClarifications(task.id, answers, skip);
      onToast(skip ? "已跳过澄清 —— 按现有信息继续" : "澄清已提交 —— 开始规划");
      setQuestions([]);
      onAnswered();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="clarify-card">
      <div className="clarify-head">
        <span className="clarify-badge">澄清</span>
        <p className="clarify-title">开始规划前，先对齐几个关键问题</p>
      </div>
      {questions.map((question, index) => (
        <div key={question.id} className="clarify-question">
          <p className="clarify-q">{question.question}</p>
          {question.rationale && <p className="clarify-rationale">为什么问：{question.rationale}</p>}
          <input
            value={answers[index] ?? ""}
            placeholder="你的回答…"
            disabled={submitting}
            onChange={(event) =>
              setAnswers((current) =>
                current.map((a, i) => (i === index ? event.target.value : a)),
              )
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit(false);
              }
            }}
          />
        </div>
      ))}
      <div className="clarify-actions">
        <button
          className="btn primary small"
          disabled={submitting}
          onClick={() => void submit(false)}
        >
          {submitting ? "提交中…" : "提交答案 ↵"}
        </button>
        <button
          className="btn ghost small"
          disabled={submitting}
          onClick={() => void submit(true)}
        >
          跳过，按现有信息继续
        </button>
      </div>
    </div>
  );
}
