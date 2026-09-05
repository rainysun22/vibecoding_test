import type {
  CompletionRequest,
  CompletionResponse,
  ModelInfo,
  StreamChunk,
  TokenUsage,
} from "@openwork/types";
import { withRetry, type LLMProvider, type ProviderAdapterConfig } from "../provider.js";
import { listModels } from "../models.js";

/** Ollama 本地模型适配器 —— 数据主权与零边际成本（N2/N3 真需求） */
export class OllamaProvider implements LLMProvider {
  readonly id = "ollama" as const;
  readonly label = "Ollama (本地)";
  private readonly config: ProviderAdapterConfig;

  constructor(config: ProviderAdapterConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    return (this.config.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  }

  listModels(): ModelInfo[] {
    return listModels("ollama");
  }

  private async availableModels(): Promise<Set<string>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return new Set();
      const data = (await response.json()) as { models?: { name?: string }[] };
      return new Set((data.models ?? []).map((m) => m.name ?? "").filter(Boolean));
    } catch {
      return new Set();
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const { model, messages, temperature, signal } = request;
    const shortName = model.split("/").slice(1).join("/") || model;

    const response = await withRetry(() =>
      fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: shortName,
          messages,
          stream: false,
          ...(temperature !== undefined && { options: { temperature } }),
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error(`Ollama API ${response.status}: ${await response.text().catch(() => "")}`);
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      eval_count?: number;
      prompt_eval_count?: number;
    };
    const content = data.message?.content ?? "";
    if (!content) throw new Error("Ollama 返回空响应");

    const usage: TokenUsage = {
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
      totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      costUSD: 0, // 本地模型零边际成本
    };
    return { content, model, usage };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const { model, messages, temperature, signal } = request;
    const shortName = model.split("/").slice(1).join("/") || model;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: shortName,
        messages,
        stream: true,
        ...(temperature !== undefined && { options: { temperature } }),
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Ollama API ${response.status}`);
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
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed) as {
            message?: { content?: string };
            done?: boolean;
            eval_count?: number;
            prompt_eval_count?: number;
          };
          if (json.message?.content) yield { delta: json.message.content, done: false };
          if (json.done) {
            yield { delta: "", done: true };
            return;
          }
        } catch {
          // 忽略不完整行
        }
      }
    }
    yield { delta: "", done: true };
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
