# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 本批主题：pi 配置目录隔离 + 本机配置文件编辑器

## 已定设计（执行时不得自行改动，改动前先提问）

- 生效目录只来自 `~/.ai-editor/pi.json` 的 `agentDir`；键缺失 / 空串 → 默认 `~/.ai-editor/pi-agent`。**不读父进程 `PI_CODING_AGENT_DIR`、不做优先级裁决**。
- 落地方式：服务启动最早期把解析值写进 `process.env.PI_CODING_AGENT_DIR`（pi 唯一覆盖点）。**只有 `pi-agent-dir.ts` 写这个变量**，模块顶层零副作用。
- **不做**旧 `~/.pi/agent` 的拷贝迁移（用户自行重配），`pi.json` 只有 `agentDir` 一个键。
- 改目录 / 改文件后 **即时生效**：重设 env → `resetModelRuntime()` → `disposeProjectRuntime()` → 重挂 `applyHttpProxySettings` + `configureHttpDispatcher`。
- 搜索 / 抓取凭据唯一来源 = `~/.ai-editor/search.json` 的 `apiKey`，**不复用模型凭据、不读环境变量、无回退**；未配置即抛可读错误（指向「设置 → 高级」）。当前仅接入 DeepSeek 的 `tools/search` / `tools/fetch`。
- 端点（契约写进 `docs/api/90-api-settings.md`）
  - `GET /api/v1/settings/pi/dir` → `{ dir, defaultDir }`
  - `PUT /api/v1/settings/pi/dir` → `{ dir }` → `{ dir, defaultDir }`；非绝对路径 / 空串 → 400 `VALIDATION_ERROR`；当前项目有在途对话 → 409 `CHAT_BUSY`
  - `GET /api/v1/settings/config-file/:name` → `{ name, exists, content }`
  - `PUT /api/v1/settings/config-file/:name` → `{ content }` → `{ saved: true }`；`name` ∉ shared `CONFIG_FILE_NAMES` → 400；校验失败 → 400 且**不写盘**
  - `name` 白名单 → 绝对路径的映射表是**唯一**取路径处，禁止拼接客户端传入值
- 文件与校验口径：`auth.json` / `settings.json`（pi 目录，严格 `JSON.parse`）、`models.json`（pi 目录，宽松 = 去 `//` 注释与尾逗号后再 parse，与 pi `stripJsonComments` 同口径）、`search.json`（`~/.ai-editor/`，zod strict `{ apiKey?: string }`）
- 明文凭据照实回传（只在这一个本机回环端点）；不进日志 / 备份 / 导出 / 云端 / 项目文件。

---

## 卡 1 — server：pi 配置目录内核

- **改动面**：新增 `packages/server/src/pi-agent-dir.ts`；`packages/server/src/index.ts` 在 `getSettingsManager()` **之前**接线；新增 `packages/server/src/pi-agent-dir.test.ts`
- **要求**
  - `DEFAULT_PI_AGENT_DIR`（`homedir()` + `.ai-editor/pi-agent`）与 `~/.ai-editor/pi.json` 路径都不出第二份字面量
  - 读：`agentDir` 非空字符串且绝对路径才认，否则默认；文件不存在 / 坏 JSON / 顶层非对象 → 默认（不抛错）
  - 写：合并写（读整份 → 只改 `agentDir` → `writeJsonAtomic`，父目录 `mkdir -p`）
  - `initPiAgentDir(override?)`：解析 → 写 env → 返回目录（override 供测试注入）
  - `applyPiConfigChange()`：重置单例 + 释放项目运行时 + 重挂 httpProxy / idleTimeout（注意：先 `resetModelRuntime()` 再 `getSettingsManager()`，否则读到旧目录）
- **硬完成判据**：`git log --oneline -1` 出现本卡 commit；`git status --short` 空；`pnpm --filter @whispering233/ai-editor-server test` 全绿；贴出 `pi-agent-dir.test.ts` 的用例清单与输出
- **约束**：`*.test.ts` 不得进 `pnpm typecheck`（tsconfig 已排除，不要改）；测试必须恢复 `process.env` 与 `HOME`

## 卡 2 — server：搜索凭据（唯一来源 `search.json`）

- **改动面**：新增 `packages/server/src/search-config.ts` + 单测；`packages/server/src/web-search.ts`、`packages/server/src/fetch.ts` 的缺省 `resolveAuth` 改指向它；`packages/shared/src/types/api.ts` 增 `searchConfigFileSchema`（zod，strict，`apiKey?: string`）
- **要求**
  - `readSearchApiKey()`：缺失 / 坏 JSON / 非对象 / `apiKey` 非字符串 / 空串 → `null`（整份忽略，不抛）
  - `resolveSearchAuth()`：有 key → `{ auth: { apiKey }, source: "search.json" }`；否则 `undefined`（**不得**回落到 `getModelRuntime().getAuth()` 或 `DEEPSEEK_API_KEY`）
  - 缺失时错误文案指向「设置 → 高级」，并声明当前仅接入 DeepSeek 搜索
- **硬完成判据**：新 commit + `git status --short` 空 + `pnpm --filter ai-editor-server test` 绿 + `pnpm --filter @whispering233/ai-editor-shared build` 后 typecheck 绿；测试须含「设置了 `DEEPSEEK_API_KEY` 仍报未配置」（证明无回退）
- **依赖**：无（与卡 1 并行，唯一共享文件是 `shared/src/types/api.ts`，本卡先落）

## 卡 3 — server：4 个端点 + 契约

- **改动面**：`packages/shared/src/types/api.ts`（`CONFIG_FILE_NAMES`、4 组 zod schema）；`packages/server/src/routes/settings.ts`；`packages/server/src/routes/settings.test.ts`
- **要求**：按上文端点表实现；写文件用 `writeTextAtomic`（保用户缩进与注释）；保存成功后调用 `applyPiConfigChange()`
- **硬完成判据**：新 commit + 干净工作区 + server 包测试绿；端点测试至少覆盖：白名单外 400、非法 JSON 400 且文件内容未变、`PUT /settings/pi/dir` 后 `GET /settings/llm` 读到新目录（在新目录写 `auth.json` 断言生效）、`files` 不存在时 `{ exists: false, content: "" }`
- **依赖**：卡 1、卡 2

## 卡 4 — UI：「高级」tab + 目录面板

- **改动面**：`packages/client/src/lib/api.ts`（4 个调用函数）；新增 `components/settings/pi-dir-panel.tsx`；`pages/Settings.tsx` 增 `advanced` tab（AI 模型之后、项目规则之前，两形态恒在）；`pages/settings-tabs.test.tsx` 更新顺序断言
- **要求**：展示当前生效目录 + 默认目录；「恢复默认」= 把 `defaultDir` 原样 PUT；保存成功后提示已生效；409 时给可读文案（先在途对话结束后再改）
- **硬完成判据**：新 commit + 干净工作区 + `pnpm --filter @whispering233/ai-editor-client test` 绿（含 tab 顺序断言）+ typecheck 绿
- **依赖**：卡 3

## 卡 5 — UI：配置文件编辑器

- **改动面**：新增 `components/settings/config-file-editor.tsx` 并挂进「高级」tab（`pi-dir-panel.tsx` 或 `Settings.tsx`，择一处的既有结构，不重复挂载）
- **要求**：4 项切换（`auth.json` / `models.json` / `settings.json` / `search.json`）；`exists: false` 显示「文件不存在，保存即创建」；保存失败（400）保留用户输入并展示服务端文案；`search.json` 项旁声明「搜索 / 网页抓取目前只接入 DeepSeek，与对话 key 是两份独立配置」
- **硬完成判据**：新 commit + 干净工作区 + client 测试绿 + typecheck 绿；浏览器核一次（截图交主会话，≤5 张）
- **依赖**：卡 4

## 卡 6 — 文档对齐 + 全量验证

- **改动面**：`docs/api/90-api-settings.md`（4 个端点 + 删「不提供 models.json 编辑」「直接编辑 settings.json」两条 + `~/.pi/agent` 改「pi 配置目录」）；`docs/api/tool-calling.md`（搜索凭据口径）；`docs/design/architecture.md` / `docs/db/schema.md` / `docs/design/20-context.md`（残留 `~/.pi/agent` 字面路径）；`docs/ui/DESIGN.md`（登记「高级」tab）；`AGENTS.md`（一条硬约束：pi 配置目录与明文端点）
- **硬完成判据**：新 commit + 干净工作区 + `pnpm -r build && pnpm typecheck && pnpm lint && pnpm -r test` 全绿（贴输出尾部）+ `docs/design/tasks.md` 已清卡
- **依赖**：卡 1–5