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
│ ▾ 卷 第一卷            +  📖  🗑  [当前位置]  更新于 8-01    │
│   摘要：全书三卷结构，第一卷为入门试炼                     │
│   ▾ 章 第一章                 +  📖  🗑    更新于 8-02      │
│     摘要：灵根测试与逐出师门                               │
│     · 场 灵根测试失败  📌⏩    +  📖  🗑    更新于 8-02      │
│       灵根品质为杂灵根，测试失败被逐出师门                  │
│     · 场 被逐出师门           +  📖  🗑                     │
│ ▸ 卷 第二卷                  +  📖  🗑                     │
└──────────────────────────────────────────────────────────┘
```

**两行结构（S13.1 修订）**：每个节点 = 两行——
- **第一行**：`[折叠箭头] [类型徽标 卷/章/场] [标题（点击就地编辑）] [＋ 就地新建] [详情图标] [回收站图标] [当前位置徽标] [更新于]`
- **第二行**：摘要（缩进对齐标题下方，`text-xs text-muted-foreground`；**默认显示、为空不渲染**、点击可就地编辑，编辑态渲染输入行）。

> **操作区布局（S13.1 修订 + H2 + 批次四 I2）**：行尾操作**直接平铺**（无 ⋯ 菜单）——＋（scene 行无）/ 详情（Eye 图标，跳 `#/outline/:nodeId`；I2 起不用 BookOpen——详情入口统一视觉语义）/ 移入回收站（Trash2 图标，直接软删，不弹确认）；顺序固定 ＋ → 详情 → 回收站 → 当前位置徽标 → 时间戳，**紧凑跟随节点内容**（不推远、不两端对齐）。

- 整块（两行）可**拖拽**（编辑态除外）；标题/摘要点击进入行内编辑（交互同 S2.4）。

## 信息层级

| 展示 | API 字段 |
|------|---------|
| 树 | `GET /outline` → `children[]`（OutlineNode：`id` / `type` / `title` / `summary` / `children` / `updatedAt`） |
| 伏笔标记（S9.2） | `GET /relation`（source_type=outline_node × 三类并行）→ `lib/outline-hooks buildNodeHookMarks` 聚合（targetName ?? targetId） |
| 层级约束 | 严格三层 volume → chapter → scene，无游离节点（决策 19）；渲染层不做任何「容错展示」 |

## 关键交互（S2.4 修订：就地为主，弹窗仅保留必要场景）

### 就地编辑标题/摘要

- 点击标题或摘要 → 行内变输入框（自动聚焦、`maxLength=200`）。
- **Enter 保存**（`PUT /outline/:nodeId { title? / summary? }`）→ toast「已保存」+ 重拉树；**Esc 取消**；**失焦保存**。
- 提交判定（`lib/outline-tree.ts` 纯函数）：标题非空且有变化才提交；摘要允许清空（清除摘要）；无变化不发请求。
- 摘要非高频但同样行内（不弹窗）；编辑态行禁用拖拽。

### 就地新建节点

- 行尾「＋」（scene 行无）→ 父 children 末尾插入行内输入框（缩进对齐下一层，自动展开父）。
- 类型由父决定（`CHILD_TYPE`）：卷 → 章、章 → 场；**root 顶层**（顶部「+ 新建」/空态）输入行带「卷/章」切换（决策 19：chapter 可挂 root）。
- **Enter 创建**（`POST /outline { type, title, parent_id }`）→ 就地出现在树中 + 高亮（3s）；**Esc 或失焦取消**（空值不误建）。

### 移动（S13.1：拖拽上下半判定 + 插入指示线，同级排序可用）

- **原生 HTML5 DnD**（无第三方库）：整块拖拽（编辑态除外）→ 悬停目标行，**目标行上半 = 插到该节点前（行上边缘 accent 2px 指示线）、下半 = 插到该节点后（行下边缘指示线）**；指示线为绝对定位层（`pointer-events-none`），不遮挡行内编辑/点击。
- **层级合法性**：目标父 = 目标行的父（`findParentIdOf`），按 `canMoveTo` 纯函数过滤（决策 19 层级约束 + 不能挂自己/子树）——scene 拖到 chapter 行会被正确拒绝（实际插入目标是 volume，非法）；同父排序自然通过。
- **顶层空白区** = 排 root 末尾（保留原语义，容器 ring-accent 高亮；scene 会被 canMoveTo 拒绝）。
- **order 计算**（`lib/outline-tree.ts dropInsertOrder` 纯函数，第三参 `excludeId`）：**剔除拖拽节点后**的目标父 children 上计算——插到某节点前 = 该节点 index；插到某节点后 = index + 1；末尾 = 剔除后 children.length（oracle M1 修订：服务端 move 是「先移除再插入 order」，同父重排若在含拖拽节点的原数组上计算，锚点在下方时错位 1 位）。drop 瞬间按鼠标位置重新判定上下半（防异步渲染滞后）；锚点 = 拖拽节点自身 → 直接原地（剔除后锚点消失会误回退末尾）。
- **原地放置**（`isNoopDrop` 纯函数：父不变且剔除后 order === 当前 index）→ 不发请求直接清理拖拽态（避免误导 toast「已移动」）。
- 「移动到…」对话框**已删除**（拖拽已覆盖精确插入位置）。

### 详情（S12.2）与软删

- 行尾**详情图标**（Eye，批次四 I2：原 BookOpen 去除）→ `#/outline/:nodeId` 节点详情页（变更记录列表 + 结构化 data 表单 + 相关实体）。
- 行尾**回收站图标**（Trash2）→ **直接软删**（H2：不弹确认）：`DELETE /outline/:nodeId` 响应 `cascaded.{ children, relations, deltas }` → 行消失 + toast「已移入回收站（含 N 个子节点）」。

### 当前位置（S13.1/S13.2 修订）

- **入口已迁往节点详情页（S13.2）**——详情页 header「设为当前位置」按钮（`PUT /project/config { current_position: nodeId }`）；大纲列表页不再提供入口。
- 生效后行尾显示「当前位置」徽标（`bg-accent text-accent-foreground` token 类，已去 amber 硬编码），顶栏同步更新（project store 广播）；伏笔面板健康指标依赖此值（决策 21）；未设置时该节点行无徽标。

### 变更记录（节点触发的 Delta，S5.4）

- **入口（S13.1 修订 + I2）**：行尾**详情图标**（Eye）→ `#/outline/:nodeId` 节点详情页；变更记录列表在详情页「变更记录」区块展示（行内展开面板已随 S12.2 详情页落地移除）。
- **数据**：`GET /api/v1/delta/node/:nodeId` → `{ nodeId, deltas: DeltaRecord[] }`（客户端按 `order` 升序兜底排序）。
- **行结构**：主行 = `description`（主文案）+ 创建时间（`formatTimestamp`）；次行 = 目标徽标（`targetType` 中文 + `targetName ?? targetId`）+ changes 紧凑 chips（`lib/delta.ts describeChange`：set=`field = to`、update=`field from → to`、add=`field +value`、remove=`field -value`；chip 底色 `bg-muted`）。
- **空态**：该节点没有变更记录（轻量文案，不打断树操作）。
- **错误态**：契约未定义该端点 404（endpoints.md L436-462）——节点缺失/软删 → 200 空数组（缺失即空态）；`OUTLINE_NODE_NOT_FOUND` 分支为**防御分支**（当前不可达，保留防契约变化）；网络失败 → 提示 + [重试]。

### 伏笔标记（S9.2）

- **展示**：节点行 **title 行尾紧凑徽标**（标题与操作区之间）——`plants`/`advances`/`resolves` 三类 lucide 图标（Pin 📌 / FastForward ⏩ / CheckCircle2 ✅）+ 原生 title tooltip 显示「埋设/推进/回收伏笔：<伏笔名>」（`text-muted-foreground` token 类，禁硬编码色；多标记按类型序 plants → advances → resolves、再名称/id 排列）。
- **数据**：`GET /api/v1/relation`（source_type=outline_node，relation_type 三类**并行**单值查询，depth=1）→ `lib/outline-hooks.ts buildNodeHookMarks` 按 source_id 聚合为「节点 → 标记列表」（targetName 联表名优先、缺省 targetId 兜底——hooks.md 关系 target 为伏笔侧）。
- **刷新**：依赖 outline store 树对象——树重拉（写操作 afterTreeChanged）后自动重拉标记。
- **降级**：任一类型请求失败 → 该类型空集；全部失败 → 标记列隐藏（`hookMarks=null`），不阻塞大纲渲染、无错误横幅（纯展示增强）。
- **范围**：标记随行渲染、**不聚合后代**——折叠父行自身标记仍显示，子树标记随展开可见。

## 状态

- **空态**：无任何节点 → 居中「大纲还是空的，先建第一卷」+ 主按钮 [新建第一卷]（点击直接进入就地输入，类型锁定卷；空态输入行同样支持卷/章切换）。
- **加载态**：树骨架。
- **错误态**：
  - `VALIDATION_ERROR`（如 scene 挂 volume 下、parent_id 缺失）→ 就地操作失败横幅。
  - `OUTLINE_NODE_NOT_FOUND`（节点已被 purge）→ 错误横幅 + 刷新树。
  - `GET /delta/node/:nodeId` 失败（网络；防御分支 `OUTLINE_NODE_NOT_FOUND` 当前不可达——缺失即 200 空态）→ 面板内错误 + [重试]，不阻塞树操作。
- **回收站**：大纲页底部折叠区**已删除（S13.1）**——软删对象的还原/彻底删除统一在「回收站」tab（`#/trash`）。

---

# OutlineDetail 节点详情页（S12.2，决策 23）

> 大纲节点的编辑权威页：标题/摘要 + 结构化 data（麦基字段集）表单、变更记录列表、相关实体；大纲树列表页行尾**详情图标**进入（S13.1 起无 ⋯ 菜单）。契约：决策 23、schema.md outline.json「节点结构化信息 data」节、endpoints.md 大纲端点（GET /outline 返回 data、PUT /outline/:nodeId 支持 data 部分合并）。

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
│ 变更记录（N 条）              [+ 新建变更]│                          │
│ · 灵根测试失败被逐出师门  8-02           │                          │
│   人物《张三》 [更新 状态 活跃→中立]      │                          │
│  （新建表单内联展开，见「新建变更」）      │                          │
├────────────────────────────────────────┤                          │
│ 伏笔标记（占位）                         │                          │
└────────────────────────────────────────┴─────────────────────────┘
```

新建变更表单（内联展开于变更记录卡内、列表上方；就地为主不弹窗）

```
┌──────────────────────────────────────────────────────────────────┐
│ 目标类型 [大纲节点 ▾]        目标 [▾ 灵根测试（默认当前节点）]       │
│ 字段     [状态 ▾]           操作 [更新 ▾]      新值 [中立]          │
│ 旧值：活跃（自动取自目标当前数据，无需手填）                        │
│ 描述 [本节点触发了什么变化，如：张三获得断剑认可       ]            │
│                                              [取消] [创建变更]    │
└──────────────────────────────────────────────────────────────────┘
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
- **设为当前位置（S13.2，入口自大纲页迁入）**：header 操作区「设为当前位置」按钮（保存按钮左侧，`variant="outline"`）——`PUT /project/config { current_position: nodeId }` → toast「已设为当前位置」；**已是当前位置**（`config.currentPosition === nodeId`）→ 按钮禁用 + 文案变「当前位置」（动作入口与元信息行状态徽标共存，参照 S13.1 前大纲页 `disabled={isCurrent || busy}` 语义）；`settingCurrent` 提交态防重复。**联动**：project store `updateConfig` 成功自动重拉 config——InfoBar「当前位置」（标题 + 点击跳转定位）、大纲行尾「当前位置」徽标、compute 预览默认 at_node（S5.4）、S9 伏笔健康指标基准（决策 21）同步刷新。失败 → error toast「设置失败：该节点可能已删除，无法设为当前位置」。
- **变更记录区块**：`components/delta/node-delta-list.tsx`（S5.4 行内面板逻辑迁移：加载/错误重试/空态/列表行 + changes chips）；「+ 新建变更」入口 S12.3 提供，见下「新建变更」。

### 变更记录 · 新建变更（S12.3）

- **入口**：变更记录卡标题行右侧「+ 新建变更」→ **内联展开表单**（就地为主不弹窗泛滥；按钮变「收起」可再点收起，表单内 [取消] 同效）。提交成功 → toast「已记录变更」+ 收起表单 + 重拉列表（`NodeDeltaList reloadKey` 信号，同 RelationsView 模式）。
- **目标**（`target_type` / `target_id`）：
  - 类型下拉：人物/设定/地点/伏笔/大纲节点（`DELTA_TARGET_TYPE_OPTIONS`：`ENTITY_TYPES` + outline_node，标签复用 `lib/delta targetTypeLabel`）。
  - **默认大纲节点 + 目标 = 当前节点**（最常见的「本节点触发了什么变化」场景）；大纲节点目标用树下拉（flattenTree 缩进，可切换任意卷/章/场）。
  - 实体目标：按类型拉列表（`GET /entity/:type`，加载中/失败重试/空态提示）；选择后拉详情 `GET /entity/:type/:id`（update 自动 from 的数据源）。
- **字段**（`field`）：按目标类型生成下拉——
  - 实体：`ENTITY_DATA_SCHEMAS` 的字段名（**client 只消费类型不打包 zod**：本地字段清单经 `import type` + `keyof ...["shape"]` 编译期断言 = shared schema keys，schema 增删字段即编译报错防漂移）；排除 `custom_fields`（record 无法用标量值表达）；标签复用 `lib/entity-detail detailFieldsForType`。
  - 大纲节点：决策 23 字段集（`lib/outline-detail detailFieldsForNodeType`，按选中节点层级；节点缺失 → 三层并集兜底）。
- **操作**（`op`，可手动切换；推断逻辑 = `lib/delta-create.ts inferOpOptions` 纯函数）：
  - 数组字段（character.personality/abilities、setting.rules、scene.conflict_levels）→ [追加 add / 移除 remove]，默认 add。
  - 标量字段 → 当前值可作 from 时 [更新 update / 设为 set] 默认 update；**值不可表达（字段缺失/布尔/数组/对象）时仅 [设为]**——避免提交被 400 拒绝。
- **值**：set/update → 「新值」输入；add → 「追加值」；remove → 「移除值（按值匹配删除）」。数字字段（character.age、hook.half_life）提交时解析为 number，NaN 回退字符串（`buildDeltaChange`）。
- **旧值自动取值**（决策 9 修订）：op=update 时表单标注「旧值：xxx（自动取自目标当前数据，无需手填）」——实体目标取详情 data、节点目标取树中 node.data；作者不手填 from，**data 后续被手动编辑 → compute 时跳过 + conflicts 标注，机制兜底**。目标数据获取失败（`ENTITY_NOT_FOUND`/网络）→ 行内提示并引导改「设为」。
- **描述**：必填（trim 非空校验），placeholder「本节点触发了什么变化，如：张三获得断剑认可」。
- **提交**：`POST /api/v1/delta { node_id: 当前节点, target_type, target_id, changes: [单条], description }`（per-op 必填语义 set→to / update→from+to / add·remove→value 由 `buildDeltaChange` 构造保证）。
- **错误态**：`VALIDATION_ERROR`（per-op 字段缺失等）→ 表单内行内提示（服务端 message）；`OUTLINE_NODE_NOT_FOUND`（节点已被 purge）→ toast「节点不存在…」+ 收起表单（树刷新后页面进入 404 态）；网络失败 → 行内提示。
- **相关实体区块**：复用 `components/entity/relations-view.tsx`（新增 `scope` prop：仅查本节点作为 source 的 1 跳关系、隐藏过滤区）；[+ 新增关联] → `CreateRelationDialog`（`RelationSource` 扩展支持 `outline_node`，源固定为本节点，目标端四类实体或大纲节点）。行内端点链接：四类实体跳 `#/entities/:type/:id`，大纲节点跳 `#/outline/:nodeId`（U8 关联 tab 同效）。删除关系物理删确认（同 U8）。
- **伏笔标记**：占位区（空态说明「伏笔标记将在伏笔面板（S9）落地」），S9 后接入 plants/advances/resolves 标记。

## 状态

- **404 态**：树中找不到节点（不存在/已软删/已 purge）→ 居中「该节点不存在或已被删除」+ [去回收站]（`#/trash`）+ [返回大纲]（`#/outline`）。
- **加载态**：大纲树骨架（outline store 未就绪时触发 loadOutline；加载中显示树骨架，不闪「加载失败」）。
- **树加载失败**：区块内「大纲加载失败」+ [重试]（loadOutline 静默吞错后的兜底呈现，同大纲列表页）。
- **表单无项目**：`config === null` 未打开项目 → 引导回首页（同大纲列表页）。
- **新建变更表单**：目标实体列表加载失败 → 行内 [重试]；目标详情获取失败 → 「旧值」提示 + 引导改「设为」；提交 `VALIDATION_ERROR` → 行内错误（表单保持展开可修正）；`OUTLINE_NODE_NOT_FOUND` → toast + 收起；`deltaCount=0` 时列表空态不变，表单仍可创建首条变更。
