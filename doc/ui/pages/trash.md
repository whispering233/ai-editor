# Trash 回收站原型

## 路由与数据

- 路由：`#/trash`（回收站是跨实体/大纲的全局入口，挂在侧栏底部分隔区，见 layout.md）
- 列表：`GET /api/v1/trash` → `{ entities[], nodes[] }`
- 还原：`POST /api/v1/trash/entity/:type/:id/restore`、`POST /api/v1/trash/outline/:nodeId/restore`
- 彻底删除（purge）：`DELETE /api/v1/trash/entity/:type/:id`、`DELETE /api/v1/trash/outline/:nodeId`（递归整棵子树）

## 布局线框

```
┌──────────────────────────────────────────────────────────┐
│ 回收站                                [刷新]               │
│ 软删对象会保留一段时间（保留时长实现期定）                      │
├──────────────────────────┬───────────────────────────────┤
│ 实体 (3)                   │ 大纲节点 (2)                   │
│ [人物] 张三      8-01  │ [场景] 被逐出师门   8-02      │
│   [还原] [彻底删除]        │   [还原] [彻底删除]            │
│ [伏笔] 玉佩来历   8-01  │ [卷] 第三卷（含整棵子树） 7-30 │
│   [还原] [彻底删除]        │   [还原] [彻底删除]            │
│ [设定] 力量体系   7-28  │                              │
│   [还原] [彻底删除]        │                              │
└──────────────────────────┴───────────────────────────────┘
```

## 信息层级

| 分栏 | API 字段 |
|------|---------|
| 实体 | `entities[].{ id, type, name, deletedAt }`（按 `deletedAt` 倒序） |
| 节点 | `nodes[].{ id, type, title, deletedAt }`（按 `deletedAt` 倒序；purge 时含整棵子树） |
| 还原结果 | `restored` / `restoredChildren` / `restoredRelations` / `restoredDeltas`（toast 摘要） |

## 关键交互

### 还原

> H2：还原直接执行，**不弹二次确认**；失败按错误态处理（404/409 等）。

- **实体**：`POST /trash/entity/:type/:id/restore` → toast「已还原，连带恢复 N 条关系、N 条变更记录」；行移除。
- **节点**：`POST /trash/outline/:nodeId/restore`：
  - 成功 → toast「已还原（含 N 个子节点）」。
  - **409 `OUTLINE_ANCESTOR_DELETED`（关键错误态）** → **行内提示**（冲突节点行下方，`border-destructive/30 bg-destructive/10` 红色块）「上级节点《{祖先名}》也在回收站，请先还原上级」+ [还原上级] 快捷按钮；祖先 id 从 409 message 解析、名字从当前回收站列表匹配（软删祖先必在列表，找不到兜底显示 id）；点击还原上级成功后自动重试当前节点——服务端报**路径上最顶层**软删祖先，还原一次级联解整条链（决策 12 修订：杜绝可见节点挂不可见父）。

### 彻底删除（purge，物理清除）

- **二次确认**：
  1. 确认框：「彻底删除后不可恢复」+ 影响范围——实体：「连带删除 N 条关系、N 条变更记录」；节点：「将删除整棵子树（N 个子节点）及关联关系、变更记录」。
  2. 二次按钮确认（MVP：确认框内再点一次「确认彻底删除」即可，不做输入文字确认）。
- `DELETE /trash/...` → 行移除 + toast「已彻底删除」。

## 状态

- **空态**：「回收站是空的」。
- **加载态**：分栏骨架。
- **错误态**：`ENTITY_NOT_FOUND` / `OUTLINE_NODE_NOT_FOUND`（目标已被 purge 的残留请求）→ 刷新列表并 toast「该对象已不存在」。
