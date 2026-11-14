# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### writing-4-remove-chapter-view — 删章视图与旧路由收口

**状态**：待执行
**依赖**：writing-2b、writing-3
**范围**：删旧章视图/视图持久化，旧路由 `replace`；**不改契约文档**（已在本次 docs commit 落好，发现漂移先停）。

**改动**
- 删 `packages/client/src/components/outline/chapter-view.tsx` + `chapter-view.test.tsx`、`packages/client/src/hooks/use-outline-view.ts` + `use-outline-view.test.ts`。
- `pages/Outline.tsx`：删视图切换按钮 / `useOutlineView` 状态 / `ChapterView` 分支；页头右端组 = `[清除推演标记（有可见标记时）] [全部折叠] [+新建卷]`；保留树视图、全部折叠、清除推演标记。
- `main.tsx`：`manuscript` case 改为 `replace` 重定向——有 id → `#/writing/:id`，无 id → `#/outline`（新增/复用一个 `ReplaceTo`，必须 `window.location.replace`，不能走 `navigate` 的 push）。
- 测试：删 `use-outline-view.test.ts`；`pages/outline.test.tsx` 删章视图/视图切换断言；`workspace-route-guard.test.ts` 的旧 `#/manuscript` 用例改 `#/writing`（若该用例只测旧路由重定向，保留重定向断言）。
- `rg` 复核：`outline-view` / `chapter-view` / `ai-editor:outline-view` 在 `packages/` 零命中。

**硬完成判据**
- 大纲页只有树视图；旧 `#/manuscript/:id` 打开后 URL 变 `#/writing/:id` 且正文可编辑；后退不回旧 URL（replace）；`#/manuscript` 落 `#/outline`。
- 全量命令（`pnpm -r build` 视情况、`pnpm -r test`、`pnpm typecheck`、`pnpm lint`）全绿。
- 浏览器验收（独立 `ui-verifier`，≤10 项）：大纲树新建卷/章/场、改名、删除、拖拽、全部折叠、清除推演标记无回归；旧路由重定向。
- 新 commit + `git status` 干净；汇报 hash/输出。

---

派工与验收命令、发布链路见 `AGENTS.md`「协作流程」与 `build.md`；需要真 HTTP 上游的卡用本地 WebDAV 或最小假 DAV（单测一律 mock `fetch`），**凭据不入库**；测试端口前提见 `build.md`「本地开发」最后一条。
