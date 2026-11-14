# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### writing-3-recent-chapter — 最近打开优先、服务端回退与保存后即时字数

**状态**：待执行
**依赖**：writing-2
**范围**：shared 类型/zod、db 批量查询、server outline metadata、client `lib/writing.ts` 的最近导航纯函数 / `Writing` 解析 / 保存回调 / store 补丁；**不新增表、不新增端点**。

**改动**
- shared：`OutlineNodeMetadata` 加 `documentUpdatedAt?: string`；`types/api.ts` 对应 zod 加 `documentUpdatedAt: z.string().optional()`（与 `textLength` 同块）。
- db：`queries/document.ts` 新增批量取 `owner_id + updated_at`（一次查询、空数组短路，风格同 `getDocumentTextLengths`）；`document.test.ts` 覆盖有/无行、多 owner。
- server：`routes/outline.ts` 的 `attachMetadata` 复用 `chapterIds` 批量取时间戳，**仅 chapter** 写 `metadata.documentUpdatedAt`；**无文档行 = 字段缺省**。`outline.test.ts` 覆盖仅章、无文档缺省、批量。
- `lib/writing.ts`：`parseLastOpenedChapters` / `readLastOpenedChapter(projectId)` / `writeLastOpenedChapter(projectId, chapterId)`（key `ai-editor:writing-last-opened`，per-book `{ [projectId]: chapterId }`；只存 id；坏 JSON / 非对象 / 非字符串值 → 空表；写失败静默）；`pickRecentChapter(outline)`（文件序可见章中最大 `documentUpdatedAt`，平局取先序第一个，无则 null）；`resolveWritingTarget(outline, lastOpenedId)` = 最近打开仍在**可见大纲**则用它，否则回退 `pickRecentChapter`；测试覆盖 per-book 隔离、脏值、最近打开优先、失效回退、平局、软删、根级章。
- `pages/Writing.tsx`：`#/writing/:id` 命中可见章时写最近打开（窄屏也写）；`#/writing` 无 id 且桌面端 → effect 里 `resolveWritingTarget`，有目标 `window.location.replace("#/writing/" + id)`，无目标空态；解析中骨架；**以当前 hash 是否已是目标作幂等守卫**（StrictMode 第二次 effect 跳过；从 `#/writing/:id` 再点「写作」可重新解析）；**窄屏不自动跳**。
- `stores/project.ts`：新增 `patchChapterMetadata(chapterId, { textLength, documentUpdatedAt })`——不可变递归更新 `outline`（未命中分支保持原引用），不改 `outlineWithMetadata` 标志；`project.test.ts` 断言不可变与未命中不换根。
- `ChapterEditor`：保存成功（自动 / 手动，含 409 覆盖分支）后调用 `onSaved({ charCount, updatedAt })`；`Writing` 传入并 patch store。**不重拉大纲树**。
- 先 `pnpm -r build` 再跑下游（shared/db 改了 src）。

**硬完成判据**
- 打开 A 不保存 → 再进写作回 A（localStorage 优先）；保存 B → 进 B；B 软删 → 回退 A（`documentUpdatedAt` 最大）；切书再回各回各的。
- 无最近打开且无已保存正文 → 空态，不跳「第一章」；窄屏 `#/writing` 不自动跳。
- 保存后 rail 字数立即更新，网络里没有新的 `GET /outline`；`documentUpdatedAt` 随 PUT `updatedAt` 更新。
- `pnpm -r build`、client / db / server 单包测试、`pnpm typecheck`、`pnpm lint` 全绿。
- 浏览器验收（独立 `ui-verifier`，≤6 项）：打开 A 不保存回 A、保存 B 回 B、软删回退、切书隔离、无目标空态、字数即时。
- 新 commit + `git status` 干净；汇报 hash/输出。

### writing-2b-rail-resize — 卷章导航栏宽度拖拽与收起

**状态**：待执行
**依赖**：writing-2；排期在 writing-3 之后（同改 `Writing.tsx`）
**范围**：抽 `AppShell` 的 `ResizeHandle` / `CollapseStrip` 到 `components/ui/`；新建 `hooks/use-writing-rail.ts`；`chapter-rail.tsx` header 加收起、右侧加手柄；`Writing.tsx` 接 `railWidth` / `collapsed`；**不改选章 / 折叠 / 窄屏 / 专注语义**，不改服务端。

**改动**
- 抽 `AppShell.tsx` 的 `ResizeHandle` / `CollapseStrip` 到 `components/ui/resize-handle.tsx` / `collapse-strip.tsx` 并参数化（手柄 `label` / `active` / `onStart` / `onMove` / `onEnd`，窄条 `side: "left" | "right"` / `label` / `onExpand`）；`AppShell` 两处改用，视觉不变；写作页复用同一对。
- `hooks/use-writing-rail.ts`：默认 240、区间 200–480（复用 `use-panels.ts` 的 `clampPanelWidth`）、`collapsed`；`localStorage` `ai-editor:writing-rail` `{ width, collapsed }`（全局一份）；拖动只改内存、`pointerup` 一次写，收起 / 展开立即写；坏值整体回默认、`collapsed` 仅严格 `true`；导出纯函数 `defaultWritingRailLayout` / `parseWritingRailLayout`。
- `chapter-rail.tsx`：header 右侧加收起 `icon-button` `DoubleLeftOutlined`；右侧 6px 手柄（`role="separator"` + `aria-label`，1px 中线常显、hover / 拖拽高亮）；拖拽中页面 `select-none`；**收起态不渲染手柄**。
- `Writing.tsx`：桌面展开 = `railWidth` + 手柄 + 正文列；收起 = 32px `CollapseStrip`（`DoubleRightOutlined`、`bg-sidebar`、右边线）+ 正文列；宽度保留、展开恢复原宽；窄屏（<1024）无手柄 / 收起，rail 全宽；专注模式不渲染 rail / 窄条。
- 测试：`hooks/use-writing-rail.test.ts`（纯函数 `defaultWritingRailLayout` / `parseWritingRailLayout` / `clampPanelWidth` 的默认、夹取、坏值、`collapsed` 严格 `true`；hook 本体依赖 window，node 环境不渲染，同 `use-panels.test.ts`）；`pages/writing.test.tsx` 增「收起态渲染窄条 / 展开态渲染手柄与收起按钮」；**否定契约**：窄屏不渲染手柄 / 收起，专注不渲染 rail / 窄条。

**硬完成判据**
- 1920/1440：默认 240；可拖到 200/480 并夹取；收起为 32px 窄条、展开恢复原宽；刷新后宽度 / 收起态保留；无横向溢出。
- 760：无手柄 / 收起，rail 全宽。
- 专注模式 rail / 窄条都不渲染；正文吸收剩余宽度。
- `pnpm --filter @whispering233/ai-editor-client test`、`pnpm typecheck`、`pnpm lint` 全绿。
- 浏览器验收（独立 `ui-verifier`，≤6 项）：默认 240、拖到 200/480、收起 / 展开 / 刷新保留、窄屏无手柄、专注。
- 新 commit + `git status` 干净；汇报 hash/输出。

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
