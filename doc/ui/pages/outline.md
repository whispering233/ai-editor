# Outline 大纲树原型

## 路由与数据

- 路由：`#/outline`
- 数据：`GET /api/v1/outline`（整树）
- 操作：`POST /outline`（建）、`PUT /outline/:nodeId`（改）、`PUT /outline/:nodeId/move`（移）、`DELETE /outline/:nodeId`（软删）、`PUT /project/config`（设当前位置）

## 布局线框

```
┌──────────────────────────────────────────────────────────┐
│ 大纲                          [+ 新建节点] [全部展开/折叠]    │
├──────────────────────────────────────────────────────────┤
│ ▾ 卷1 第一卷                        更新于 8-01    [⋯]    │
│   ▾ 章1 第一章                      更新于 8-01    [⋯]    │
│     · 场景 灵根测试失败              更新于 8-02    [⋯]    │
│     · 场景 被逐出师门                             [⋯]    │
│   ▾ 章2 第二章                                        [⋯] │
│     · 场景 …                                          [⋯] │
│ ▸ 卷2 第二卷                                          [⋯] │
└──────────────────────────────────────────────────────────┘
```

行结构：`[折叠箭头] [类型徽标 卷/章/场] [标题] [摘要·弱化截断] [当前位置徽标] [⋯ 操作菜单]`

⋯ 菜单：编辑标题/摘要 · 新建子节点 · 移动到… · 设为当前位置 · 移入回收站（软删）

## 信息层级

| 展示 | API 字段 |
|------|---------|
| 树 | `GET /outline` → `children[]`（OutlineNode：`id` / `type` / `title` / `summary` / `children` / `updatedAt`） |
| 层级约束 | 严格三层 volume → chapter → scene，无游离节点（决策 19）；渲染层不做任何「容错展示」 |

## 关键交互

### 创建节点

对话框：

- 类型：volume / chapter / scene（单选）。
- 父节点：树形下拉，**按类型过滤**（决策 19）：
  - volume → 父固定 root（隐藏选择器）
  - chapter → 可选 root 或 volume
  - scene → **仅 chapter 可选**，其余置灰禁用
- 字段：`title`（必填 1-200 字）、`summary`（可选）。
- 提交：`POST /outline { type, title, parent_id, summary }`；成功后自动展开父节点、新节点高亮。

### 移动节点（拖拽重排）

- 拖拽行 → 悬停候选父节点：合法目标（同创建规则过滤）高亮，非法目标显示禁用态。
- 落点位置决定 `order`（插入兄弟之间）。
- 提交：`PUT /outline/:nodeId/move { parent_id, order }`。
- **MVP 兜底**：⋯ 菜单「移动到…」对话框（选父节点 + 目标位置）——拖拽实现成本高时先做对话框，交互语义一致。
- 移动后画布投影自动更新（决策 1），无需前端联动处理。

### 设为当前位置

- 菜单项「设为当前位置」→ `PUT /project/config { current_position: nodeId }`。
- 生效后行尾显示「当前位置」徽标，顶栏同步更新（project store 广播）。
- 伏笔面板健康指标依赖此值（决策 21）；未设置时该节点行无徽标。

### 软删（移入回收站）

- ⋯ 菜单 → 确认对话框，展示级联影响：`DELETE /outline/:nodeId` 响应 `cascaded.{ children, relations, deltas }` → 确认后行消失 + toast「已移入回收站（含 N 个子节点）」。

## 状态

- **空态**：无任何节点 → 居中「大纲还是空的，先建第一卷」+ 主按钮 [新建第一卷]（打开创建对话框，类型锁定 volume）。
- **加载态**：树骨架。
- **错误态**：
  - `VALIDATION_ERROR`（如 scene 挂 volume 下、parent_id 缺失）→ 创建/移动对话框内联错误。
  - `OUTLINE_NODE_NOT_FOUND`（节点已被 purge）→ 错误横幅 + 刷新树。
  - `PUT /project/config` 失败（`current_position` 指向软删节点，服务端拒绝）→ toast「该节点已删除，无法设为当前位置」。
