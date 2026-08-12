# Canvas 画布原型

## 路由与数据

- 路由：`#/canvas`
- 节点：`GET /api/v1/outline`（与大纲树同一数据的投影，决策 1）
- 连线：`GET /api/v1/relation?source_type=outline_node&depth=1`（前端过滤 `relation_type=plot_edge`）
- 建连线：`POST /relation { source_type:"outline_node", source_id, target_type:"outline_node", target_id, relation_type:"plot_edge", metadata:{ label } }`
- 删连线：`DELETE /relation/:id`（**物理删除**，决策 12）
- 布局持久化：localStorage，key `ai-editor:canvas:{project_id}`（决策 10，按项目隔离），结构 `{ nodes: { [nodeId]: { x, y } }, zoom }`；丢失时自动布局，不视为数据异常

## 布局线框

```
┌───────────────────────────────────────────────────────────────┐
│ [自动布局]  缩放 [-] 100% [+]  [显示: 全部节点 / 仅场景]  [画布说明] │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│   ┌──────────────┐      ┌──────────────┐    ┌──────────────┐  │
│   │ ▾ 卷1         │      │ ▾ 卷2         │    │ 卷3(折叠)     │  │
│   │  └ 第1章      │      │  └ 第4章      │    │              │  │
│   │   · 场景A     │      │   · 场景E     │    │              │  │
│   │   · 场景B     │      │   · 场景F     │    │              │  │
│   └──────────────┘      └──────────────┘    └──────────────┘  │
│        └──────────[ 路径A ]───────────┘                        │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## 信息层级

| 元素 | 展示 | API 字段 |
|------|------|---------|
| 节点卡 | 类型徽标 + 标题 +（可选）摘要截断 | `GET /outline` → `children[]`（`id`/`type`/`title`/`summary`） |
| 连线 | 曲线 + 中点标签 | `relationType=plot_edge`，标签取 `metadata.label`；`relation.id` 用于删除 |
| 布局 | 坐标/缩放 | localStorage（不进出任何 API 字段，决策 10） |

节点卡右上角伏笔标记**已随 S10.1 集成**：复用 S9.2 `buildNodeHookMarks`（plants/advances/resolves 徽标，并行三请求降级），见 `doc/ui/pages/outline.md`。

## 关键交互

### 节点布局

- 拖拽节点 → 坐标防抖写 localStorage。
- 首次打开无布局记录 → 自动布局：大纲先序遍历，树序从左到右、同层自上而下排布。
- [自动布局] 按钮随时重排；缩放按钮 + 滚轮，`zoom` 写 localStorage。
- 「显示: 仅场景」开关：隐藏卷/章容器节点，只留 scene（推荐模式，连线以 scene 为主）。

### 创建连线（plot_edge）

1. 从节点拖出连线，松开到目标节点。
2. 弹出小表单：连线标签（可选，写入 `metadata.label`，如「路径A」）。
3. 提交 `POST /relation`；成功即绘制。
4. 失败：`RELATION_EXISTS` → toast「这条连线已经存在」；`VALIDATION_ERROR` → toast 参数问题。

### 删除连线

- 点击连线高亮 → [删除连线] → 确认框（**提示：物理删除不可恢复，可随时重建**）→ `DELETE /relation/:id`。

## 状态

- **空态**：无大纲节点 → 居中「大纲还是空的，先去搭大纲」+ [去大纲]（`#/outline`）。
- **加载态**：节点区骨架。
- **错误态**：列表/关系请求失败 → 重试横幅；连线操作失败用 toast。
- **说明角标**：常驻小字「连线与坐标仅用于推演展示，不参与状态计算」（决策 9/10），可点击收起。
