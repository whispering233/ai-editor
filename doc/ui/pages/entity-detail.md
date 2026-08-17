# EntityDetail 实体详情原型

## 路由与数据

- 路由：`#/entities/:type/:id`
- 数据：`GET /api/v1/entity/:type/:id` → `{ id, type, name, data, relations[], deltaCount, createdAt, updatedAt }`
- 编辑：`PUT /api/v1/entity/:type/:id`（partial：只传变更字段）
- 软删：`DELETE /api/v1/entity/:type/:id`
- 关系：`POST /api/v1/relation`（新增）、`DELETE /api/v1/relation/:id`（物理删）
- 状态预览：`POST /api/v1/delta/compute`（计算实体到达指定大纲节点时的累积状态 + conflicts，S5 起）

## 布局线框

```
┌──────────────────────────────────────────────────────────────────┐
│ [实体 › 人物 › 张三]                  [编辑] [问 AI] [移入回收站]  │
│ 创建于 8-01 · 更新于 8-02 · 变更记录 5 条（点击展开）              │
├────────────────────────────────┬─────────────────────────────────┤
│ 基础信息（data 表单）             │ 关联（1 跳）                     │
│ 角色:   [主角            ]       │ 师徒 → 李四             [删除]  │
│ 性别:   [男              ]       │ 出现于 → 第3章·灵根测试   [删除]  │
│ 年龄:   [16              ]       │ 掌握 → 火球术            [删除]  │
│ 性格:   [坚韧] [谨慎] [多疑] +   │                                 │
│ 动机:   [复仇            ]       │ [+ 新增关联]                     │
│ 能力:   [火球术] [御剑] +         │                                 │
│ 状态:   [活跃            ]       │                                 │
│                        [保存]    │                                 │
└────────────────────────────────┴─────────────────────────────────┘
```

变更记录 · 状态预览（行内展开区块，位于元信息行与表单之间；S5.4）

```
┌──────────────────────────────────────────────────────────────────┐
│ 变更记录 · 状态预览                    （0 条时：轻量空态文案）      │
│ 计算节点 [第3章·灵根测试 ▾]（默认当前位置）         [计算]           │
│ ⚠ 发现 1 处状态冲突：combat_power 记录应为 100，实际为 150          │
│ 状态差异（相对当前数据 · 到达《第3章·灵根测试》）：                 │
│   combat_power  100 → 850                                          │
│ 应用的变更记录（2）：                                               │
│   · 张三获得断剑认可 《第3章·灵根测试》 更新 战力 100 → 850  8-01   │
│   · 张三被挚友背叛   《第4章·宗门夜宴》  更新 性格 善良 → 多疑 8-02 │
└──────────────────────────────────────────────────────────────────┘
```

## 面包屑导航（U7 增补）

- header 顶部为 tab 化分段面包屑「实体 › 人物 › 张三」（替代原类型徽标位，共用组件 `components/page-nav/Breadcrumb.tsx`）：
  - 「实体」段：点击 → `#/entities/character`（列表默认类型）。
  - 类型段「人物」：点击 → `#/entities/character`（当前类型列表，返回上级）。
  - 当前实体名「张三」：不可点（当前段高亮）。
- 样式与列表页类型 tab 一致（分段圆角 + 当前段高亮 `bg-zinc-900 text-white` / token 类），层级清晰可感知。

## 信息层级

### data 表单（按类型差异化；data 内部字段原样 snake_case 透传）

| 类型 | 字段与控件 |
|------|-----------|
| character | `role` 文本 · `gender` 文本 · `age` 数字 · `personality[]` 标签列表 · `motivation` 多行 · `abilities[]` 标签列表 · `status` 文本 · `custom_fields` 键值组 |
| setting | `description` 多行 · `rules[]` 标签列表（**分类唯一手段，决策 31：category 已废弃**）· `custom_fields` —— **`parent_id` 已移除（决策 30）：层级改由 belongs_to 关系表达，见下方「层级区块」** |
| location | `type` 文本 · `parent_id` 文本 · `description` 多行 · `custom_fields` |
| hook | `status` 下拉（planted/progressing/resolved/abandoned）· `category` 文本 · `expected_payoff` 多行 · `payoff_timing` 下拉 · `half_life` 数字 · `is_core` 开关 · `notes` 多行 · `expected_resolve_node_id` 大纲节点选择器 |

- 字段来源：响应 `data`（Record<string, unknown>，原样透传）；编辑提交 `PUT { data: { 变更字段 } }`（partial 合并，未改字段不提交）。
- 未出现的字段不渲染；`custom_fields` 为空时不显示。

### 关联区（紧邻 1 跳）

| 展示 | API 字段 |
|------|---------|
| 关系行 | `relations[].relationType` + `sourceName`/`targetName`（本实体在任一端都展示，行内标注方向箭头） |
| 层级区块（**决策 30，仅 setting**） | 从 `relations` 中过滤 `belongs_to` 且两端均为 setting 的行分区展示：**父设定**（`targetId=本实体` 的来源端）/ **子设定**（`sourceId=本实体` 的目标端），名称可跳转详情；「修改上级」→ 弹层搜索选择器（候选 = `listEntities(setting)`，排除自身）→ 服务端防环校验后**删旧边 + 建新边**（无旧父则仅建） |
| 计数 | `deltaCount`（元信息行「变更记录 N 条」入口，点击展开「状态预览」区块——S5 起提供 compute 预览明细，见关键交互） |
| 时间 | `createdAt` / `updatedAt` |

## 关键交互

- **编辑**：字段直接编辑，[保存] → `PUT` partial → toast「已保存」；保存中禁用按钮。
- **新增关联**：对话框（左右布局「本实体 —关系→ 目标」：左列固定本实体禁选卡片，中列关系类型下拉 + 箭头，右列另一端类型 + 实体搜索选择 + 大纲节点选项，如 ally/rival/appears_in 等）→ `POST /relation`；`RELATION_EXISTS` → 提示「这条关系已经存在」。
- **删关系**：确认框（提示：物理删除不可恢复，可重新建立）→ `DELETE /relation/:id`。
- **软删**：header「移入回收站」按钮 → **直接软删**（H2：不弹确认）→ `DELETE /entity/:type/:id` → 跳回列表 + toast「已移入回收站，可随时还原」（级联计数在 toast 中展示）。
- **问 AI**：注入右栏 ChatPanel 当前会话 context `{ focus_entity_type, focus_entity_id }`（不再跳独立聊天页，layout.md §4.2）；右栏显示「正在讨论：张三」focus 小条。

### 变更记录 · 状态预览（S5.4）

> 端点能力约束：**无按实体查 Delta 的 REST 端点**——实体侧只有 `deltaCount`（计数）与 `POST /delta/compute`（预览）可用；按节点列表在大纲侧（pages/outline.md「变更记录」）。

- **入口**：元信息行「变更记录 N 条」点击 → 行内展开「状态预览」区块（位于元信息行下方、表单上方）；再点收起；0 条时同样可展开（显示轻量空态，见下）。
- **计算节点选择**：下拉列出全部大纲节点（树序遍历缩进，复用 `flattenTree`）；**默认取 project store 的 `currentPosition`**（须在大纲树中存在——软删后选择无意义，回退为空）；未设置当前位置 → 提示「未设置当前位置，请手动选择计算节点」。
- **[计算]** → `POST /api/v1/delta/compute { target_type, target_id, at_node_id }`（决策 9：只沿大纲树父链累积）→ 结果区三段：
  - **状态差异**：`lib/delta.ts diffStateFields`（纯函数）比较计算 `state` 与当前 `data`——仅列值有变化的字段（`field：当前值 → 计算值`；计算态新增/缺失字段标注「（无）」「（已移除）」）；无差异显示「计算状态与当前数据一致」。标题带到达节点名「到达《X》」。
  - **应用的变更记录**：按路径顺序列出 `appliedDeltas`——description + 触发节点标题（大纲树映射，缺省 id）+ changes 紧凑 chips（`describeChange`：set=`field = to`、update=`field from → to`、add=`field +value`、remove=`field -value`）；含 `skipped` 的 delta 逐条内联标注（destructive 弱化样式「field：记录应为 expected，实际 actual（已跳过）」）。
  - **conflicts**（如有）：结果区顶部警示块（`border-destructive/30 bg-destructive/10 text-destructive` + TriangleAlert）——「发现 N 处状态冲突：手动编辑的数据与变更记录不一致」，逐条 `field：记录应为 expected，实际为 actual`（决策 9 修订：update from 不匹配 → 跳过 + 标注，非 409；conflicts 仅含 deltaId 无法回溯 description，不展示来源）。
- **空态**：`deltaCount === 0` → 区块仅显示「暂无变更记录——实体当前状态即初始状态」，不展示计算控件。
- **错误态**：计算失败 `OUTLINE_NODE_NOT_FOUND` → 行内「该节点已不存在，请重新选择计算节点」；网络失败 → 无法连接提示；大纲未加载（outline store 为 null）→ 行内 [加载大纲]。

## 状态

- **错误态（关键）**：`ENTITY_NOT_FOUND`（404）→ 居中「该实体不存在或已被删除」+ [去回收站]（`#/trash`）+ [返回列表]。
- **加载态**：表单骨架。
- **空关联**：「暂无关联，新增一个」+ [新增关联]。
- **保存失败**：`VALIDATION_ERROR` → 表单内联错误（如 name 超长）；`ENTITY_NOT_FOUND` → 提示已删除并引导返回。
- **状态预览**：计算中显示结果区骨架（两行脉冲）；`deltaCount === 0` → 轻量空态（不展示计算控件）；计算失败 → 区块内行内提示（`OUTLINE_NODE_NOT_FOUND` / 网络失败），不阻塞表单操作。
