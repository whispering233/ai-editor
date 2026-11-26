# 配置说明（config）

> 索引式：字段/格式契约指向对应文档，本文件只回答「有哪些配置载体、在哪个目录、谁读写」。铁律：**模型 API key 绝不写入项目文件**（project.json / outline.json / data.db / sessions/ / 备份 zip 天然不含 key）——代码与数据物理隔离。

## 1. 本机级（跟用户账号走，不随书、不进备份 / 导出 / 云端）

| 载体 | 内容 | 读写方 |
| :--- | :--- | :--- |
| `~/.ai-editor/pi.json` | **本项目唯一的本机级配置文件**。`agentDir` = pi 配置目录（绝对路径；键缺失 / 空串 = 默认 `~/.ai-editor/pi-agent`）。未知键忽略；文件不存在 / 非法 JSON / 结构不符 → 一律按缺省 | server 包 `src/pi-agent-dir.ts`（**唯一读写入口**）；`agentDir` 由设置页写 |
| pi 配置目录（缺省 `~/.ai-editor/pi-agent/`）的 `auth.json` | 各 provider 凭据（API key / OAuth）；**一家一条**，值可以是字面 key、`$ENV_VAR` 引用或 `!命令`（pi `resolveConfigValue` 语义）。**存量凭据优先**：仅当该家在 auth.json 无条目时才回落到 provider 内置环境变量（`DEEPSEEK_API_KEY` 等）——环境变量是兜底，不是与凭据并存的第二个来源 | pi 凭据存储；本仓经 `ModelRuntime` 读写；设置页写入 = 唯一写入口 |
| 同上目录的 `models.json` | 自定义 provider / 模型覆盖（baseUrl、api 形态、模型元数据、`$ENV` 取值） | pi `models.json` 语义；本仓经 `ModelRuntime` 读；写 = 设置页「高级 → 自定义模型」表单或 JSON 编辑器（同一端点；写前滚动备份 `models.json.bak`，备份失败不改主文件） |
| 同上目录的 `settings.json` | 模型与运行参数：`defaultModel` / `enabledModels`（可见模型作用域）/ 重试（`retry`）/ 压缩（`compaction`）/ 思考预算（`thinkingBudgets`）/ 出站代理与空闲超时 | pi settings；本仓经 `SettingsManager` 读；写 = 设置页「高级 → 运行参数」只写 `retry.enabled` / `compaction.enabled` / `httpIdleTimeoutMs` 三键，其余经 JSON 编辑器（同一文本端点） |
| 同上目录的其余内容（`models-store.json`、`themes/`、`prompts/`、`tools/`、`bin/`、`debug.log`） | pi 自有的缓存与资源目录 | pi 自用，本仓不读不写 |
| `~/.ai-editor/search.json` | **联网搜索 / 网页抓取的凭据**（可选文件）：`apiKey` = 字面 key（缺失 / 空串 = 未配置；坏 JSON = 整份忽略）。**唯一来源、无回退**：不读模型凭据、不读环境变量；当前只接入 DeepSeek 的 `tools/search` 与 `tools/fetch` 两个端点。由设置页「高级 → 联网搜索」的单字段表单写（空串 = 未配置；写入仍走配置文本文端点，服务端 strict 校验）；同页 JSON 编辑器保留为兜底 | server 包 `src/search-config.ts`（唯一解析点）；消费方 = `web-search.ts` / `fetch.ts` |
| `<userData>/desktop.json` | **桌面版专属**应用级配置：`projectRoot` = 书库位置（绝对路径）、`zoom` = 界面缩放 factor（缺失 / 不在 `ZOOM_FACTORS` 阶梯上 → `1`；设置页「通用 → 界面缩放」可改，但写入口仍只在主进程的 `applyZoom`；阶梯与键位见 `50-desktop.md` §4.1）。创作根属于「部署级」——不能存进它自己的 `.ai-editor/config.json`（鸡生蛋）；CLI 形态**永不读取**（创作根由启动参数决定）。平台路径 = Windows `%APPDATA%\AI Editor\` / macOS `~/Library/Application Support/AI Editor/` / Linux `~/.config/AI Editor/` | 桌面版 `packages/desktop`；语义见 `50-desktop.md` §2 |
| `<userData>/logs/ai-editor.log` | 桌面版主进程 console 输出（含服务启动日志）；GUI 用户没有终端，这是唯一排障线索 | 桌面版 `packages/desktop`；见 `50-desktop.md` §2 |
| 启动参数 `projectRoot` + 环境变量 `AI_EDITOR_PORT` | 创作根目录 / 服务端口覆盖（仅 bin 直接执行入口读取）；**默认端口按形态分段取**（shared `PORT_RANGES`：桌面端 / web 生产 / web 开发三段互不相交），覆盖即绕过分段隔离 | `build.md` §端口策略 |
| 浏览器 localStorage | 展示层偏好，不进数据文件：主题 `ai-editor:theme`、三栏面板 `ai-editor:panels`、写作偏好 `ai-editor:writing`、提案自动确认 `ai-editor:yolo`、设定树描述开关 `ai-editor:setting-desc`、码字悬浮面板位置 `ai-editor:stats-panel`、写作页卷章导航栏 `ai-editor:writing-rail`（`{ width, collapsed }`，宽度 200–480px）、写作页最近打开 `ai-editor:writing-last-opened`（`{ [projectId]: chapterId }` 的 per-book 映射；只存 id，不存正文）、码字目标 `ai-editor:writing-goal:{projectId}`（`{ goal, enabled, writingDays }`；按书隔离；`writingDays` = 0–6 的周序号集合，缺省全勾；目标与连续天数的口径见 `../api/130-api-writing-stats.md`）、大纲画布 `ai-editor:canvas:{projectId}`（`{ version: 3, nodes: { [nodeId]: { x, y } }, viewport?: { x, y, zoom } }`；按书隔离；v1 / v2 旧条目读侧整体丢弃一次——卡片高度与行距改过，旧摆位不再匹配；仅摆位、删章后由页面清理）（仅此十个 key；`stats-panel` 只存面板位置，不存会话数字） | `docs/ui/DESIGN.md` |

**pi 配置目录的落地方式（单点）**：生效目录 = `pi.json` 的 `agentDir`（键缺失 / 空串）→ 缺省 `~/.ai-editor/pi-agent`；服务启动最早期把它写入 `process.env.PI_CODING_AGENT_DIR`（pi 官方覆盖点，`pi-coding-agent` `dist/config.js` 的 `getAgentDir()`）——本仓**不**从父进程继承的环境变量里取值（这个变量是输出，不是输入）。此后 pi 的**一切**路径都从它派生（凭据 / 模型 / settings / 缓存 / 资源目录），所以只有这一个开关，不存在逐调用点传参。桌面版、CLI 形态、浏览器形态共用同一个默认值，**与用户自己的 pi CLI 配置目录（`~/.pi/agent`）完全隔离**：这里没有的凭据就是没有，pi CLI 那边的扩展 / 会话 / 缓存也不会流进来。

**环境变量是第二来源，不随目录隔离**（pi 语义，本仓不干预）：目录里没有该家凭据时，pi 会去 `process.env` 找 provider 内置变量（`DEEPSEEK_API_KEY` 等，名单在 pi 的 provider 定义里），设置页把这种来源标为「环境变量」。影响：shell 里 export 过 key 时浏览器形态显示「已配置」，而**双击启动的桌面版通常看不到 shell 环境变量** → 同一台机器上两种形态可能不一致；要让文件成为唯一来源，就在 `auth.json` 里写一条（存量优先）。**禁止**在启动时删除进程里的 provider 环境变量（2026-11 决策）：那等于自建一套凭据语义，且 docker / CI 用 env 注入的方式会直接失效。

**首次启用新目录**：新目录是空的（没有凭据 / 模型覆盖 / 参数）——**不做任何拷贝与迁移**，用户自己在设置页重新配置（新写入自然落在 `~/.ai-editor/pi-agent`）。用户旧 `~/.pi/agent` 目录一个字节不动，pi CLI 不受影响；想沿用旧配置就把 `agentDir` 改成 `~/.pi/agent`（或反过来把 `PI_CODING_AGENT_DIR` 指过来共用一份）。

## 2. 创作根级（`<创作根>/.ai-editor/`，agent 在各本书之间共用）

| 载体 | 内容 | 读写方 |
| :--- | :--- | :--- |
| `<创作根>/.ai-editor/config.json` | 创作根级偏好（不进项目文件）：`debug` 段 = 调试日志开关 `{ "debug": { "enabled": true, "categories": [...] } }`，四类别 chat/request/usage/http；categories 缺失 = 全部、enabled 缺失/false = 全关；文件不存在/非法 JSON/结构不符 = 全关。`lastProject` = 上次成功打开的项目目录（绝对路径），启动时自动恢复（见 `build.md` §启动流程），open 成功后由服务端合并写入（原子写 + 保留其他字段；写入失败不影响打开结果） | server 包 `src/debug.ts` / `src/last-project.ts` |
| `<创作根>/.ai-editor/cloud.json` | **云端存档**账号配置与同步状态（不进项目文件）：`webdav` 段 = `url` / `username` / `password`（**应用密码，明文存储 + 文件权限 0600**）/ `device`（设备名，缺省 = 简化 hostname：去域名后缀、滤非法字符、剥首尾空白与 `_`、截 16 字符）；`autoPush` = 自动推送开关（**本机级**，缺省关）；`books` = 按 `project.id` 记 `dirName` / `lastPushedFileName` / `lastSeenHeadFileName` / `lastSyncAt` / `lastSeenCloudFiles` / `lastAutoPushAt`（旧文件里的 `baseEntries` 读侧容忍、已不再写）。**任何 API 响应永不回传 password** | server 包 `src/cloud/`；语义见 `40-cloud-sync.md`，端点见 `../api/100-api-cloud.md` |
| `<创作根>/.ai-editor/library.json` | 书库**签名文件**（桌面版卸载器只删带它的目录，防误删用户自建的同名目录） | 桌面版 `packages/desktop`；见 `50-desktop.md` |

## 3. 项目内（随书移动，进备份 / 导出）

| 载体 | 内容 | 读写方 |
| :--- | :--- | :--- |
| `project.json` | id/name/language/**kind**（工作区类型：`novel`（缺省）/ `practice`，缺省即旧文件兜底）/**author_id**（仅练习工作区：预置作家 id）/schema_version/current_position/backup_frequency_minutes（自动备份频率枚举 1/5/10/15/30/60，null/0 关闭，缺省 10）/**deduction_nodes**（推演节点标记） | `docs/db/schema.md` |
| `AGENTS.md` | 项目规则唯一事实源（取代废弃的 `project.json` `prompt`）：设置页直编 + 文件管理器直接编辑（mtime 检测外部修改） | `docs/design/20-context.md` §4；端点 `docs/api/10-api-project.md` |
| `data.db` | 实体 / 关系 / 变更记录 / 章正文快照等（含迁移版本） | `docs/db/schema.md` |
| `.backups/` | 备份产物 `<时间戳>-<手动\|自动>-<设备>…zip`（命名单源 = shared `utils/backup.ts`） | `docs/api/20-api-backup.md` |
| `sessions/` | 对话历史（一 session 一 JSONL，格式 = pi session v3）——**纯本地目录**：不进备份/导出/云端，恢复类操作不写不删（见 `docs/design/10-data-model.md` §10） | `docs/db/schema.md` |

## 4. 读写边界

- pi 配置目录内的一切由 pi 负责落盘格式；本仓经 pi 的 `ModelRuntime` / `SettingsManager` 读写，**不维护第二份配置**、不直读 `auth.json` / `settings.json`。唯一例外是下方的配置文件编辑器（见 `../api/90-api-settings.md`）——它按文本读写 pi 目录下的文件，仍不解析语义。
- `~/.ai-editor/pi.json` 只属服务端：唯一键 `agentDir`（设置页写）；合并写（原子写 + 只改本键，未知键原样保留）。
- 联网检索与抓取（`web_search` / `fetch_content`）的凭据唯一载体 = `~/.ai-editor/search.json` 的 `apiKey`：**不复用模型凭据、不读环境变量、无回退**——没配就在工具调用时抛可读错误（不静默失败）。当前仅接入 DeepSeek 的 search / fetch 两个端点（按次计费，不进会话 token 账目；查询词 / URL 会发往 DeepSeek）。
- 项目目录内的 `.pi/`（项目级 settings/extensions/skills）**一律不参与配置**：资源加载显式关闭扩展/技能/提示词模板，且项目信任为 false——项目目录可能来自他人（备份包/共享目录），不接受其中携带的可执行资源或配置。
- 项目文件（project.json/outline.json/AGENTS.md）走原子写；`sessions/` 由 pi `SessionManager` 追加写（整文件重写仅限迁移）。
- 创作根 `.ai-editor/config.json` 的键都属**服务端**：`debug` / `lastProject` 由用户手编也行，但 `lastProject` 由服务端在 `POST /project/open` 成功后合并写入（写前先读、只改本键，不碰其他键）；未知键一律忽略。
- 创作根 `.ai-editor/cloud.json`（**独立文件，不并入 config.json**）：凭据与偏好分离——`config.json` 的语义是「用户可手编」且常被贴进 issue，凭据物理上就该在另一条路径上；`0600` 权限只需加给一个文件。由设置页端点写入（`PUT /api/v1/cloud/config`）；文件内容属服务端，用户不需要手编。**云盘凭据与模型 API key 同等对待：绝不进项目文件、不进备份 zip、不进任何 API 响应、不进备份文件名段**（后者：设备名/备份标签等于应用密码 → `PUT /cloud/config` 与两个备份写入端点一律 400；存量坏设备名读侧按未配置处理，见 `40-cloud-sync.md` §7）。
- 桌面版 `<userData>/desktop.json` 只属外壳进程（不由 server 读写、不进项目文件/备份 zip/任何 API 响应）；设置页「书库位置」的展示值由外壳经 preload 下发，不新增服务端端点。

## 可配 / 不可配边界（判据）

**判据：配错会导致「无界成本」或「静默失控」的数值不给用户配。**

- **可配**（pi settings）：模型与可见模型作用域、重试次数与退避、压缩阈值（`reserveTokens`/`keepRecentTokens`）、思考预算。这些是「体验与成本曲线」参数，且载体是用户自己的 pi 配置——本仓不设 UI 门槛，也不复制一份。
- **可配**（设置页）：pi 配置目录（换目录只影响「读哪份配置」，不影响数据与项目文件）。
- **可配**（创作根 `.ai-editor/config.json`）：`debug` 日志开关。
- **刻意不可配**（代码常量，仅测试可注入）：单条工具结果上限（`TOOL_RESULT_MAX_TOKENS`）、SSE 心跳间隔（`DEFAULT_HEARTBEAT_MS`）、提案 TTL（`PROPOSAL_TTL_MS`）与条数上限、端口分段（`PORT_RANGES`）。这些是**失控保护与协议常量**——能配就等于让用户拆保险丝。
- 上下文压缩由 pi 的 compaction 承担（参数见上一行）；本仓不设自算的上下文总闸与历史预算比例。
