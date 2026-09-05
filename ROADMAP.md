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

## v0.3：能力扩展

- [ ] 浏览器与本地文件工具（读本地目录、抓取网页作为 research 数据源）
- [ ] 多 Agent 并行委托与工作区隔离
- [ ] 成果 diff 视图：版本间结构化对比（git 化体验）
- [ ] 技能市场：从 URL / 仓库一键安装第三方技能
- [ ] 断点恢复 UI：进程重启后可视化续跑状态

## v0.4：协同与生态

- [ ] 可选云端协同：多设备同步（端到端加密，密钥不上云）
- [ ] OpenAPI 规范导出与第三方客户端支持
- [ ] 插件系统：自定义 provider / deliverable 格式 / 工具
- [ ] Postgres 存储后端（保持 SQL 语义，平滑迁移）

## 原则

每一版本坚持：本地优先不回退、开放格式不绑架、密钥永不出本机。
