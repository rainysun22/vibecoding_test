import type { ModelInfo, ProviderId } from "@openwork/types";

/**
 * 内置模型目录 —— 定价为公开牌价（USD / 1M tokens），供成本估算与路由。
 * 仅作默认参考；Ollama 本地模型定价为 0（数据主权 + 零边际成本）。
 */
const CATALOG: ModelInfo[] = [
  // OpenAI
  { id: "openai/gpt-4o", provider: "openai", label: "GPT-4o", inputPricePerMTok: 2.5, outputPricePerMTok: 10, contextWindow: 128_000, tier: "flagship" },
  { id: "openai/gpt-4o-mini", provider: "openai", label: "GPT-4o mini", inputPricePerMTok: 0.15, outputPricePerMTok: 0.6, contextWindow: 128_000, tier: "economy" },
  // Anthropic
  { id: "anthropic/claude-sonnet-4", provider: "anthropic", label: "Claude Sonnet 4", inputPricePerMTok: 3, outputPricePerMTok: 15, contextWindow: 200_000, tier: "flagship" },
  { id: "anthropic/claude-haiku-3.5", provider: "anthropic", label: "Claude Haiku 3.5", inputPricePerMTok: 0.8, outputPricePerMTok: 4, contextWindow: 200_000, tier: "balanced" },
  // Google
  { id: "gemini/gemini-2.5-pro", provider: "gemini", label: "Gemini 2.5 Pro", inputPricePerMTok: 1.25, outputPricePerMTok: 10, contextWindow: 1_000_000, tier: "flagship" },
  { id: "gemini/gemini-2.5-flash", provider: "gemini", label: "Gemini 2.5 Flash", inputPricePerMTok: 0.3, outputPricePerMTok: 2.5, contextWindow: 1_000_000, tier: "economy" },
  // DeepSeek（OpenAI 兼容）
  { id: "deepseek/deepseek-chat", provider: "deepseek", label: "DeepSeek Chat", inputPricePerMTok: 0.27, outputPricePerMTok: 1.1, contextWindow: 64_000, tier: "economy" },
  // Qwen（OpenAI 兼容）
  { id: "qwen/qwen-max", provider: "qwen", label: "Qwen Max", inputPricePerMTok: 1.6, outputPricePerMTok: 6.4, contextWindow: 32_000, tier: "flagship" },
  { id: "qwen/qwen-plus", provider: "qwen", label: "Qwen Plus", inputPricePerMTok: 0.4, outputPricePerMTok: 1.2, contextWindow: 128_000, tier: "balanced" },
  // Ollama 本地
  { id: "ollama/qwen3:8b", provider: "ollama", label: "Qwen3 8B (本地)", inputPricePerMTok: 0, outputPricePerMTok: 0, contextWindow: 32_000, tier: "local" },
  { id: "ollama/llama3.1:8b", provider: "ollama", label: "Llama 3.1 8B (本地)", inputPricePerMTok: 0, outputPricePerMTok: 0, contextWindow: 128_000, tier: "local" },
];

const byId = new Map(CATALOG.map((m) => [m.id, m]));

export function findModel(id: string): ModelInfo | undefined {
  return byId.get(id);
}

export function listModels(provider?: ProviderId): ModelInfo[] {
  return provider ? CATALOG.filter((m) => m.provider === provider) : [...CATALOG];
}

/** 估算一次调用的成本 */
export function estimateCost(
  model: ModelInfo,
  promptTokens: number,
  completionTokens: number,
): number {
  return (
    (promptTokens / 1_000_000) * model.inputPricePerMTok +
    (completionTokens / 1_000_000) * model.outputPricePerMTok
  );
}
