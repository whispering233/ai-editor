# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### C6 — 大纲画布骨架（只读呈现 + 摆位）

#### 范围
- 依赖：`@xyflow/react@12.12.1`（exact，client `dependencies`）+ `pnpm install`；样式只引 `@xyflow/react/dist/base.css`（在页面或 `main.tsx` 顶部一次），`--xy-*` 覆盖唯一入口 = `components/outline-canvas/canvas-theme.css`。
- 导航：`components/nav/nav-items.tsx` 的 `novel.items` 在「大纲」后加 `{ key: "/canvas", icon: <DeploymentUnitOutlined />, label: "大纲画布" }`（**`ShareAltOutlined` 已被「关联」占用**，勿复用）；`hooks/use-route.ts` 的 `KNOWN_ROUTE_SEGMENTS` 加 `canvas`，文件头注释的「10 路由」与「已移除」说明同步；`main.tsx` 加 `case "canvas"`。`lib/workspace-route-guard.ts` **不用改**（小说侧默认放行、只挡练习段）。
- 页面：`pages/OutlineCanvas.tsx`（壳）+ `components/outline-canvas/`（`ChapterCard.tsx`、`canvas-theme.css`、`lib/outline-canvas-layout.ts`）。
- 数据：`useOutlineLoader({ withMetadata: true })`（`{ reload, retry }`）+ shared `numberVisibleOutline`；只渲染 `chapter` 节点；卡片 = `第N卷` + `第N章`（两档 TypeChip，同大纲页）+ 章名 + 伏笔徽标（复用大纲页徽标组件）+ `N 场`。
- 摆位：`lib/outline-canvas-layout.ts` 纯函数（每行 8 为常量、卡宽/高/间距常量单点）：缺失坐标的章补到网格末尾、已有坐标不动；`localStorage` key = `ai-editor:canvas:{projectId}`（`projectId = useProjectStore(s => s.config?.id ?? null)`；**为 null 时不持久化**，只在内存里摆），结构 `{ nodes: {id:{x,y}}, viewport?: {x,y,zoom} }`；读写要防御坏 JSON、丢弃已删 id；首帧无 viewport → `fitView`，有则恢复；MiniMap + Controls（缩放 0.25–2）。
- 状态：空态（「还没有章节」+ 去大纲新建）、骨架、错误条 + 重试、未打开项目引导；窄屏全宽（无 master-detail）；antd 浮层 `getPopupContainer` 指向画布容器。
- 单测：布局纯函数（空树 / 只有卷 / 卷章混合 / 缺坐标补位 / 已有坐标不动 / 已删 id 清理 / 旧格式兼容）。

#### 依赖
C1。

#### 完成判据
`pnpm -r build` → `pnpm typecheck` / `pnpm lint` 绿；`pnpm --filter @whispering233/ai-editor-client test` 绿；一卡一 commit；`git status` 干净。浏览器核对（100+ 章、刷新后坐标/缩放保持、MiniMap 可见）另派 ui-verifier，不在本卡内。

### C7 — 大纲画布连线（plot_edge CRUD）

#### 范围
- **前置（翻掉 C6 的只读开关）**：`OutlineCanvas.tsx` 的 `nodesConnectable={false}` / `elementsSelectable={false}` / `edges={EMPTY_EDGES}` 三处；`ChapterCard` 补 `<Handle type="source">` / `<Handle type="target">`（位置与颜色走 `canvas-theme.css` 的 `--xy-handle-*`，不在组件里写色值）。
- 拖出即连：source handle → target card；空边（metadata 空）直接 POST；自连 / 落空取消；重复边 409 → toast。
- 边：`label` 线上显示（空则不画文字）、选中态、点击开右侧抽屉（复用 C4 表单 + 删除按钮）；`Delete` 键与浮条按钮 → `ConfirmDialog` 物理删。
- 单卡选中 = 聚焦邻边（其余边降透明）；点空白取消；双击卡片 = `#/outline/:id`。
- 数据：`listRelations({ relation_type: "plot_edge", depth: 1 })`（`packages/client/src/lib/api.ts:617`）；`edge.id` = 关系 id；**两端 id 不在可见章集合内的边直接丢弃**（脏数据 / 旧卷场景边）。
- 建边：`createRelation({ source_type: "outline_node", source_id, target_type: "outline_node", target_id, relation_type: "plot_edge" })`（`:653`）；409 `RELATION_EXISTS` → toast，不重复加边；自连 / 落空取消。
- 编辑：`updateRelationMeta(relationId, buildRelationMetadataPayload(base, draft))`（`:673`，复用 C4 的 `EditRelationDialog`）。
- 删边：边是**受控**的 ⇒ `onEdgesDelete` 里先 `ConfirmDialog`，确认后 `deleteRelation(id)`、取消则状态不动；`deleteKeyCode="Delete"`；`onNodesDelete` 不实现（节点不可删）。
- 选中：`onNodeClick` 记聚焦章 id，非邻边 opacity 降（`edge.style` / `node.style` 是 React Flow 的 API，不算内联 CSS）；点空白清除。
- 单测：拖连 payload（纯函数）；邻边过滤；脏边丢弃；删边确认路径。

#### 依赖
C4、C6。#### 完成判据
：`pnpm -r build` → `pnpm typecheck`/`lint` 绿；client 测试绿；浏览器实测（连边 / 改 label / 删边 / 刷新后边仍在，截图）；commit + 干净。
