# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

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
