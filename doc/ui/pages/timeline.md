# Timeline 时间轴面板原型

> 决策 26（2026-08）：时间轴为**事件线性序列**——事件是独立实体（`entities` 表 CHECK 含 `'event'`），全局 `sort_order` 线性序（拖拽为权威），`time_label` 仅作自由文本展示、**不参与排序、不解析**（见 `doc/database/schema.md`）。
>
> **修订注记（2026-08，决策 26 F3/F4）**：UI 形态裁决为**垂直时间轴 + 时间点分组**（自实现，零新依赖）——左侧垂直时间轴线 + 节点圆点；同 `time_label` 事件归入同一「时间点」组块；组间按拖拽 `sort_order` 序（拖拽仍为权威）。F3 落地轴线 + 节点 + 事件行（本页线框），F4 落地同标签归组（「时间点分组」线框）。
>
> **修订注记（2026-08，决策 26 G2）——时间标签点实体化**：时间标签从事件剥离为独立实体 **`timepoint`**（name = 时间标签文本）——时间轴数据项分两类：时间标签点与事件；事件经 `occurs_at` 关系挂载到时间点（1:n，事件至多挂一个）。**双独立线性序**：时间点序（组间）+ 事件序（组内排序键）；拖拽时间点不修改其下事件序，单条事件任意可拖（跨组拖拽即改挂载）。未挂载事件归入列表末尾「未挂载」兜底区。详见 `doc/database/schema.md`（SCHEMA_VERSION 3）与 `doc/api/endpoints.md`。

## 路由与数据

- 路由：`#/timeline`（列表）、`#/timeline/:id`（事件详情）
- 列表：`GET /api/v1/entity/event`（按 `sort_order` 升序；行含 `tags` 与 `occurs_in` 关联节点数）、`GET /api/v1/entity/timepoint`（按 `sort_order` 升序，时间点 = 时间标签）
- 挂载关系：`GET /api/v1/relation`（`relation_type='occurs_at'`，timepoint → event）
- 详情/关联：`GET /api/v1/entity/event/:id`（`relations` 含 `occurs_in` / `occurs_at`）
- 大纲（选节点）：`GET /api/v1/outline`
- 操作：
  - 新建时间点：`POST /entity/timepoint`（body：`name` = 时间标签文本）
  - 新建事件：`POST /entity/event`（body：`name` / `description` / `tags`；**无 time_label**）
  - 更新：`PUT /entity/:type/:id`（**清空语义（F1）**：空值提交即清除，见 endpoints.md；时间点改名 = `PUT /entity/timepoint/:id` name）
  - 排序：`PUT /entity/event/:id/move`（body：`{order}`，事件拖拽）、`PUT /entity/timepoint/:id/move`（body：`{order}`，时间点拖拽）
  - 挂载：`POST /relation`（`source_type='timepoint'`、`relation_type='occurs_at'`，target 为事件）
  - 取消挂载：`DELETE /relation/:id`
  - 关联大纲节点：`POST /relation`（`source_type='event'`、`relation_type='occurs_in'`，target 为大纲节点）
  - 软删：`DELETE /entity/event/:id` / `DELETE /entity/timepoint/:id`（时间点软删 → 其下事件 occurs_at 级联软删 → 事件变未挂载）

## 布局线框（G2 时间标签点实体化）

```
┌───────────────────────────────────────────────────────────────┐
│ 时间轴                        [AI 排序]  [+ 新建事件] [+ 新建时间点] │
├───────────────────────────────────────────────────────────────┤
│ 标签: [全部] [主线] [战争] [身世]                               │
├───────────────────────────────────────────────────────────────┤
│  │ ● 第二天黄昏       2 个事件          [重命名][▾]  ⠿ ← 时间点整组可拖│
│  │   ├─○ 主角踏入宗门   [主线]  2 节点  [⋯]  ⠿ ← 单条事件可拖      │
│  │   └─○ 玉佩来历揭开   [身世][主线] 1 节点 [⋯]  ⠿                 │
│  │   [+ 在此时间点新建事件]                                       │
│  │ ● 少年时           1 个事件          [重命名][▾]  ⠿            │
│  │   └─○ 门派考核       [主线]  1 节点  [⋯]  ⠿                    │
│  │ ● 未挂载           2 个事件          [▾]                       │
│  │   └─○ 无标签事件A     [⋯]  ⠿ ← 未挂载事件可拖到任一时间点      │
│  │                                                               │
│  │   （拖拽时间点 ⠿ = 整组移动（组间序，内部事件序不变）；          │
│  │     拖拽事件 ⠿ = 单条移动（组内序 / 跨组 = 改挂载））           │
└───────────────────────────────────────────────────────────────┘
```

- **垂直轴线**：容器内绝对定位竖线 `absolute left-[11px] top-0 bottom-0 w-0.5 bg-border pointer-events-none`（left = 节点列中心；**pointer-events-none 是拖拽共存前提**，组间空隙处线连续贯穿）。
- **节点圆点**：`relative z-10 rounded-full border-2 border-primary bg-background`（不透明背景盖住穿过轴线，尺寸 `size-4`；组内事件行用小圆点 `size-2 rounded-full bg-primary/60`）。
- **时间点组块**（= 时间标签）：**组标题** = 大圆点 + 时间点名（`text-sm font-medium text-foreground`，F4 样式）+ 事件计数 + [重命名]（行内编辑，`PUT /entity/timepoint/:id` name）+ 折叠按钮（`aria-expanded`，折叠后仅标题行、轴线仍连续）；**组内事件堆叠**（各自不再画线，轴线容器级贯穿）；组尾「[+ 在此时间点新建事件]」轻量按钮（自动挂载该时间点）。
- **未挂载兜底区**：无 `occurs_at` 事件归入列表末尾「未挂载」组（组标题 `italic text-muted-foreground` 弱化占位；事件按 sort_order 平铺）；可直接拖拽到任一时间点完成挂载。
- **事件行**：内容卡 `rounded-md bg-card border-border px-3 py-2`，从左到右：拖拽柄 `GripVertical` → 事件名（`truncate` + title 全文）→ tags 胶囊 → 「N 节点」计数 → ⋯ 菜单（详情/编辑/移入回收站）。**事件行内不再有时间标签**（G2：时间标签 = 组标题）。**事件名行下方为全宽描述区（F6）**：`text-sm text-muted-foreground` 次要层级，两行截断 `line-clamp-2`；**超过两行才显示「展开」按钮**（clamp 态 `scrollHeight > clientHeight` 运行时测量，窗口 resize 重测；展开态跳过重测保留上次 clamped 测量值），展开后 `line-clamp-none` 显示「收起」；描述 trim 后为空不渲染。
- **拖拽（双轨，G2）**：
  - **时间点拖拽**：draggable 设在组块根（组标题行）；onDragOver 用 `e.clientY` 与各组块中点比较算插入位；drop → `PUT /entity/timepoint/:id/move`（**只重排时间点序，其下事件序不变**）；失败回滚 + toast。
  - **事件拖拽**：draggable 设在事件行根；onDragOver 同款判定；drop → 组内移动 = `PUT /entity/event/:id/move`；**跨组拖拽 = 改挂载**（旧 occurs_at 移除 + 新 occurs_at 建立 + 事件 move 插入目标位置，一次性提交，无确认弹窗）→ 失败回滚 + toast。
- 视觉全走 tokens（`border-border`/`bg-card`/`bg-background`/`text-foreground`/`text-muted-foreground`/`rounded-md`），**禁硬编码色类**；节点/轴线主题色点缀适配浅深双主题。

## 滚动结构（G1：区块独立滚动，2026-08 实现）

- **实现**：页面根容器 `<section className="flex h-full min-h-0 flex-col">`（占满 MainPanel 内容区高度——`h-full` 相对 `flex-1 min-h-0` 父级生效，与 Canvas.tsx §631 同式高度链，MainPanel 无需改动）；分「固定区 + 滚动区」两段：
  - **固定区**（正常流，不滚动）：header（标题 + AI 排序 + 新建事件 + 新建时间点）+ 标签筛选器（仅 `items.length > 0` 时渲染）。列表滚动时两者保持可见——用户核心诉求「标签和按钮均可见」。
  - **滚动区**（`min-h-0 flex-1 overflow-y-auto` 独立滚动）：错误横幅 / 加载骨架 / 空态 / TimelineView 列表 / 「无匹配」提示——均属「替代列表位置」的状态内容，归滚动区；筛选器 `mb-3` 间距保留在滚动区外（固定区底部与滚动区之间）。
- 其他页面（大纲/画布等）保持整体滚动不变；本页拖拽/筛选/编辑逻辑零改动。

## 信息层级

| 展示 | API 字段 |
|------|---------|
| 时间点（组标题） | `timepoint.name`（时间标签文本，**可重命名**；G2 后事件不再携带 time_label） |
| 行主信息 | `event.name` |
| 标签徽标 | `event.data.tags`（字符串数组，多枚徽标并排） |
| 关联节点数 | `relations` 中 `occurs_in` 关系计数（显示「N 节点」） |
| 描述 | `event.data.description`（详情页展示；**F6：列表行内展示**——事件名行下方全宽，两行截断 + 超两行显示「展开/收起」，空描述不渲染） |
| 事件排序 | `sort_order`（事件全局线性序，拖拽为权威；**组内排序键**——渲染时组内按事件全局序投影排序） |
| 时间点排序 | `sort_order`（时间点全局线性序，拖拽为权威；**组间顺序**；拖拽不修改其下事件序） |
| 时间 | `createdAt` / `updatedAt` |

## 关键交互

### 新建时间点（G2）

顶部 `[+ 新建时间点]` → 对话框/行内输入：`name`（时间标签文本，如「第二天黄昏」）→ `POST /entity/timepoint` → 时间轴末尾追加时间点（未挂载事件可拖入）。

### 新建事件（双入口，G2）

- **时间点内新建**：时间点组尾「[+ 在此时间点新建事件]」→ 对话框：`name` + `description` + `tags`（逗号分隔输入，F8 建议）+ 可选关联节点选择器 → `POST /entity/event` + `POST /relation`（occurs_at 挂载该时间点）。
- **顶部新建（不挂载）**：`[+ 新建事件]` → 同表单 → 仅 `POST /entity/event` → 事件入「未挂载」兜底区，可后续拖拽挂载。

### 标签输入建议（F8，2026-08 用户反馈）

新建/编辑/详情页的 tags 输入框提供**已存在标签建议**：输入时按当前输入匹配已有标签（前缀/包含匹配，排除已选标签），显示建议列表，点选即填入（替换当前输入段，保持逗号分隔兼容）。数据源 = 列表 API 全量拉取聚合（`GET /entity/event?limit=200` 的 summary.tags，零 API 改动）；列表页复用已拉取 items（不足时补拉全量），详情页独立补拉全量聚合。无匹配 / 无已存在标签时不显示建议区。

### 拖拽排序（双轨，G2）

- **时间点拖拽**（组标题 ⠿）：整组移动 → `PUT /entity/timepoint/:id/move`（`{order}`）→ 只重排时间点序，其下事件序不变；失败 → 位置回滚 + toast。
- **事件拖拽**（事件行 ⠿）：单条移动 → `PUT /entity/event/:id/move`（`{order}`，服务端按新位重排事件全局序）。
- **跨组拖拽**（事件拖到另一时间点区块）：**即改挂载**——旧 occurs_at 移除 + 新 occurs_at 建立 + 事件 move 插入目标位置，一次性提交（无确认弹窗）；失败 → 回滚 + toast。

### 时间点重命名（G2）

组标题 [重命名] → 行内输入框（预填当前名）→ Enter/确认提交 `PUT /entity/timepoint/:id { name }`、Esc/失焦取消；成功后组标题更新。

### 标签筛选

顶部标签筛选器：行 `[全部] [tag1] [tag2] …`（tag 从当前列表数据聚合），点击 tag 过滤列表（MVP 含此功能），再次点击取消；筛选态高亮当前 tag。

### AI 排序入口（F9 + G2 修订）

列表页头部「AI 排序」按钮：点击 → 向右栏聊天注入预设指令（「请按时间标签的语义先后顺序对时间轴时间点排序」）→ 聊天 agent 循环中 LLM 读取时间点列表（name = 时间标签文本）→ 调用提案工具 `propose_reorder_timepoints`（见 `doc/api/tools.md`；G2 后取代 propose_reorder_events）→ 提案卡展示顺序变化预览 → 用户确认 → Executor 校验后重排 `timepoint.sort_order` → `notifyDataChanged` → 本页自动重拉新序。无项目打开时按钮禁用（聊天不可用）。

### 详情页（#/timeline/:id）

- **字段编辑（G2 修订）**：`name` / `description` / `tags` 表单 → `PUT /entity/event/:id` → toast「已保存」。**清空语义（F1）**：data 字段均可清除——输入框清空（`description`）或标签输入清空（`tags`）→ 提交**空值**（`""` / `[]`）即显式清除原值；仅当原值非空时提交空值。**时间标签改挂载**：详情页显示当前挂载时间点 + 时间点选择器（列表拉取 `GET /entity/timepoint`，改挂载 = 旧 occurs_at 移除 + 新建立）。
- **occurs_in 关联管理**：
  - 添加关联：从大纲树选择器选节点 → `POST /relation`（`source_type='event'`、`relation_type='occurs_in'`）。
  - 取消关联：已关联节点列表行尾 [取消关联]（二次确认）→ `DELETE /relation/:id`。
  - 已关联节点列表展示大纲节点标题，点击跳 `#/outline/:nodeId` 定位。

### 行操作

- 事件 ⋯ 菜单：详情（跳 `#/timeline/:id`）· 编辑（对话框，同新建表单预填）· 移入回收站（软删确认框，展示级联 `cascaded.relations/deltas`）→ `DELETE /entity/event/:id` → 行消失 + toast「已移入回收站，可随时还原」。
- 时间点 ⋯ 菜单：重命名 · 移入回收站（软删确认框，提示「其下 N 个事件将变为未挂载」）→ `DELETE /entity/timepoint/:id` → 时间点消失 + 其下事件移入「未挂载」区 + toast。

## 状态

- **空态**：「还没有时间点。先定义一个时间标签点（如「第二天黄昏」），再在其中挂载事件。」+ [新建时间点] 主操作按钮。
- **错误态**：列表失败 → 重试横幅；详情 404（`ENTITY_NOT_FOUND`——事件走泛型实体路由，服务端错误码与实体详情一致）→ 居中「该事件不存在或已被删除」+ [去回收站]（`#/trash`）+ [返回列表]（`#/timeline`）。
- **加载态**：列表骨架（行级 `animate-pulse bg-muted`）；标签筛选无匹配 → 「没有匹配「{tag}」的事件」。
