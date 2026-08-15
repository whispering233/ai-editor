# Timeline 时间轴面板原型

> 决策 26（2026-08）：时间轴为**事件线性序列**——事件是独立实体（`entities` 表 CHECK 含 `'event'`），全局 `sort_order` 线性序（拖拽为权威），`time_label` 仅作自由文本展示、**不参与排序、不解析**（见 `doc/database/schema.md`）。
>
> **修订注记（2026-08，决策 26 F3/F4）**：UI 形态裁决为**垂直时间轴 + 时间点分组**（自实现，零新依赖）——左侧垂直时间轴线 + 节点圆点；同 `time_label` 事件归入同一「时间点」组块；组间按拖拽 `sort_order` 序（拖拽仍为权威）。F3 落地轴线 + 节点 + 事件行（本页线框），F4 落地同标签归组（「时间点分组」线框）。

## 路由与数据

- 路由：`#/timeline`（列表）、`#/timeline/:id`（事件详情）
- 列表：`GET /api/v1/entity/event`（按 `sort_order` 升序；行含 `tags` 与 `occurs_in` 关联节点数）
- 详情/关联：`GET /api/v1/entity/event/:id`（`relations` 含 `occurs_in`）
- 大纲（选节点）：`GET /api/v1/outline`
- 操作：
  - 新建：`POST /entity/event`（body：`name` / `description` / `time_label` / `tags`）
  - 更新：`PUT /entity/event/:id`（**清空语义（F1）**：空值提交即清除，见 endpoints.md）
  - 排序：`PUT /entity/event/:id/move`（body：`{order}`，拖拽后调用）
  - 关联：`POST /relation`（`source_type='event'`、`relation_type='occurs_in'`，target 为大纲节点）
  - 取消关联：`DELETE /relation/:id`
  - 软删：`DELETE /entity/event/:id`

## 布局线框（F3 垂直时间轴，自实现）

```
┌───────────────────────────────────────────────────────────────┐
│ 时间轴                                        [+ 新建事件]      │
├───────────────────────────────────────────────────────────────┤
│ 标签: [全部] [主线] [战争] [身世]                               │
├───────────────────────────────────────────────────────────────┤
│  │ ● 第二天黄昏                                2 个事件        │  ← 组标题（F4）
│  │ ├─○ 主角踏入宗门      [主线]      2 节点   [⋯]               │
│  │ └─○ 玉佩来历揭开      [身世][主线] 1 节点   [⋯]               │
│  │ ● 少年时                                1 个事件            │  ← 组标题（F4）
│  │ └─○ 门派考核          [主线]      1 节点   [⋯]               │
│  │                                                             │
│  │   （拖拽行头 ⠿ 调整事件先后顺序——组间线性序，拖拽为权威）      │
└───────────────────────────────────────────────────────────────┘
```

- **垂直轴线**：容器内绝对定位竖线 `absolute left-[11px] top-0 bottom-0 w-0.5 bg-border pointer-events-none`（left = 节点列中心；**pointer-events-none 是拖拽共存前提**，组间空隙处线连续贯穿）。
- **节点圆点**：`relative z-10 rounded-full border-2 border-primary bg-background`（不透明背景盖住穿过轴线，尺寸 `size-4`；组内事件行用小圆点 `size-2 rounded-full bg-primary/60`）。
- **事件行**：内容卡 `rounded-md bg-card border-border px-3 py-2`，从左到右：拖拽柄 `GripVertical` → 事件名（`truncate` + title 全文）→ 时间标签（**F5 醒目**：有值 `text-sm font-medium text-primary` 主题色点缀；空值占位「未标注时间」弱化样式 `text-xs italic text-muted-foreground`——已标注/未标注一眼可辨）→ tags 胶囊 → 「N 节点」计数 → ⋯ 菜单（详情/编辑/移入回收站）。**事件名行下方为全宽描述区（F6）**：`text-sm text-muted-foreground` 次要层级（低于事件名/时间标签），两行截断 `line-clamp-2`；**超过两行才显示「展开」按钮**（clamp 态 `scrollHeight > clientHeight` 运行时测量，窗口 resize 重测；展开态跳过重测保留上次 clamped 测量值），展开后 `line-clamp-none` 显示「收起」；描述 trim 后为空不渲染（上方线框为展示简洁省略描述行，F4 线框组内事件行同理）。
- **拖拽**：draggable 设在事件行根（组内行不 draggable 防误拖，F4 后为组块根）；容器 onDragOver `e.preventDefault()`，用 `e.clientY` 与各行/组块中点比较算插入位（复用 S13 上下半判定模式），插入指示 `border-t-2 border-primary`；dragstart 时被拖行 `opacity-50`；拖拽结束 → `PUT /entity/event/:id/move` → 失败回滚 + toast。
- 视觉全走 tokens（`border-border`/`bg-card`/`bg-background`/`text-foreground`/`text-muted-foreground`/`rounded-md`），**禁硬编码色类**；节点/轴线主题色点缀适配浅深双主题。

## 布局线框（F4 时间点分组，待 F4 卡实现）

```
┌───────────────────────────────────────────────────────────────┐
│ 时间轴                                        [+ 新建事件]      │
├───────────────────────────────────────────────────────────────┤
│ 标签: [全部] [主线] [战争] [身世]                               │
├───────────────────────────────────────────────────────────────┤
│  │ ● 第二天黄昏                                2 个事件    [▾] │
│  │   ├─○ 主角踏入宗门   [主线]      2 节点   [⋯]               │
│  │   └─○ 玉佩来历揭开   [身世][主线] 1 节点   [⋯]               │
│  │ ● 少年时                                  1 个事件    [▾] │
│  │   └─○ 门派考核       [主线]      1 节点   [⋯]               │
│  │                                                             │
│  │   （拖拽组块 ⠿ 调整组间顺序；「未标注时间」事件归入兜底组）    │
└───────────────────────────────────────────────────────────────┘
```

- 同 `time_label` 事件归入同一组块：**组标题** = 大圆点 + 时间标签（醒目样式）+ 事件计数 + 可选折叠按钮（`aria-expanded`，折叠后仅标题行、轴线仍连续）；**组内事件堆叠**（各自不再画线，轴线容器级贯穿）；「未标注时间」事件归入兜底组（按 sort_order 平铺）。
- 分组纯函数与 UI 分离（novu 模式）：按 `time_label` 聚类（trim 后分组），组序 = 组内最早事件 sort_order 序；拖拽改 sort_order 后组随事件自然迁移。
- 组件切分：`components/timeline/` 下 `Timeline.tsx`（容器 + 轴线 + 分组渲染）/ `TimelineGroup.tsx`（组块：标题 + 折叠）/ `TimelineEvent.tsx`（事件行）——F3 先建 TimelineEvent 与容器骨架，F4 加分组与折叠。

## 信息层级

| 展示 | API 字段 |
|------|---------|
| 行主信息 | `name` |
| 时间标签 | `time_label`（自由文本，行内/右侧展示；**不参与排序、不解析**；F5 样式提升：行内有值 → `text-sm font-medium text-primary` 主题色点缀、空 → 「未标注时间」弱化占位斜体） |
| 标签徽标 | `tags`（字符串数组，多枚徽标并排） |
| 关联节点数 | `relations` 中 `occurs_in` 关系计数（显示「N 节点」） |
| 描述 | `description`（详情页展示；**F6：列表行内展示**——事件名行下方全宽，两行截断 + 超两行显示「展开/收起」，空描述不渲染） |
| 排序 | `sort_order`（全局事件线性序，拖拽为权威；非 event 实体恒为 NULL） |
| 时间 | `createdAt` / `updatedAt` |

## 关键交互

### 新建事件（手动）

顶部 `[+ 新建事件]` → 对话框：`name` + `description` + `time_label` + `tags`（逗号分隔输入）+ 可选关联节点选择器（大纲树选择器，可空，同伏笔埋点选择器）。

→ `POST /entity/event`；选了节点再 `POST /relation`（event → outline_node，`occurs_in`）→ 列表刷新。新建事件追加至列表尾部。

### 标签输入建议（F8，2026-08 用户反馈）

新建/编辑/详情页的 tags 输入框提供**已存在标签建议**：输入时按当前输入匹配已有标签（前缀/包含匹配，排除已选标签），显示建议列表，点选即填入（替换当前输入段，保持逗号分隔兼容）。数据源 = 列表 API 全量拉取聚合（`GET /entity/event?limit=200` 的 summary.tags，零 API 改动）；列表页复用已拉取 items（不足时补拉全量），详情页独立补拉全量聚合。无匹配 / 无已存在标签时不显示建议区。

### 拖拽排序

- **原生 HTML5 DnD**：拖拽行头 ⠿ 拖动行，**复用大纲 S13 的上下半插入判定模式**（拖动中按目标行上半/下半判定插入位，显示插入指示线）。
- 拖拽结束 → `PUT /entity/event/:id/move`（`{order}`，服务端按新位重排 `sort_order`）。
- 失败 → 行位置回滚 + toast；成功 → 列表保持新序（不整页刷新）。

### 标签筛选

顶部标签筛选器：行 `[全部] [tag1] [tag2] …`（tag 从当前列表数据聚合），点击 tag 过滤列表（MVP 含此功能），再次点击取消；筛选态高亮当前 tag。

### AI 排序入口（F9，2026-08 用户反馈）

列表页头部 `[+ 新建事件]` 旁新增「AI 排序」按钮：点击 → 向右栏聊天注入预设指令（「请按时间标签的语义先后顺序对时间轴事件排序」）→ 聊天 agent 循环中 LLM 读取事件列表（含 time_label）→ 调用提案工具 `propose_reorder_events`（见 `doc/api/tools.md`）→ 提案卡展示顺序变化预览 → 用户确认 → Executor 校验后重排 `sort_order` → `notifyDataChanged` → 本页自动重拉新序。无项目打开时按钮禁用（聊天不可用）。

### 详情页（#/timeline/:id）

- **字段编辑**：`name` / `description` / `time_label` / `tags` 表单 → `PUT /entity/event/:id` → toast「已保存」。**清空语义（2026-08 用户反馈 F1 修复）**：三个 data 字段均可清除——输入框清空（`description`/`time_label`）或标签输入清空（`tags`）→ 提交**空值**（`""` / `[]`）即显式清除原值；仅当原值非空时提交空值（原值本就为空 → 无变更不提交）。清空 `time_label` 后列表行恢复「未标注时间」。
- **occurs_in 关联管理**：
  - 添加关联：从大纲树选择器选节点 → `POST /relation`（`source_type='event'`、`relation_type='occurs_in'`）。
  - 取消关联：已关联节点列表行尾 [取消关联]（二次确认）→ `DELETE /relation/:id`。
  - 已关联节点列表展示大纲节点标题，点击跳 `#/outline/:nodeId` 定位。

### 行操作

⋯ 菜单：详情（跳 `#/timeline/:id`）· 编辑（对话框，同新建表单预填）· 移入回收站（软删确认框，展示级联 `cascaded.relations/deltas`）→ `DELETE /entity/event/:id` → 行消失 + toast「已移入回收站，可随时还原」。

## 状态

- **空态**：「还没有事件。先定义一个关键事件，再把它们排成故事的时间骨架。」+ [新建事件] 主操作按钮。
- **错误态**：列表失败 → 重试横幅；详情 404（`ENTITY_NOT_FOUND`——事件走泛型实体路由，服务端错误码与实体详情一致）→ 居中「该事件不存在或已被删除」+ [去回收站]（`#/trash`）+ [返回列表]（`#/timeline`）。
- **加载态**：列表骨架（行级 `animate-pulse bg-muted`）；标签筛选无匹配 → 「没有匹配「{tag}」的事件」。
