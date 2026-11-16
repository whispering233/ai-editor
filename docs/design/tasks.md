# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### 卡 1：大纲页分栏壳、路由与响应式

- **目标**：`#/outline` 与 `#/outline/:nodeId` 都由同一个 `<Outline nodeId={...} />` 分栏壳渲染：左 rail 显示现有大纲树（能力暂保持现状），右详情列显示 `OutlineDetail`；完成宽度拖拽 / 收起、窄屏两级互斥、空态 / 错误态 / 加载态、页头常驻。
- **允许改**：`packages/client/src/main.tsx`、`packages/client/src/pages/Outline.tsx`、新增 `packages/client/src/hooks/use-outline-rail.ts`；如需拆栏头可新增 `packages/client/src/components/outline/outline-rail-header.tsx`。`packages/client/src/pages/OutlineDetail.tsx` 仅做「可嵌入」的最小改动（允许暂时保留自身 loader，卡 3 移除）；新增 `packages/client/src/hooks/use-outline-rail.test.ts` 覆盖纯函数防御分支。
- **不做**：不改写作页 / `use-writing-rail.ts`；不改 API / DB / tools；不删除现有树能力；不做 dirty 守卫（卡 3）；不改写作页旧路由。
- **验收**：桌面 `#/outline` = 树 + 空详情；`#/outline/:id` = 树 + 详情；宽度默认 `max(320px, 中栏 1/3)`、拖拽 280–600、收起 0、刷新保持（`ai-editor:outline-rail`）；窄屏 `#/outline` 树全宽、`#/outline/:id` 详情 + 「大纲树」返回条；无项目 / 空树 / 坏 id 都有页头与引导；rail header 40px、详情页头常驻；`outline.test.tsx` 的 SSR 断言同步更新（补 `useMediaQuery` mock）。
- **完成判据（硬）**：`git log --oneline -1` 含本卡 commit；`git status --porcelain` 为空；汇报附 commit hash + `pnpm typecheck` + `pnpm lint` + `pnpm --filter @whispering233/ai-editor-client test` 的输出摘要。oracle：reviewer 独立复跑 + 浏览器核一次分栏 / 窄屏。

### 卡 2：大纲树平移、URL 选中与行视觉

- **目标**：树在 rail 内保留原大纲树全量能力；**选中唯一来源 = URL**；单击行体 = 选中并进详情，标题 / 摘要单击只编辑，双击不再进详情；选中 = `bg-accent` + `aria-current`；推演 / 阅读进度徽标改 icon + `title` / `aria-label`；选中变化 / 树刷新展开祖先并 `scrollIntoView({ block: "nearest" })`；删除当前节点 / 其祖先导致 URL 节点消失 → `location.replace("#/outline")`；新建 / 链式新建后选中并进详情。
- **允许改**：`packages/client/src/pages/Outline.tsx`、`packages/client/src/components/outline/*`、`packages/client/src/lib/outline-tree.ts`（仅在缺少 helper 时补纯函数）、`outline.test.tsx`。
- **不做**：不改详情表单 / loader（卡 3）；不做跨页 `focusOutlineNodeId` 深链（卡 4）；不改拖拽 / 右键菜单的既有语义；不迁 antd Tree。
- **验收**：单击行体进 `#/outline/:id`（同 id 不重复 push）；标题 / 摘要编辑不切详情；右键菜单、拖拽、全部折叠、行内新建 / 删除仍可用；选中行可见且样式为 `bg-accent`；删除当前 / 祖先节点后回到 `#/outline`；图标徽标带完整 `title` / `aria-label`；无新增硬编码色。
- **完成判据（硬）**：同上（新 commit + 干净工作区 + typecheck / lint / client test 输出）。oracle：reviewer 独立复跑 + 浏览器逐条核行手势。

### 卡 3：详情接入、单一数据源与未保存守卫

- **目标**：`OutlineDetail` 接受 `node`（壳 `findNode` 派生）/ `nodeId` / `reload` / `leading`（收起钮）/ `onDirtyChange`，移除自身 `useOutlineLoader`；`useDataRefresh` 只刷关系 / 变更记录，**不再 `reload()` 整树**；保存成功后由壳 `reload()` 收敛并重置表单；dirty 时 rail 切换（含新建 / 链式新建）/ 空白区清选中 / 窄屏返回条先 `confirm`；`Ctrl/Cmd + S` 在行内编辑与详情表单间正确分层；`notFound` / 空态也保留页头与收起钮。
- **允许改**：`packages/client/src/pages/OutlineDetail.tsx`、`packages/client/src/pages/Outline.tsx`（host / 回调）、`outline.test.tsx`。
- **不做**：不新增 API / DB / 工具；不改详情字段与保存 payload；不拦浏览器后退 / 「写正文」外链（登记 `backlog.md`）；不把详情改成自动保存。
- **验收**：打开详情只发一次大纲 GET（壳持有）；保存后 rail 标题 / 摘要即时更新且表单不闪回旧值；切换节点 / 新建导航 / 空白区 / 窄屏返回在 dirty 时弹确认，取消留在原处；`Ctrl+S` 在行内编辑时保存行内、否则保存详情；坏 id / 无节点页头常驻且有返回入口；`pnpm --filter @whispering233/ai-editor-client test` 绿。
- **完成判据（硬）**：同上。oracle：reviewer 独立复跑 + 浏览器核「保存 → 切换 → 再打开」与 409 / 保存失败路径。

### 卡 4：跨页定位与边角收敛

- **目标**：`focusOutlineNodeId`（概览开场跳转）在树就绪后展开祖先、3s 高亮并 `location.replace("#/outline/:id")`；深链 `#/outline/:id` 直接选中；删除当前节点 / 祖先 / 全部折叠 / 刷新后的选中与详情保持；空树 CTA「新建第一卷」；无项目 / 加载失败 / 坏 id 的文案与返回路径统一。
- **允许改**：`packages/client/src/pages/Outline.tsx`、`packages/client/src/pages/OutlineDetail.tsx`、`packages/client/src/lib/outline-tree.ts`（仅纯函数）、`outline.test.tsx`。
- **不做**：不做虚拟滚动、键盘导航、折叠态持久化、自动选中上次编辑节点（均留 `backlog.md`）；不改 `current_position` 语义。
- **验收**：从概览「阅读进度」/ 关系面板跳转后 URL 为目标节点、祖先已展开、高亮约 3s；`#/outline` 不自动选中；删除祖先节点后不出现死详情；「全部折叠」按字面执行且详情保留；空树 / 无项目 / 坏 id 的按钮可达。
- **完成判据（硬）**：同上。oracle：reviewer 独立复跑 + 浏览器核深链与删除边角。

### 卡 5：测试、像素走查与文档收口

- **目标**：补 `outline.test.tsx` 的 SSR 断言（树 / 详情 / 空态 / 窄屏 / 图标徽标）；`use-outline-rail` 的纯函数测试已随卡 1 落地，本卡只复跑；跑全量验证；由 `ui-verifier` 做有上限的浏览器像素走查；更新 `CHANGELOG.md` Unreleased；清空本文件的任务卡。
- **允许改**：`packages/client/src/pages/outline.test.tsx`、`CHANGELOG.md`、`docs/design/tasks.md`。功能缺陷回到对应卡修，不在本卡顺手改设计。
- **不做**：不新增功能 / 不扩 API / 不改 `DESIGN.md` 已定稿的交互口径（除非发现文档与实现矛盾，先停下提问）。
- **验收**：`pnpm typecheck`、`pnpm lint`、`pnpm -r test` 全绿；`ui-verifier` 按条目上限核桌面 1440 / 窄屏 390 的分栏、收起、选中、图标徽标、空态、dirty 确认；CHANGELOG 只记用户可见变化；`tasks.md` 回到「暂无」。
- **完成判据（硬）**：`git log --oneline -1` 含本卡 commit；`git status --porcelain` 为空；汇报附 commit hash + 三条命令输出摘要 + ui-verifier 的逐条证据。oracle：ui-verifier 独立验收（不在本卡 commit 内）。
