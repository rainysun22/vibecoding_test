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

## v0.2：运行成本与速度优化（下一版本重点）

- [ ] **流式输出直达前端**：LLM stream 经 SSE 透传，正文逐字渲染（首字延迟从秒级降到百毫秒级）
- [ ] **计划缓存与去重**：相似目标命中历史 plan，跳过 planning 阶段
- [ ] **经济模型自动降级**：预算上限内自动选择最优性价比模型；超限任务挂起提示
- [ ] **本地模型优先路由**：Ollama 可用时长尾任务自动走本地，边际成本归零
- [ ] **并行步骤执行**：research 步骤并发执行（当前为串行 DAG 保守实现）
- [ ] **成果生成 worker 化**：docx/pptx 生成移出主事件循环，避免大文件阻塞 SSE

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
