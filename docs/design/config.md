# 配置说明（config）

> 各配置载体一览（索引式：字段/格式契约指向对应文档，不重复）。铁律：**模型 API key 绝不写入项目文件**（project.json/outline.json/data.db/备份 zip 天然不含 key）——代码与数据物理隔离。

| 载体 | 内容 | 契约位置 |
| :--- | :--- | :--- |
| 启动参数 `projectRoot` + 环境变量 `AI_EDITOR_PORT` | 创作根目录 / 服务端口覆盖（仅 bin 直接执行入口读取） | `build.md` |
| 用户级 `~/.ai-editor/config.json`（schema v2） | LLM 配置：`schema_version`/`provider`/`model`/`thinking_level`/`api_keys`；key 三级解析链（env > 用户配置 > pi-agent `~/.pi/agent/auth.json` 只读兜底）；模型解析绝不跨 provider | `docs/api/90-api-settings.md`（字段表 + 解析链） |
| 项目 `project.json` | id/name/language/schema_version/current_position/backup_frequency_minutes（自动备份频率枚举 1/5/10/15/30/60，null/0 关闭，缺省 10） | `docs/db/schema.md` |
| 项目目录 `AGENTS.md` | 项目规则唯一事实源（取代废弃的 project.json `prompt`）：设置页直编 + 文件管理器直接编辑（mtime 检测外部修改）；注入 system「## 项目设定」 | `docs/design/20-context.md` §3；端点 `docs/api/10-api-project.md`（GET/PUT /project/agents） |
| 创作根 `.ai-editor/config.json` 的 `debug` 段 | 调试日志开关：`{ "debug": { "enabled": true, "categories": [...] } }`，五类别 chat/request/stream/usage/http；categories 缺失 = 全部、enabled 缺失/false = 全关；文件不存在/非法 JSON/结构不符 = 全关（无配置文件默认关闭防刷屏）；stream 类别经 chatStream `debugStream` 选项显式传入 llm 包（显式 true 才开，无 env 回退） | server 包 `src/debug.ts` |
| 浏览器 localStorage | 展示层偏好，不进数据文件：主题 `ai-editor:theme`（use-theme）、三栏面板 `ai-editor:panels`、画布坐标/缩放 | `docs/ui/DESIGN.md`（布局与交互）；代码 client/src |

**读写边界**：用户级/创作根配置由服务端读写（设置页）；项目文件（project.json/outline.json/AGENTS.md）走原子写；`~/.pi/agent/auth.json` 只读兜底（绝不写回）。schema v1 旧 `api_key` 字段读侧仅对 deepseek 生效，未知字段保留不校验。
