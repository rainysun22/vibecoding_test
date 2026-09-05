# OpenWork 路线图

## v0.1（当前：可用内核）

- [x] Monorepo：types / llm-gateway / deliverables / core / server / web
- [x] 多模型网关：OpenAI / Anthropic / Gemini / DeepSeek / Qwen / Ollama / Mock
- [x] 成果引擎：markdown / html / docx / xlsx / pptx + SHA-256 版本化
- [x] Agent 循环：plan → act → verify，断点续跑
- [x] 语义级审批（计划 / 成果两个 checkpoint）
- [x] 任务轨迹全量落库 + SSE 实时流
- [x] 技能资产（YAML）与定时委托（cron）
- [x] React 工作台（三栏：委托 / 活动流 / 审批与成果）

## v0.2（当前：运行成本与速度优化）

- [x] **流式输出直达前端**：LLM stream 经 EventBus/SSE 透传，正文逐字渲染（节流聚合，约 100ms/帧）
- [x] **计划缓存与去重**：goal 归一化 + SHA-256 哈希命中历史 plan，跳过 planning 阶段（LRU 语义，30 天惰性清理）
- [x] **经济模型自动降级**：日预算上限，超限后自动切换最便宜的已配置付费模型；无可用模型时明确报错
- [x] **本地模型优先路由**：Ollama 可用时 execution 走本地模型，边际成本归零；planning/verify 仍用强模型
- [x] **并行步骤执行**：连续 research 步骤 `Promise.all` 并发执行
- [x] **成果生成 worker 化**：docx/xlsx/pptx 生成移入 worker 线程，避免大文件阻塞主事件循环

## v0.3（当前：能力扩展）

- [x] **工具系统**：委托中显式引用的 URL / 本地文件路径自动成为 research 数据源（网页抓取 + 文件读取），工具执行全程落审计事件
- [x] **成果 diff 视图**：版本间行级结构化对比（LCS 增/删/上下文 + 统计），git 化体验
- [x] **成果修订闭环**：基于反馈一键生成新版本，同成果版本链追加（v1 → v2 → …）
- [x] **技能安装**：YAML 内容 / URL 一键安装第三方技能（schema 校验 + 热加载）
- [x] **断点恢复**：进程重启后未完成任务自动续跑（任务锁防并发 + 恢复事件落库），前端可视化续跑
- [ ] 多 Agent 并行委托与工作区隔离

## v0.4：协同与生态

- [ ] 可选云端协同：多设备同步（端到端加密，密钥不上云）
- [ ] OpenAPI 规范导出与第三方客户端支持
- [ ] 插件系统：自定义 provider / deliverable 格式 / 工具
- [ ] Postgres 存储后端（保持 SQL 语义，平滑迁移）

## 原则

每一版本坚持：本地优先不回退、开放格式不绑架、密钥永不出本机。
