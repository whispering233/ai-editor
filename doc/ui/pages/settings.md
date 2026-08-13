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
│ 项目提示词（B1，决策 25）                           │
│  · 注入 AI 上下文「## 项目设定」段（每轮有效）        │
│  · 承载项目级规则/行业要求；空 = 整段跳过             │
│  · 建议 ### 及以下层级小标题；避免 ## 顶层标题        │
│    （与系统分段标题冲突）                           │
│  [多行文本域…                            ]        │
│  [保存提示词]                                     │
│                                                  │
│ 自动备份（B2，决策 27）                            │
│  · 跟随书籍：备份/频率均为本项目独立                  │
│  · 服务运行期间按频率自动备份；有变更才生成新备份      │
│  · 每项目保留最近 20 份，超出自动清理最旧             │
│  频率: [每 10 分钟 ▼]  [立即备份]                  │
│  历史备份:                                         │
│  ┌──────────────────────────────────────┐        │
│  │ 08-13 10:15   1.2 MB    [加载]       │        │
│  │ 08-13 09:45   1.2 MB    [加载]       │        │
│  │ 08-12 22:30   986 KB    [加载]       │        │
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
| 项目提示词（B1） | GET/PUT `/api/v1/project/config` → `prompt` |
| 备份频率（B2） | GET/PUT `/api/v1/project/config` → `backupFrequencyMinutes` / `backup_frequency_minutes` |
| 备份列表（B2） | `GET /api/v1/project/backups` → `backups[]`（fileName/size/createdAt） |
| 立即备份（B2） | `POST /api/v1/project/backup` → `backup` |
| 加载备份（B2） | `POST /api/v1/project/backup/restore` `{ fileName }` → `{ restored, snapshot }` |

## 关键交互

- **模型名**：文本框；保存时非空校验。
- **key 区**：
  - 未配置（`apiKeySet=false`）→ 显示「未配置」+ 输入框。
  - 已配置 → 显示掩码 + [更换]（展开输入框）+ [清除]（提交 `api_key: ""`）。
- **保存**：`PUT /settings/llm` → toast「已保存，仅影响新请求」（决策 17：运行中的 agent 循环不受扰动）。
- **项目提示词（B1）**：`GET /project/config` 载入当前 `prompt` → 多行文本域编辑 → [保存提示词] `PUT /project/config { prompt }` → toast + `dataVersion` +1（中栏数据页刷新）；清空保存 = 移除项目提示词（后续请求「## 项目设定」整段跳过）。
- **备份频率（B2）**：下拉选择（关闭 / 每 5 / 10 / 15 / 30 / 60 分钟）→ 选择即保存 `PUT /project/config { backup_frequency_minutes }`（null = 关闭）→ toast + 列表/定时器按新频率生效；无项目打开时整区禁用（404/409 时显示引导提示）。
- **立即备份（B2）**：点击 → `POST /project/backup` → 成功后列表顶部出现新条目 + toast「已备份」；失败（如磁盘错误）→ toast。
- **加载备份（B2）**：行内 [加载] → **强确认 Dialog**：展示备份时间与大小 + 说明「将覆盖当前项目数据；覆盖前会自动备份当前状态（后悔药）」→ 确认 → `POST /project/backup/restore { fileName }` → 成功后提示快照文件名 + **刷新项目数据**（config/outline/会话，与 B1 保存同款 dataVersion 联动）；409 `SCHEMA_VERSION_MISMATCH`（备份来自更高版本）→ 阻断提示。
- **错误态**：`VALIDATION_ERROR` → 表单内联错误。
- 说明区常驻：key 只进用户级配置、不进项目文件（决策 17）；环境变量优先级提示（当 key 来自环境变量时，页面仍可保存配置但实际生效以环境变量为准——MVP 仅文案说明，不区分来源展示）。
