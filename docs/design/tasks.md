# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### 卡 B1：md zip 根级章按阅读序

**目标**：修正 `GET /api/v1/project/export-novel` 的 zip 条目顺序：从「卷序 → 卷内章序 → 直挂 root 章」改为树序阅读序；路径、编号、章内容不变。

**契约**（`docs/api/10-api-project.md` §`GET /api/v1/project/export-novel`）：

- 条目顺序 = `outline` 顶层 children 树序：卷（含无可见章卷的目录条目）与直挂 root 章按树位置交错；卷内章按 `numberVisibleOutline.chapters`。
- 软删节点不进；路径 / 编号 / 正文 / 空目录规则不变。
- 只修正 md zip；TXT 已按阅读序，不动。

**改动范围**：

1. `packages/shared/src/utils/novel-export.ts`：`buildNovelExportEntries(bookName, numbering, outline)` 按 tree walk；保留 `labeledSegment` / path 规则；不重算编号。
2. `packages/server/src/routes/project.ts`：export-novel 路由把 `readOutlineFile` 结果传入；TXT 路由不动。
3. 测试：shared 新增/修改 root 章在卷前的用例，断言 entries 顺序；server export-novel 测试新增 root-first fixture（或调整现有 fixture）断言 `Object.keys(unzipSync)` 顺序；既有路径 / 正文断言保持。
4. `docs/api/10-api-project.md` 已更新；`backlog.md` 删除 B1 条目；`CHANGELOG.md` `### Fixed` 加一条。

**硬完成判据**：同整本 TXT 卡（新 commit + `git status` 干净 + 汇报 hash 与命令输出）；不得改 TXT / 编号 / 路径 / 正文 / 其他导出。

**边界**：不做 U+2011 分支改名；不加依赖；不改 `numberVisibleOutline`。
