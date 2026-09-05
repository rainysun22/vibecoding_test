import type {
  CompletionRequest,
  CompletionResponse,
  ModelInfo,
  ProviderConfig,
  ProviderId,
  StreamChunk,
} from "@openwork/types";
import type { LLMProvider, ProviderAdapterConfig } from "./provider.js";
import { findModel, listModels } from "./models.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GeminiProvider } from "./providers/gemini.js";
import { OllamaProvider } from "./providers/ollama.js";
import { MockProvider } from "./providers/mock.js";

export interface GatewayOptions {
  /** 默认使用的完整模型 ID（provider/model） */
  defaultModel?: string;
  /** 计划/旗舰任务使用的模型（缺省用 defaultModel） */
  plannerModel?: string;
  /** 成本路由策略（v0.2：本地优先 + 预算降级） */
  routing?: Partial<RoutingConfig>;
}

/** 成本路由策略 —— v0.2 运行成本优化的核心配置 */
export interface RoutingConfig {
  /** 本地模型优先：Ollama 可用时，execution 类调用自动走本地（边际成本归零） */
  preferLocal: boolean;
  /** 首选本地模型 ID（如 "ollama/qwen3:8b"） */
  localModel: string | null;
  /** 每日预算上限（USD）。0 = 不限额；超限后自动降级到最便宜可用模型 */
  dailyBudgetUSD: number;
}

/** 预算超限且无可用免费模型时抛出 */
export class BudgetExceededError extends Error {
  constructor(
    readonly spentUSD: number,
    readonly budgetUSD: number,
  ) {
    super(
      `今日预算超限：已消费 $${spentUSD.toFixed(4)} / 上限 $${budgetUSD.toFixed(2)}。` +
        " 请提高预算、启用本地模型，或明日再试。",
    );
    this.name = "BudgetExceededError";
  }
}

/**
 * LLMGateway —— OpenWork 的模型中立网关。
 *
 * 职责：
 * 1. 统一协议：任何厂商走同一 complete/stream 接口
 * 2. 成本路由：按任务分层选择模型（planner 强模型 / 执行经济模型）
 * 3. 用量核算：每次调用记入台账（成本透明，N2 真需求）
 */
export class LLMGateway {
  private readonly providers = new Map<ProviderId, LLMProvider>();
  private readonly configs = new Map<ProviderId, ProviderConfig>();
  private readonly callLog: { model: string; usage: CompletionResponse["usage"]; at: string }[] = [];

  defaultModel: string;
  plannerModel: string;

  /** 成本路由策略 */
  routing: RoutingConfig = {
    preferLocal: false,
    localModel: null,
    dailyBudgetUSD: 0,
  };

  /** 今日已消费（USD）—— 进程内累计 + 启动时从持久化台账恢复 */
  private spentToday = { date: localDateKey(), usd: 0 };

  constructor(options: GatewayOptions = {}) {
    this.defaultModel = options.defaultModel ?? "mock/mock-agent";
    this.plannerModel = options.plannerModel ?? this.defaultModel;
    this.routing = { ...this.routing, ...options.routing };
    this.registerBuiltins();
  }

  /* --------------------------- 提供商管理 --------------------------- */

  private registerBuiltins(): void {
    this.setProvider(new MockProvider());
  }

  /** 注册/替换一个提供商适配器（含配置） */
  setProvider(provider: LLMProvider, config?: ProviderConfig): void {
    this.providers.set(provider.id, provider);
    if (config) this.configs.set(provider.id, config);
  }

  /** 配置提供商凭据（本地存储，永不外发） */
  configure(id: ProviderId, config: Partial<ProviderConfig>): ProviderConfig {
    const existing =
      this.configs.get(id) ??
      ({ id, enabled: false, connected: false } satisfies ProviderConfig);
    const next: ProviderConfig = {
      ...existing,
      ...config,
      id,
      connected: Boolean(config.apiKey ?? existing.apiKey) || id === "ollama" || id === "mock",
    };
    this.configs.set(id, next);

    const adapterConfig: ProviderAdapterConfig = {
      apiKey: next.apiKey,
      baseUrl: next.baseUrl,
    };
    switch (id) {
      case "openai":
      case "deepseek":
      case "qwen":
        this.providers.set(
          id,
          new OpenAICompatibleProvider(id, providerLabel(id), adapterConfig),
        );
        break;
      case "anthropic":
        this.providers.set(id, new AnthropicProvider(adapterConfig));
        break;
      case "gemini":
        this.providers.set(id, new GeminiProvider(adapterConfig));
        break;
      case "ollama":
        this.providers.set(id, new OllamaProvider(adapterConfig));
        break;
      case "mock":
        this.providers.set(id, new MockProvider());
        break;
    }
    return next;
  }

  getProvider(id: ProviderId): LLMProvider | undefined {
    return this.providers.get(id);
  }

  /** 当前可用模型列表（按已注册提供商过滤；mock/ollama 始终可用） */
  availableModels(): ModelInfo[] {
    const providerIds = new Set(this.providers.keys());
    return listModels().filter((m) => providerIds.has(m.provider));
  }

  /** 提供商配置视图（隐去密钥） */
  providerConfigs(): ProviderConfig[] {
    const known: ProviderId[] = ["mock", "openai", "anthropic", "gemini", "deepseek", "qwen", "ollama"];
    return known.map((id) => this.configs.get(id) ?? { id, enabled: false, connected: id === "mock" });
  }

  async testProvider(id: ProviderId): Promise<boolean> {
    const provider = this.providers.get(id);
    if (!provider) return false;
    const ok = await provider.testConnection();
    const config = this.configs.get(id);
    if (config) {
      this.configs.set(id, { ...config, connected: ok });
    }
    return ok;
  }

  /* --------------------------- 调用与路由 --------------------------- */

  /** 非流式调用 */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const provider = this.resolveProvider(request.model);
    const response = await provider.complete(request);
    this.recordUsage(request.model, response.usage);
    return response;
  }

  /** 流式调用 */
  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const provider = this.resolveProvider(request.model);
    let finalUsage: StreamChunk["usage"];
    for await (const chunk of provider.stream(request)) {
      if (chunk.usage) finalUsage = chunk.usage;
      yield chunk;
    }
    if (finalUsage) this.recordUsage(request.model, finalUsage);
  }

  /** 按任务性质选择模型：planning/verifying 用 planner 模型；execution 走成本路由 */
  modelForPurpose(purpose: "planning" | "verifying" | "execution"): string {
    if (purpose !== "execution") return this.plannerModel;

    // 1. 本地优先：Ollama 已配置时，执行类调用边际成本归零
    if (
      this.routing.preferLocal &&
      this.routing.localModel &&
      this.providers.has("ollama")
    ) {
      return this.routing.localModel;
    }

    // 2. 预算降级：超限后自动切换到最便宜的可用付费模型
    const budget = this.routing.dailyBudgetUSD;
    if (budget > 0 && this.todaySpentUSD() >= budget) {
      const cheapest = this.cheapestPaidModel();
      if (!cheapest) throw new BudgetExceededError(this.todaySpentUSD(), budget);
      return cheapest;
    }

    return this.defaultModel;
  }

  /** 更新路由策略（服务层负责持久化） */
  setRouting(patch: Partial<RoutingConfig>): RoutingConfig {
    this.routing = { ...this.routing, ...patch };
    return this.routing;
  }

  /** 启动时恢复当日累计消费（来自持久化 usage 台账） */
  restoreSpentToday(usd: number): void {
    this.spentToday = { date: localDateKey(), usd: Math.max(0, usd) };
  }

  /** 今日已消费（USD） */
  todaySpentUSD(): number {
    if (this.spentToday.date !== localDateKey()) this.spentToday = { date: localDateKey(), usd: 0 };
    return this.spentToday.usd;
  }

  /** 最便宜的已配置付费模型（排除 mock：mock 是演示兜底而非成本降级目标） */
  private cheapestPaidModel(): string | null {
    const candidates = this.availableModels().filter((m) => {
      if (m.provider === "mock") return false;
      const config = this.configs.get(m.provider);
      return config?.connected ?? m.provider === "ollama";
    });
    if (candidates.length === 0) return null;
    const blended = (m: (typeof candidates)[number]) =>
      (m.inputPricePerMTok + m.outputPricePerMTok) / 2;
    candidates.sort((a, b) => blended(a) - blended(b));
    return candidates[0]!.id;
  }

  private resolveProvider(modelId: string): LLMProvider {
    const providerId = modelId.split("/")[0] as ProviderId;
    const provider = this.providers.get(providerId);
    if (provider) return provider;
    // 模型未注册对应提供商时，回退 mock，保证系统永不因配置缺失而崩溃
    return this.providers.get("mock") ?? new MockProvider();
  }

  /* --------------------------- 用量台账 --------------------------- */

  private recordUsage(model: string, usage: CompletionResponse["usage"]): void {
    this.callLog.push({ model, usage, at: new Date().toISOString() });
    if (this.callLog.length > 10_000) this.callLog.splice(0, this.callLog.length - 10_000);
    // 当日预算累计（免费模型成本为 0，不影响）
    if (this.spentToday.date !== localDateKey()) this.spentToday = { date: localDateKey(), usd: 0 };
    this.spentToday.usd += usage.costUSD;
  }

  /** 导出会话内用量台账（服务层负责持久化） */
  drainUsageLog(): { model: string; usage: CompletionResponse["usage"]; at: string }[] {
    return this.callLog.splice(0, this.callLog.length);
  }

  /* --------------------------- 信息 --------------------------- */

  describeModel(modelId: string): ModelInfo | undefined {
    return findModel(modelId);
  }
}

/** 本地日期键（YYYY-MM-DD）：预算按本地日历日结算 */
function localDateKey(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function providerLabel(id: ProviderId): string {
  return (
    {
      openai: "OpenAI",
      deepseek: "DeepSeek",
      qwen: "Qwen (通义千问)",
      anthropic: "Anthropic",
      gemini: "Google Gemini",
      ollama: "Ollama (本地)",
      mock: "Mock (离线演示)",
    }[id] ?? id
  );
}
