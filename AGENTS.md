# AGENTS.md

面向编码 agent 的协作入口。**设计文档是单一事实来源**：本文件只回答「读什么」「怎么协作」，并登记设计文档不承载的**代码级硬约束**——凡能在 `docs/` 里查到的内容，这里不复述。

## 文档即契约

**文档地图与阅读顺序 = `docs/docs-map.md`**（唯一索引来源，本文件不复述）。

- 改动前先读对应文档；发现文档之间或文档与代码矛盾，**先停下提问**，不要自行发明。
- pi 的行为以 `node_modules` 里实际安装的 `@earendil-works/*` 代码 / 类型为准，禁止凭记忆写接口。

## 协作流程

- 任务以 `docs/design/tasks.md` 为清单：垂直切片、一次一张、一卡一 commit、独立验证；卡内不做卡外顺手改动，完成后清卡并汇报。
- 每卡「实现 fixer + 独立验证 oracle」双代理；并行卡片用临时分支 + `git worktree`，验证后合回 main 并清理。
- 并行派工硬要求：子代理必须显式 `context: "fresh"`（默认 fork 会把父会话的编排叙事当成自己的进度）；任务卡必须带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS），并要求汇报附 commit hash / 命令输出。
- 验证命令：`pnpm typecheck` / `pnpm lint` / `pnpm -r test`。**单包测试的 filter 必须与 package.json 的 `name` 逐字一致**（桌面包名无 scope = `ai-editor-desktop`），写错会打印 `Scope: 0 of 8 workspace projects` 并静默空跑；fresh clone 先 `pnpm -r build` 再 typecheck；UI 改动额外用浏览器核一次像素（**核前必须整页重载**：`#/` 之间的 `goto` 是同文档导航，不会重新拉 bundle，曾因此得出一轮「功能没生效」的假阴性）；改桌面版主进程（依赖 / import）后必须跑打包态启动冒烟 `node packages/desktop/scripts/smoke.mjs`（先 `pack.mjs`）。**Windows 本机这两步当前不可用**（Electron 二进制懒下载需镜像、本地出包会撞文件锁），等价走法见 `backlog.md`「开发环境」。
- 提交信息用中文、遵循 conventional commits；文档里的日期用真实日期（`date +%F`）。**合同文档（`docs/api` / `docs/db` / `docs/ui` / `docs/design` 正文）不写任务卡编号**——卡清空后编号即成悬空引用；`backlog.md` 保留登记来源，代码注释里的历史阶段编号按 provenance 保留。**冲突合并的提交要带 `GIT_MERGE_AUTOEDIT=no`**（或 `--no-edit`）：merge 状态下 `git commit` 会为了编辑 `MERGE_MSG` 开编辑器，自动化会直接挂住。
- 日常不 push、不建 PR、不新增 CI；远端与 CI 只服务发布链路（push `v*` tag 触发 `.github/workflows/`）。

## 版本发布

按 `docs/design/build.md`「正式发布链路」执行（发布面清单以该节为准，不在此复述）。

## 代码级硬约束

设计文档不承载实现约定，只在此登记；改了对应代码就同步改这里。

### 依赖与运行时

- **精确版本（禁 `^` / `~`）** = 与我们代码咬合的第三方包：`@earendil-works/*`、`@blocknote/core|react|ariakit`、`@ant-design/x`、`@ant-design/x-markdown`（我们依赖其内部结构——`ThoughtChain` 标题字重 / `footer` 槽位 / `div onClick` 折叠头，patch 漂移会静默改掉这些前提）、`@xyflow/react`、`drizzle-orm`、`undici`、`electron`、`electron-updater`；其余运行时库（`react` / `antd` / `hono` / `zod` / `better-sqlite3` 等）沿用 `^`。升级 = 一个显式 commit 齐抬版本 + 全量测试 + **无锁安装冒烟**（`pnpm pack:test` + `pnpm start:test`；`pnpm test` 绿不代表装得上）+ 该包的浏览器 / 打包态核对。
- typebox 的 `Type` / `Static` 经 `pi-ai` 重导出，不单独装 typebox。传递依赖不需要自建解析锁（上游内部 pi 依赖均为精确版本）。**声明位置按 import 性质**：运行时 import 进 `dependencies`。
- 升级 pi 后复查四处「与 pi 同构」断言：`packages/server/src/http-dispatcher.ts` 与 pi `core/http-dispatcher.ts` 的差异只允许「不跟踪 `installedGlobalFetch`」；pi-ai 凭据解析顺序；会话文件类型（`session-manager.d.ts`）；模型 / 运行参数表单字段源 = pi `schemas/{models,settings}.schema.json`（字段增减要同步表单，否则静默少字段）。
- 升级后复核模型目录：provider 家集合有增删改名要同步 `PROVIDER_ICONS`；`resolveDefaultModel` 对取不到的已选模型静默回落首个可用模型（不是缺陷）。
- 凡调 LLM 一律走 pi 的 Agent 路径（`createAgentSessionServices` + `createAgentSessionFromServices` + `SessionManager`）；禁止直连 `completeSimple`、禁止自建 fetch / agent / 请求头——provider 特化头、重试 / 超时、思考档位只在 pi 的包装层生效。
- pi 配置与凭据的唯一读写入口 = `packages/server/src/model-runtime.ts` 的 `getModelRuntime()` / `getSettingsManager()`；业务代码不得直读 pi 配置目录的 `auth.json` / `settings.json`（唯一例外 = 设置页「高级」的配置文件编辑器：整份文本透传、不解析语义）。
- **pi 配置目录**唯一来源 = `~/.ai-editor/pi.json` 的 `agentDir`（缺失 / 非绝对路径 → 缺省 `~/.ai-editor/pi-agent`）；`process.env.PI_CODING_AGENT_DIR` 是**输出不是输入**（不读父进程值），只在 `packages/server/src/pi-agent-dir.ts` 里写、模块顶层零副作用（测试隔离靠这点）；改目录与改配置文件后统一走 `applyPiConfigChange()`（重设 env → 重建单例 → 释放项目运行时 → 重挂 dispatcher），否则读到的还是旧目录。编辑器可编的文件白名单 = shared `CONFIG_FILE_NAMES`（`name → 绝对路径`映射唯一，永不拼接客户端值），校验口径必须跟 pi 的**读**一致（`models.json` 宽容注释、`auth/settings` 严格、`search.json` 只认 `apiKey`）；明文凭据只在这一个本机回环端点回传，不进日志 / 备份 / 导出 / 云端 / 项目文件。`models.json` 写入前必须滚动备份为同目录 `models.json.bak`（唯一实现 = `pi-agent-dir.ts` 的 `backupModelsConfig`，备份失败中止保存、主文件不动；`.bak` 不进白名单、不参与 `applyPiConfigChange`）。
- 搜索 / 抓取（`web_search` / `fetch_content`）的凭据唯一来源 = `~/.ai-editor/search.json` 的 `apiKey`：**不复用模型凭据、不读环境变量、无回退**；未配置就抛可读错误（指向「设置 → 高级」）。
- 出站 HTTP 走服务启动时安装的全局 undici dispatcher（`packages/server/src/http-dispatcher.ts`：连接族退避 + 环境代理 + 空闲超时）；业务代码不要另建 fetch / agent（云端 WebDAV 同样走它）。

### pi 会话侧口径

- 模型请求入参是 `TranscriptContext`：提示词与工具声明在 `messages` 首条 system 消息里，**顶层 `systemPrompt` 不存在**；断言提示词用 pi-ai 的 `getCurrentSystemPrompt(messages)`。
- 会话列表 `messageCount` 必须是可见消息数（`projectSessionMessages(entries).length`），禁用 pi `SessionInfo.messageCount`（它含首条 system 条目）。
- 会话文件在**首条 user 消息**落盘 ⇒ `SessionManager.create()` 之后盘上暂无文件；首轮中止会留只含 user 消息的会话（历史面板照常列出，不是缺陷）。
- 会话 id 是**不透明值**：服务端只能经「磁盘发现 + header id 映射」解析路径，禁止用客户端传入值拼接路径；旧 v1 扁平文件留盘但不读取。

### 数据库

- 查询层统一经 `queryDb` 取 drizzle 实例，禁止绕过直接 `prepare`（迁移管线除外）；JSON 列（data / changes / metadata）一律 text 模式 + 行映射防御解析，**禁用 drizzle `mode:'json'`**。
- db 打开只有一条管道 = `packages/server/src/middleware/project.ts` 的 `openProjectDatabase`（开机 `detectProject` 与 `POST /project/open` 共用）；缺 `data.db` 的全新空库直接写 `SCHEMA_VERSION`（不重置 `outline.json`）。
- 写文件类迁移（`up(db, ctx)`）必须幂等（整文件重写）；JSON 提取查询必须带 `json_valid` 守卫（裸 `json_extract` 遇坏 JSON 会打挂整表查询）。
- 表结构声明单源（建表 SQL 与迁移 DDL 逐字同形，不按 `kind` 建表）；语义不同的数据各用**专属表**，禁止塞进 `entities` 或通用 kv 表。
- Delta 字段白名单单一定义 = `shared/src/constants/delta.ts`（`SET_ONLY_FIELDS` / `REMOVED_CHARACTER_FIELDS` / `IMMUTABLE_FIELDS`），client / tools 禁止手抄。

### 章级正文历史

- 快照记的是**被覆盖的旧内容**（保存钩子里把 `existing.content` 压入），当前内容永不进历史；节流（同一章最小间隔）与去重（内容未变跳过）**只在服务端**判定——客户端零改动，跨标签页天然一致。唯一执行点 = `packages/db/src/queries/document-snapshots.ts` 的 `insertSnapshotIfDue`。
- **恢复必须复用保存核心**（`routes/manuscript.ts` 的 `saveChapterContent`），且恢复前**强制**压当前内容（绕过节流但不去重）；禁止为恢复复制第二份保存逻辑——那会让码字统计、`base_updated_at` 冲突保护、投影派生三处逐渐分叉。
- 深度由**两个上限共同**决定：`MAX_SNAPSHOTS_PER_DOCUMENT` 与 `SNAPSHOT_BUDGET_MULTIPLIER`（预算 = 该书正文总量 × 倍数）。**两者必须同值同抬**——只抬一个会被另一个静默压回，表现为「历史莫名很短」且不报错。
- 快照表随 `data.db` 进备份 / 云端 / 导入导出（零额外代码）；**不做自动 `VACUUM`**（独占锁会撞备份 tick）。

### 云端存档

契约、协议与实测口径见 `docs/design/40-cloud-sync.md`、`docs/api/100-api-cloud.md`；实现侧单点：

- 凭据与同步状态唯一载体 = `<创作根>/.ai-editor/cloud.json`（不进项目文件 / 备份 zip / 任何 API 响应），读写唯一入口 = `packages/server/src/cloud/state.ts`。
- 变更判定只有一把尺子 `hasFileChangesSince`（备份 tick / 云端 `dirty` / 自动推送共用）；自动推送复用备份 tick 链，**不得新增第二套定时器**（`AUTO_PUSH_THROTTLE_MS` 是节流窗口，不是排程间隔）。
- 备份命名写入 = 解析，唯一实现 = `shared/utils/backup.ts`。**凭据不得进文件名段**：新增任何「用户文本进文件名」的入口都要挂同一守卫（写侧 `writeCloudConfig` / `writeBackup` / `renameBackup`，读侧 `configuredDeviceName` 把坏值当未配置）。
- 删书前若 `cloud.json` 有该书 book state → 先推送一份最新状态，失败默认中止（`force` 才继续）；不得绕过这套口径直接 `rm -rf` 书目录。

### API / 工具 / SSE

- 导出出口契约见 `docs/api/10-api-project.md`。实现侧单源：卷号 / 章号 / 文件名 / TXT 组装一律消费 shared（`outline-numbering.ts` 的 `numberVisibleOutline`、`orderVisibleChapters`、`sanitizeDocumentFileName`、`novel-export.ts`），服务端与客户端不得复刻；与服务端 `deriveChapterOrder`（含软删、保引用稳定）不是同一口径，不得互为替代。
- 关系端点适用性与说明的单源：`RELATION_TYPE_META[*].endpoints`（成对 `{from,to}`，缺省 = 通配，`"*"` 只在声明侧生效）与 shared `relationTypeAllowedFor` / `allowedRelationTypes`；它只收窄 UI 选单与 AI 提案，**服务端不新增端点校验**。`metadata` 归一一处 = shared `normalizeRelationMetadata`（POST / PUT / 工具执行侧共用，客户端不得手抄 trim / 删键）；客户端提交判定单源 = `lib/relation-types.ts` 的 `dialogRelationTypeAllowed` / `relationSubmitError`（`relation-submit-wiring.test.ts` 守接线）。
- 工具参数 schema 用 TypeBox，放 `packages/tools`（**不放 `shared`**：client 不打包 schema）；`execute` 抛错即失败；`propose_*` 的预览细节**只走 `details`**（随 `tool_execution_end` 帧下发），`content` 只给 `proposal_id` + 一句话摘要。
- 工作区类型（`kind`）的能力收窄与覆盖类写包入口校验见 `docs/design/60-practice.md` / `architecture.md`；实现上是 `ToolDefinition.scope` + 装配过滤（结构性边界，不靠提示词）。
- SSE 帧集与字段以 `docs/api/80-api-chat.md` 为准；唯一实现点 = `packages/agent/src/runtime/events.ts`，不得回退旧事件名。

### 数值单源

- 任何上限 / 缺省 / 阈值 / 档位常量**只在定义处出现**：散文与注释引用常量名，不复述数字；模型需要看到的数字必须由常量**插值**进工具 `description`，并有测试断言两者同值。
- 客户端派生（格式化 / 阈值 / 段优先级 / 热力档位 / 日历固定周数 `MONTH_CALENDAR_WEEKS` / 目标档位 `WRITING_GOAL_PRESETS` 与连续天数）同样单源：`client/src/lib/session-status.ts`、`client/src/lib/writing-stats.ts`、`client/src/lib/writing-goal.ts`；`--heat-*` 等 CSS 变量只定义在 `client/src/index.css`。

### 前端

- **`Dialog` 已换芯 antd `Modal`（2026-11）**：`components/ui/dialog.tsx` 只保留 API 壳 + 几何钉子（内边距 16 / 原 `grid gap-4` 搬到 `styles.body` / 浮层阴影 / 浅遮罩，后两个色值变量在 `index.css`），焦点陷阱与叠层 `Esc` 由 rc-dialog 提供——**不要自己再挂 `window keydown`**；但**焦点归还必须留在这一个文件里**（antd 的 `focusTriggerAfterClose` 在本仓拿不到触发器：模态内聚焦早于它保存 `activeElement`，实测关闭后焦点落回 `body`）。**弹窗宽度只能用 `DialogContent` 的 `width` prop（`DIALOG_WIDTHS` 档位）**：antd 无层 CSS 的 `.ant-modal { max-width }` 会压掉 `@layer utilities` 的 `max-w-*`。**确认框在途不可关**：`ConfirmDialog` 的 `submitting` 期间 `onOpenChange` 必须早退（判定单源 = 纯函数 `canCloseConfirm`），否则框没了、请求还在跑、失败文案无处落（正确写法先例 = `export-book-dialog.tsx` 的 `if (exporting) return`）。
- **错误条单源 = `components/ui/error-banner.tsx`**（`row` / `stack` 两布局；`onRetry` 缺省时不渲染按钮，非重试动作走 `actions`；**外边距一律由调用点 `className` 传**）。`lib/styles.ts` 的 `errorBannerClass` 已随收口删除，不得再起第二份手写错误条；`ErrorBoundary` 整页兜底 / `FeedbackHost` 全局横幅 / `compute-preview` 的「状态冲突」警示块不属本控件。
- **保存态文案单源 = `components/ui/save-status.tsx`**（`编辑中… / 保存中… / 已保存 · HH:MM` 四态；输入即 pending）：**九处**（章正文 / 参考资料 / 练习 / 自由练习 + 地点·伏笔·时间点·事件·人物五类详情，`EntityDetail` 一组件服务前三类）只传状态与时刻，不各写一份 span。详情页的 `pending` 必须复用**守卫那一份 dirty**（不另算一套）、进页恒 `idle`、`saved` 只用本地时刻（不得拿服务端 `updated_at` 冒充）。手动保存（按钮 / `Ctrl/Cmd+S`）成功 `showToast("已保存", "success", "save")`，自动保存**不弹**；存档三条提示用**同一个 `key: "save"`** 升级同一条（`stores/ui.ts` 的第三参 → `message.open`），否则一次快捷键会叠两条。
- **样式 primitive 单源（2026-11）**：区块卡一律 `components/ui/section-card.tsx`（`card` = 8px 圆角 + `section-title` 16px，别手写 `rounded-md border border-border p-4` + `<h2 className="text-sm font-semibold">`）；可点内联引用 = `components/ui/ref-chip.tsx`（第三种 chip：`TagChip` = 用户数据 / `TypeChip` = 枚举结构 / `RefChip` = 可点，`to` 渲染 `<a>`、`onClick` 渲染 `<button>`、两者可共存以表达「先过守卫再跳」）；卡形加载占位 = `components/ui/skeleton-block.tsx`（**圆角必须与 `SectionCard` 同档**——两者不同改就是「加载完成瞬间跳一档」，而测试与类型全绿）。UI 文案里的行内链接走 `inline-link`（墨字 + `hover:underline`，**不建组件**；`Link`/`colorLink` 只服务正文/富文本）。**错误文案两个 primitive**：字段级（可就地指明哪个字段）= `components/ui/field-error.tsx`（12px，挂在字段下、提交时聚焦该字段）；保存失败（只能说明没存上）= `components/ui/save-error.tsx`（14px，区块 / 弹窗底部）。两者只差字号档与落点，语义不得互换；归并按语义走，字号随落点档位，不为了凑档位改观感。**错误文案色单源 = `text-error-text`**（`index.css` 的 `--error-text`，深浅两态每个底都 ≥ 4.5:1，`antd-tokens.test.ts` 直读 CSS 断言）：`colorError` 只管危险按钮 / 警告图标等**面与图标**，**不要**再拿 `text-destructive` 写错误文案（测得浅色灰底 4.14:1、深容器 3.61:1）。家族类串由 `design-discipline.test.ts` 的 `ref-chip-shell` / `skeleton-block-shell` 锁在唯一实现里（后者正则与圆角无关，换档后新抄的同样会被拦）。
- **每日目标与连续天数**：口径单源 = `client/src/lib/writing-goal.ts`（严格连续 / 写作日集合 / **今天未达标不算断签** / 空集合按全勾），组件不得另写一遍；目标与写作日是**本机偏好**（`ai-editor:writing-goal:{projectId}`，按书隔离，不进备份 / 云端 / 项目文件），**不新增表与端点**。`GET /writing-stats` 在写作页是第二个消费点，**只允许两个触发点**（进页 + 保存后节流，窗口 = `WRITING_PROGRESS_REFRESH_MS`，基准必须是「保存触发的刷新时刻」——拿进页那次请求当基准会把进页后的保存全吞掉）；达成反馈只做内联（数字主色 + `✓`），不弹 toast / 不发系统通知。
- **本机配置文件表单写入只有一条路** = `PUT /settings/config-file/:name`（表单只负责拼文本，不自建写入 / 不新增 typed 端点）；jsonc 解析与注释计数单源 = shared `utils/jsonc.ts`（与 pi 读口径同语义，`"disabled"` 等 pi 合法但表单不表达的写法一律判解析失败并指路 JSON，不静默改写）。
- **离开守卫（2026-11 收口，全站）**：任一草稿源 dirty 时，离开页面（页内切换 / 左栏导航 / 浏览器后退）先确认。机制单源 = `lib/leave-guard.ts`（模块级单槽 + **同一时刻只允许一个在途确认**）+ `hooks/use-unsaved-guard.ts` 的 `useUnsavedGuard(dirty, confirm)`（内部注册模块槽，**后退 handler 一律走 `confirmLeave()`** ⇒ 调用点不可能漏掉共享在途槽；旧 `useLeaveGuard` / `useBackGuard` 降为内部实现，调用点禁用）。**注册者恒为 1 = 持有脏表单的叶子组件**（`EntityDetail` / `OutlineDetail` / `TimelineDetail` / 设置页）；壳（`Outline` / `SettingWorkbench`）**不得注册**，页内动作改调 `confirmLeave()`，`onDirtyChange` 只上报供宿主行为（如 `notifyDataChanged` 抑制）。`LeaveGuardContext` / `useRegisterDirty` 仍服务设置页七处草稿源（新增草稿源必须报到，漏一处 = 静默丢稿，`settings-leave-guard.test.ts` 有源码守卫）；`config-file-editor` 按**四个文件槽全量**判脏，不是当前槽位。关窗 / 刷新与「更改书库位置」（直接重启）不在范围内。
- **在途读计数单源 = `lib/inflight.ts`**（`beginRead` / `endRead` + `useSyncExternalStore` 订阅；生产方唯一 = `apiFetch` 的 `GET`，消费方唯一 = `MainToolbar` 刷新按钮）。**只数读**——写操作（保存 / 导出 / 备份 / 云推拉）另有 `saving` / `busy`，混进来会让刷新按钮在保存时也转圈；**也不要再在各页上报 `loading`**（GET 就是「读」的唯一定义，页面级布尔必然漂移）。长任务反馈口径见 `DESIGN.md` §Components `long-task`（真信号 + 已用时，**不做假进度**）。

- 任何切换当前项目的端点之后，客户端必须收敛项目镜像（重拉 config + outline + 书架）——服务端 `currentProject` 是单例事实源，客户端只是镜像。
- 同一路由组件的「形态」状态也是状态：`Dashboard` 的 `mode` 在 `#/` ↔ `#/overview` 之间不重挂载，凡 `if (mode !== "overview") return` 的 effect 必须把 `mode` 写进依赖数组。
- 开机直达书籍只在 `hooks/use-enter-last-book.ts` 做首帧一次；勿在 Dashboard / AppShell 加常驻重定向（会把「回书架」弹回去）。
- **改色唯一入口** = `AntdProvider.tsx`（同步 `DESIGN.md` 登记表）；块编辑器 `--bn-*` 映射唯一入口 = `components/blocknote/blocknote.css`；守卫 = `design-discipline.test.ts` + `components/antd-tokens.test.ts`，新增 antd 组件先扩 token 守卫。
- antd 组件会给 `.ant-btn` 注入 `position: relative`（与 Tailwind `.absolute` 同特异性、antd 注入更晚）⇒ 定位一律挂外层包装 `div`，不写在 antd 组件 `className` 上；危险色图标按钮写 `color="danger" variant="text"`。
- antd `Input` 会给 `.ant-input-affix-wrapper` 注入 `min-width: 0`（同样后注入、覆盖 Tailwind `min-w-*`）⇒ 弹性最小宽一律挂外层包装 `div`，直接写在 `Input` 的 `className` 上会被压成 0 宽。
- 缩进列几何依赖 antd `controlHeightSM`：占位 / 摘要 / 标签 / 就地新建行复用同一条占位链（不手写 `pl-*` 像素），折叠箭头恒 `RightOutlined` + `!collapsed && "rotate-90"`（`antd-tokens.test.ts` 有该值断言）。
- 块编辑器升级 = 显式 commit + 全量测 + 浏览器像素核对；禁 `@blocknote/xl-*`；`server` / `tools` / `db` / `agent` 不得依赖 `@blocknote/*`（服务端不解析块结构）。
- `Ctrl/Cmd + S` = 保存当前内容 + 生成本地存档：键位常量 = `client/src/lib/save-shortcut.ts`；动作走 `registerSaveHandler` 注册栈（后注册者优先）；存档唯一注册者 = `AppShell` 的 `useSaveArchive`；页面保存失败必须 `return false`（阻断存档）。
- 整栏快捷键 = `Ctrl/Cmd+B` / `Ctrl/Cmd+Shift+B`：判定单源 = `client/src/lib/panel-shortcuts.ts`（可编辑区不抢键，块编辑器保留 `Mod+B` 加粗），接线在 `AppShell`；设置页「快捷键」清单与顶带两角开关同源，不得各写一份键位。
- **大纲页（master-detail）实现侧**：大纲只拉一次（页面壳持有 `useOutlineLoader`，`OutlineDetail` 不自拉，`node` 由壳 `findNode` 派生传入）；选中唯一来源 = URL `#/outline/:nodeId`（`#/outline` 无选中）；detail 的 `useDataRefresh` 只刷关系 / 变更记录，**不得再 `reload()` 整树**；未保存守卫 = rail / 空白区 / 窄屏返回条 / 详情页头「写正文」外链（普通左键走 `onNavigate` → 壳 `confirmDiscard`；修饰键 / 中键保留浏览器原生新标签页），**浏览器后退也拦**（哨兵历史条目，单源 `lib/back-guard.ts` + `hooks/use-back-guard.ts`）；拖拽落点单源 = `lib/outline-tree.ts` 的 `resolveDropPlan`（目标行父合法 → 同级前后；父不合法但目标行自身可承载 → `inside` + 子级末尾，覆盖空 / 折叠 / 非空卷章；卷 → 卷仍同级），页面不得另起判定；树筛选（状态 / 剧情线）判定单源 = 同文件 `filterOutlineNodes`，**组件态不持久化**，生效时必须「整树强制展开 + 禁拖拽 + 编号恒按全树」（三条缺一就会出现「筛了像没筛」/ 落点歧义 / 编号前移）；rail 宽度 / 收起态 key `ai-editor:outline-rail`。**首屏只展开卷的判定单源 = 同一文件的 `initialCollapsedNodes` / `OUTLINE_AUTO_COLLAPSE_NODE_LIMIT`，且必须在渲染期派生（`userCollapsed ?? autoCollapsed`）——用 state + effect 事后收起会先把整棵树挂上再收回（千章书实测白渲染 ≈1.3s）**。契约见 `DESIGN.md` `outline-page`。
- **大纲画布实现侧**：拖动只改坐标，不改父子 / 章序 / 卷归属（结构编辑唯一入口仍是大纲树）；坐标与视口只存本机 `ai-editor:canvas:{projectId}`（展示层偏好，不进项目文件 / 备份 / 云端，key 与形状见 `config.md`）；缺失坐标的补位布局单源 = `lib/outline-canvas-layout.ts`（页面不得另起摆位；**卡片高度 `canvasCardHeight()` 与行距都在这一个文件里派生**，页面不得写死 68 / 92 / 116）；LOD 只有两档、阈值与 `canvasLodLevel()` 同源（不新增中间档；far 档 = 章名 + 左上角纯数字章号，第N章徽标 / 第三行 / 伏笔徽标隐藏）；筛选是组件态（`lib/outline-canvas-filter.ts` 的 `matchCanvasChapterFilter` / `applyCanvasFilter`，三维同一对象：卷 / 状态 / 剧情线，同维 OR、跨维 AND）——不写 localStorage、不进 URL、不重排卡片、不删节点（跨卷连线与位置记忆都依赖节点仍在）；只引 `@xyflow/react/dist/base.css`，`--xy-*` 唯一映射 = `components/outline-canvas/canvas-theme.css`。契约见 `DESIGN.md` `outline-canvas`。
- **章的结构化字段**：枚举与文案单源 = `shared/src/constants/outline.ts`（`OUTLINE_STATUS` / `CHAPTER_FUNCTIONS` / `CHAPTER_TENSIONS`），标签校验 = `shared` 的 `nodeTagsSchema`（章与场景共用，`trim` / ≤24 字 / ≤5 条）；表单控件单源 = `components/ui/tags-editor.tsx`（实体页与章详情共用，不要再抄一份）；保存前标签归一 = `lib/outline-detail.ts` 的 `normalizeOutlineDataForm`（`TagsEditor` 允许末行留空以便续输，空串直接提交会被服务端 400），dirty 判定也走同一归一；缺省 `status = "draft"` 与缺省等价（表单不得因默认值立刻判 dirty）；章行标签预览与画布卡片共用取数单源 = `lib/outline-tags.ts` 的 `outlineTagsFromData` / `previewOutlineTags` / `OUTLINE_TAG_PREVIEW_LIMIT`，树行只读、不新增交互。
- **设定页（master-detail）实现侧**：壳 = `pages/SettingWorkbench`，`SettingRail` 不自持选中（`nodeId` prop + `onSelect`，**选中唯一来源 = URL**）；树内写操作成功后经 `onMutated` 通知宿主走 `notifyDataChanged()`，**详情 dirty 时不发**（不得静默重置表单）；详情收起 = 整列不渲染且不改存宽度、点行不自动展开；rail 默认宽 / 边界 / 持久化 key 只在 `hooks/use-setting-rail.ts` 定义（窄屏两级互斥）。契约见 `DESIGN.md` `setting-page`。
- **工作台子栏页头单源 = `components/ui/panel-header.tsx`**（仅写作 / 大纲 / 设定的两列）：标题行 40 + 元信息行 24 + 分割线（`PageDivider` 必须是 header 直接子节点、横向内距挂 `insetClassName`，否则线两端内缩）；rail 头 `mb-0`、详情头 `-mx-6` + `insetClassName="px-6"`；操作一律 24px 图标、保存是唯一 `primary`；子栏面板开关唯一实现 = `components/ui/panel-toggle-button.tsx`（外端锚定：最左可见列 `leading` / 最右可见列 `actions` 末尾；rail 头承载开关时同样 `px-6`）。契约见 `DESIGN.md` §Layout「工作台子栏页头」。
- 聊天链路：SSE 解析唯一实现 = `hooks/use-sse.ts`；store 的 loadSeq / msgSeq 竞态、事件级流身份守卫、中止在途 SSE 的约定不得回退；工具行归一唯一入口 = `ChatPanel` 的 `asToolCall`。**停止生成 = store 的 `stopStreaming()`**（与断连同一条取消链路，本轮**不会收到 `agent_end`**）：必须**先折叠思考块再作废流身份**（顺序反了 patch 会被自己的身份守卫挡掉，思考块永久展开）；半截正文保留，运行态工具表 / 未确认提案清空。
- **工具行 = 每条 assistant 消息一条 `@ant-design/x` `ThoughtChain`**（`items` 顺序 = 调用顺序）：状态轴**只标进行中 / 失败**（成功回落序号，不整轮染绿）；**不用 x 的 `collapsible`**（它的折叠头是 `div onClick`，无键盘语义）——折叠头是我们自己的 `<button aria-expanded>` + 条件 `content`；来源卡片进**恒显的 `footer`**（不新增第二处挂载点），无卡片时不传 `footer`（空槽位白占一行高）。契约见 `DESIGN.md` `tool-row`。
- **正文 markdown 流式口径单源 = `ChatPanel` 的 `MARKDOWN_STREAMING` / `MARKDOWN_DONE`**（`hasNextChunk` 跟随尾条流式 + `incompleteMarkdown: 'complete'`）；**不用 `streaming={true}` 布尔预设**（会一并打开 `typewriter` / `incremental`，与 delta 到达叠成双动画）。
- 提案 UI：`PROPOSAL_TYPE_LABELS` 必须覆盖 `PROPOSAL_TOOLS` 全集；历史只读卡从 `toolCalls` 重建并按 `toolCallId` 与 live 去重，不新增表 / API。
- 推演标记提交基底必须用可见标记（`lib/deduction.ts` 的 `toggledDeductionNodes`）——拿 raw `config.deductionNodes` 回传会把失效 id 送回服务端，严格 400 会让该书标记操作永久锁死。
- 写作面：工具条不得自任滚动容器（`sticky` 已是库 tooltip / 下拉的包含块）；高度链三处接通，中间不得用 `items-start` / `self-start` 截断（下游 `flex: 1` 拿不到剩余高度）。
- 新增练习页 = 三处同改：`components/nav/nav-items.tsx` 项集 / `lib/workspace-route-guard.ts` 的练习首段常量 / 「练习区无回收站、无概览」前提。
- 文本文件导入（范文等）必须走 `readTextFile`（UTF-8 → GB18030 回落，禁 `file.text()`）。
- 桌面能力检测唯一入口 = `client/src/lib/desktop.ts` 的 `desktopBridge()`（浏览器形态 / SSR 返回 null）；禁止在组件里直接摸 `window.aiEditorDesktop`。
- 泛型 `EntityList` / `EntityDetail` **已冻结**：不再承载新能力——列表只服务 location / relations，详情只服务 location / hook / timepoint 详情段与设定详情（由 `SettingWorkbench` 壳承载）；人物 / 设定 / 大纲页是自有工作台，见 `DESIGN.md`。
- 品牌与图标资产：`packages/client/public/provider-icons.svg`（供应商 logo）与 `client/public/brand-icon.svg`（系统面负形版，兼 favicon 与桌面图标源）的用法见 `DESIGN.md` / `50-desktop.md` §5.3；不要引入 `@lobehub/icons`，也不要另存图标副本。

### 桌面版

设计契约见 `docs/design/50-desktop.md`；实现侧不可省：

- preload 必须 CJS（源文件 `preload.cts`，`sandbox: true` 是既定基线），主进程 ESM；服务走主进程 in-process `startServer()`（不开子进程），退出复用 `ServerHandle.close()`；窗口加载 `http://127.0.0.1:<实际端口>`，**端口分段单源 = shared `constants/ports.ts`**（server / `vite.config` / desktop 全部派生，禁止复述字面量）。
- 应用级配置唯一载体 = `<userData>/desktop.json`；桌面包不得依赖 `process.cwd()` / 命令行参数；日志落 `<userData>/logs/ai-editor.log`；**preload 能力面 = `pickDirectory()` / `getLibraryRoot()` / `changeLibraryRoot()` / 关窗落盘的 `onFlushRequest()` / 缩放的 `getZoomState()` + `setZoom()` + `onZoomChanged()`**（不暴露 fs / shell / ipcRenderer 原语）。
- **退出必须经 flush 通道**：关窗先拦一次、请渲染侧落盘（`desktop:flush-request` / `desktop:flush-done`，成败判定单源 = `client/src/lib/desktop-flush.ts` 的 `flushSucceeded`），**不得在 `before-quit` 里抢跑 `closeServer()`**——落盘要打 HTTP，服务端得活到那时（菜单「退出」下 `before-quit` 先于窗口 close）；因此 `before-quit` **只在无窗口时**才关服务端，判定单源 = `quit-sequence.ts` 的 `shouldCloseServerOnBeforeQuit`。
- 打包不可省：`pnpm deploy --prod` + `npmRebuild: false` + 显式 `linux.executableName`（scope 名里的 `@` 会被 AppImage 工具链拒收）；Electron 42+ 无 postinstall（懒下载，install 阶段不要依赖它存在）。
- `electron-updater` 是 CJS ⇒ 必须默认导入 + 解构（具名导入在打包态直接崩、typecheck 不报）；只在 Windows 安装态、用户确认后先 `await closeServer()` 再 `quitAndInstall(true, true)`。
- 升级路径守卫不可回退：`installer.nsh` 的 `customUnInstall` 开头保留 `${If} ${isUpdated}` / `${If} ${Silent}` 早退（漏掉会在升级时弹「清除使用数据」）。卸载清理删目录前**必须先验签名文件** `<书库>/.ai-editor/library.json`——书库目录名是通用名，按名 `RMDir /r` 会误删用户自建的同名目录；`<userData>` 存在性检查用 `desktop.json`。
- 打包分工：本地只打 Linux 包自查，Windows 包只由 CI 出（本地交叉需 Wine）；workflow 不写 pnpm `version`（从根 `packageManager` 读）。
- **界面缩放的写入口只在主进程**：键位（`Ctrl/Cmd + = / - / 0`，`before-input-event` + 纯函数 `zoomKeyIntent`）、应用菜单、设置页「通用 → 界面缩放」卡三者都落到 `applyZoom`；档位阶梯单源 = `desktop/src/zoom.ts` 的 `ZOOM_FACTORS`（菜单与卡片都不得写百分比字面量）。渲染层只经三个 preload 能力接触缩放：`getZoomState()` / `setZoom("in"|"out"|"reset")`（**只收意图、不收数字**；端点由主进程下发 `atMin` / `atMax` / `atDefault`）/ `onZoomChanged(handler)`；**三个 handler 的注册点必须在 `loadURL` 之前**（`AppShell` 开机即订阅）。比例显示面**只两个**（卡片常驻 + 变化 toast，同 `key: "zoom"`；「快捷键」tab 不显示）；**client 禁止拦这三组键**（浏览器形态交给原生缩放，设置页清单只是 `desktopOnly` 展示）。缩放**只能在 `did-finish-load` 里设**（`loadURL` 前是空操作、每次导航都会重置），窗口 `show: false` 到那次重放之后再显示；`desktop.json` 的 `zoom` 是**必填**键——`writeDesktopConfig` 整对象覆写，任何新增写入点漏带就是「缩放静默重置回 100%」，且不报错。

### 测试与验证

- 各包 `test` script = `vitest run`；各包 tsconfig 已 `exclude: ["src/**/*.test.ts"]`，不要改回——**`*.test.ts` 不进 `pnpm typecheck`**，编译期断言（`satisfies` / 穷尽性检查）必须写在 src 模块里；`.test.tsx` 仍会被 typecheck（有意保留）。
- 改 shared / db / tools 的 `src` 后先 `pnpm -r build` 再 typecheck / 下游测试（下游读上游 **dist**，不重建会给假绿）。
- **排序键必须平台无关**：`localeCompare` 的结果取决于 ICU（Windows zh-CN）与 C locale（Linux/CI）——
  凡进入**断言**或**接口契约**（列表返回顺序）的排序一律用码元比较（`a < b ? -1 : a > b ? 1 : 0`）或 ASCII 键；
  中文名排序只允许出现在纯展示层，且不得被测试固定。已因此红过两次 CI（v0.0.66 前后各一次）。
- 变异 / 探针验证只能用 `cp -r` 真副本或 `git worktree`，禁止硬链接副本 + 就地截断写（会写穿 inode 污染源仓库）；恢复后复跑全量回归。**本机不要在 `git worktree` 里跑验证**：新检出没有根 `node_modules` 与 `packages/*/dist`（都在 `.gitignore`），`pnpm -r exec` 直接拒跑（`ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH`），补齐要 `pnpm install` + `pnpm -r build`——顺序卡因此在 main 里单写者执行，worktree 只用于临时隔离改动本身。
- **测试沙箱必须同时设 `HOME` 与 `USERPROFILE`**（Windows 的 `os.homedir()` 只读后者；只改 `HOME` 会让用例静默读写真实 `~/.pi/agent` / `~/.ai-editor/pi-agent`）。已内置 `expect(homedir()).toBe(tmp)` 守卫的 6 个文件：`routes/{chat,settings,kind-guard,practice,smoke}.test.ts`、`web-search.test.ts`；新建靠家目录隔离的用例照抄该三行。Windows 本机剩余的既有红（`EPERM` / `0600` / 本地 WebDAV 403 / 端口占用）见 `backlog.md`「开发环境」——**不能当基线**。

## 产品非目标与延期项

- 非目标（理由见 `docs/design/00-master-design.md`「批量导入边界」）：不做超长小说正文生成、不做批量拆解导入——重新引入前必须先改设计文档。
- 延期项与有意口径：`docs/design/backlog.md`（多标签页、undo、token 聚合面、跨书参考资料导入等）。

## 仓库与目录

`docs/`、`scripts/`、`test-project/` 在仓库根；包内路径相对 `packages/`。`test-project/` 整体不入库（含运行时生成的 `.ai-editor/config.json`）；创作根 `.ai-editor/config.json` 只属服务端（`debug` 用户手编、`lastProject` 服务端在 open 成功后合并写入，见 `config.md`）。
