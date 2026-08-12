# Timeline 时间轴面板原型

> 决策 26（2026-08）：时间轴为**事件线性序列**——事件是独立实体（`entities` 表 CHECK 含 `'event'`），全局 `sort_order` 线性序（拖拽为权威），`time_label` 仅作自由文本展示、**不参与排序、不解析**（见 `doc/database/schema.md`）。

## 路由与数据

- 路由：`#/timeline`（列表）、`#/timeline/:id`（事件详情）
- 列表：`GET /api/v1/entity/event`（按 `sort_order` 升序；行含 `tags` 与 `occurs_in` 关联节点数）
- 详情/关联：`GET /api/v1/entity/event/:id`（`relations` 含 `occurs_in`）
- 大纲（选节点）：`GET /api/v1/outline`
- 操作：
  - 新建：`POST /entity/event`（body：`name` / `description` / `time_label` / `tags`）
  - 更新：`PUT /entity/event/:id`
  - 排序：`PUT /entity/event/:id/move`（body：`{order}`，拖拽后调用）
  - 关联：`POST /relation`（`source_type='event'`、`relation_type='occurs_in'`，target 为大纲节点）
  - 取消关联：`DELETE /relation/:id`
  - 软删：`DELETE /entity/event/:id`

## 布局线框

```
┌───────────────────────────────────────────────────────────────┐
│ 时间轴                                        [+ 新建事件]      │
├───────────────────────────────────────────────────────────────┤
│ 标签: [全部] [主线] [战争] [身世]                               │
├───────────────────────────────────────────────────────────────┤
│ ⠿ 主角踏入宗门   第二天黄昏        [主线]       2 节点   [⋯]    │
│ ⠿ 玉佩来历揭开   少年时            [身世][主线] 1 节点   [⋯]    │
│ ⠿ 宗门大比       第三纪元          [战争]       3 节点   [⋯]    │
│                                                               │
│   （拖拽行头 ⠿ 调整事件先后顺序）                                │
└───────────────────────────────────────────────────────────────┘
```

## 信息层级

| 展示 | API 字段 |
|------|---------|
| 行主信息 | `name` |
| 时间标签 | `time_label`（自由文本，行内/右侧展示；**不参与排序、不解析**） |
| 标签徽标 | `tags`（字符串数组，多枚徽标并排） |
| 关联节点数 | `relations` 中 `occurs_in` 关系计数（显示「N 节点」） |
| 描述 | `description`（详情页展示） |
| 排序 | `sort_order`（全局事件线性序，拖拽为权威；非 event 实体恒为 NULL） |
| 时间 | `createdAt` / `updatedAt` |

## 关键交互

### 新建事件（手动）

顶部 `[+ 新建事件]` → 对话框：`name` + `description` + `time_label` + `tags`（逗号分隔输入）+ 可选关联节点选择器（大纲树选择器，可空，同伏笔埋点选择器）。

→ `POST /entity/event`；选了节点再 `POST /relation`（event → outline_node，`occurs_in`）→ 列表刷新。新建事件追加至列表尾部。

### 拖拽排序

- **原生 HTML5 DnD**：拖拽行头 ⠿ 拖动行，**复用大纲 S13 的上下半插入判定模式**（拖动中按目标行上半/下半判定插入位，显示插入指示线）。
- 拖拽结束 → `PUT /entity/event/:id/move`（`{order}`，服务端按新位重排 `sort_order`）。
- 失败 → 行位置回滚 + toast；成功 → 列表保持新序（不整页刷新）。

### 标签筛选

顶部标签筛选器：行 `[全部] [tag1] [tag2] …`（tag 从当前列表数据聚合），点击 tag 过滤列表（MVP 含此功能），再次点击取消；筛选态高亮当前 tag。

### 详情页（#/timeline/:id）

- **字段编辑**：`name` / `description` / `time_label` / `tags` 表单 → `PUT /entity/event/:id` → toast「已保存」。
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
