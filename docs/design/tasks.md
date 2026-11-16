# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

> 执行顺序：先卡 1，独立验证并 commit 后再派卡 2；B1（md zip 根级章顺序）在两卡完成后从 `backlog.md` 单独开卡。

### 卡 1：整本 TXT 导出（小说工作区）

**目标**：书架当前书「导出」弹窗新增第三项「纯文本」，下载整本单文件 `.txt`；排版二选一（保真 / 网文排版），默认保真。

**已定契约**（详见 `docs/api/10-api-project.md` §`GET /api/v1/project/export-novel-txt`、`docs/ui/DESIGN.md` §`export-book-dialog`）：
- 端点 `GET /api/v1/project/export-novel-txt?layout=preserve|webnovel`；默认 `preserve`；UTF-8 无 BOM + CRLF；单文件；文件名 `{书名}.txt` / `{书名}-网文.txt`（空书名 `未命名`）；不写书名 / 目录；按阅读序；无章卷跳过卷标题；空章留标题；不可再导入。
- 错误：无项目 409 `NO_PROJECT_OPEN`；练习区 400 `KIND_MISMATCH`；无可见章 400 `VALIDATION_ERROR`；非法 layout 400 `VALIDATION_ERROR`。
- 排版：保真 = 正文原样；网文 = 普通段落两个全角空格、连续段落不空行；非段落块原样、前后空行。标题行不带 `#`，标题用原始名不 sanitize。

**改动范围**：
1. `packages/shared/src/utils/novel-export.ts`：`NOVEL_TXT_LAYOUTS` / `NovelTxtLayout`、`NovelTxtBlock`、`buildNovelTxt`、`novelTxtFileName`；标题用原始名（**不要复用 `labeledSegment`**，它会 sanitize 文件名）。
2. `packages/shared/src/types/api.ts`：`projectExportNovelTxtQuerySchema`（`z.enum(NOVEL_TXT_LAYOUTS).optional()`）；经 `@whispering233/ai-editor-shared/schemas` 子路径消费（**根入口不导出 zod 运行时**）。
3. `packages/server/src/routes/project.ts`：新路由；`requireCurrentProject` → `assertWorkspaceKind(project,"novel")` → `numberVisibleOutline` → 无章 400 → `getDocumentTexts` 批量 → 按 `numbering.chapters` 阅读序组装卷 / 章标题与正文 → `buildNovelTxt`；`Content-Type: text/plain; charset=utf-8`；`Content-Disposition` ASCII fallback `book.txt` + RFC5987；不做 wal_checkpoint。
4. `packages/client/src/lib/api.ts`：`fetchZipDownload` 泛化为 `fetchDownload`（允许 zip/octet-stream 或 text/plain；错误仍走 JSON 包裹）；`parseContentDispositionFilename` 加可选 fallback（默认仍 `project.zip`）；`exportNovelTxt(layout)`。
5. `packages/client/src/components/shelf/export-book-dialog.tsx`：`ExportBookKind` 加 `"txt"`；第三项 label `纯文本`、caption `{书名}.txt · 整本单文件 · UTF-8 · 有损`；选中后在单选组下方（`Radio.Group` 之外）显示 `Checkbox`「网文排版（段首缩进、段间不空行；文件名加 -网文）」，默认不勾、不记忆、在途禁用；`onExport` 传 layout；`exportBookToast` 加 TXT 文案；`exportBookOptions` 保持练习区只一项。
6. `packages/client/src/pages/Dashboard.tsx`：`handleExportBook` 按 kind 分派 `exportNovelTxt(layout)`；成功关框、失败留框。
7. 测试：`packages/shared/src/utils/novel-export.test.ts`（保真 / 网文 / 根级章阅读序 / 空章 / 空卷 / 卷·章标题原始名（含 `:` / `/` 不被 sanitize）/ CRLF / 末尾换行 / 文件名）；`packages/server/src/routes/export-novel-txt.test.ts`（200 content-type、默认与显式 layout、文件名、无章 400、练习区 400、无项目 409、非法 layout 400；纯文本直接断言 body，不需要解压）；`packages/client/src/lib/api.test.ts`（text/plain 接受、text/html 拒绝、文件名 fallback、layout query）；`packages/client/src/components/shelf/export-book-dialog.test.tsx`（三项 / 练习区一项 / checkbox 出现与默认值 / toast）；`packages/client/src/pages/dashboard-shelf.test.ts`（分派源码扫描）。
8. `CHANGELOG.md` `## [Unreleased]` 的 `### Added` 加一条（整本 TXT 导出）；文档已由主会话改好，worker 只核对不重写。

**硬完成判据**：`git log` 含本卡新 commit；`git status --short` 空；汇报附 commit hash、`pnpm -r build`、`pnpm typecheck`、相关包测试命令与输出。不得把卡 2 / B1 的改动混入本 commit。

**边界**：不做 U+2011 分支改名；不新增 db 表/查询/迁移/依赖；不改 md zip 行为（B1 另行开卡）；不做 GB18030/BOM；不做 TXT 导入。

### 卡 2：单章 TXT 导出（写作页）

**目标**：写作页章正文页头「导出」下拉新增两项：`导出纯文本（保真）` / `导出纯文本（网文排版）`，只导出当前章，纯客户端、无端点。

**契约**（详见 `docs/api/110-api-manuscript.md` §导入导出、`docs/ui/DESIGN.md` §`writing-page`）：
- 正文取编辑器最新块 JSON（`latestRef`，含未保存改动）→ shared `blocksToPlainMd` → shared `buildNovelTxt`；不读服务端。
- 第一行 `第M章 章名`：章名空 → `第M章`；编号取不到 → 只用章名；都空 → `正文`。
- 文件名 `{章名}.txt` / `{章名}-网文.txt`（章名空 → `正文`；不带章号）；UTF-8 无 BOM + CRLF；空章只出标题行。
- 不弹确认框；成功 toast 文件名；失败 toast 错误。

**改动范围**：
1. `packages/shared/src/utils/novel-export.ts`：复用卡 1 的 `buildNovelTxt` / `novelTxtFileName`；不重复实现排版。
2. `packages/client/src/lib/document-io.ts`：`exportDocumentTxt(content, title, chapterLabel, layout)`——解析块 JSON（失败 → 空文本，不抛）→ `blocksToPlainMd` → `buildNovelTxt([{ kind: "chapter", label: chapterLabel, text }], layout)`；文件名 `novelTxtFileName(title, layout)`。
3. `packages/client/src/components/manuscript/chapter-editor.tsx`：从 `outline` 用 `numberOutline(outline).labels.get(chapterId)` 取章号；TXT 文件名基名 = `chapterTitle?.trim() || "正文"`（不改现有 JSON/MD 的 `documentTitle()` 行为）；显示标签按「`第M章 章名` → 章名空只留 `第M章` → 编号取不到只用章名 → 都空 `正文`」回退；下拉加两项；TXT 两项不 confirm，直接 `downloadTextFile` + toast。
4. 测试：`packages/client/src/lib/document-io.test.ts`（标题回退 / 两种排版 / 空内容 / 文件名 / 非法 JSON 不抛）；`chapter-editor` 现有无组件测试（仓内无 jsdom），至少加源码扫描断言（菜单含两项、TXT 不 confirm），或补 `document-io` 单测覆盖排版；不引 jsdom。
5. `CHANGELOG.md` `### Added` 补单章 TXT 一条（可与卡 1 同版本，但分卡分 commit）。

**硬完成判据**：同卡 1（新 commit + `git status` 干净 + 汇报 hash 与命令输出）；不得改服务端 / API / 整本弹窗。
