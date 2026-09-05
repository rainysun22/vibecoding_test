# OpenWork 架构设计

## 总体形态：本地优先 + 可选云端协同

```
┌─────────────────────────────────────────────────────────────┐
│  客户端层  apps/web（React 工作台：委托 / 活动流 / 审批 / 成果） │
├─────────────────────────────────────────────────────────────┤
│  接口层    apps/server（Fastify REST + SSE 实时流 + 静态托管） │
├─────────────────────────────────────────────────────────────┤
│  运行时    @openwork/core                                     │
│   ├─ AgentRunner    plan → act → verify + 语义级审批          │
│   ├─ Scheduler      cron 定时委托                             │
│   ├─ SkillRegistry  YAML 技能资产                             │
│   └─ Storage        node:sqlite（零原生依赖）                 │
├─────────────────────────────────────────────────────────────┤
│  模型层    @openwork/llm-gateway                              │
│   统一协议 · 成本路由（planner 强模型 / 执行经济模型）· 用量台账 │
├─────────────────────────────────────────────────────────────┤
│  交付层    @openwork/deliverables                             │
│   Markdown → md / html / docx / xlsx / pptx + 内容寻址版本化  │
└─────────────────────────────────────────────────────────────┘
```

## Agent 执行循环（core/agent.ts）

```
createTask(goal)
   │
   ▼
phasePlan ──── LLM 生成结构化计划（research → draft → deliver）
   │              │
   │              └─ 自动模式：直接进入执行
   ▼              ▼ 手动模式：创建 plan checkpoint → 暂停等待审批
phaseExecute ─ 逐步执行：研究笔记 → 正文草稿 → 成果文件
   │              （run_state 持久化，断点续跑）
   ▼
phaseVerify ── LLM 质量校验（verdict / score / issues）
   │              │
   │              └─ 自动模式：完成
   ▼              ▼ 手动模式：创建 deliverable checkpoint → 暂停
finish ─────── status = completed，成果可下载
```

关键设计：

1. **可恢复执行**：运行状态（`RunState`）持久化于 `tasks.run_state`，审批通过或进程重启后从断点续跑，已完成的步骤不重复执行。
2. **单一控制流**：阶段切换只在主循环 `run()` 中发生，阶段函数不互相直接调用，避免重入与并发冲突。
3. **失败兜底**：计划解析失败时构造最小计划；未知模型回退 Mock Provider——系统永不因单点配置缺失而崩溃。

## 模型中立网关（llm-gateway）

所有提供商实现统一 `LLMProvider` 协议（`complete` / `stream` / `testConnection`），零 SDK 依赖、原生 fetch：

- **OpenAI 兼容族**：OpenAI / DeepSeek / Qwen 共用一个适配器
- **专有协议**：Anthropic / Gemini / Ollama 各自适配
- **Mock**：依据 system 指令标记确定性生成计划/正文/校验 JSON，支撑无密钥的全流程演示与 CI

成本路由按任务性质选模型：`planning` / `verifying` 用 `plannerModel`（强模型），`execution` 用 `defaultModel`（经济模型）。每次调用的 token 与费用实时归集到任务台账与全局 usage_log。

## 成果版本化（deliverables + deliverable-store）

- 每个成果以 SHA-256 内容寻址：`deliverables/<id>/v<n>.<ext>`
- 版本链记录于 `deliverable_versions` 表（版本号 / 内容哈希 / 字节数 / 来源任务）
- 同一内容不重复落盘，天然支持回滚与审计

## 语义级审批

信任粒度在「一版计划 / 一版成果」，而非每个工具调用：

- checkpoint 只有 `plan` / `deliverable` 两种语义类型
- 拒绝即终止（保留轨迹），批准则从断点续跑
- 自动模式（`OPENWORK_AUTO_APPROVE=1`）供受信场景与 CI

## 数据模型（SQLite）

| 表 | 职责 |
| --- | --- |
| tasks | 委托主档 + run_state + 用量累计 |
| task_events | 任务轨迹（seq 单调递增，可回放） |
| checkpoints | 审批点 |
| deliverables / deliverable_versions | 成果元数据与版本链 |
| schedules | 定时委托 |
| settings | 网关配置持久化（密钥仅存本地） |
| usage_log | 全局用量台账 |

## 实时通信

`GET /api/events`（SSE）广播所有运行时事件；前端按 `taskId` 过滤局部刷新，配合 15s 心跳与自动重连（`retry: 3000`），避免轮询开销。

## 安全边界

- API 默认只监听 `127.0.0.1`
- 提供商密钥仅存于本地 SQLite，任何接口不回显完整密钥
- 成果下载文件名做非法字符清洗，`content-disposition` UTF-8 编码
