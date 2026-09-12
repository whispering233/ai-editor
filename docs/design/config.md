# 配置说明（config）

> 各配置载体一览（索引式：字段/格式契约指向对应文档，不重复）。铁律：**模型 API key 绝不写入项目文件**（project.json/outline.json/data.db/sessions/备份 zip 天然不含 key）——代码与数据物理隔离。

| 载体 | 内容 | 契约位置 |
| :--- | :--- | :--- |
| 启动参数 `projectRoot` + 环境变量 `AI_EDITOR_PORT` | 创作根目录 / 服务端口覆盖（仅 bin 直接执行入口读取） | `build.md` |
| pi agent dir `~/.pi/agent/auth.json` | 各 provider 凭据（API key / OAuth）；**一家一条**，值可以是字面 key、`$ENV_VAR` 引用或 `!命令`（pi `resolveConfigValue` 语义）。**存量凭据优先**：仅当该家在 auth.json 无条目时才回落到 provider 内置环境变量（`DEEPSEEK_API_KEY` 等）——环境变量是兜底，不是与凭据并存的第二个来源 | pi 凭据存储；本仓经 `ModelRuntime` 读写；设置页写入 = 唯一写入口 |
| pi agent dir `~/.pi/agent/models.json` | 自定义 provider / 模型覆盖（baseUrl、api 形态、模型元数据、`$ENV` 取值） | pi `models.json` 语义；本仓不解析，交由 `ModelRuntime` |
| pi agent dir `~/.pi/agent/settings.json` | 模型与运行参数：`defaultModel` / `enabledModels`（可见模型作用域）/ 重试（`retry`）/ 压缩（`compaction`）/ 思考预算（`thinkingBudgets`） | pi settings；本仓经 `SettingsManager` 读写 |
| 项目 `project.json` | id/name/language/schema_version/current_position/backup_frequency_minutes（自动备份频率枚举 1/5/10/15/30/60，null/0 关闭，缺省 10） | `docs/db/schema.md` |
| 项目目录 `AGENTS.md` | 项目规则唯一事实源（取代废弃的 `project.json` `prompt`）：设置页直编 + 文件管理器直接编辑（mtime 检测外部修改） | `docs/design/20-context.md` §4；端点 `docs/api/10-api-project.md` |
| 项目目录 `sessions/` | 对话历史（一 session 一 JSONL，格式 = pi session v3） | `docs/db/schema.md` |
| 创作根 `.ai-editor/config.json` | 创作根级偏好（不进项目文件）：`debug` 段 = 调试日志开关 `{ "debug": { "enabled": true, "categories": [...] } }`，四类别 chat/request/usage/http；categories 缺失 = 全部、enabled 缺失/false = 全关；文件不存在/非法 JSON/结构不符 = 全关（server 包 `src/debug.ts`）。`lastProject` = 上次成功打开的项目目录（绝对路径），启动时自动恢复（见 `build.md` §启动流程），open 成功后由服务端合并写入（原子写 + 保留其他字段；写入失败不影响打开结果） | server 包 `src/debug.ts` / `src/last-project.ts` |
| 浏览器 localStorage | 展示层偏好，不进数据文件：主题 `ai-editor:theme`、三栏面板 `ai-editor:panels`、画布坐标/缩放 | `docs/ui/DESIGN.md` |

**读写边界**：

- pi agent dir 的唯一读写在服务端（设置页 key 写入经 pi credential store；模型/压缩参数经 pi settings）。
- 项目目录内的 `.pi/`（项目级 settings/extensions/skills）**一律不参与配置**：资源加载显式关闭扩展/技能/提示词模板，且项目信任为 false——项目目录可能来自他人（备份包/共享目录），不接受其中携带的可执行资源或配置。
- 用户级旧文件 `~/.ai-editor/config.json` **已废弃**（key/模型/预算全部迁往 pi agent dir）：代码不再读取，文件保留在磁盘不影响行为。
- 项目文件（project.json/outline.json/AGENTS.md）走原子写；`sessions/` 由 pi `SessionManager` 追加写（整文件重写仅限迁移）。
- 创作根 `.ai-editor/config.json` 的两个键属**服务端**：`debug` 由用户手编（启动读一次，含 `debug` 段以外的未知键一律忽略），`lastProject` 由服务端在 `POST /project/open` 成功后合并写入（写前先读、只改本键，不碰 `debug`）。

## 可配 / 不可配边界（判据）

**判据：配错会导致「无界成本」或「静默失控」的数值不给用户配。**

- **可配**（pi settings）：模型与可见模型作用域、重试次数与退避、压缩阈值（`reserveTokens`/`keepRecentTokens`）、思考预算。这些是「体验与成本曲线」参数，且载体是用户自己的 pi 配置——本仓不设 UI 门槛，也不复制一份。
- **刻意不可配**（代码常量，仅测试可注入）：单条工具结果上限（8000 tokens）、SSE 心跳间隔（15-30s）、提案 TTL（10 分钟）与条数上限。这些是**失控保护与协议常量**——能配就等于让用户拆保险丝。
- 上下文压缩由 pi 的 compaction 承担（参数见上一行）；本仓不设自算的上下文总闸与历史预算比例。
