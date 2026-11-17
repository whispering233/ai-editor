# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### 卡 4：跨页定位与边角收敛

- **目标**：`focusOutlineNodeId`（概览开场跳转）在树就绪后展开祖先、3s 高亮并 `location.replace("#/outline/:id")`；深链 `#/outline/:id` 直接选中；删除当前节点 / 祖先 / 全部折叠 / 刷新后的选中与详情保持；空树 CTA「新建第一卷」；无项目 / 加载失败 / 坏 id 的文案与返回路径统一；坏 id 空态按钮在窄详情列 `flex-wrap` + `whitespace-nowrap`（文字不竖排，必要时上下排）。
- **允许改**：`packages/client/src/pages/Outline.tsx`、`packages/client/src/pages/OutlineDetail.tsx`、`packages/client/src/lib/outline-tree.ts`（仅纯函数）、`outline.test.tsx`。
- **不做**：不做虚拟滚动、键盘导航、折叠态持久化、自动选中上次编辑节点（均留 `backlog.md`）；不改 `current_position` 语义。
- **验收**：从概览「阅读进度」/ 关系面板跳转后 URL 为目标节点、祖先已展开、高亮约 3s；`#/outline` 不自动选中；删除祖先节点后不出现死详情；「全部折叠」按字面执行且详情保留；空树 / 无项目 / 坏 id 的按钮可达。
- **完成判据（硬）**：同上。oracle：reviewer 独立复跑 + 浏览器核深链与删除边角。

### 卡 5：测试、像素走查与文档收口

- **目标**：补 `outline.test.tsx` 的 SSR 断言（树 / 详情 / 空态 / 窄屏 / 图标徽标）；`use-outline-rail` 的纯函数测试已随卡 1 落地，本卡只复跑；跑全量验证；由 `ui-verifier` 做有上限的浏览器像素走查；更新 `CHANGELOG.md` Unreleased；清空本文件的任务卡。
- **允许改**：`packages/client/src/pages/outline.test.tsx`、`CHANGELOG.md`、`docs/design/tasks.md`。功能缺陷回到对应卡修，不在本卡顺手改设计。
- **不做**：不新增功能 / 不扩 API / 不改 `DESIGN.md` 已定稿的交互口径（除非发现文档与实现矛盾，先停下提问）。
- **验收**：`pnpm typecheck`、`pnpm lint`、`pnpm -r test` 全绿；`ui-verifier` 按条目上限核桌面 1440 / 窄屏 390 的分栏、收起、卡 2 行手势与图标态（含伏笔徽标点击不导航）、卡 3 窄屏页头、卡 4 坏 id 窄列、空态、dirty 确认；CHANGELOG 只记用户可见变化；`tasks.md` 回到「暂无」。
- **完成判据（硬）**：`git log --oneline -1` 含本卡 commit；`git status --porcelain` 为空；汇报附 commit hash + 三条命令输出摘要 + ui-verifier 的逐条证据。oracle：ui-verifier 独立验收（不在本卡 commit 内）。
