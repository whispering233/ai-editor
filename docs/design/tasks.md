# 开发任务清单（Task Cards）

开发任务卡，**垂直切片**组织。契约依据：`docs/design/`（架构/上下文/循环/配置）、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`。

**执行纪律**：

- 一次只做一张卡，垂直切片、验证通过（含测试）才算完成，然后独立 commit（一卡一 commit，回滚 = revert 该 commit）；卡内不做卡外顺手改动。
- 契约以 `docs/` 为准；发现文档之间或文档与代码矛盾，先停下提问，不要自行发明。
- 每卡双代理：实现（fixer）+ 独立验证（oracle，只读仓库、自带探针）。
- 验证：`pnpm typecheck` / `pnpm lint` / `pnpm -r test`；**视觉改动额外跑** `packages/client` 的 `design-discipline.test.ts` 与 `antd-tokens.test.ts`，并用 headless 探针看像素。
- 本批次为「换内核」重构：涉及 pi 的行为以 `@earendil-works/* 0.85.1`（exact pin）实际代码为准，卡内不得凭记忆写接口。

---

## 批次总览（依赖序）

`K1 工具层 TypeBox → K2 agent pi 运行时 → K3 事件与提案 → K4 server chat → K5 server settings`
`K4/K5 → K6 client`；`K7 收尾` 最后。

## K1 — 工具层 TypeBox 化

**目标**：`packages/tools` 的工具参数 schema 从 zod 切到 TypeBox；执行契约改为「抛错即失败 / 返回 `{content, details}`」；提案载荷走 `details`。

**范围**：
- `tools` 全部 `argsSchema` → `Type.Object(...)`（`Type`/`Static` 从 `@earendil-works/pi-ai` 重导出，不新增 typebox 依赖）。
- registry：存 TypeBox schema；提供校验函数（非严格字段可保留 `additionalProperties: false` 语义）；删除 zod 依赖与 `z.ZodTypeAny` 类型。
- executor：zod `safeParse` → TypeBox 校验；结果形态改为 `{ content, details }`；提案 `{proposal_id, type, preview}` 放 `details`。
- `shared/types/tool.ts` 的 zod 工具 schema 导出删除（HTTP API 用的 zod schema 不动）。

**不在范围**：pi AgentSession 装配（K2）；SSE 事件（K3）；工具目录/分析逻辑本身的行为变更。

**验证**：`pnpm --filter @whispering233/ai-editor-tools test`；`pnpm typecheck`；`pnpm lint`。

## K2 — agent 包：pi 运行时装配

**目标**：新增 pi 嵌入运行时（`ModelRuntime` + `SessionManager` + `AgentSession`），旧 `run.ts/context.ts/session.ts` 暂留供编译，但不再被新路径使用。

**范围**：
- `agent` 依赖加 `@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai` = `0.85.1`（exact pin）；确认 `pnpm-workspace.yaml` `allowBuilds` 覆盖 pi 依赖的构建脚本。
- 新增运行时模块：`agentDir`（`getAgentDir`）、会话目录 = `<项目根>/sessions`（`SessionManager.create`）、`createAgentSessionServices` + `createAgentSessionFromServices` 装配。
- 资源加载选项：`noExtensions: true`、`noSkills: true`、`noPromptTemplates: true`；`agentsFilesOverride` 只喂项目根 `AGENTS.md`；**项目 `.pi/` 一律不参与配置（项目信任=false）**。
- 系统提示词：内核提示词常量走 loader `systemPrompt`。
- 工具注册：把 `tools` registry 的 TypeBox 工具装配进 AgentSession。
- 会话生命周期：打开/切换项目 → 创建/加载/释放运行时；单项目单在途流约束。

**不在范围**：事件映射（K3）；HTTP/SSE（K4）。

**验证**：`pnpm --filter @whispering233/ai-editor-agent test`（用 pi faux provider 离线跑一轮 prompt + 工具调用）；`pnpm typecheck`。

## K3 — agent 包：事件映射 + 提案仓移植

**目标**：会话事件 → SSE 帧（pi 事件投影：剥离 `partial`、丢弃内部状态事件、`session` 合成帧、`contextUsage` 附加）；提案仓从 `executor.ts` 移植为独立模块。

**范围**：
- 事件投影模块（契约见 `docs/api/80-api-chat.md` 事件表与过滤约定）：`session` / `ping` / `agent_start` / `turn_start` / `message_*` / `tool_execution_*` / `turn_end` / `compaction_*` / `auto_retry_*` / `agent_end`；`turn_end`/`agent_end` 附 `getContextUsage()`。
- 提案仓：TTL 10 分钟 + 条数上限 + 快照校验 + 绑定项目 + 按会话作废（从 `executor.ts` 抽出，行为不变）。
- 删除旧 `run.ts` / `context.ts` / `session.ts` / `executor.ts` 派发部分与对应测试。

**不在范围**：HTTP 路由（K4）；client 渲染（K6）。

**验证**：事件序列单测（给定 pi 事件输入断言帧输出，含 `partial` 剥离与丢弃表）；提案仓单测（TTL/上限/过期/项目不匹配）；`pnpm --filter agent test`。

## K4 — server：chat 路由切换到 pi 运行时

**目标**：`POST /chat` 走新运行时的 SSE；会话列表/消息/思维链/删除端点走 `SessionManager`。

**范围**：
- `routes/chat.ts` 重写：SSE 帧转发、心跳、三路断开检测 → `AgentSession.abort()`、`CHAT_BUSY`、`session` 首帧、focus 注入。
- 会话端点：列表/消息投影（含 thinking 预览 + `deferred`）/思维链全文端点/删除（`SESSION_BUSY`）；**id → 路径只经磁盘发现映射，禁止拼接**（删除 `sess_` 正则与校验）。
- 项目中间件：切换/关闭项目时中止在途流、清空提案、释放运行时。

**不在范围**：settings 路由（K5）；client（K6）。

**验证**：`packages/server/src/routes/chat.test.ts` 重写（faux provider + 临时项目目录 + 假 SessionManager 文件）；`pnpm --filter server test`。

## K5 — server：settings / 模型路由切换到 pi

**目标**：`GET/PUT /settings/llm` 数据源与写入目标换成 pi（`ModelRuntime` + credential store）。

**范围**：
- GET：provider 列表（含未配置认证者）+ `authConfigured`/`authSource` + 每家模型目录 + 激活模型/思考强度（`getModels` / `getProviderAuthStatus` / `getSupportedThinkingLevels`）。
- PUT：provider/model/thinking_level 写 pi settings；`api_key` 写/清 pi credential store（空串 = 删除）；model ∈ provider 目录校验。
- 删除：`~/.ai-editor/config.json` 读取链、`api_keys`、`context_budget` 解析、`REGISTERED_PROVIDERS`/`PROVIDER_FALLBACK_MODEL`/env 映射表、`DEFAULT_*` 常量。

**不在范围**：OAuth 登录流程、自定义 provider 表单（`docs/api/90-api-settings.md`「不做的事」）。

**验证**：`settings.test.ts` 重写（HOME 隔离的临时 agent dir）；`pnpm --filter server test`。

## K6 — client：聊天链路消费 pi 事件

**目标**：SSE 解析与 store 适配新事件集；思维链折叠展示；提案卡从 `tool_execution_end.result.details` 提取；占用条换 `contextUsage` 口径。

**范围**：
- `hooks/use-sse.ts` + `stores/chat.ts`：事件集重写（`message_update` 增量累积 text/thinking/toolcall、`tool_execution_*`、`compaction_*`/`auto_retry_*` 状态提示、`agent_end` 终止/错误、`session` 首帧）。
- 思维链：`thinking-block` 组件（契约 = `docs/ui/DESIGN.md` §会话）；流式期间展开、结束后折叠；历史回看预览 + 按需拉全文。
- 提案卡：从工具结果 `details` 提取，确认/拒绝端点不变。
- 占用条：`contextUsage` 口径；切会话/项目清零。
- 会话列表/删除：新 id 语义（不透明 id）。

**不在范围**：设置页 UI 改造（K5 只改后端契约；页面字段映射在 K6 内按现有表单对齐）。

**验证**：chat store 单测；`design-discipline.test.ts` + `antd-tokens.test.ts`；headless 视觉探针（subagent 执行，主会话只看结论与必要截图）。

## K7 — 收尾：清理与发布面

**目标**：删净旧内核，发布面收敛到 5 包。

**范围**：
- 删除 `packages/llm` 与 `agent`/`server` 中遗留引用；`shared` 中会话/设置旧类型清理。
- 脚本与文档：`publish-packages.mjs` / `pack-test-install.mjs` / `verify-installed.mjs` 改 5 包；`docs/design/build.md` 已改，核对落地；README 更新。
- `CHANGELOG.md`：破坏性条目（会话格式、包删除、配置位置变更、思考强度缺省由 pi 决定）。
- 版本号同步（`pnpm release:version`）。

**验证**：`pnpm -r build && pnpm typecheck && pnpm lint && pnpm -r test`；`pnpm test:packed`（安装态冒烟）。

---

## 当前任务卡

- [ ] K1 — 工具层 TypeBox 化
- [ ] K2 — agent 包：pi 运行时装配
- [ ] K3 — agent 包：事件映射 + 提案仓移植
- [ ] K4 — server：chat 路由切换到 pi 运行时
- [ ] K5 — server：settings / 模型路由切换到 pi
- [ ] K6 — client：聊天链路消费 pi 事件
- [ ] K7 — 收尾：清理与发布面
