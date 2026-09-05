import { useCallback, useEffect, useState } from "react";
import type {
  KnowledgeDoc,
  KnowledgeRecall,
  ModelInfo,
  ProviderConfig,
  ProviderId,
  Schedule,
  SkillDefinition,
  UserProfile,
} from "@openwork/types";
import * as api from "../api";

interface SettingsModalProps {
  skills: SkillDefinition[];
  onClose: () => void;
  onToast: (message: string) => void;
}

type Tab = "models" | "schedules" | "skills" | "knowledge" | "profile";

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
          <button className={tab === "knowledge" ? "active" : ""} onClick={() => setTab("knowledge")}>
            知识库
          </button>
          <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>
            用户画像
          </button>
        </div>
        <div className="modal-body">
          {tab === "models" && <ModelsTab onToast={onToast} />}
          {tab === "schedules" && <SchedulesTab onToast={onToast} />}
          {tab === "skills" && <SkillsTab skills={skills} />}
          {tab === "knowledge" && <KnowledgeTab onToast={onToast} />}
          {tab === "profile" && <ProfileTab onToast={onToast} />}
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

/* ------------------------------ 知识库（v0.4） ------------------------------ */

function KnowledgeTab({ onToast }: { onToast: (message: string) => void }) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [recalls, setRecalls] = useState<KnowledgeRecall[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setDocs(await api.listKnowledgeDocs().catch(() => []));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!content.trim() || busy) return;
    setBusy(true);
    try {
      await api.addKnowledgeDoc(title.trim() || "未命名文档", content);
      setTitle("");
      setContent("");
      await load();
      onToast("文档已加入知识库 —— 委托时自动按相关性召回");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "添加失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await api.deleteKnowledgeDoc(id).catch(() => null);
    await load();
  };

  const preview = async () => {
    if (!query.trim()) return;
    setRecalls(await api.recallKnowledgePreview(query.trim()).catch(() => []));
  };

  return (
    <div className="settings-sections">
      <section>
        <h3>个人知识库（本地优先）</h3>
        <p className="hint">
          上传私有文档（行业资料、产品口径、历史报告…）—— 委托时按相关性自动召回注入，内容永不出本机
        </p>
        <div className="knowledge-form">
          <input
            placeholder="文档标题，如：2026 产品口径备忘"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            placeholder="粘贴文档内容（Markdown / 纯文本）…"
            rows={5}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          <button className="btn primary" disabled={!content.trim() || busy} onClick={() => void add()}>
            加入知识库
          </button>
        </div>
      </section>

      <section>
        <h3>召回预览</h3>
        <div className="knowledge-recall-form">
          <input
            placeholder="模拟委托目标，查看会命中哪些文档…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void preview();
            }}
          />
          <button className="btn ghost" onClick={() => void preview()}>
            测试召回
          </button>
        </div>
        {recalls && (
          <ul className="knowledge-recall-list">
            {recalls.length === 0 ? (
              <li className="muted">无相关文档命中（低置信拒绝 —— 宁缺毋滥）</li>
            ) : (
              recalls.map((recall) => (
                <li key={recall.docId}>
                  <span className="badge info">{(recall.score * 100).toFixed(0)}%</span> {recall.title}
                </li>
              ))
            )}
          </ul>
        )}
      </section>

      <section>
        <h3>已有文档（{docs.length}）</h3>
        {docs.length === 0 ? (
          <div className="list-empty">暂无文档</div>
        ) : (
          <ul className="knowledge-list">
            {docs.map((doc) => (
              <li key={doc.id}>
                <div>
                  <div className="knowledge-title">{doc.title}</div>
                  <div className="knowledge-meta">
                    {doc.sizeChars.toLocaleString()} 字符 · {new Date(doc.createdAt).toLocaleString("zh-CN")}
                  </div>
                </div>
                <button className="btn err small" onClick={() => void remove(doc.id)}>
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ 用户画像（v0.4） ------------------------------ */

function ProfileTab({ onToast }: { onToast: (message: string) => void }) {
  const [profile, setProfile] = useState<UserProfile>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void api
      .getUserProfile()
      .then(setProfile)
      .finally(() => setLoaded(true));
  }, []);

  const save = async () => {
    try {
      await api.saveUserProfile(profile);
      onToast("画像已保存 —— 此后每次委托自动生效");
    } catch {
      onToast("保存失败");
    }
  };

  if (!loaded) return <div className="list-empty">加载中…</div>;

  return (
    <div className="settings-sections">
      <section>
        <h3>用户画像（一次填写，长期生效）</h3>
        <p className="hint">
          相当于给 AI 助理做「入职培训」：身份背景、工作偏好、表达风格自动注入每一次委托，不必反复自我介绍
        </p>
        <div className="profile-form">
          <label>
            <span>我是谁（身份 / 业务背景 / 所在行业）</span>
            <textarea
              rows={3}
              placeholder="例：跨境电商创业者，主营家居品类，团队 5 人，关注供应链与品牌出海"
              value={profile.about ?? ""}
              onChange={(event) => setProfile({ ...profile, about: event.target.value })}
            />
          </label>
          <label>
            <span>工作偏好（流程 / 结构 / 重点取舍）</span>
            <textarea
              rows={3}
              placeholder="例：结论先行，先给行动建议再给分析；数据必须标注出处；控制在千字内"
              value={profile.preferences ?? ""}
              onChange={(event) => setProfile({ ...profile, preferences: event.target.value })}
            />
          </label>
          <label>
            <span>表达风格（语气 / 受众 / 文风）</span>
            <textarea
              rows={3}
              placeholder="例：正式商务语气，面向投资人；避免口语与网络用语；多用小标题与列表"
              value={profile.voice ?? ""}
              onChange={(event) => setProfile({ ...profile, voice: event.target.value })}
            />
          </label>
          <button className="btn primary" onClick={() => void save()}>
            保存画像
          </button>
        </div>
      </section>
    </div>
  );
}
