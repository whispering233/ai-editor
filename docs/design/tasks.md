# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### C5 — AI 工具收窄 + description 透传

#### 范围
- `packages/tools/src/proposal/types.ts`：`resolveEndpoint` 返回值补 `nodeType?: OutlineNodeType`（大纲节点侧 = `node.type`；实体侧不填）。**不改其它调用方的行为**。
- `packages/tools/src/proposal/relation.ts`：`buildProposeAddRelation` 在既有伏笔校验之后加端点矩阵校验——`relationTypeAllowedFor(args.type, from, to)`，不合法抛错（工具失败、不生成提案），文案带关系类型中文名与两端中文类型（`relationTypeLabel` 不可用则用 shared 标签表）。既有「伏笔源端仅章」保留在前（文案更具体）。
- **执行侧漏了归一（卡外发现，必须一起修）**：`packages/tools/src/executor/relation.ts` 的 `add_relation` **直连 db `createRelation`**，不经过 REST，所以 C2 的 normalizer 在 AI 路径上不生效。改为 `metadata` 存在时先过 shared `normalizeRelationMetadata` 再写库（不存在则不传键）。
- `packages/tools/src/schemas/proposal.ts`：`propose_add_relation` 的模型可见说明补「`metadata` 可传 `{ label, description }`（短标签 / 说明）」，**不写具体数字上限**（上限单源在 client `lib/relation-metadata.ts`，跨包复述会漂）。
- 单测：`ally` 地点→人物 抛错；`kills` 人物→人物 通过；章→章 `plot_edge` 通过、章→卷 `plot_edge` 抛错；`appears_in` 人物→章 通过、人物→人物 抛错；`occurs_at` 时间点→事件 通过；`add_relation` 执行把 `{label:" x ", description:"  ", extra:1}` 归一成 `{label:"x", extra:1}`（查 db 落库值）。

#### 依赖
C1、C2。

#### 完成判据
`pnpm -r build` → `pnpm typecheck` / `pnpm lint` 绿；`pnpm --filter @whispering233/ai-editor-tools test` 绿（filter 名以 package.json 的 `name` 为准，逐字一致）；一卡一 commit；`git status` 干净。

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
- 拖出即连：source handle → target card；空边（metadata 空）直接 POST；自连 / 落空取消；重复边 409 → toast。
- 边：`label` 线上显示（空则不画文字）、选中态、点击开右侧抽屉（复用 C4 表单 + 删除按钮）；`Delete` 键与浮条按钮 → `ConfirmDialog` 物理删。
- 单卡选中 = 聚焦邻边（其余边降透明）；点空白取消；双击卡片 = `#/outline/:id`。
- 单测：拖连 payload；重复边错误处理；删边确认路径。

#### 依赖
C4、C6。#### 完成判据
：`pnpm -r build` → `pnpm typecheck`/`lint` 绿；client 测试绿；浏览器实测（连边 / 改 label / 删边 / 刷新后边仍在，截图）；commit + 干净。
