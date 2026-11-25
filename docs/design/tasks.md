# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 卡 2 · 联网搜索 key 表单 + 目录浏览按钮

**契约**：`../ui/DESIGN.md` `tab-advanced`（三张卡的顺序与字段）；`../api/90-api-settings.md` 文末两条（`search.json` 单字段表单；pi 配置文件仍不做表单）。

**改动面**

1. 新增 `packages/client/src/lib/search-key.ts`（纯函数，可测）：`parseSearchKey(text): { ok: true; apiKey: string } | { ok: false; reason: string }`（空文本 = `{ apiKey: "" }`；坏 JSON / 形状不符 → 失败原因）与 `composeSearchConfigText(apiKey): string`（`JSON.stringify({ apiKey: apiKey.trim() }, null, 2)`）。
2. 新增 `packages/client/src/components/settings/search-key-panel.tsx`：`SectionCard` + `section-title`「联网搜索」+ 标题行右侧 `button-primary`「保存」（`dirty && !saving` 才可点）+ `Input.Password`（回显当前 key、眼睛切换；外层 `div` 承担弹性宽度）+ `caption-text`（只存本机 `~/.ai-editor/search.json`；按次计费、与对话 key 独立；未配置时工具报错指回这里）。读 = `getConfigFile("search.json")`，写 = `saveConfigFile("search.json", text)`（现有端点，零新 API）；成功 `showToast("已保存，立即生效")`，失败行内错误、不清空输入；解析失败时禁用输入并提示去下方 JSON 编辑器修复。
3. `components/settings/pi-config-section.tsx`：顺序 = `PiDirPanel` → `SearchKeyPanel` → `ConfigFileEditor`。
4. `components/settings/pi-dir-panel.tsx`：输入框同一行加 `button-default`「浏览…」，**仅 `desktopBridge()` 非空**时渲染；点击 `pickDirectory()` 选中则填入输入框（不自动保存）。
5. 测试：`lib/search-key.test.ts`（空文本 / 正常 / 坏 JSON / 非对象 / 未知键由服务端 strict 拒绝，客户端不兜）+ 面板渲染断言（沿用 `react-dom/server` 走查式断言，仓内无 jsdom）。

**验收判据（硬）**

- `git log` 含本卡新 commit + `git status --short` 干净（无 commit = 不许报 PASS）。
- `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 通过；Windows 本机既有红不计，但**不得新增**失败。
- UI 走查（独立验证子代理，最多 3 张截图）：① 已存 key 时输入框回显、点眼睛可见明文；② 改值后「保存」变可点，保存后 toast「已保存，立即生效」且 `search.json` 内容为 `{ "apiKey": ... }`；③ 清空并保存 → 文件里 `apiKey` 为空串（= 未配置）；④ 桌面形态出现「浏览…」、浏览器形态不出现。
- 汇报附 commit hash + 命令输出 + 走查结论。

## 已定序、未开工（R3 后续两刀，开工前各自再走一次设计提问）

- **卡 3 · `models.json` provider 表单**：baseUrl + api 形态 + 模型列表；必须同时落「注释检测（`stripJsonComments(text) !== text` 即禁用表单）/ 改写前备份 / 保存前最终文本预览」三件套 + 未知字段透传；字段源 = pi 自带 `schemas/models.schema.json`。
- **卡 4 · `settings.json` 开关子集**：`retry.enabled` / `compaction.enabled` / `httpIdleTimeoutMs`；走同一条文本端点（不用 pi typed setter——同样丢注释，且注释会让 `save()` 静默早退）。`enabledModels` 是模式串、`thinkingBudgets` / `httpProxy` 无 setter，一律留在 JSON。