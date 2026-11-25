# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 卡 1 · 保存态单源 + 手动保存提醒

**契约**：`../ui/DESIGN.md` `save-status` / `toast`（同槽位升级）/ `writing-toolbar`（保存按钮）；`../design/config.md` 不受影响。

**问题**（2026-11，代码可证）：四处保存态只在一处页面各写一份，且只在保存完成时置态——输入中仍显示上一次「已保存」；手动保存按钮点完没有任何提示（`chapter-editor.tsx` 里 `showToast` 只服务导入导出）。

**改动面**

1. 新增 `packages/client/src/components/ui/save-status.tsx`：导出 `SaveState = "idle" | "pending" | "saving" | "saved"` 与 `SaveStatus({ state, savedAt })`，文案单源（`编辑中…` / `保存中…` / `已保存 · HH:MM`，时刻用 `lib/manuscript.ts` 的 `formatSavedAt`）。
2. `packages/client/src/stores/ui.ts`：`showToast(text, kind?, key?)`，`Toast` 增加可选 `key`；`components/feedback/FeedbackHost.tsx` 统一改 `message.open({ content, type, duration, ...(key ? { key } : {}) })`（三分支合并）。
3. `packages/client/src/hooks/use-save-archive.ts`：三条 toast 带 `key: "save"`（存档成功 / 节流 / 存档失败）。
4. `components/manuscript/chapter-editor.tsx`：状态换共享类型；`handleChange` 置 `pending`；`saveNow()` 成功后 `showToast("已保存", "success", "save")`（**自动保存路径 `saveContent` 不弹**、失败不弹）；页头 `statusText` 与专注态工具条都用 `<SaveStatus>`。
5. `pages/ReferenceDetail.tsx`：共享组件 + 新增 `savedAt`（手动保存与正文自动保存成功都置 `new Date()`）；编辑器 onChange 置 `pending`；两处 `showToast("已保存")` 补 `key: "save"`。**已知残留**（不改）：只改元信息（名称 / 分类 / 标签 / URL）不置 pending——那一层没有 dirty 判定，登记 `backlog.md`。
6. `pages/PracticeDetail.tsx` / `pages/FreeDetail.tsx`：子组件的 `saving: boolean` 换成 `saveState: SaveState`（页面派生：`saving` → `"saving"`；`draft !== detail.draft` → `"pending"`；`savedAt !== null` → `"saved"`；否则 `"idle"`；`saving` 优先）；`saveDraft()` 成功 → `showToast("已保存", "success", "save")`；保存按钮 `loading={saveState === "saving"}`；子组件仍是纯展示。
7. 测试：新增 `components/ui/save-status.test.tsx`；更新 `pages/practice-detail.test.tsx` / `free-detail.test.tsx` 的 props 与文案断言；补 `FeedbackHost` 的 keyed 路径断言（`shouldNotifyToast` 现成）；`chapter-editor.test.ts` 若有文案断言同步。

**验收判据（硬）**

- `git log` 含本卡新 commit，且 `git status --short` 干净（无 commit = 不许报 PASS）。
- `pnpm typecheck` / `pnpm lint` / `pnpm -r test` 通过；Windows 本机既有红（`EPERM` / `0600` / 本地 WebDAV 403 / 端口占用）不计，但**不得新增**失败。
- UI 走查（独立验证子代理，最多 4 张截图）：① 输入文字后状态立即变「编辑中…」（不是「已保存」）；② 停手后「保存中…」→「已保存 · HH:MM」；③ 点保存按钮出现一条「已保存」toast；④ 连按两次 `Ctrl/Cmd+S` 全程只有一条提示，文案升级为「已保存并生成存档」（或节流文案）。
- 汇报附：commit hash、上述命令的关键输出、走查结论。

## 卡 2 · 联网搜索 key 表单 + 目录浏览按钮

**契约**：`../ui/DESIGN.md` `tab-advanced`（三张卡的顺序与字段）；`../api/90-api-settings.md` 文末两条（`search.json` 单字段表单；pi 配置文件仍不做表单）。

**改动面**

1. 新增 `packages/client/src/lib/search-key.ts`（纯函数，可测）：`parseSearchKey(text): { ok: true; apiKey: string } | { ok: false; reason: string }`（空文本 = `{ apiKey: "" }`；坏 JSON / 形状不符 → 失败原因）与 `composeSearchConfigText(apiKey): string`（`JSON.stringify({ apiKey: apiKey.trim() }, null, 2)`）。
2. 新增 `packages/client/src/components/settings/search-key-panel.tsx`：`SectionCard` + `section-title`「联网搜索」+ 标题行右侧 `button-primary`「保存」（`dirty && !saving` 才可点）+ `Input.Password`（回显当前 key、眼睛切换；外层 `div` 承担弹性宽度）+ `caption-text`（只存本机 `~/.ai-editor/search.json`；按次计费、与对话 key 独立；未配置时工具报错指回这里）。读 = `getConfigFile("search.json")`，写 = `saveConfigFile("search.json", text)`（现有端点，零新 API）；成功 `showToast("已保存，立即生效")`，失败行内错误、不清空输入；解析失败时禁用输入并提示去下方 JSON 编辑器修复。
3. `components/settings/pi-config-section.tsx`：顺序 = `PiDirPanel` → `SearchKeyPanel` → `ConfigFileEditor`。
4. `components/settings/pi-dir-panel.tsx`：输入框同一行加 `button-default`「浏览…」，**仅 `desktopBridge()` 非空**时渲染；点击 `pickDirectory()` 选中则填入输入框（不自动保存）。
5. 测试：`lib/search-key.test.ts`（空文本 / 正常 / 坏 JSON / 非对象 / 未知键保留？——只按 `apiKey` 读，未知键由服务端 strict 拒绝，不在客户端兜）+ 面板渲染断言（可沿用 `react-dom/server` 走查式断言，仓内无 jsdom）。

**验收判据（硬）**

- `git log` 含本卡新 commit + `git status --short` 干净。
- `pnpm typecheck` / `pnpm lint` / `pnpm -r test` 通过，无新增失败。
- UI 走查（独立子代理，最多 3 张截图）：① 已存 key 时输入框回显、点眼睛可见明文；② 改值后「保存」变可点，保存后 toast「已保存，立即生效」且 `search.json` 内容为 `{ "apiKey": ... }`；③ 清空并保存 → 文件里 `apiKey` 为空串（= 未配置）；④ 桌面形态出现「浏览…」、浏览器形态不出现。
- 汇报附 commit hash + 命令输出 + 走查结论。

## 已定序、未开工（R3 后续两刀，开工前各自再走一次设计提问）

- **卡 3 · `models.json` provider 表单**：baseUrl + api 形态 + 模型列表；必须同时落「注释检测（`stripJsonComments(text) !== text` 即禁用表单）/ 改写前备份 / 保存前最终文本预览」三件套 + 未知字段透传；字段源 = pi 自带 `schemas/models.schema.json`。
- **卡 4 · `settings.json` 开关子集**：`retry.enabled` / `compaction.enabled` / `httpIdleTimeoutMs`；走同一条文本端点（不用 pi typed setter——同样丢注释，且注释会让 `save()` 静默早退）。`enabledModels` 是模式串、`thinkingBudgets` / `httpProxy` 无 setter，一律留在 JSON。