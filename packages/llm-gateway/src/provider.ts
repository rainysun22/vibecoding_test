import type {
  CompletionRequest,
  CompletionResponse,
  ModelInfo,
  ProviderId,
  StreamChunk,
} from "@openwork/types";

/**
 * Provider 统一协议 —— 所有厂商适配器实现此接口。
 * 设计约束：零 SDK 依赖、原生 fetch、模型中立（N2 真需求）。
 */
export interface LLMProvider {
  readonly id: ProviderId;
  readonly label: string;

  /** 该提供商下可用模型（含定价，供成本路由） */
  listModels(): ModelInfo[];

  /** 非流式完成 */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /** 流式完成（逐块产出，节省首字延迟） */
  stream(request: CompletionRequest): AsyncGenerator<StreamChunk>;

  /** 连通性测试（不产生 token 消耗） */
  testConnection(): Promise<boolean>;
}

/** 适配器公共配置 */
export interface ProviderAdapterConfig {
  apiKey?: string;
  baseUrl?: string;
}

/** 网络重试：指数退避（应对瞬时 429/5xx） */
export async function withRetry<T>(
  operation: () => Promise<T>,
  { retries = 2, baseDelayMs = 800 }: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (attempt === retries) break;
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * 2 ** attempt),
      );
    }
  }
  throw lastError;
}
