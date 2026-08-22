# Settings 设置原型

## 路由与数据

- 路由：`#/settings`
- 读取：`GET /api/v1/settings/llm` → `{ model, apiKeySet, apiKeyMasked? }`
- 保存：`PUT /api/v1/settings/llm { model?, api_key? }`（`api_key` 传空字符串 = 清除已保存 key）

## 布局线框

```
┌──────────────────────────────────────────────────┐
│ 设置                                              │
├──────────────────────────────────────────────────┤
│ AI 模型                                           │
│  模型名:  [deepseek-v4-flash                 ]    │
│                                                  │
│ API Key                                          │
│  状态:  已配置（sk-****1234） / 未配置              │
│  新 Key: [——————————————————————]                │
│         [保存 Key]  [清除 Key]                    │
│                                                  │
│  说明:                                           │
│  · key 保存在用户目录配置文件（~/.ai-editor/        │
│    config.json），不写入项目文件                    │
│  · 环境变量 DEEPSEEK_API_KEY 优先于此处配置         │
│                                                  │
│ 项目规则文件 AGENTS.md（决策 41，修订决策 25）            │
│  · 项目目录下 AGENTS.md 为项目规则唯一事实源               │
│  · 注入 AI 上下文「## 项目设定」段（每轮有效）              │
│  · 空文件 = 整段跳过                                     │
│  · 可在文件管理器中直接编辑；web 读取检测外部修改           │
│    （mtime 比对，外部修改后提示刷新/重新加载）              │
│  [多行文本域…                            ]              │
│  [保存 AGENTS.md]                                       │
│                                                  │
│ 自动备份（B2 决策 27 + 决策 28 + 决策 29）            │
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
| 模型名 | GET → `model`；PUT → `model` |
| key 状态 | GET → `apiKeySet`（布尔）；已配置时展示 `apiKeyMasked` 掩码 |
| key 编辑 | PUT → `api_key`（新 key；空字符串 = 清除） |
| 项目规则文件 AGENTS.md（决策 41，修订决策 25） | 读写走文件接口（GET/PUT 项目目录下 AGENTS.md 文件内容；`project.json` `prompt` 字段废弃） |
| 备份频率（B2） | GET/PUT `/api/v1/project/config` → `backupFrequencyMinutes` / `backup_frequency_minutes` |
| 备份列表（B2 + B2.5 + B2.6） | `GET /api/v1/project/backups` → `backups[]`（fileName/size/createdAt/kind/name?） |
| 立即备份（B2.5） | `POST /api/v1/project/backup` 可选 `{ name }` → `backup`（fileName/size/createdAt/kind:"manual"/name?） |
| 重命名备份（B2.6） | `POST /api/v1/project/backup/rename` `{ fileName, name? }` → `{ backup }` |
| 加载备份（B2） | `POST /api/v1/project/backup/restore` `{ fileName }` → `{ restored, snapshot }` |

## 关键交互

- **模型名**：文本框；保存时非空校验。
- **key 区**：
  - 未配置（`apiKeySet=false`）→ 显示「未配置」+ 输入框。
  - 已配置 → 显示掩码 + [更换]（展开输入框）+ [清除]（提交 `api_key: ""`）。
- **保存**：`PUT /settings/llm` → toast「已保存，仅影响新请求」（决策 17：运行中的 agent 循环不受扰动）。
- **项目规则文件 AGENTS.md（决策 41，修订决策 25）**：设置页「项目提示词」改为**直接编辑项目目录下 AGENTS.md 文件内容**（读写走文件接口）——载入当前内容 → 多行文本域编辑 → [保存 AGENTS.md] 写回文件 → toast + `dataVersion` +1（中栏数据页刷新）；清空保存 = 空文件（后续请求「## 项目设定」整段跳过）。
  - **唯一事实源**：AGENTS.md 取代 project.json `prompt`（`prompt` 字段废弃，不再读写）；打开项目时若 `prompt` 存在且无 AGENTS.md → **自动迁移**写入 AGENTS.md（内容原样，一次迁移后 prompt 不再使用）。
  - **外部编辑支持**：用户可在文件管理器中直接编辑 AGENTS.md；web 读取时检测外部修改（**mtime 比对**，外部修改后提示刷新/重新加载）。
  - **注入逻辑保留**：system prompt「## 项目设定」段逻辑不变，数据源从 project.json `prompt` 改为 AGENTS.md 文件内容。
- **备份频率（B2 + 决策 27 修订）**：下拉选择（关闭 / 每 1 / 5 / 10 / 15 / 30 / 60 分钟，1 分钟档 2026-08 批次十四新增）→ 选择即保存 `PUT /project/config { backup_frequency_minutes }`（null = 关闭）→ toast + 列表/定时器按新频率生效；无项目打开时整区禁用（404/409 时显示引导提示）。
- **立即备份（B2 + B2.5）**：旁侧「备份名称（可选）」输入框（maxLength 30，决策 28）——trim 后非空 → 随请求提交 `POST /project/backup { name }`，文件名 `<时间戳>-m-<名称>.zip`，成功后清空输入 + toast「已备份「名称」」；空输入 → 不传 name（`<时间戳>-m.zip`，决策 29：无名称手动备份带 `-m` 段，列表仍标「手动」）。失败（如磁盘错误）→ toast。
- **备份列表（B2.5 + B2.6）**：时间显示补秒（当年 `MM-DD HH:mm:ss` / 跨年 `YY-MM-DD HH:mm:ss`——同分钟内多次备份可区分）；**类型标签（决策 29）**：行内简单标签区分手动/自动（`kind` 字段，如小徽标「手动」「自动」；快照归「自动」）；自定义名称行内展示（时间置灰 + 名称强调，无名称备份只显示时间+标签）；完整文件名在行 tooltip。
- **重命名备份（B2.6，决策 29）**：行内 [重命名]（铅笔图标）→ 行内输入框（预填当前名称，maxLength 30；自动备份预填空）→ **Enter 或确认按钮提交** `POST /project/backup/rename { fileName, name? }`（空输入 = 清除名称）；**Esc 或失焦取消**（提交中禁用输入，失焦不取消）；成功刷新列表 + toast「已重命名」；400 名称非法 / 409 目标名冲突 → 行内错误提示（透传服务端 message，保持编辑态）。类型标签不随重命名改变（重命名只改名称，来源保持）。
- **加载备份（B2）**：行内 [加载] → **强确认 Dialog**：展示备份时间、类型标签与大小 + 说明「将覆盖当前项目数据；覆盖前会自动备份当前状态（后悔药）」→ 确认 → `POST /project/backup/restore { fileName }` → 成功后提示快照文件名 + **刷新项目数据**（config/outline/会话，与 B1 保存同款 dataVersion 联动）；409 `SCHEMA_VERSION_MISMATCH`（备份来自更高版本）→ 阻断提示。
- **错误态**：`VALIDATION_ERROR` → 表单内联错误。
- 说明区常驻：key 只进用户级配置、不进项目文件（决策 17）；环境变量优先级提示（当 key 来自环境变量时，页面仍可保存配置但实际生效以环境变量为准——MVP 仅文案说明，不区分来源展示）。
