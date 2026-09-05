import type {
  CompletionRequest,
  CompletionResponse,
  ModelInfo,
  StreamChunk,
  TokenUsage,
} from "@openwork/types";
import { withRetry, type LLMProvider, type ProviderAdapterConfig } from "../provider.js";
import { estimateCost, listModels } from "../models.js";

/**
 * OpenAI 兼容适配器 —— 一份实现覆盖 OpenAI / DeepSeek / Qwen 及任何
 * OpenAI 兼容端点（vLLM、网关代理等）。零 SDK、原生 fetch。
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: ModelInfo["provider"];
  readonly label: string;
  private readonly config: ProviderAdapterConfig;
  private readonly models: ModelInfo[];
  private readonly defaultBaseUrl: string;

  constructor(
    id: "openai" | "deepseek" | "qwen",
    label: string,
    config: ProviderAdapterConfig,
  ) {
    this.id = id;
    this.label = label;
    this.config = config;
    this.models = listModels(id);
    this.defaultBaseUrl = {
      openai: "https://api.openai.com/v1",
      deepseek: "https://api.deepseek.com/v1",
      qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }[id];
  }

  private get baseUrl(): string {
    return (this.config.baseUrl || this.defaultBaseUrl).replace(/\/$/, "");
  }

  listModels(): ModelInfo[] {
    return [...this.models];
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const { model, messages, temperature, maxTokens, signal } = request;
    const shortName = model.split("/").slice(1).join("/") || model;

    const response = await withRetry(() =>
      fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey ?? ""}`,
        },
        body: JSON.stringify({
          model: shortName,
          messages,
          ...(temperature !== undefined && { temperature }),
          ...(maxTokens !== undefined && { max_tokens: maxTokens }),
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error(
        `${this.label} API ${response.status}: ${await safeText(response)}`,
      );
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string }, finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    const choice = data.choices?.[0];
    if (!choice?.message?.content) {
      throw new Error(`${this.label} 返回空响应`);
    }
    const usage = toUsage(model, data.usage?.prompt_tokens, data.usage?.completion_tokens);
    return {
      content: choice.message.content,
      model,
      usage,
      finishReason: choice.finish_reason,
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const { model, messages, temperature, maxTokens, signal } = request;
    const shortName = model.split("/").slice(1).join("/") || model;

    const response = await withRetry(() =>
      fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey ?? ""}`,
        },
        body: JSON.stringify({
          model: shortName,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(temperature !== undefined && { temperature }),
          ...(maxTokens !== undefined && { max_tokens: maxTokens }),
        }),
        signal,
      }),
    );

    if (!response.ok || !response.body) {
      throw new Error(`${this.label} API ${response.status}: ${await safeText(response)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          yield { delta: "", done: true };
          return;
        }
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield { delta, done: false };
          if (json.usage) {
            yield {
              delta: "",
              done: true,
              usage: toUsage(model, json.usage.prompt_tokens, json.usage.completion_tokens),
            };
            return;
          }
        } catch {
          // 忽略无法解析的行（心跳/注释）
        }
      }
    }
    yield { delta: "", done: true };
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await withRetry(
        () =>
          fetch(`${this.baseUrl}/models`, {
            headers: { authorization: `Bearer ${this.config.apiKey ?? ""}` },
          }),
        { retries: 0 },
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}

function toUsage(model: string, prompt?: number, completion?: number): TokenUsage {
  const promptTokens = prompt ?? 0;
  const completionTokens = completion ?? 0;
  const info = listModels().find((m) => m.id === model);
  const costUSD = info
    ? estimateCost(info, promptTokens, completionTokens)
    : 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUSD,
  };
}
