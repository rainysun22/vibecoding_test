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
  /** 流式增量上下文：同一 streamId 的 delta 按序拼接即为完整输出（仅广播，不落库） */
  streamId?: string;
  /** 流式增量文本 */
  delta?: string;
  /** 流结束标记（最终帧） */
  streamDone?: boolean;
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
