import { useCallback, useEffect, useState } from "react";
import type { ModelInfo, ProviderConfig, ProviderId, Schedule, SkillDefinition } from "@openwork/types";
import * as api from "../api";

interface SettingsModalProps {
  skills: SkillDefinition[];
  onClose: () => void;
  onToast: (message: string) => void;
}

type Tab = "models" | "schedules" | "skills";

const PROVIDER_LABEL: Record<ProviderId, string> = {
  mock: "Mock（离线演示）",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  deepseek: "DeepSeek",
  qwen: "Qwen（通义千问）",
  ollama: "Ollama（本地）",
};

/** 设置弹窗：模型网关 · 定时委托 · 技能资产 */
export function SettingsModal({ skills, onClose, onToast }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("models");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>设置</h2>
          <button className="btn ghost" onClick={onClose}>
            ✕ 关闭
          </button>
        </div>
        <div className="modal-tabs">
          <button className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}>
            模型网关
          </button>
          <button className={tab === "schedules" ? "active" : ""} onClick={() => setTab("schedules")}>
            定时委托
          </button>
          <button className={tab === "skills" ? "active" : ""} onClick={() => setTab("skills")}>
            技能资产
          </button>
        </div>
        <div className="modal-body">
          {tab === "models" && <ModelsTab onToast={onToast} />}
          {tab === "schedules" && <SchedulesTab onToast={onToast} />}
          {tab === "skills" && <SkillsTab skills={skills} />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ 模型网关 ------------------------------ */

function ModelsTab({ onToast }: { onToast: (message: string) => void }) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState("mock/mock-agent");
  const [plannerModel, setPlannerModel] = useState("mock/mock-agent");
  const [drafts, setDrafts] = useState<Record<string, { apiKey: string; baseUrl: string }>>({});
  const [preferLocal, setPreferLocal] = useState(false);
  const [localModel, setLocalModel] = useState("");
  const [dailyBudgetUSD, setDailyBudgetUSD] = useState("0");

  const load = useCallback(async () => {
    const [providerList, modelList, routing] = await Promise.all([
      api.listProviders(),
      api.listModels(),
      api.getRouting(),
    ]);
    setProviders(providerList);
    setModels(modelList);
    setPreferLocal(routing.preferLocal);
    setLocalModel(routing.localModel ?? "");
    setDailyBudgetUSD(String(routing.dailyBudgetUSD));
    const current = modelList.find((m) => m.id === "mock/mock-agent");
    if (current) {
      setDefaultModel(current.id);
      setPlannerModel(current.id);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProvider = async (id: ProviderId) => {
    const draft = drafts[id];
    try {
      await api.configureProvider(id, {
        apiKey: draft?.apiKey || undefined,
        baseUrl: draft?.baseUrl || undefined,
        enabled: true,
      });
      const result = await api.testProvider(id);
      await load();
      onToast(result.connected ? `${PROVIDER_LABEL[id]} 连接成功` : `${PROVIDER_LABEL[id]} 连接失败，请检查密钥`);
    } catch {
      onToast("保存失败");
    }
  };

  const saveModels = async () => {
    try {
      await api.setDefaultModels(defaultModel, plannerModel);
      onToast("模型路由已更新");
    } catch {
      onToast("保存失败");
    }
  };

  const saveRouting = async () => {
    try {
      await api.setRouting({
        preferLocal,
        localModel: localModel || null,
        dailyBudgetUSD: Number(dailyBudgetUSD) || 0,
      });
      onToast("成本策略已更新");
    } catch {
      onToast("保存失败");
    }
  };

  return (
    <div className="settings-sections">
      <section>
        <h3>成本路由</h3>
        <p className="hint">执行用经济模型、计划用强模型 —— 成本与质量的最优平衡（密钥仅存本地）</p>
        <div className="model-selects">
          <label>
            <span>执行模型（默认）</span>
            <select value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}（${model.inputPricePerMTok}/${model.outputPricePerMTok} 每百万 tokens）
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>计划模型（强模型）</span>
            <select value={plannerModel} onChange={(e) => setPlannerModel(e.target.value)}>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary" onClick={() => void saveModels()}>
            保存路由
          </button>
        </div>
      </section>

      <section>
        <h3>本地优先与预算</h3>
        <p className="hint">
          本地模型承担执行类调用（边际成本归零）；预算超限后自动降级到最便宜的已配置模型
        </p>
        <div className="routing-form">
          <label className="check-row">
            <input
              type="checkbox"
              checked={preferLocal}
              onChange={(e) => setPreferLocal(e.target.checked)}
            />
            <span>本地模型优先（需已配置 Ollama）</span>
          </label>
          <label>
            <span>本地执行模型</span>
            <select value={localModel} onChange={(e) => setLocalModel(e.target.value)}>
              <option value="">未选择</option>
              {models
                .filter((m) => m.tier === "local")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>每日预算上限（USD，0 = 不限）</span>
            <input
              type="number"
              min={0}
              step="0.5"
              value={dailyBudgetUSD}
              onChange={(e) => setDailyBudgetUSD(e.target.value)}
            />
          </label>
          <button className="btn primary" onClick={() => void saveRouting()}>
            保存策略
          </button>
        </div>
      </section>

      <section>
        <h3>提供商</h3>
        <div className="provider-list">
          {providers.map((provider) => {
            const draft = drafts[provider.id] ?? { apiKey: "", baseUrl: "" };
            return (
              <div key={provider.id} className="provider-row">
                <div className="provider-name">
                  {PROVIDER_LABEL[provider.id]}
                  <span className={`badge ${provider.connected ? "ok" : "muted"}`}>
                    {provider.connected ? "已连接" : "未配置"}
                  </span>
                </div>
                {provider.id !== "mock" && (
                  <div className="provider-form">
                    <input
                      type="password"
                      placeholder={provider.id === "ollama" ? "无需密钥" : "API Key"}
                      value={draft.apiKey}
                      onChange={(e) =>
                        setDrafts({ ...drafts, [provider.id]: { ...draft, apiKey: e.target.value } })
                      }
                    />
                    <input
                      type="text"
                      placeholder={provider.id === "ollama" ? "http://127.0.0.1:11434" : "自定义 Base URL（可选）"}
                      value={draft.baseUrl}
                      onChange={(e) =>
                        setDrafts({ ...drafts, [provider.id]: { ...draft, baseUrl: e.target.value } })
                      }
                    />
                    <button className="btn ghost" onClick={() => void saveProvider(provider.id)}>
                      保存并测试
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------ 定时委托 ------------------------------ */

function SchedulesTab({ onToast }: { onToast: (message: string) => void }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [goal, setGoal] = useState("");
  const [cron, setCron] = useState("0 9 * * 1");

  const load = useCallback(async () => {
    setSchedules(await api.listSchedules());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!goal.trim() || !cron.trim()) return;
    try {
      await api.createSchedule(goal.trim(), cron.trim());
      setGoal("");
      await load();
      onToast("定时委托已创建");
    } catch {
      onToast("创建失败：cron 表达式不合法");
    }
  };

  return (
    <div className="settings-sections">
      <section>
        <h3>新建定时委托</h3>
        <p className="hint">按 cron 计划自动发起委托（如每周一 09:00 生成周报）</p>
        <div className="schedule-form">
          <input
            placeholder="委托目标，如：生成本周 AI 领域动态摘要"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          <input
            placeholder="cron 表达式"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            title="分 时 日 月 周"
          />
          <button className="btn primary" onClick={() => void create()}>
            创建
          </button>
        </div>
      </section>

      <section>
        <h3>已有计划</h3>
        {schedules.length === 0 ? (
          <div className="list-empty">暂无定时委托</div>
        ) : (
          <ul className="schedule-list">
            {schedules.map((schedule) => (
              <li key={schedule.id}>
                <div>
                  <div className="schedule-goal">{schedule.goal}</div>
                  <div className="schedule-meta">
                    ⏰ {schedule.cron}
                    {schedule.nextRunAt && ` · 下次 ${new Date(schedule.nextRunAt).toLocaleString("zh-CN")}`}
                  </div>
                </div>
                <div className="schedule-actions">
                  <button
                    className={`btn ghost small ${schedule.enabled ? "" : "muted-btn"}`}
                    onClick={async () => {
                      await api.toggleSchedule(schedule.id, !schedule.enabled);
                      await load();
                    }}
                  >
                    {schedule.enabled ? "暂停" : "启用"}
                  </button>
                  <button
                    className="btn err small"
                    onClick={async () => {
                      await api.deleteSchedule(schedule.id);
                      await load();
                    }}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ 技能资产 ------------------------------ */

function SkillsTab({ skills }: { skills: SkillDefinition[] }) {
  return (
    <div className="settings-sections">
      <section>
        <h3>技能（YAML · 开放格式 · 可移植）</h3>
        <p className="hint">技能位于仓库 skills/ 目录，可自由编写、分享与跨平台迁移</p>
        {skills.length === 0 ? (
          <div className="list-empty">未发现技能</div>
        ) : (
          <ul className="skill-list">
            {skills.map((skill) => (
              <li key={skill.id}>
                <div>
                  <div className="skill-name">
                    {skill.name} <span className="badge info">.{skill.outputFormat}</span>
                  </div>
                  <div className="skill-desc">{skill.description}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
