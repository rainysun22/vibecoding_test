import type {
  CompletionRequest,
  CompletionResponse,
  ModelInfo,
  StreamChunk,
  TokenUsage,
} from "@openwork/types";
import { withRetry, type LLMProvider, type ProviderAdapterConfig } from "../provider.js";
import { estimateCost, listModels } from "../models.js";

/** Google Gemini API 适配器（原生 fetch，零 SDK） */
export class GeminiProvider implements LLMProvider {
  readonly id = "gemini" as const;
  readonly label = "Google Gemini";
  private readonly config: ProviderAdapterConfig;

  constructor(config: ProviderAdapterConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    return (this.config.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  }

  listModels(): ModelInfo[] {
    return listModels("gemini");
  }

  private toGeminiContents(messages: { role: string; content: string }[]) {
    return messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const { model, messages, temperature, maxTokens, signal } = request;
    const shortName = model.split("/").slice(1).join("/") || model;
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");

    const response = await withRetry(() =>
      fetch(`${this.baseUrl}/models/${shortName}:generateContent?key=${this.config.apiKey ?? ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: this.toGeminiContents(messages),
          ...(system && { systemInstruction: { parts: [{ text: system }] } }),
          generationConfig: {
            ...(temperature !== undefined && { temperature }),
            ...(maxTokens !== undefined && { maxOutputTokens: maxTokens }),
          },
        }),
        signal,
      }),
    );

    if (!response.ok) {
      throw new Error(`Gemini API ${response.status}: ${await response.text().catch(() => "")}`);
    }

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const content = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");
    if (!content) throw new Error("Gemini 返回空响应");

    const usageMeta = data.usageMetadata;
    const usage: TokenUsage = {
      promptTokens: usageMeta?.promptTokenCount ?? 0,
      completionTokens: usageMeta?.candidatesTokenCount ?? 0,
      totalTokens: (usageMeta?.promptTokenCount ?? 0) + (usageMeta?.candidatesTokenCount ?? 0),
      costUSD: 0,
    };
    const info = listModels("gemini").find((m) => m.id === model);
    if (info) usage.costUSD = estimateCost(info, usage.promptTokens, usage.completionTokens);

    return { content, model, usage, finishReason: data.candidates?.[0]?.finishReason };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const { model, messages, temperature, maxTokens, signal } = request;
    const shortName = model.split("/").slice(1).join("/") || model;
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");

    const response = await withRetry(() =>
      fetch(`${this.baseUrl}/models/${shortName}:streamGenerateContent?alt=sse&key=${this.config.apiKey ?? ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: this.toGeminiContents(messages),
          ...(system && { systemInstruction: { parts: [{ text: system }] } }),
          generationConfig: {
            ...(temperature !== undefined && { temperature }),
            ...(maxTokens !== undefined && { maxOutputTokens: maxTokens }),
          },
        }),
        signal,
      }),
    );

    if (!response.ok || !response.body) {
      throw new Error(`Gemini API ${response.status}`);
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
        try {
          const json = JSON.parse(trimmed.slice(5).trim()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
          };
          const text = (json.candidates?.[0]?.content?.parts ?? [])
            .map((p) => p.text ?? "")
            .join("");
          if (text) yield { delta: text, done: false };
        } catch {
          // 忽略心跳
        }
      }
    }
    yield { delta: "", done: true };
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models?key=${this.config.apiKey ?? ""}`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
