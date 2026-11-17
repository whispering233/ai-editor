# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### C4 — 关系说明编辑（label + description 共用表单）

#### 范围
- `components/entity/relations-view.tsx` 行尾加「编辑」`icon-button`（`EditOutlined`，删除按钮左侧）→ 受控 Dialog（复用 `components/ui/dialog.tsx`）：`label`（`input`）+ `description`（`textarea`）→ `PUT /api/v1/relation/:id`（metadata 整体替换，关框不提交）；成功后重载列表 + toast。
- 表单组件抽到可复用位置（画布抽屉复用同一表单），提交逻辑与校验单份。
- 单测：提交 payload 形状；空串 → 键被删；失败保留输入并显示错误。

#### 依赖
C1、C2。#### 完成判据
：`pnpm -r build` → `pnpm typecheck`/`lint` 绿；client 测试绿；浏览器实测两处入口（列表 / 画布在 C7 复验）；commit + 干净。

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
- 依赖：`@xyflow/react@12.12.1`（精确版本，client `dependencies`）+ `pnpm install`。
- 导航：`components/nav/nav-items.tsx` 小说项集在「大纲」后加 `{ key: "/canvas", icon: <ShareAltOutlined />, label: "大纲画布" }`；`hooks/use-route.ts` 的 `KNOWN_ROUTE_SEGMENTS` 加 `canvas`；`main.tsx` 路由挂载。
- 页面：`pages/OutlineCanvas.tsx`（壳）+ `components/outline-canvas/`（`ChapterCard`、`canvas-theme.css`、`lib/outline-canvas-layout.ts`）。
- 数据：复用 `useOutlineLoader({ withMetadata: true })` + `numberVisibleOutline`；只渲染 `chapter` 节点；卡片含 `第N卷` / `第N章` / 章名 / 伏笔徽标 / `N 场`。
- 摆位：网格补位纯函数（每行 8，常量单点）+ `localStorage` `ai-editor:canvas:{projectId}`（读写、已删 id 清理、旧格式兼容）；`fitView` 首帧；MiniMap + Controls（0.25–2）；antd 浮层 `getPopupContainer`。
- 状态：空态 / 骨架 / 错误条 + 重试 / 未打开项目引导；窄屏全宽。

#### 完成判据
：`pnpm -r build` → `pnpm typecheck`/`lint` 绿；`pnpm --filter @whispering233/ai-editor-client test` 绿；浏览器实测截图（100+ 章、刷新后坐标保持、缩放保持、MiniMap 可见）；commit + 干净。

### C7 — 大纲画布连线（plot_edge CRUD）

#### 范围
- 拖出即连：source handle → target card；空边（metadata 空）直接 POST；自连 / 落空取消；重复边 409 → toast。
- 边：`label` 线上显示（空则不画文字）、选中态、点击开右侧抽屉（复用 C4 表单 + 删除按钮）；`Delete` 键与浮条按钮 → `ConfirmDialog` 物理删。
- 单卡选中 = 聚焦邻边（其余边降透明）；点空白取消；双击卡片 = `#/outline/:id`。
- 单测：拖连 payload；重复边错误处理；删边确认路径。

#### 依赖
C4、C6。#### 完成判据
：`pnpm -r build` → `pnpm typecheck`/`lint` 绿；client 测试绿；浏览器实测（连边 / 改 label / 删边 / 刷新后边仍在，截图）；commit + 干净。
