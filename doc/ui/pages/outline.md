# Outline 大纲树原型

## 路由与数据

- 路由：`#/outline`
- 数据：`GET /api/v1/outline`（整树）
- 操作：`POST /outline`（建）、`PUT /outline/:nodeId`（改）、`PUT /outline/:nodeId/move`（移）、`DELETE /outline/:nodeId`（软删）、`PUT /project/config`（设当前位置）

## 布局线框

```
┌──────────────────────────────────────────────────────────┐
│ 大纲                          [全部展开/折叠] [+ 新建]       │
├──────────────────────────────────────────────────────────┤
│ ▾ 卷1 第一卷                        更新于 8-01   ＋ ⋯    │
│   ▾ 章1 第一章                      更新于 8-01   ＋ ⋯    │
│     · 场景 灵根测试失败              更新于 8-02   · ⋯    │
│     · 场景 被逐出师门                             · ⋯    │
│   ▾ 章2 第二章                                        ＋ ⋯ │
│     · 场景 …                                          · ⋯ │
│ ▸ 卷2 第二卷                                          ＋ ⋯ │
└──────────────────────────────────────────────────────────┘
```

行结构：`[折叠箭头] [类型徽标 卷/章/场] [标题（点击就地编辑）] [摘要·弱化截断（点击就地编辑）] [＋ 就地新建] [⋯ 操作菜单] [当前位置徽标] [更新于]`

> **操作区布局（2026-08 修订）**：右侧操作区（＋ / ⋯ / 位置徽标 / 时间戳）**紧凑跟随节点内容**，不做两端对齐（避免中间大片空白）；顺序固定为 ＋ → ⋯ → 位置徽标 → 时间戳。摘要限宽（`max-w-[45%]`）防止挤压操作区。

- 整行可**拖拽**（编辑态除外）；标题/摘要点击进入行内编辑。
- ⋯ 菜单：新建子节点 · 移动到… · 设为当前位置 · **详情**（S12.2：跳 `#/outline/:nodeId` 节点详情页，替代原行内「变更记录」面板）· 移入回收站（软删）。

## 信息层级

| 展示 | API 字段 |
|------|---------|
| 树 | `GET /outline` → `children[]`（OutlineNode：`id` / `type` / `title` / `summary` / `children` / `updatedAt`） |
| 层级约束 | 严格三层 volume → chapter → scene，无游离节点（决策 19）；渲染层不做任何「容错展示」 |

## 关键交互（S2.4 修订：就地为主，弹窗仅保留必要场景）

### 就地编辑标题/摘要

- 点击标题或摘要 → 行内变输入框（自动聚焦、`maxLength=200`）。
- **Enter 保存**（`PUT /outline/:nodeId { title? / summary? }`）→ toast「已保存」+ 重拉树；**Esc 取消**；**失焦保存**。
- 提交判定（`lib/outline-tree.ts` 纯函数）：标题非空且有变化才提交；摘要允许清空（清除摘要）；无变化不发请求。
- 摘要非高频但同样行内（不弹窗）；编辑态行禁用拖拽。

### 就地新建节点

- 行尾「＋」（scene 行无）或 ⋯ 菜单「新建子节点」→ 父 children 末尾插入行内输入框（缩进对齐下一层，自动展开父）。
- 类型由父决定（`CHILD_TYPE`）：卷 → 章、章 → 场；**root 顶层**（顶部「+ 新建」/空态）输入行带「卷/章」切换（决策 19：chapter 可挂 root）。
- **Enter 创建**（`POST /outline { type, title, parent_id }`）→ 就地出现在树中 + 高亮（3s）；**Esc 或失焦取消**（空值不误建）。

### 移动（拖拽优先）

- **原生 HTML5 DnD**（无第三方库）：整行拖拽（编辑态除外）→ 悬停目标行/顶层空白区，合法目标高亮（`canMoveTo` 纯函数：决策 19 层级过滤 + 不能挂自己/子树）→ 放下即移动，**落点 = 目标父末尾**（精确插入位置留「移动到…」对话框或后续增强）。
- ⋯ 菜单「移动到…」对话框保留为兜底（复杂目标选择/精确位置：目标父 + 排最前/排在某节点后/排最后）。

### 设为当前位置

- ⋯ 菜单「设为当前位置」→ `PUT /project/config { current_position: nodeId }`。
- 生效后行尾显示「当前位置」徽标，顶栏同步更新（project store 广播）。
- 伏笔面板健康指标依赖此值（决策 21）；未设置时该节点行无徽标。

### 软删（移入回收站）

- ⋯ 菜单 → 确认对话框（危险操作必须确认，layout.md §3.2），展示级联影响：`DELETE /outline/:nodeId` 响应 `cascaded.{ children, relations, deltas }` → 确认后行消失 + toast「已移入回收站（含 N 个子节点）」。

### 变更记录（节点触发的 Delta，S5.4）

- **入口（S12.2 修订）**：⋯ 菜单「详情」→ `#/outline/:nodeId` 节点详情页（行内展开面板已随详情页落地移除）；变更记录列表在详情页「变更记录」区块展示。
- **数据**：`GET /api/v1/delta/node/:nodeId` → `{ nodeId, deltas: DeltaRecord[] }`（客户端按 `order` 升序兜底排序）。
- **行结构**：主行 = `description`（主文案）+ 创建时间（`formatTimestamp`）；次行 = 目标徽标（`targetType` 中文 + `targetName ?? targetId`）+ changes 紧凑 chips（`lib/delta.ts describeChange`：set=`field = to`、update=`field from → to`、add=`field +value`、remove=`field -value`；chip 底色 `bg-muted`）。
- **空态**：该节点没有变更记录（轻量文案，不打断树操作）。
- **错误态**：契约未定义该端点 404（endpoints.md L436-462）——节点缺失/软删 → 200 空数组（缺失即空态）；`OUTLINE_NODE_NOT_FOUND` 分支为**防御分支**（当前不可达，保留防契约变化）；网络失败 → 提示 + [重试]。

## 状态

- **空态**：无任何节点 → 居中「大纲还是空的，先建第一卷」+ 主按钮 [新建第一卷]（点击直接进入就地输入，类型锁定卷；空态输入行同样支持卷/章切换）。
- **加载态**：树骨架。
- **错误态**：
  - `VALIDATION_ERROR`（如 scene 挂 volume 下、parent_id 缺失）→ 就地操作失败横幅。
  - `OUTLINE_NODE_NOT_FOUND`（节点已被 purge）→ 错误横幅 + 刷新树。
  - `PUT /project/config` 失败（`current_position` 指向软删节点，服务端拒绝）→ toast「该节点已删除，无法设为当前位置」。
  - `GET /delta/node/:nodeId` 失败（网络；防御分支 `OUTLINE_NODE_NOT_FOUND` 当前不可达——缺失即 200 空态）→ 面板内错误 + [重试]，不阻塞树操作。

---

# OutlineDetail 节点详情页（S12.2，决策 23）

> 大纲节点的编辑权威页：标题/摘要 + 结构化 data（麦基字段集）表单、变更记录列表、相关实体；大纲树列表页 ⋯ 菜单「详情」进入。契约：决策 23、schema.md outline.json「节点结构化信息 data」节、endpoints.md 大纲端点（GET /outline 返回 data、PUT /outline/:nodeId 支持 data 部分合并）。

## 路由与数据

- 路由：`#/outline/:nodeId`（中栏大纲 tab 二级路由，main.tsx outline 分支拦截第二段，仿 `#/entities/:type/:id`；`#/outline` 仍是列表页）
- 数据：**节点本体来自 project store 的 outline 树**（`GET /outline` 已含 data）——按 nodeId `findNode` 查找（软删/缺失 → 404 态），不单独请求节点详情端点
- 变更记录：`GET /api/v1/delta/node/:nodeId`（列表区块）
- 相关实体：`GET /api/v1/relation?source_type=outline_node&source_id=:nodeId&depth=1`（本节点作为 source 的关系）
- 编辑：`PUT /api/v1/outline/:nodeId`（title/summary/data 可部分更新；data 部分合并——未传字段保留）

## 布局线框

```
┌──────────────────────────────────────────────────────────────────┐
│ [大纲 › 第一卷 › 第二章 › 灵根测试]       [保存]                    │
│ 场 · 更新于 8-02 · [当前位置]                                      │
├────────────────────────────────────────┬─────────────────────────┤
│ 基础信息                                 │ 相关实体（本节点为源）    │
│ 标题:   [灵根测试              ]        │ 剧情连线 → 第4章·夜宴 [删除]│
│ 摘要:   [测试灵根品质的仪式      ]        │ 出现于 → 灵根峰      [删除]│
│ 结构化信息（场景）                        │                          │
│ 场景目标: [确认灵根品质        ]         │ [+ 新增关联]              │
│ 冲突层次: [✓内心] [✓人际] [社会]        │                          │
│ 开场价值: [希望            ]            │                          │
│ 收场价值: [绝望            ]            │                          │
├────────────────────────────────────────┤                          │
│ 变更记录（N 条）                         │                          │
│ · 灵根测试失败被逐出师门  8-02           │                          │
│   人物《张三》 [更新 状态 活跃→中立]      │                          │
├────────────────────────────────────────┤                          │
│ 伏笔标记（占位）                         │                          │
└────────────────────────────────────────┴─────────────────────────┘
```

## 信息层级

### 元信息（header 区）

| 展示 | 来源 |
|------|------|
| 面包屑「大纲 › … › 节点名」 | 树路径（`findNodePath`）；父级段点击跳 `#/outline/:parentId`，首段「大纲」跳 `#/outline`，当前段高亮不可点（共用 `components/page-nav/Breadcrumb.tsx`） |
| 类型徽标 卷/章/场 | `node.type` → `TYPE_LABEL`（components/outline/dialogs） |
| 更新时间 | `node.updatedAt`（`formatTimestamp`） |
| 当前位置徽标 | `node.id === config.currentPosition`（同大纲列表页） |

### data 字段表单（按节点层级渲染；lib/outline-detail.ts `detailFieldsForNodeType`）

| 层级 | 字段 | 控件 |
|------|------|------|
| scene | `goal` 场景目标/欲望 | 多行文本（max 1000） |
| scene | `conflict_levels` 冲突层次 | 多选 checkbox 组（`CONFLICT_LEVELS`：inner/personal/extra_personal → 内心/人际/社会，`CONFLICT_LEVEL_LABEL`） |
| scene | `value_from` 开场价值 / `value_to` 收场价值 | 单行文本（max 200，双输入） |
| chapter | `reversal` 章末反转 | 多行文本（max 1000） |
| chapter | `climax_scene` 章高潮场景 | 场景节点选择器 |
| volume | `climax_scene` 幕高潮场景 / `inciting_scene` 激励事件 | 场景节点选择器（双选择器） |

- **场景节点选择器**：下拉仅列树中 scene 节点（`sceneNodeOptions`：flattenTree 过滤 type=scene，缩进沿用），空选项「（未设置）」；表单值为空串/缺失 → 未设置态。**引用清除语义**：未设置提交空串 `""`（服务端 schema 为 `z.string().optional()` 不接受 null；浅合并空串即覆盖清除）。
- **防御分支**：当前值非空但不在选项集（引用节点已被删/purge）→ 追加临时 option（id 原文 + 「（已删除）」标注），避免 select 静默显示空白。
- 未知/自定义字段（schema passthrough）不渲染控件、保存时原样保留（浅合并不动未传字段）。

## 关键交互

- **编辑与保存**：基础信息 + data 字段同一表单，header [保存] 一次提交（diff 只传变更字段）：
  - title：非空且变化才提交（`shouldCommitTitle`）；清空 → 行内「标题不能为空」不发请求。
  - summary：有变化才提交，允许清空（提交空串 `""`——服务端 `patch.summary !== undefined` 即写入，真正清除摘要）。
  - data：`diffData`（lib/entity-detail，JSON 序列化 + 空值规约）只提交变更字段 → `PUT { data }` 浅合并。
  - 成功 → toast「已保存」+ 重拉 outline 树（节点 updatedAt 刷新，表单重置为服务端权威值）；`VALIDATION_ERROR`（字段超长/非法枚举）→ 表单卡底部行内错误横幅；`OUTLINE_NODE_NOT_FOUND`（节点已被 purge）→ 404 态。
- **变更记录区块**：`components/delta/node-delta-list.tsx`（S5.4 行内面板逻辑迁移：加载/错误重试/空态/列表行 + changes chips）；「+ 新建变更」入口 S12.3 提供，本页暂无。
- **相关实体区块**：复用 `components/entity/relations-view.tsx`（新增 `scope` prop：仅查本节点作为 source 的 1 跳关系、隐藏过滤区）；[+ 新增关联] → `CreateRelationDialog`（`RelationSource` 扩展支持 `outline_node`，源固定为本节点，目标端四类实体或大纲节点）。行内端点链接：四类实体跳 `#/entities/:type/:id`，大纲节点跳 `#/outline/:nodeId`（U8 关联 tab 同效）。删除关系物理删确认（同 U8）。
- **伏笔标记**：占位区（空态说明「伏笔标记将在伏笔面板（S9）落地」），S9 后接入 plants/advances/resolves 标记。

## 状态

- **404 态**：树中找不到节点（不存在/已软删/已 purge）→ 居中「该节点不存在或已被删除」+ [去回收站]（`#/trash`）+ [返回大纲]（`#/outline`）。
- **加载态**：大纲树骨架（outline store 未就绪时触发 loadOutline；加载中显示树骨架，不闪「加载失败」）。
- **树加载失败**：区块内「大纲加载失败」+ [重试]（loadOutline 静默吞错后的兜底呈现，同大纲列表页）。
- **表单无项目**：`config === null` 未打开项目 → 引导回首页（同大纲列表页）。
