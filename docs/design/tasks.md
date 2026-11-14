# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### writing-0-extract-editor-panel — 拆出无路由的章正文编辑面板

**状态**：待执行
**依赖**：无
**范围**：仅 `packages/client/src/pages/Manuscript.tsx`（变薄）、新建 `packages/client/src/components/manuscript/chapter-editor.tsx`；不改路由行为、不改样式、不改保存逻辑、不动 `lib/manuscript.ts`。

**改动**
- 把现页面主体整体搬进 `ChapterEditor`：props = `{ outline: OutlineTree | null, chapterId: string, basePath: "/manuscript" | "/writing" }`（`basePath` 供上一/下一章链接派生目标）。正文加载、自动保存、409 `DOCUMENT_STALE`、404、导入导出、专注模式、页头、工具条、字数/保存态一律原样搬入，**行为零变化**。
- `Manuscript` 变薄壳：`useProjectStore(s => s.outline)` + `useOutlineLoader({ withMetadata: false })`（**保持现状**）→ 加载/错误态 → `<ChapterEditor key={chapterId} outline={outline} chapterId={chapterId} basePath="/manuscript" />`；壳不再持有正文状态。
- 页面高度链不变：壳仍为 `section flex h-full min-h-0 flex-col` + 内层滚动容器；`ChapterEditor` 不自建滚动容器、不改 `p-6`。
- 不做：不拆 rail、不加路由、不改 `#/manuscript`、不改 CSS、不改测试语义。

**硬完成判据**
- `Manuscript.tsx` 不再包含正文加载/保存逻辑；`ChapterEditor.tsx` 无 `useParams` / 路由依赖，只接 props。
- `pnpm --filter @whispering233/ai-editor-client test`、`pnpm typecheck`、`pnpm lint` 全绿。
- 浏览器冒烟（独立 `ui-verifier`，≤6 项）：`#/manuscript/:id` 打开、编辑后 1.5s 自动保存、手动保存、上一/下一章、专注模式、导入导出，与改前一致。
- 新 commit + `git status` 干净；汇报 commit hash 与命令输出。

### writing-1-nav-route-shell — 写作一级页、路由与写正文入口

**状态**：待执行
**依赖**：writing-0
**范围**：client 导航/路由/页面壳；本卡不建 rail（writing-2）、不做最近导航（writing-3）。

**改动**
- `components/nav/nav-items.tsx`：小说 items 在 `/outline` **之前**插入 `{ key: "/writing", icon: <EditOutlined />, label: "写作" }`（补 import；图标用 Outlined 纪律）。练习项集不动。
- `hooks/use-route.ts`：`KNOWN_ROUTE_SEGMENTS` 加 `"writing"`；`#/writing` 与 `#/writing/:id` 都能解析。
- 新建 `pages/Writing.tsx`：`useOutlineLoader({ withMetadata: true })` + store `outline`；全高分栏外壳（`-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden`）+ 正文列（`min-h-0 min-w-0 flex-1 p-6`）。有 id → `<ChapterEditor key={chapterId} outline={outline} chapterId={chapterId} basePath="/writing" />`；无 id → `page-title`「写作」+ 空态（去大纲）。本卡 rail 位置留空/占满，不做折叠树。
- `main.tsx`：`case "writing"` 渲染 `<Writing chapterId={...} />`；**页面不挂 key**（只有编辑器子树挂），`#/writing` 无 id 合法。旧 `manuscript` case 保持可用（P1 才改重定向）。
- 所有「写正文」/章跳转改指 `#/writing/:id`：`components/outline/chapter-view.tsx`（P1 会删，本卡先改）、`pages/OutlineDetail.tsx` 的 `navigate("/manuscript/"+id)`、`ChapterEditor` 的上一/下一章 `basePath`。
- 不写 `workspace-route-guard.ts`：小说侧默认放行、练习侧允许清单本就不含 `writing` ⇒ 自动挡回 `/practice`，只补测试。
- 测试：`nav-items.test.ts`（十项 + 写作在大纲前）、`use-route.test.ts`（解析两态）、`workspace-route-guard.test.ts`（练习区 `#/writing` 挡回）、`pages/outline.test.tsx`（写正文链接）、新增 `pages/writing.test.tsx`（SSR：无 id 空态、有 id 渲染编辑面板占位）。

**硬完成判据**
- 1920/1440：左栏「写作」在第一项且与「大纲」互斥高亮；`#/writing/:id` 可编辑保存；`#/writing` 空态不崩；旧 `#/manuscript/:id` 仍可编辑。
- 760：写作页不横向溢出（rail 未建，允许正文占满）。
- 命令全绿；新 commit + `git status` 干净；汇报 hash/输出。

### writing-2-chapter-rail — 卷章导航栏与全高布局

**状态**：待执行
**依赖**：writing-1
**范围**：新建 `components/writing/chapter-rail.tsx`、`lib/writing.ts`（本卡只放 rail 行派生）；`pages/Writing.tsx` 的 rail / 窄屏 / 专注接线；不改服务端、不改大纲页；**本卡 rail 固定 240px，宽度拖拽 / 收起在 writing-2b**。

**改动**
- `lib/writing.ts`：`buildWritingRailRows(outline)` 按 `outline.children` 文件序遍历（卷行 → 卷内章行；存量根级章顶层就地；跳过 `deleted`；0 章卷保留；不按 `chapterRows` 重组），徽标一律查 `numberOutline(outline).labels`，卷行 `N章` = 可见章子节点数；测试覆盖卷 / 根级章 / 0 章卷 / 软删 / 徽标。
- `chapter-rail.tsx`：顶部 header 40px（`px-3 py-2`、`section-title`「卷章」，本卡**无收起按钮**——2b 加）；行区 `p-2`；行几何 / 选中 / 折叠 / 字数严格按 `DESIGN.md`（32px、24px 折叠盒、`min-w-14`、`truncate`、`formatTextLength` 仅 `textLength > 0`、`bg-accent` + `aria-current="page"`）；**本卡无拖拽手柄**。卷折叠 state 在 `Writing`（session），换章后选中行 `scrollIntoView({ block: "nearest" })`。
- 桌面：rail 240px + 正文列；正文列 `flex min-h-0 min-w-0 flex-1 flex-col p-6`，窄屏返回条是列内 `shrink-0` 一行，下面 `min-h-0 flex-1` 包 `ChapterEditor`。
- 窄屏（`useMediaQuery("(min-width: 1024px)")`）：`#/writing` rail 全宽、无正文；`#/writing/:id` 正文全宽 + 32px「章节目录」返回条（`ArrowLeftOutlined`）。专注：`useUiStore(s => s.focusMode)` 为真时隐藏 rail 与返回条。
- 空 / 加载 / 错误态按 `DESIGN.md`：rail 骨架、无章空态、有章无选中提示、大纲失败重试、显式坏 `chapterId` 错误条 + 返回目录（不自动回退）。
- 测试：`components/writing/chapter-rail.test.tsx`（renderToString：卷行 `N章`、章行字数 / 0 不显示、根级章顶层、0 章卷、选中 `aria-current`、折叠箭头）；`pages/writing.test.tsx` 增窄屏 / 空态；**否定契约**：rail 不渲染新建 / 改名 / 删除按钮，也不渲染拖拽手柄 / 收起按钮（2b 才加）。

**硬完成判据**
- 1920/1440：rail 240、正文吸收剩余；点章直接进正文（页面无「写正文」按钮）；折叠 / 展开、选中滚动可见；**无拖拽手柄 / 收起按钮**（2b 才加）。
- 760：两级互斥 + 「章节目录」返回条可用；无横向溢出。
- 专注模式 rail / 返回条都不渲染；正文吸收剩余宽度。
- `pnpm --filter @whispering233/ai-editor-client test`、`pnpm typecheck`、`pnpm lint` 全绿。
- 浏览器验收（独立 `ui-verifier`，≤6 项）：rail 几何、点章进正文、折叠、选中滚动、窄屏两级、专注。
- 新 commit + `git status` 干净；汇报 hash/输出。

### writing-3-recent-chapter — 最近打开优先、服务端回退与保存后即时字数

**状态**：待执行
**依赖**：writing-2
**范围**：shared 类型/zod、db 批量查询、server outline metadata、client `lib/writing.ts` 的最近导航纯函数 / `Writing` 解析 / 保存回调 / store 补丁；**不新增表、不新增端点**。

**改动**
- shared：`OutlineNodeMetadata` 加 `documentUpdatedAt?: string`；`types/api.ts` 对应 zod 加 `documentUpdatedAt: z.string().optional()`（与 `textLength` 同块）。
- db：`queries/document.ts` 新增批量取 `owner_id + updated_at`（一次查询、空数组短路，风格同 `getDocumentTextLengths`）；`document.test.ts` 覆盖有/无行、多 owner。
- server：`routes/outline.ts` 的 `attachMetadata` 复用 `chapterIds` 批量取时间戳，**仅 chapter** 写 `metadata.documentUpdatedAt`；**无文档行 = 字段缺省**。`outline.test.ts` 覆盖仅章、无文档缺省、批量。
- `lib/writing.ts`：`parseLastOpenedChapters` / `readLastOpenedChapter(projectId)` / `writeLastOpenedChapter(projectId, chapterId)`（key `ai-editor:writing-last-opened`，per-book `{ [projectId]: chapterId }`；只存 id；坏 JSON / 非对象 / 非字符串值 → 空表；写失败静默）；`pickRecentChapter(outline)`（文件序可见章中最大 `documentUpdatedAt`，平局取先序第一个，无则 null）；`resolveWritingTarget(outline, lastOpenedId)` = 最近打开仍在**可见大纲**则用它，否则回退 `pickRecentChapter`；测试覆盖 per-book 隔离、脏值、最近打开优先、失效回退、平局、软删、根级章。
- `pages/Writing.tsx`：`#/writing/:id` 命中可见章时写最近打开（窄屏也写）；`#/writing` 无 id 且桌面端 → effect 里 `resolveWritingTarget`，有目标 `window.location.replace("#/writing/" + id)`，无目标空态；解析中骨架；一次性 ref 防重复 replace；**窄屏不自动跳**。
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
