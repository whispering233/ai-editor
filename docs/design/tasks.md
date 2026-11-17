# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### C3 — 客户端关系类型谓词收窄（删硬编码特例）

#### 范围
- `packages/client/src/lib/relation-types.ts`：删除 `DIALOG_RELATION_TYPES` 的类型清单与 `hookAnchorAllowed` 的判断，改为经 shared `allowedRelationTypes` / `relationTypeAllowedFor` 派生（端点 = 源 `{type, nodeType?}` + 目标 `{type}`）；**保留两条非矩阵口径**：①「`group === "mount"` 不进通用对话框」（由 group 派生、不列类型名；挂载仍只由时间轴 UI 建）；② 源为 `outline_node` 但 `nodeType` 缺失时，伏笔三类（`HOOK_RELATION_TYPES`）fail-closed 排除——shared 谓词对缺失 `nodeType` 是通配，客户端此处要比它更严，否则会造出服务端必定 400 的入口。
- `components/entity/create-relation-dialog.tsx`：关系类型下拉按「源端点 + 目标端点」双端收窄（目标类型变化要重算；详情模式源固定、列表模式源类型可选）；**提交前再校验一次** `relationTypeAllowedFor`——类型输入是自由文本 `AutoComplete`，下拉只是建议，不加这道 guard 就仍能提交 `ally`(location→character)。
- `components/entity/relations-view.tsx` 的**筛选行不改**：它过滤的是存量关系（当前实体可能是目标端），按矩阵收窄会把合法行藏掉。
- 单测：地点→人物 不含 `ally`/`kills`；人物→人物 不含 `belongs_to`/`plants`；章→伏笔 含 `plants`/`advances`/`resolves`；卷→伏笔 不含；`nodeType` 缺失的 outline_node 源不含伏笔三类；`mount` 组恒不进对话框；提交 guard 对非法组合返回错误文案。

#### 依赖
C1。

#### 完成判据
`pnpm -r build` → `pnpm typecheck` / `pnpm lint` 绿；`pnpm --filter @whispering233/ai-editor-client test` 绿；浏览器实测一次（地点源 + 人物目标，下拉里没有「盟友」）；一卡一 commit，`git status` 干净。

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
