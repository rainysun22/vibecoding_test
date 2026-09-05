import { useEffect, useState } from "react";
import type { ConfidenceRecord, Task } from "@openwork/types";
import * as api from "../api";

interface ConfidenceBarProps {
  task: Task | null;
}

/** 置信度 → 颜色分级（低于阈值的步骤即校验重点） */
function levelOf(confidence: number): "high" | "mid" | "low" {
  if (confidence >= 0.6) return "high";
  if (confidence >= 0.4) return "mid";
  return "low";
}

/**
 * 置信度传播（v0.5，arXiv:2604.23505）——
 * 步骤级不确定度打分 → 任务级乘性传播：
 * 低置信步骤自动重采样一次，仍低则进入校验重点名单。
 */
export function ConfidenceBar({ task }: ConfidenceBarProps) {
  const [confidence, setConfidence] = useState<api.TaskConfidence | null>(null);

  useEffect(() => {
    if (!task) {
      setConfidence(null);
      return;
    }
    void api
      .getTaskConfidence(task.id)
      .then(setConfidence)
      .catch(() => setConfidence(null));
  }, [task, task?.status, task?.updatedAt]);

  if (!task || !confidence) return null;
  const steps = confidence.steps ?? [];
  if (confidence.taskConfidence === null && steps.length === 0) return null;

  const taskLevel = levelOf(confidence.taskConfidence ?? 1);

  return (
    <div className="confidence-bar">
      <div className="confidence-head">
        <span className="confidence-label">置信度</span>
        <div className="confidence-meter" title={`任务级置信度（步骤乘性传播）`}>
          <div
            className={`confidence-fill ${taskLevel}`}
            style={{ width: `${Math.round((confidence.taskConfidence ?? 1) * 100)}%` }}
          />
        </div>
        <span className={`confidence-value ${taskLevel}`}>
          {Math.round((confidence.taskConfidence ?? 1) * 100)}%
        </span>
      </div>
      {steps.length > 0 && (
        <ul className="confidence-steps">
          {steps.map((step) => {
            const level = levelOf(step.confidence);
            return (
              <li key={step.stepId} className="confidence-step">
                <span className="confidence-step-title" title={step.stepTitle}>
                  {step.stepTitle}
                </span>
                <div className="confidence-meter small">
                  <div
                    className={`confidence-fill ${level}`}
                    style={{ width: `${Math.round(step.confidence * 100)}%` }}
                  />
                </div>
                <span className={`confidence-value ${level}`}>
                  {Math.round(step.confidence * 100)}%
                  {level === "low" ? " · 已重采样" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
