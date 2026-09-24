# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 进行中：小说文档导出（markdown 卷/章目录树）

链路：shared 编号收口 → shared 导出纯函数 → 服务端 `GET /project/export-novel` → 客户端 api → 导出类型弹窗。契约已落：`docs/api/10-api-project.md`（§`GET /api/v1/project/export-novel`）、`docs/ui/DESIGN.md`（§书架主页 `export-book-dialog`）、`docs/design/00-master-design.md` §1、`docs/design/backlog.md`（md 保真度 / 直写目录两项残差）。

**通用完成判据（每卡必附）**：`git log` 出现本卡新 commit + `git status` 干净；改 `shared` 的 `src` 后**先 `pnpm -r build`** 再跑下游测试；汇报必附 commit hash + 命令输出。

### 卡 E1 — shared 编号派生收口 + client `numberOutline` 消费（重构，行为不变）

- **契约**：`docs/design/10-data-model.md` §4/§15（编号口径 = shared `orderVisibleChapters`；展示编号 ≠ 服务端 `deriveChapterOrder`）
- **改动**：
  - 新增 `packages/shared/src/utils/outline-numbering.ts`：`numberVisibleOutline(tree: DeductionTreeLike | null)` → `{ volumes: { volumeId, volumeTitle, volumeLabel }[]; chapters: { chapterId, chapterTitle, chapterLabel, volumeId, volumeLabel, volumeTitle }[] }`
    - 卷序 = 顶层**可见**卷按树序 1-based（`第1卷`）；**无可见章的卷照样占号**（树视图徽标不能丢）
    - 章序 = `orderVisibleChapters` 顺序（跨卷连续、含存量直挂 root 章）
    - 直挂 root 的章：`volumeId` / `volumeLabel` / `volumeTitle` = `""`
    - 软删节点及其整棵子树跳过；`null` / 空树 → 两数组皆空
  - `shared/src/utils/index.ts` 补 `export *`
  - `packages/client/src/lib/outline-tree.ts` 的 `numberOutline` 改为消费它：`labels` = 卷 + 章徽标、`chapterRows.chapter` 从树里按 id 取节点；**对外签名与输出逐字段不变**（`ROOT_NODE_ID` 仍是直挂 root 章的 `volumeId`）
- **测试**：新增 `shared/src/utils/outline-numbering.test.ts`（卷号/章号/软删跳过/root 直挂章/无可见章的卷占号/空树）；`client/src/lib/outline-tree.test.ts` 保持绿
- **验证**：`pnpm -r build` → `pnpm typecheck` → `pnpm --filter @whispering233/ai-editor-shared test` → `pnpm --filter @whispering233/ai-editor-client test`
- **风险**：`numberOutline` 输出形状漂移会让大纲页编号错位 ⇒ oracle 必须逐字段核对（labels 覆盖**所有可见卷与可见章**、章视图行序不变）

### 卡 E2 — shared 导出纯函数（sanitize 挪位 + zip 条目/正文组装）

- **契约**：`docs/api/10-api-project.md` §`GET /api/v1/project/export-novel`（命名/编号/正文口径）
- **依赖**：E1
- **改动**：
  - 新增 `packages/shared/src/utils/file-name.ts`：`sanitizeDocumentFileName` + `FILE_NAME_LIMIT` 从 `client/src/lib/document-io.ts` **原样挪入**（docstring 含已知缺陷口径一并带过去）；`document-io.ts` 改为从 shared re-export（**不得复制实现**），其现有测试保持绿
  - 新增 `packages/shared/src/utils/novel-export.ts`：
    - `buildNovelExportEntries(bookName, numbering)` → `{ path, chapterId, chapterLabel, chapterTitle }[]`；`path` = `{sanitize(书名)}/{卷目录}/{章文件名}`；卷目录 = `第N卷 {卷名}`（卷名为空 → `第N卷`）；**直挂 root 章不进卷目录**（直接落书名目录下）；章文件名 = `第M章 {章名}.md`（章名为空 → `第M章.md`）
    - `buildNovelChapterMarkdown(chapterLabel, chapterTitle, text)` → `# 第M章 章名` + 空行 + `text`（`text` 为空 → 只留标题行）；标题用**原始章名**（trim，不走 sanitize）
    - `novelExportZipFileName(bookName)` → `{sanitize(书名)}-小说文档.zip`
  - `shared/src/utils/index.ts` 补 `export *`
- **测试**：新增 `packages/shared/src/utils/novel-export.test.ts`（路径拼接/空卷名/空章名/直挂 root 章/书名段 sanitize/标题头/空正文/zip 名）
- **验证**：`pnpm -r build` → `pnpm typecheck` → `pnpm --filter @whispering233/ai-editor-shared test` → `pnpm --filter @whispering233/ai-editor-client test`

### 卡 E3 — 服务端 `GET /api/v1/project/export-novel`

- **契约**：`docs/api/10-api-project.md` §`GET /api/v1/project/export-novel`（严格照文档实现，**不改文档**）
- **依赖**：E2
- **改动**：`packages/server/src/routes/project.ts` 在 `/export` 之后新增路由：
  `requireCurrentProject()` → `readOutlineFile(project.root)` → `numberVisibleOutline` → **`chapters.length === 0` → 400 `VALIDATION_ERROR`「本书还没有章节」**（不产空包）→ `getDocumentTexts(project.db, "chapter", ids)`（**一次 IN 查询**取 `content_text`，不读块 JSON）→ `buildNovelExportEntries` → `zipSync(..., { level: 6 })`（`strToU8`）→ `Content-Type: application/zip` + `Content-Disposition: attachment; filename="book.zip"; filename*=UTF-8''<encodeURIComponent(novelExportZipFileName(书名))>`；**不做 `checkpointWal`**、不写项目目录任何文件
- **测试**：`packages/server/src/routes/`（跟随现有测试脚手架，可新建 `export-novel.test.ts`）：① 卷/章齐备的书 → 解压后条目名与 md 内容符合文档（标题行 + 投影；空章只有标题行）；② 无可见章 → 400 `VALIDATION_ERROR`；③ 未打开项目 → 409 `NO_PROJECT_OPEN`
- **验证**：`pnpm -r build` → `pnpm typecheck` → `pnpm --filter @whispering233/ai-editor-server test`
- **禁止**：动 `POST /project/import` / restore 路径（导入仍只认三文件包）

### 卡 E4 — 客户端 `exportNovelZip()`

- **契约**：同 E3 响应契约；客户端侧沿用 `exportProjectZip` 的二进制分流口径
- **依赖**：E3（仅测试 mock，可先行）
- **改动**：`packages/client/src/lib/api.ts`：把 `exportProjectZip` 的响应分流主体抽成内部 `fetchZipDownload(path)`；`exportProjectZip()` 与新增 `exportNovelZip()` 各自传路径；响应类型同 `ExportProjectZipRes`；错误码与网络错误口径**不变**
- **测试**：`packages/client/src/lib/api.test.ts` 增 `exportNovelZip` 覆盖（zip 分流 / JSON 错误 / 网络错误），现有 `exportProjectZip` 断言保持绿
- **验证**：`pnpm typecheck` → `pnpm --filter @whispering233/ai-editor-client test`

### 卡 E5 — 导出类型弹窗 + Dashboard 接线

- **契约**：`docs/ui/DESIGN.md` §书架主页 `export-book-dialog`
- **依赖**：E4
- **改动**：
  - 新增 `packages/client/src/components/shelf/export-book-dialog.tsx`：受控 Dialog（`components/ui/dialog.tsx`）+ antd `Radio.Group`（竖排两选项，默认 `项目压缩文件`）+ caption 文案（照 DESIGN.md 表）+ Footer `[取消]` / `[导出]`（primary，`loading`/`disabled` 随在途）；组件**只上报所选类型**，不自己下载
  - `pages/Dashboard.tsx`：导出按钮改为开弹窗；`handleExportBook` 拆两条（`exportProjectZip` / `exportNovelZip`）共用 `<a download>` 管道与错误分流（`describeExportError`）；toast = `已导出《书名》备份` / `已导出《书名》小说文档`；成功关框、失败留框
- **测试**：`packages/client/src/components/shelf/export-book-dialog.test.tsx`（SSR：open=false 不渲染 / 两选项文案 + `导出` 按钮 / 默认选中第一项）+ `pages/dashboard-shelf.test.ts` 补「导出按钮开弹窗而非直接下载」断言
- **验证**：`pnpm typecheck` → `pnpm lint` → `pnpm --filter @whispering233/ai-editor-client test` + **浏览器像素核对**（弹窗浅/深两态；实导一份小说文档后解压核对目录树与标题头）+ 截图证据
- **风险**：antd `Radio` 若撞 token 守卫 ⇒ 改走 `button-default` 二按钮形态，并同步 `DESIGN.md`

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
