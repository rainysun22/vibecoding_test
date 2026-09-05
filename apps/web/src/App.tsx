import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Checkpoint, DeliverableMeta, SkillDefinition, Task, TaskEvent, UsageSummary } from "@openwork/types";
import * as api from "./api";
import { Composer } from "./components/Composer";
import { TaskList } from "./components/TaskList";
import { ActivityStream } from "./components/ActivityStream";
import { DeliverablesPanel } from "./components/DeliverablesPanel";
import { ApprovalCard } from "./components/ApprovalCard";
import { SettingsModal } from "./components/SettingsModal";

/**
 * OpenWork 工作台主布局：
 * 左栏（委托 + 任务）· 中栏（活动流）· 右栏（审批 + 成果）
 * 全局通过 SSE 实时刷新，本地优先无需轮询。
 */
export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [taskDeliverables, setTaskDeliverables] = useState<DeliverableMeta[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [allDeliverables, setAllDeliverables] = useState<DeliverableMeta[]>([]);
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [stats, setStats] = useState<UsageSummary | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionAlive, setConnectionAlive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      setTasks(await api.listTasks());
    } catch {
      // 网络抖动时保持既有列表，SSE 会驱动下次刷新
    }
  }, []);

  const refreshGlobal = useCallback(async () => {
    try {
      const [pending, deliverables, usage] = await Promise.all([
        api.listPendingCheckpoints(),
        api.listDeliverables(),
        api.usageStats(),
      ]);
      setCheckpoints(pending);
      setAllDeliverables(deliverables);
      setStats(usage);
    } catch {
      // 同上
    }
  }, []);

  const refreshTaskDetail = useCallback(async (taskId: string) => {
    try {
      const detail = await api.getTask(taskId);
      setEvents(detail.events);
      setTaskDeliverables(detail.deliverables);
    } catch {
      // 任务可能刚被清理
    }
  }, []);

  /* 初始化加载 */
  useEffect(() => {
    void (async () => {
      const [taskList, skillList] = await Promise.all([
        api.listTasks(),
        api.listSkills().catch(() => [] as SkillDefinition[]),
      ]);
      setTasks(taskList);
      setSkills(skillList);
      setSelectedId(taskList[0]?.id ?? null);
      await refreshGlobal();
    })();
  }, [refreshGlobal]);

  /* 选中任务变化时拉取详情 */
  useEffect(() => {
    if (selectedId) void refreshTaskDetail(selectedId);
    else {
      setEvents([]);
      setTaskDeliverables([]);
    }
  }, [selectedId, refreshTaskDetail]);

  /* SSE 实时驱动所有刷新 */
  useEffect(() => {
    const unsubscribe = api.subscribeEvents((event) => {
      setConnectionAlive(true);
      if (event.taskId === selectedIdRef.current) {
        void refreshTaskDetail(event.taskId);
      }
      void refreshTasks();
      void refreshGlobal();
    });
    return unsubscribe;
  }, [refreshTasks, refreshGlobal, refreshTaskDetail]);

  const handleCreate = useCallback(
    async (goal: string, skillId?: string) => {
      const task = await api.createTask(goal, skillId);
      setSelectedId(task.id);
      setEvents([]);
      setTaskDeliverables([]);
      void refreshTasks();
      void refreshGlobal();
    },
    [refreshTasks, refreshGlobal],
  );

  const handleDecide = useCallback(
    async (checkpointId: string, decision: "approve" | "reject", comment?: string) => {
      try {
        await api.decideCheckpoint(checkpointId, decision, comment);
        if (selectedIdRef.current) void refreshTaskDetail(selectedIdRef.current);
        void refreshTasks();
        void refreshGlobal();
        showToast(decision === "approve" ? "已批准，任务继续执行" : "已拒绝，任务终止");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "审批操作失败");
      }
    },
    [refreshTasks, refreshGlobal, refreshTaskDetail, showToast],
  );

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  const pendingForSelected = useMemo(
    () => checkpoints.filter((c) => c.taskId === selectedId),
    [checkpoints, selectedId],
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">⬡</span>
          <div>
            <h1>OpenWork</h1>
            <p className="brand-tagline">开源中立 · 成果交付 · 本地可控</p>
          </div>
        </div>
        {stats && (
          <div className="header-stats">
            <span title="累计任务">📋 {stats.totalTasks}</span>
            <span title="累计 tokens">🔤 {stats.totalTokens.toLocaleString()}</span>
            <span title="累计成本（Mock 免费）">💰 ${stats.totalCostUSD.toFixed(4)}</span>
          </div>
        )}
        <button className="btn ghost" onClick={() => setSettingsOpen(true)}>
          ⚙ 设置
        </button>
      </header>

      <main className="app-body">
        <section className="panel column-left">
          <Composer skills={skills} onSubmit={handleCreate} onError={showToast} />
          <TaskList
            tasks={tasks}
            selectedId={selectedId}
            onSelect={setSelectedId}
            pendingCount={checkpoints.length}
          />
        </section>

        <section className="panel column-center">
          <ActivityStream task={selectedTask} events={events} connected={connectionAlive} />
        </section>

        <section className="panel column-right">
          {pendingForSelected.length > 0 ? (
            <div className="approval-stack">
              {pendingForSelected.map((checkpoint) => (
                <ApprovalCard key={checkpoint.id} checkpoint={checkpoint} onDecide={handleDecide} />
              ))}
            </div>
          ) : (
            <div className="empty-approval">
              {selectedTask
                ? selectedTask.status === "awaiting_approval"
                  ? "审批处理中…"
                  : "当前任务无待审批项 · 语义级审批：计划与成果两个粒度"
                : "选择或创建一个委托开始"}
            </div>
          )}
          <DeliverablesPanel
            deliverables={selectedId ? taskDeliverables : allDeliverables}
            scoped={Boolean(selectedId)}
            onToast={showToast}
          />
        </section>
      </main>

      {settingsOpen && (
        <SettingsModal skills={skills} onClose={() => setSettingsOpen(false)} onToast={showToast} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
