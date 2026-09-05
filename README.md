# OpenWork

**开源中立 · 成果交付 · 本地可控的 All-in-One 个人 AI 工作台**

OpenWork 的核心理念：「对话即交付」——你委托一个目标，系统负责拆解、执行、校验，并产出**可带走的开放格式成果**（Markdown / HTML / docx / xlsx / pptx）。

与主流 "Work" 系产品的差异：

| 维度 | 主流产品 | OpenWork |
| --- | --- | --- |
| 开放性 | 闭源、绑定厂商生态 | Apache-2.0 开源、模型中立 |
| 成果 | 私有格式 / 平台内沉淀 | 开放格式 + 内容寻址版本化，可自由迁移 |
| 信任 | 逐工具确认或黑盒运行 | 语义级审批（一次审「一版计划 / 一版成果」）+ 全程轨迹可审计 |
| 成本 | token 计费黑盒 | 多模型成本路由 + 透明用量台账 |
| 数据 | 云端优先 | 本地优先（SQLite + 文件系统），密钥永不出本机 |

## 快速开始

```bash
# 要求 Node.js >= 22.5（node:sqlite）
npm install
npm run build          # 构建 types → llm-gateway → deliverables → core → server
npm start               # 启动服务 http://127.0.0.1:4765
```

打开 `http://127.0.0.1:4765` 即是工作台。**无需任何 API 密钥**——内置 Mock Provider 提供确定性离线输出，全流程（委托 → 计划 → 审批 → 执行 → 成果）开箱即用。

### 接入真实模型

在「设置 → 模型网关」中填入任一提供商的 API Key（仅存本地）：

- OpenAI / Anthropic / Google Gemini
- DeepSeek / Qwen（通义千问）
- Ollama（本地部署，零成本）

支持**成本路由**：计划用强模型（质量），执行用经济模型（成本），每次调用的 token 与费用实时记入台账。可设置**日预算上限**（超限自动降级到最便宜的可用模型）与**本地优先**（Ollama 可用时执行类调用零成本）。

### 开发模式

```bash
npm run dev             # API 服务（4765）
npm run dev:web         # Vite 前端（5173，代理到 4765）
npm test                # core / deliverables / llm-gateway 全部测试
```

## 核心能力

- **一句话委托**：输入目标，Agent 自动完成 plan → act → verify 循环
- **语义级审批**：计划与成果两个粒度的 checkpoint，审批后从断点续跑
- **成果引擎**：五种开放格式生成，SHA-256 内容寻址 + 版本链（docx/xlsx/pptx 在 worker 线程生成，不阻塞主流程）
- **任务轨迹**：每一步落为事件流，可完整回放与审计
- **技能资产**：YAML 定义的可复用委托模板（见 `skills/`），可自由编写与分享，支持在线安装校验与热加载
- **定时委托**：cron 表达式驱动的自动任务
- **SSE 实时流**：所有状态变化实时推送前端，LLM 输出逐字流式渲染
- **速度与成本优化**：计划缓存（相似目标跳过 planning）、连续 research 步骤并行执行
- **工具系统**：委托中显式引用的 URL 与本地文件路径自动成为 research 数据源（网页抓取 + 文件读取），每次工具执行落为审计事件
- **成果修订与 diff**：基于反馈一键生成新版本，版本间行级结构化对比（增/删/上下文 + 统计），git 化体验
- **断点恢复**：进程重启后未完成任务自动续跑（run_state 持久化 + 任务锁防并发），前端可视化恢复按钮

## 仓库结构

```
packages/
  types/          共享类型（全系统统一词汇表）
  llm-gateway/    多模型网关（统一协议 + 成本路由 + 用量核算）
  deliverables/   成果引擎（md / html / docx / xlsx / pptx）
  core/           Agent 运行时（plan→act→verify + 审批 + 调度 + SQLite 存储）
apps/
  server/         Fastify API + SSE + 静态托管
  web/            React 工作台前端
skills/           内置技能（YAML）
```

详细设计见 [ARCHITECTURE.md](./ARCHITECTURE.md)，演进计划见 [ROADMAP.md](./ROADMAP.md)。

## License

Apache-2.0
