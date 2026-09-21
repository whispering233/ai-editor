# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 书架 / 删除书籍 / 会话移出备份 / 云端恢复（2026-09）

契约依据：`docs/api/10-api-project.md`（list 的 id/origin、`POST /project/delete`、export/import 白名单）、`docs/api/100-api-cloud.md`（pull、remote-books、import-book）、`docs/api/20-api-backup.md`（zip = 三文件、restore 不碰会话）、`docs/api/120-api-decompose.md`（start 副作用与客户端义务）、`docs/design/40-cloud-sync.md`（§1 / §3 / §4 / §5 / §7 / §8 / §10）、`docs/design/10-data-model.md` §10/§11、`docs/design/60-decompose.md` §1/§2.1、`docs/db/schema.md`（project.json `origin`、sessions 纯本地）、`docs/ui/DESIGN.md`（书架主页 / 拆解小说 / 备份与云端）。**卡序 = 依赖序**：23.1 → 23.2 → 23.3 → 23.4 → 23.5 → 23.6 → 23.7 → 23.8。

### 卡 23.1 · client：拆解 start 后收敛项目镜像（bug 修复）

- **范围**：`components/decompose/decompose-dialog.tsx`——`startDecompose` 成功后先重拉项目配置 + 大纲并刷新书架，再跳 `#/decompose`；不新增 store 字段（复用 `loadConfig` / `loadOutline` / `loadBookshelf`）。
- **完成判据**：client 单测断言成功后三个刷新各发一次（顺序无关）、刷新失败不阻断跳转；浏览器手测：已打开 A 时拆解 B → 书架高亮 B、点 A 打开的是 A（不再看到 B 的数据）。

### 卡 23.2 · shared+server+client：书架两类（origin）+ 当前书按 id

- **范围**：① shared `ProjectFileConfig.origin?: "book" | "decompose"` + `projectListResSchema` 增 `id` / `origin`；② server `initProject` 覆盖参数收 `origin`（缺省不写字段）、`decompose/start` 传 `decompose`、`GET /project/list` 输出 `id` + `origin`（缺失 → `book`）、open 路由补标（`origin` 缺失且库内有拆解 job → 写一次 `decompose`，幂等）；③ client 书架按 `origin` 分「小说项目 / 小说拆解」两组（组标题 + 条数，空组不渲染）、所有「当前书」判定改 `book.id === config?.id`。
- **完成判据**：server 测试（list 两字段与缺省值；创建的项目 `book`；拆解建档 `decompose`；补标只写一次、无 job 不写）；client 测试（两组渲染 / 空组不渲染 / 按 id 高亮——同名不同 id 造不出，用 id 不匹配的 config 断言不高亮）；浏览器像素核对。

### 卡 23.3 · server+shared+client：`sessions/` 移出备份与云

- **范围**：① `backup.ts`：`createBackupZip` 不再打包随包目录；`PACKED_DIR_NAMES` 收敛为**遗留白名单**（只用于 `isAllowedBackupEntry` / `validateBackupPackage` 接受旧包条目，条目内容一律忽略）；`writeProjectFilesFromBackup` / `overwriteProjectFiles` 删掉会话目录覆盖步骤；`hasFileChangesSince` / `hasLocalEditsSince` / `hasUnbackedChanges` 去掉 `sessions/`；② `cloud/sync.ts`：pull 去掉并集合并（删 `mergeDirFromEntries` 调用与 `packedEntriesOfZip`）、`baseEntries` 停写（类型字段保留可选、读侧容忍）；③ shared 客户端契约去掉 `CloudPullRes.merged`，client `stores/cloud.ts` 同步去掉展示、`stores/chat.ts` 删除会话的「推送后另一台也删」toast；④ 测试更新（含「存量带 `sessions/**` 的包仍可导入且不写本地会话目录」）。
- **完成判据**：单测证新包只含三文件；旧包（含 `sessions/**`）校验通过、导入/restore/pull 后本机 `sessions/` 字节不变；纯写会话不触发自动备份、不影响 `dirty`/`backupStale`；`pnpm --filter @whispering233/ai-editor-server test` 与 client 测试全绿。

### 卡 23.4 · shared+server：删书后端（含云端前置）

- **范围**：① shared `projectDeleteReqSchema` / `projectDeleteResSchema`；② `POST /api/v1/project/delete`（`{ path, force?, delete_remote? }`）——路径校验（`books/` 直接子目录 + 含 `project.json`）、云端前置推送（判据 = `cloud.json` 已配置 **且** 该书有 book state；未打开的书临时开 db 打包推送）、失败 502 除非 `force`、取消在跑拆解 job、删当前书时关连接 + 清 `currentProject` + 抹 `lastProject`、物理删目录；③ `cloud/state.ts` 删该书 state、`cloud/sync.ts` 删云端书目录（尾斜杠 + `Depth: infinity`，best-effort，失败回 `remoteError`）；④ `last-project.ts` 补清键函数。
- **完成判据**：server 测试——无云状态直接删（零云端请求）、有云状态先推送再删（mock fetch 断言顺序：PUT → DELETE 本地）、推送失败不删且返回 502、`force` 才删、删当前书后 `GET /project/config` 回 409 且 `lastProject` 键消失、`delete_remote` 失败仍返回 200 + `remoteError`；路径逃逸/非 books 目录/缺 project.json 拒绝。

### 卡 23.5 · client：删书入口与确认框

- **范围**：① 书架行由整行 `<button>` 改 `div` + 内层打开按钮 + 行尾垃圾桶 `icon-button`（当前书条并列一个「删除」`button-default`）；② `book-delete-dialog`：书名 + 后果三行 + 复选「同时删除云端备份」（默认不勾）+ `[删除]` danger；推送失败 → 框内错误 + `[仍要删除]`（`force`）；③ 成功后刷新书架，删的是当前书时回书架并清云端状态；client api/store 补删除动作；④ 把当前书判定抽为可测的纯函数 `isCurrentBook(book, config)`（`books/[name]` 不再是判据），并**补行为级用例**：`id` 不匹配（name 相同也算不匹配）→ 不高亮（卡 23.2 oracle 登记的防御用例，随本卡结构改造一并落地）。
- **完成判据**：SSR/单测断言行结构（存在「打开」按钮与删除按钮，二者不嵌套）+ 对话框分支文案；浏览器手测三类：删除非当前书、删除当前书、勾选删云端（用本地 WebDAV 或 mock 起服务）。

### 卡 23.6 · shared+server：云端书架列出与导入新书

- **范围**：① shared `cloudRemoteBooksResSchema` / `cloudImportBookReqSchema` / `cloudImportBookResSchema`；② `GET /api/v1/cloud/remote-books`（工作根不存在 → 空数组、不 MKCOL；每目录 1 次 PROPFIND；解析 `<书名>`/`projectId`、列出可解析备份、标 `localExists`）；③ `POST /api/v1/cloud/import-book`（**请求体 snake_case**：`dir_name` / `file_name`，见 `api-public.md`；下载 head / 指定份 → 既有 `validateBackupPackage` 管道 → 同 id 已存在 409 → `uniqueBookDir` 建档、id 沿用 → 该 zip 原样落新书 `.backups/`（新增写原始字节的 helper，文件名走备份命名白名单校验）→ 写 `cloud.json` book state（`dirName` / `lastPushedFileName` / `lastSeenHeadFileName` / `lastSeenCloudFiles` / `lastSyncAt` = `max(now, 三文件 mtime 向上取整)`）→ 不自动打开）。
- **完成判据**：server 测试（列目录含无备份目录与无法解析 id 的目录；导入后 `GET /project/list` 出现新书且为 `book` 组、`.backups/` 有一份同名字节一致的 zip、`GET /cloud/status` 状态为 `synced`；同 id 二次导入 409；坏包 400；目录不存在 404）；与真 WebDAV（本地 `rclone serve webdav`）集成跑一次。

### 卡 23.7 · client：从云端恢复对话框

- **范围**：书架「导入备份」旁并列「从云端恢复…」`button-default`（点开拉 `GET /cloud/remote-books`）；对话框行列表（书名 / 最近备份时间 · 份数 · 大小 / 行尾状态：「本机已有」置灰、无备份置灰、可导入给「导入」按钮）；未配置 409 → 引导去设置页云端面板（复用 `requestCloudPane`）；导入成功关框 + toast + 刷新书架（不自动打开）。
- **完成判据**：单测/presenter 断言三分支行状态与置灰；浏览器手测（本地 WebDAV 起一份云端备份 → 空书架导入 → 书架出现该书 → 打开后可同步）。

### 卡 23.8 · 收尾：回归 + CHANGELOG + 清卡

- **范围**：全量 `pnpm -r build` → `typecheck` → `lint` → `pnpm -r test`；桌面版打包态启动冒烟（若改到主进程则必跑）；`CHANGELOG.md` 增 `Unreleased` 段（按 Added / Changed / Fixed 归类本批落地项，不写卡号）；README 书架/备份两条 bullet 对齐新能力（删书、从云端恢复、会话不进包）；清空本文件卡片。
- **完成判据**：四道命令全绿且贴出输出；`docs/design/tasks.md` 回到「当前无进行中任务卡」。

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
