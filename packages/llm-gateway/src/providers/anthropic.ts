import type {
  CompletionRequest,
  CompletionResponse,
  ModelInfo,
  StreamChunk,
  TokenUsage,
} from "@openwork/types";
import { withRetry, type LLMProvider, type ProviderAdapterConfig } from "../provider.js";
import { estimateCost, listModels } from "../models.js";

/** Anthropic Messages API 适配器（原生 fetch，零 SDK） */
export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic" as const;
  readonly label = "Anthropic";
  private readonly config: ProviderAdapterConfig;

  constructor(config: ProviderAdapterConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    return (this.config.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
  }

  listModels(): ModelInfo[] {
    return listModels("anthropic");
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const { model, messages, temperature, maxTokens, signal } = request;
    const shortName = model.split("/").slice(1).join("/") || model;
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const rest = messages.filter((m) => m.role !== "system");

    const response = await withRetry(() =>
      fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: shortName,
          // v0.6 token 优化：system 作为稳定前缀打 cache_control 标记。
          // 同任务内多次同角色调用（如多个研究步骤）命中缓存，免重复 prefill，
          // agentic 场景成本降 45-80%、TTFT 降 13-31%（arXiv:2601.06007）。
          system: system ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : undefined,
          messages: rest,
          max_tokens: maxTokens ?? 8192,
          ...(temperature !== undefined && { temperature }),
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error(`Anthropic API ${response.status}: ${await response.text().catch(() => "")}`);
    }

    const data = (await response.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };
    const content = (data.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    if (!content) throw new Error("Anthropic 返回空响应");

    const usage = usageOf(model, data.usage?.input_tokens, data.usage?.output_tokens);
    return { content, model, usage, finishReason: data.stop_reason };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const { model, messages, temperature, maxTokens, signal } = request;
    const shortName = model.split("/").slice(1).join("/") || model;
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const rest = messages.filter((m) => m.role !== "system");

    const response = await withRetry(() =>
      fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: shortName,
          // v0.6 token 优化：与 complete 相同 —— system 前缀打 cache_control
          system: system ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : undefined,
          messages: rest,
          max_tokens: maxTokens ?? 8192,
          stream: true,
          ...(temperature !== undefined && { temperature }),
        }),
        signal,
      }),
    );

    if (!response.ok || !response.body) {
      throw new Error(`Anthropic API ${response.status}`);
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
        try {
          const json = JSON.parse(payload) as {
            type?: string;
            delta?: { text?: string };
            message?: { usage?: { input_tokens?: number; output_tokens?: number } };
            usage?: { output_tokens?: number };
          };
          if (json.type === "content_block_delta" && json.delta?.text) {
            yield { delta: json.delta.text, done: false };
          } else if (json.type === "message_start" && json.message?.usage) {
            // Anthropic 在 message_start 给出 input 用量；output 在 message_delta
          }
        } catch {
          // 忽略心跳
        }
      }
    }
    yield { delta: "", done: true };
  }

  async testConnection(): Promise<boolean> {
    try {
      // 发送一个 1-token 的最小请求验证密钥
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-3.5",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      return response.ok || response.status === 400; // 400 也可能表示模型名问题，密钥已通过
    } catch {
      return false;
    }
  }
}

function usageOf(model: string, input?: number, output?: number): TokenUsage {
  const promptTokens = input ?? 0;
  const completionTokens = output ?? 0;
  const info = listModels("anthropic").find((m) => m.id === model);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUSD: info ? estimateCost(info, promptTokens, completionTokens) : 0,
  };
}
