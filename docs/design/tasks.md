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
**范围**：client 导航/路由/页面壳；本卡不建 rail（writing-2）、不做最近编辑（writing-3）。

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
**范围**：新建 `components/writing/chapter-rail.tsx` + `pages/Writing.tsx` 的 rail / 窄屏 / 专注接线；不改服务端、不改大纲页。

**改动**
- 从 `outline` 派生 rail 行：按 `outline.children` **文件序**遍历（卷行 → 卷内章行；**存量根级章在顶层就地**；跳过 `deleted`；0 章卷保留；不按 `chapterRows` 重组，避免根级章被挪位）。徽标文案一律查 `numberOutline(outline).labels.get(node.id)`，**不复制编号规则**；卷行右侧 `N章` = 可见章子节点数。
- rail 行几何 / 选中 / 折叠 / 字数严格按 `DESIGN.md` §数据展示 `writing-page`：32px 行高、24px 折叠箭头盒（无子卷同几何空占位）、`min-w-14` 编号徽标、`truncate` 标题、字数 `formatTextLength`（`textLength > 0` 才渲染）、选中 `bg-accent` + `aria-current="page"`。折叠 state 放 `Writing`（session，不写 localStorage），换章后选中行 `scrollIntoView({ block: "nearest" })`。
- 桌面：rail 240px + 正文列；窄屏（`useMediaQuery("(min-width: 1024px)")`）：`#/writing` rail 全宽、`#/writing/:id` 正文全宽 + 顶部 32px「章节目录」返回条（`ArrowLeftOutlined`，仅窄屏）。
- 专注：`useUiStore(s => s.focusMode)` 为真时隐藏 rail 与窄屏返回条（正文列仍按现有高度链铺满）。
- 空/加载/错误态按 `DESIGN.md` `writing-page`：rail 骨架、无章空态、大纲失败重试。
- 测试：新增 `components/writing/chapter-rail.test.tsx`（renderToString：卷行 `N章`、章行字数/0 不显示、根级章顶层、0 章卷、选中 `aria-current`、折叠箭头）；`pages/writing.test.tsx` 增窄屏/空态断言；**否定契约**：rail 不渲染新建/改名/删除按钮。

**硬完成判据**
- 1920/1440/760：rail 240、正文吸收剩余；点章直接进正文（页面无「写正文」按钮）；折叠/展开、选中滚动可见；窄屏两级 + 返回条可用；专注隐藏 rail。
- `pnpm --filter @whispering233/ai-editor-client test`、`pnpm typecheck`、`pnpm lint` 全绿。
- 浏览器验收（独立 `ui-verifier`，≤8 项）：桌面 rail 几何、点章进正文、折叠、选中滚动、窄屏两级、专注；无横向溢出。
- 新 commit + `git status` 干净；汇报 hash/输出。

### writing-3-recent-chapter — 最近编辑与保存后即时字数

**状态**：待执行
**依赖**：writing-2
**范围**：shared 类型/zod、db 批量查询、server outline metadata、client `lib/writing.ts` / store 补丁 / `Writing` 重定向 / 保存回调；**不新增表、不新增端点**。

**改动**
- shared：`packages/shared/src/types/outline.ts` 的 `OutlineNodeMetadata` 加 `documentUpdatedAt?: string`；`packages/shared/src/types/api.ts` 对应 zod 加 `documentUpdatedAt: z.string().optional()`（与 `textLength` 同块）。
- db：`packages/db/src/queries/document.ts` 新增批量取 `owner_id + updated_at` 的函数（一次查询、空数组短路，风格同 `getDocumentTextLengths`）；`document.test.ts` 覆盖有/无行、多 owner。
- server：`routes/outline.ts` 的 `attachMetadata` 复用已收集的 `chapterIds` 批量取时间戳，**仅 chapter** 写 `metadata.documentUpdatedAt`；**无文档行 = 字段缺省**（不写空串/0）。`outline.test.ts` 覆盖仅章、无文档缺省、批量。
- client：新增 `lib/writing.ts` 的 `pickRecentChapter(outline): string | null`——按树文件序遍历未软删章，取最大 `documentUpdatedAt`（平局取先序第一个；无则 null）；`lib/writing.test.ts` 覆盖无文档、根级章、平局、软删。
- `pages/Writing.tsx`：`#/writing` 且桌面端 → effect 里 `window.location.replace("#/writing/" + id)`；无最近章 → 空态；窄屏不跳；用一次性 ref 防重复 replace。
- `stores/project.ts`：新增 `patchChapterMetadata(chapterId, { textLength, documentUpdatedAt })`——**不可变**递归更新 `outline`（未命中分支保持原引用），不改 `outlineWithMetadata` 标志；`project.test.ts` 断言不可变与未命中不换根。
- `ChapterEditor`：保存成功（自动/手动，含 409 覆盖分支）后调用 `onSaved({ charCount, updatedAt })`；`Writing` 传入并 patch store。**不重拉大纲树**。
- 先 `pnpm -r build` 再跑下游（shared/db 改了 src）。

**硬完成判据**
- 只打开一章不保存 → `#/writing` 目标不变；保存 A 再保存 B → 进 B；B 软删后 → 回退 A。
- 保存后 rail 字数立即更新，网络里没有新的 `GET /outline`。
- `pnpm -r build`、`pnpm --filter @whispering233/ai-editor-client test`、`pnpm --filter @whispering233/ai-editor-db test`、`pnpm --filter @whispering233/ai-editor-server test`、`pnpm typecheck`、`pnpm lint` 全绿。
- 浏览器验收（独立 `ui-verifier`，≤5 项）：保存后 `#/writing` 落到该章、字数即时、软删回退。
- 新 commit + `git status` 干净；汇报 hash/输出。

### writing-4-remove-chapter-view — 删章视图与旧路由收口

**状态**：待执行
**依赖**：writing-3
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
