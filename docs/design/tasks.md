# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### C1 — shared 关系契约：端点适用性 + metadata 归一

#### 范围
- `packages/shared/src/constants/entity.ts`：`RELATION_TYPE_META` 增可选字段 `endpoints?: readonly { from: EndpointRef; to: EndpointRef }[]`（`EndpointRef = { type: EntityType | "outline_node"; nodeType?: OutlineNodeType }`），按 `docs/db/schema.md` 预定义关系类型表的「端点」列逐条填；举证不足者（`appears_in` / `involves`）保持不写（= 通配）。
- `packages/shared/src/utils/relation-type.ts`：`RelationEndpointRef` 类型 + `relationTypeAllowedFor(type: string, from: RelationEndpointRef, to: RelationEndpointRef): boolean`（未知 / 自定义类型 = true；成对匹配，`nodeType` 只在声明侧与传入侧都给出时比较）+ `allowedRelationTypes(from, to): RelationType[]`（= `RELATION_TYPES.filter(...)`，供对话框与关联页筛选一次取全）。`RelationEndpointRef` 的实体侧用既有实体类型（`ENTITY_TYPES` 元素类型），不新建重复枚举。
- `packages/shared/src/types/api.ts` 关系 schema 段：`RelationMetadata = { label?: string; description?: string }` + `normalizeRelationMetadata(input: unknown): Record<string, unknown>`（`trim`、空串删键、非字符串丢弃、其余键原样保留）；经 shared 根入口导出。
- 单测：矩阵正反例（`character→character` 的 `ally` 通过、`location→character` 拒绝；`occurs_at` 的 `timepoint→location` 拒绝；`plot_edge` 仅章→章；自定义类型恒 true）；归一（trim / 空串 / 非字符串 / 保留别的键）。

#### 完成判据

- `pnpm -r build` → `pnpm typecheck` 绿；`pnpm --filter @whispering233/ai-editor-shared test` 绿。
- `git log -1` 是新 commit 且 `git status` 干净（无 commit 不许报 PASS）。

### C2 — 服务端 metadata 归一（POST / PUT 同口径）

#### 范围
- `packages/server/src/routes/relation.ts`：POST 与 PUT 都经 `normalizeRelationMetadata`；PUT 现有的手写 trim（:175 附近）删除；`description` 同样 trim / 空串删键。
- 单测：POST 带 `{label:"  x  ", description:"  y  "}` 落库为 trim 后；空串删键；非字符串被丢弃；PUT 清空传 `{}`。

#### 依赖
C1。#### 完成判据
：`pnpm -r build` → `pnpm typecheck` 绿；`pnpm --filter @whispering233/ai-editor-server test` 绿；commit + 干净。

### C3 — 客户端关系类型谓词收窄（删硬编码特例）

#### 范围
- `packages/client/src/lib/relation-types.ts`：删除 `DIALOG_RELATION_TYPES` 的手写类型清单与 `hookAnchorAllowed` 的手写判断，改为经 shared `allowedRelationTypes` / `relationTypeAllowedFor` 派生（对话框选源 / 目标类型时收窄类型下拉；「关联」页筛选行同步）。**保留「`group === "mount"` 不进通用对话框」这条分组规则**（它由 group 派生、不列类型名；矩阵已覆盖 `occurs_at` 的两种端点组合，但挂载仍只由时间轴 UI 建）。
- `components/entity/create-relation-dialog.tsx` / `relations-view.tsx` 消费新谓词；端点类型变化时若当前关系类型不再合法 → 清空类型选择。
- 单测：选「地点」源 + 「人物」目标时下拉不含 `ally` / `kills`；选章 + 伏笔时仍仅 `plants` / `advances` / `resolves`。

#### 依赖
C1。#### 完成判据
：`pnpm -r build` → `pnpm typecheck` / `pnpm lint` 绿；`pnpm --filter @whispering233/ai-editor-client test` 绿；commit + 干净。

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
- `packages/tools/src/proposal/relation.ts`：生成提案前用 shared `relationTypeAllowedFor(resolveEndpoint(source), resolveEndpoint(target))` 校验，不合法抛错（工具失败，不生成提案）；`metadata` 经 `normalizeRelationMetadata` 后写入提案。
- `packages/tools/src/schemas/proposal.ts`：`metadata` 描述改为 `{ label?, description? }`（数字 / 阈值不写在描述里；如有上限由常量插值）。
- 单测：`ally` 指向地点 → 抛错；章→章 `plot_edge` + `description` → 提案 metadata 归一；`appears_in` 任意实体仍通过。

#### 依赖
C1。#### 完成判据
：`pnpm -r build` → `pnpm typecheck` 绿；`pnpm --filter @whispering233/ai-editor-tools test` 绿（filter 名以 package.json 为准）；commit + 干净。

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
