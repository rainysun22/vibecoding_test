import { EventEmitter } from "node:events";

/** 用量记录（成本透明：N2 真需求） */
export interface UsageRecord {
  model: string;
  tokens: number;
  costUSD: number;
}

/**
 * 运行时事件总线 —— 驱动 SSE 实时推送与任务轨迹回放。
 * 所有事件同时广播到 "*" 通配频道（供 SSE 聚合订阅）与具名频道。
 */
export interface RuntimeEventPayload {
  type: string;
  taskId: string;
  title: string;
  detail?: string;
  at: string;
  usage?: UsageRecord;
}

export class EventBus extends EventEmitter {
  override emit(type: string, payload: RuntimeEventPayload): boolean {
    super.emit("*", payload);
    return super.emit(type, payload);
  }

  /** 订阅全部事件（SSE 聚合流） */
  subscribe(listener: (payload: RuntimeEventPayload) => void): () => void {
    this.on("*", listener);
    return () => this.off("*", listener);
  }
}
