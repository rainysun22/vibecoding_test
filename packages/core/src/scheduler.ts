import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import type { Schedule } from "@openwork/types";
import type { Storage } from "./storage.js";

/**
 * 定时委托调度器 —— cron 驱动的自动任务（本地优先运行）。
 * 到点自动创建委托任务，由 AgentRunner 异步执行。
 */
export class Scheduler {
  private readonly jobs = new Map<string, Cron>();

  constructor(
    private readonly storage: Storage,
    private readonly onTrigger: (goal: string, skillId?: string) => void,
  ) {}

  /** 启动时恢复所有已启用的调度 */
  start(): void {
    for (const schedule of this.storage.listSchedules()) {
      if (schedule.enabled) this.register(schedule);
    }
  }

  create(goal: string, cron: string, skillId?: string): Schedule {
    // 校验 cron 表达式
    new Cron(cron, { paused: true });
    const schedule: Schedule = {
      id: randomUUID(),
      goal,
      skillId,
      cron,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    this.storage.createSchedule(schedule);
    this.register(schedule);
    return schedule;
  }

  toggle(id: string, enabled: boolean): Schedule | null {
    this.storage.updateSchedule(id, { enabled });
    if (enabled) {
      const schedule = this.storage.listSchedules().find((s) => s.id === id);
      if (schedule) this.register(schedule);
    } else {
      this.unregister(id);
    }
    return this.storage.listSchedules().find((s) => s.id === id) ?? null;
  }

  remove(id: string): void {
    this.unregister(id);
    this.storage.deleteSchedule(id);
  }

  private register(schedule: Schedule): void {
    this.unregister(schedule.id);
    const job = new Cron(schedule.cron, () => {
      this.storage.updateSchedule(schedule.id, { lastRunAt: new Date().toISOString() });
      this.onTrigger(schedule.goal, schedule.skillId);
    });
    this.jobs.set(schedule.id, job);
    const next = job.nextRun();
    if (next) {
      this.storage.updateSchedule(schedule.id, {
        nextRunAt: next.toISOString(),
      });
    }
  }

  private unregister(id: string): void {
    this.jobs.get(id)?.stop();
    this.jobs.delete(id);
  }

  stopAll(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }
}
