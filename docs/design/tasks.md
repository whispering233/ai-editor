# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

契约已先行登记（实现阶段不得再改契约；发现文档与代码冲突就停下提问）：
- `docs/ui/DESIGN.md` `tab-advanced`（四张卡顺序 + `models-providers` 全量形态）
- `docs/api/90-api-settings.md`（`models.json` 写入前滚动备份 `models.json.bak`；pi 配置文件只对 `models.json` 提供表单）
- `docs/design/config.md`（`models.json` 的读写方）
- `AGENTS.md`（升级 pi 后复查第四处：模型表单字段源 = `schemas/models.schema.json`）

## 卡 3a · jsonc 单源 + `models.json` 写入前滚动备份

**目标**：先把「丢注释可恢复」的保护在盘上做实，前端表单随后上线。

**改动面**

1. 新增 `packages/shared/src/utils/jsonc.ts`（按仓内既有 utils 导出口径导出）：
   - `stripJsonComments(text)`：与 pi `dist/utils/json.js` 同语义（去 `//` 注释与尾逗号，**字符串字面量不动**），从 `packages/server/src/pi-agent-dir.ts` 的私有实现上提（连语义注释一起搬，保留「升级 pi 时复查」提示）。
   - `parseJsonc(text)`：`stripJsonComments` + `JSON.parse`，失败返回可读 reason（不抛）。
   - `countJsoncLosses(text)`：返回被去掉的注释 / 尾逗号**处数**（供 3b 的确认文案；实现与 `stripJsonComments` 同一套正则，不许另写一份语义）。
2. `packages/server/src/pi-agent-dir.ts`：删除私有 `stripJsonComments`，`checkConfigFileText` 改调 shared；**行为与文案保持不变**（`'models.json'` 宽容、`auth/settings` 严格）。
3. `packages/server/src/routes/settings.ts` 的 `PUT /settings/config-file/:name`：`name === "models.json"` 时，写入前若目标文件存在且内容与本次不同 → 先把原文备份到同目录 `models.json.bak`（单份滚动、覆盖上一代；用 `writeTextAtomic` 或等价原子写）；**备份失败中止保存**（500 + 可读文案，主文件不动）。文件不存在 / 内容相同 → 不备份。
4. 测试：
   - shared：`url 里的 //` 不被当注释、行注释、尾逗号、无注释原样、嵌套结构、`countJsoncLosses` 计数正确。
   - server：PUT `models.json` 后 `.bak` 内容 = 旧文；第二次 PUT 覆盖 `.bak`；内容相同 → 不产生 / 不改 `.bak`；`.bak` 不在白名单 → `GET /config-file/models.json.bak` 400；既有 `checkConfigFileText` 用例全绿。沙箱必须同时设 `HOME` 与 `USERPROFILE`（`AGENTS.md`「测试与验证」）。

**验收判据（硬）**

- `git log` 含本卡新 commit + `git status --short` 干净（无 commit = 不许报 PASS）。
- 改 shared → 先 `pnpm -r build`，再 `pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering233/ai-editor-server test` 通过（Windows 既有红不计，不得新增）。
- 汇报附 commit hash、上述命令关键输出、`.bak` 用例的实际断言。

## 卡 3b · 高级 → 自定义模型表单

**依赖**：卡 3a 已合入 main。

**改动面**

1. 新增 `packages/client/src/lib/models-config.ts`（纯函数）：
   - `readCustomProviders(text)`：用 shared `parseJsonc` 解析，返回 `models.json` 里的自定义 provider 列表 + 原始对象（未知键原样保留）；解析失败给 reason。
   - `composeModelsText(original, providers)`：只覆盖表单负责的字段（provider 级 `id/name/baseUrl/api/authHeader/apiKey` + 模型行 `id/name/contextWindow/maxTokens/reasoning`），顶层与 provider 级未知键透传。
   - 校验：provider `id` 必填（新建后不可改）、模型 `id` 必填、数字字段（`contextWindow` / `maxTokens`）正整数或空、模型 id 不重复；`id` 与 pi 内置 provider 同名 → 行内**警告**（不禁止，pi overlay 允许覆盖）。
2. 新增 `packages/client/src/components/settings/models-providers-panel.tsx`（含受控 `Dialog` 表单，复用 `components/ui/dialog.tsx`）：形态严格按 `DESIGN.md` `models-providers`——列表行 + 「添加」+ 编辑/删除（删除 `ConfirmDialog` 二次确认）；空列表 `empty-state`；只列 `models.json` 里的自定义 provider。
3. 保存：组装文本 → 若 `countJsoncLosses(loadedText) > 0` 先弹确认（文案含处数与「原文会备份为 models.json.bak」）→ `saveConfigFile("models.json", text)` → 成功 `showToast("已保存，立即生效")` 并重读列表；失败在弹窗内展示服务端文案、**不清空输入**。
4. `components/settings/pi-config-section.tsx`：顺序 = `PiDirPanel` → `SearchKeyPanel` → `ModelsProvidersPanel` → `ConfigFileEditor`。
5. 测试：`lib/models-config.test.ts`（未知键透传 / 模型行增删 / 校验 / 注释计数接入）+ 面板 SSR 走查（空列表、有 provider、按钮禁用态）。

**验收判据（硬）**

- `git log` 含本卡新 commit + `git status --short` 干净。
- `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 通过。
- 浏览器走查（**沙箱 HOME**，不得写真实 `~/.ai-editor`；最多 3 张截图）：① 预先写一份带 `//` 注释 + 未知键的 `models.json` → 卡片列出 provider；② 改一个 `baseUrl` 保存 → 弹「将丢失 N 处注释」确认 → 确认后 `models.json.bak` = 旧文、新文件无注释且未知键仍在；③ 「添加」新建一家 provider + 一个模型，保存后列表与文件都对；④ 删除 provider 有二次确认。
- 汇报附 commit hash + 命令输出 + 走查结论。

## 已定序、未开工（R3 最后一刀）

- **`settings.json` 开关子集**：`retry.enabled` / `compaction.enabled` / `httpIdleTimeoutMs`；走同一条文本端点（不用 pi typed setter——同样丢注释，且注释会让 `save()` 静默早退）。`enabledModels` 是模式串、`thinkingBudgets` / `httpProxy` 无 setter，一律留在 JSON。开工前先确认是否值得单开一卡（三个控件、收益中等）。