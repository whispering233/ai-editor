# Settings 设置原型

## 路由与数据

- 路由：`#/settings`
- 读取：`GET /api/v1/settings/llm` → `{ provider, model, thinkingLevel, providers: [...] }`（多 provider：deepseek + opencode-go，各家含模型目录与 key 状态）
- 保存：`PUT /api/v1/settings/llm { provider?, model?, thinking_level?, api_keys? }`（`api_keys` 值传空字符串 = 清除该家已保存 key）
- 多 provider 模型名**可撞名**（deepseek-v4-flash/pro 两家都有）——以 `provider` 字段消歧；聊天按 `config.provider + model` 一对解析

## 布局线框

```
┌──────────────────────────────────────────────────┐
│ 设置                                              │
├──────────────────────────────────────────────────┤
│ AI 模型（每提供商一张卡片，竖排一行一张）            │
│ ┌─ DeepSeek ───────────────────────────┐ 当前     │
│ │ 模型: [deepseek-v4-flash ▼]          │          │
│ │      （点选 = 激活此模型）             │          │
│ │ key: 已配置 sk-****1234              │          │
│ │      [更换] [清除]                   │          │
│ └──────────────────────────────────────┘          │
│ ┌─ OpenCode Go ────────────────────────┐          │
│ │ 模型: [qwen3.7-max ▼]                │          │
│ │      （点选 = 激活此模型）             │          │
│ │ key: 未配置（聊天下拉已禁用此组）       │          │
│ │ 新 Key: [——————————] [保存]          │          │
│ └──────────────────────────────────────┘          │
│ 说明: key 存用户级配置（~/.ai-editor/config.json）或  │
│ 环境变量（DEEPSEEK_API_KEY / OPENCODE_API_KEY），或  │
│ pi-agent 配置（~/.pi/agent/auth.json 只读兜底）；     │
│ 不写入项目文件；未配 key 的 provider 聊天下拉整组禁用  │
│                                                  │
│ 项目规则文件 AGENTS.md（修订）            │
│  · 项目目录下 AGENTS.md 为项目规则唯一事实源               │
│  · 注入 AI 上下文「## 项目设定」段（每轮有效）              │
│  · 空文件 = 整段跳过                                     │
│  · 可在文件管理器中直接编辑；web 读取检测外部修改           │
│    （mtime 比对，外部修改后提示刷新/重新加载）              │
│  [多行文本域…                            ]              │
│  [保存 AGENTS.md]                                       │
│                                                  │
│ 自动备份（B2）            │
│  · 跟随书籍：备份/频率均为本项目独立                  │
│  · 服务运行期间按频率自动备份；有变更才生成新备份      │
│  · 每项目保留最近 20 份，超出自动清理最旧             │
│  频率: [每 10 分钟 ▼]                             │
│  [备份名称（可选）…] [立即备份]                    │
│  历史备份:                                         │
│  ┌──────────────────────────────────────┐        │
│  │ 08-13 10:15:30 [手动] 定稿 1.2 MB    │        │
│  │            [重命名] [加载]          │        │
│  │ 08-13 09:45:12 [自动]     1.2 MB    │        │
│  │            [重命名] [加载]          │        │
│  │ 08-12 22:30:05 [自动]     986 KB    │        │
│  │            [重命名] [加载]          │        │
│  └──────────────────────────────────────┘        │
│                                                  │
│ [保存设置]                                        │
└──────────────────────────────────────────────────┘
```

## 信息层级

| 展示 | API 字段 |
|------|---------|
| 激活 provider/模型 | GET → `provider` + `model`；PUT → `provider` + `model`（一对同传） |
| 卡内模型目录 | GET → `providers[]`（含各家 `models[]`：id/provider/displayName/contextWindow/maxTokens/reasoning） |
| 各家 key 状态 | GET → `providers[].apiKeySet`（布尔）+ `apiKeyMasked?`（掩码） |
| key 编辑 | PUT → `api_keys: { <provider>: string }`（空字符串 = 清除该家已保存 key） |
| 思考强度 | GET → `thinkingLevel`；PUT → `thinking_level`（全局，不分 provider） |
| 项目规则文件 AGENTS.md（修订） | 读写走文件接口（GET/PUT 项目目录下 AGENTS.md 文件内容；`project.json` `prompt` 字段废弃） |
| 备份频率（B2） | GET/PUT `/api/v1/project/config` → `backupFrequencyMinutes` / `backup_frequency_minutes` |
| 备份列表（B2 + B2.5 + B2.6） | `GET /api/v1/project/backups` → `backups[]`（fileName/size/createdAt/kind/name?） |
| 立即备份（B2.5） | `POST /api/v1/project/backup` 可选 `{ name }` → `backup`（fileName/size/createdAt/kind:"manual"/name?） |
| 重命名备份（B2.6） | `POST /api/v1/project/backup/rename` `{ fileName, name? }` → `{ backup }` |
| 加载备份（B2） | `POST /api/v1/project/backup/restore` `{ fileName }` → `{ restored, snapshot }` |

## 关键交互

- **AI 模型双卡（每 provider 一卡）**：
  - 卡内模型下拉 = 该 provider 目录（`providers[].models`）；**点选即激活**——PUT `{ provider, model }` 一对（激活后全局生效，聊天下拉同源同步）。
  - 卡内 key 区：未配置（`apiKeySet=false`）→ 「未配置」+ 新 key 输入 + [保存 key]（PUT `api_keys: { <provider>: key }`）；已配置 → 掩码 + [更换]（展开输入框）+ [清除]（PUT `api_keys: { <provider>: "" }`）。
  - key 缺失不影响本卡操作，但该 provider 模型在**聊天下拉中整组禁用**（防 LLM_API_KEY_MISSING）。
  - 激活卡视觉标记（如边框高亮或「当前」徽标）：`config.provider` 对应的卡。
- **模型名**：文本框 → 卡内下拉；选择即保存（乐观更新，失败 toast）。
- **保存**：`PUT /settings/llm` → toast「已保存，仅影响新请求」（运行中的 agent 循环不受扰动）。
- **项目规则文件 AGENTS.md（修订）**：设置页「项目提示词」改为**直接编辑项目目录下 AGENTS.md 文件内容**（读写走文件接口）——载入当前内容 → 多行文本域编辑 → [保存 AGENTS.md] 写回文件 → toast + `dataVersion` +1（中栏数据页刷新）；清空保存 = 空文件（后续请求「## 项目设定」整段跳过）。
  - **唯一事实源**：AGENTS.md 取代 project.json `prompt`（`prompt` 字段废弃，不再读写）；打开项目时若 `prompt` 存在且无 AGENTS.md → **自动迁移**写入 AGENTS.md（内容原样，一次迁移后 prompt 不再使用）。
  - **外部编辑支持**：用户可在文件管理器中直接编辑 AGENTS.md；web 读取时检测外部修改（**mtime 比对**，外部修改后提示刷新/重新加载）。
  - **注入逻辑保留**：system prompt「## 项目设定」段逻辑不变，数据源从 project.json `prompt` 改为 AGENTS.md 文件内容。
- **备份频率（B2 + 修订）**：下拉选择（关闭 / 每 1 / 5 / 10 / 15 / 30 / 60 分钟，1 分钟档 2026-08 批次十四新增）→ 选择即保存 `PUT /project/config { backup_frequency_minutes }`（null = 关闭）→ toast + 列表/定时器按新频率生效；无项目打开时整区禁用（404/409 时显示引导提示）。
- **立即备份（B2 + B2.5）**：旁侧「备份名称（可选）」输入框（maxLength 30）——trim 后非空 → 随请求提交 `POST /project/backup { name }`，文件名 `<时间戳>-m-<名称>.zip`，成功后清空输入 + toast「已备份「名称」」；空输入 → 不传 name（`<时间戳>-m.zip`，无名称手动备份带 `-m` 段，列表仍标「手动」）。失败（如磁盘错误）→ toast。
- **备份列表（B2.5 + B2.6）**：时间显示补秒（当年 `MM-DD HH:mm:ss` / 跨年 `YY-MM-DD HH:mm:ss`——同分钟内多次备份可区分）；**类型标签**：行内简单标签区分手动/自动（`kind` 字段，如小徽标「手动」「自动」；快照归「自动」）；自定义名称行内展示（时间置灰 + 名称强调，无名称备份只显示时间+标签）；完整文件名在行 tooltip。
- **重命名备份（B2.6）**：行内 [重命名]（铅笔图标）→ 行内输入框（预填当前名称，maxLength 30；自动备份预填空）→ **Enter 或确认按钮提交** `POST /project/backup/rename { fileName, name? }`（空输入 = 清除名称）；**Esc 或失焦取消**（提交中禁用输入，失焦不取消）；成功刷新列表 + toast「已重命名」；400 名称非法 / 409 目标名冲突 → 行内错误提示（透传服务端 message，保持编辑态）。类型标签不随重命名改变（重命名只改名称，来源保持）。
- **加载备份（B2）**：行内 [加载] → **强确认 Dialog**：展示备份时间、类型标签与大小 + 说明「将覆盖当前项目数据；覆盖前会自动备份当前状态（后悔药）」→ 确认 → `POST /project/backup/restore { fileName }` → 成功后提示快照文件名 + **刷新项目数据**（config/outline/会话，与 B1 保存同款 dataVersion 联动）；409 `SCHEMA_VERSION_MISMATCH`（备份来自更高版本）→ 阻断提示。
- **错误态**：`VALIDATION_ERROR` → 表单内联错误。
- 说明区常驻：key 只进用户级配置或环境变量，不进项目文件；**每 provider 独立解析链**（见 doc/api/endpoints.md §系统设置）；当有效 key 来自环境变量时，页面仍可保存配置但实际生效以环境变量为准——MVP 仅文案说明，不区分来源展示。
