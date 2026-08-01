# HookPanel 伏笔面板原型

> MVP 简化（2026-08 决策）：**不展示健康指标徽标与章节序**（`_health` REST 契约与面板展示留后续迭代，见 `doc/design/backlog.md`）；本面板 MVP 只列基础字段与生命周期操作。

## 路由与数据

- 路由：`#/hooks`
- 列表：`GET /api/v1/entity/hook`（EntitySummary：`summary.status` / `summary.payoff_timing`）
- 详情/关联：`GET /api/v1/entity/hook/:id`（`relations` 含 `plants`/`advances`/`resolves`/`depends_on`/`involves`）
- 大纲（选节点）：`GET /api/v1/outline`；当前位置：`GET /project/config`
- 操作：
  - 新建：`POST /entity/hook` + `POST /relation`（plants）
  - 推进/回收：`POST /delta`（status 变化）+ `POST /relation`（advances/resolves），一次提交（等价 executor 复合写，tools.md）
  - 废弃：`POST /delta`（status=abandoned）
  - 软删：`DELETE /entity/hook/:id`

## 布局线框

```
┌───────────────────────────────────────────────────────────────┐
│ 伏笔池                                        [+ 新建伏笔]      │
├───────────────────────────────────────────────────────────────┤
│ 🔴 活跃 (3)                                                   │
│  ├─ 📌 身世之谜   mystery                          [⋯]         │
│  │   依赖: 玉佩来历                                            │
│  ├─ 📌 玉佩来历   mystery                          [⋯]         │
│  └─ 📌 断剑认主   item                             [⋯]         │
│                                                               │
│ ✅ 已回收 (1)                                                 │
│  └─ 灵根测试                                                  │
│                                                               │
│ 已废弃 (0)                                                    │
└───────────────────────────────────────────────────────────────┘
```

（hooks.md 示意中的健康徽标与「埋点章 → 预计回收章」展示为后续迭代内容，MVP 不做。）

## 信息层级

| 展示 | API 字段 |
|------|---------|
| 行主信息 | `name`、`summary.category` |
| 状态分组 | `summary.status`：planted/progressing → 活跃；resolved → 已回收；abandoned → 已废弃 |
| 埋点/回收位置 | 详情 `relations`：`plants` 关系 `source_id`（埋点节点）、`resolves`（已回收节点）、data 字段 `expected_resolve_node_id`（预计回收节点）——MVP 展示节点 id，章节序后续迭代由服务端现推（决策 21） |
| 依赖链 | `relations[relationType=depends_on]` → 目标 hook 名 |
| 时间 | `createdAt` / `updatedAt` |

## 关键交互

### 新建伏笔（手动）

对话框：`name` + data 表单（`category` / `expected_payoff` / `payoff_timing` / `half_life` / `is_core` / `notes` / `expected_resolve_node_id` 大纲节点选择器）+ 埋点节点选择（`plant_at_node_id`，大纲树选择器，可空）。

→ `POST /entity/hook`；有埋点节点再 `POST /relation`（outline_node → hook，`plants`）→ 列表刷新。

### 推进 / 回收 / 废弃（复合写确认面板）

所有状态变更操作走「提案式确认」交互——与 AI 提案体验一致：先展示将写入的内容，确认后才执行。

- **推进**：选择大纲节点（默认当前位置节点）+ 描述 → 面板展示「将写入：status → progressing + advances 关系」→ 确认 → `POST /delta` + `POST /relation` 一次提交。成功 toast「已推进」。
- **回收**：选择节点 + 描述 → 面板展示「status → resolved + resolves 关系」；若该伏笔存在 `depends_on` 依赖者（别人依赖它），面板额外提示「有 N 个伏笔依赖此伏笔」。
- **废弃**：仅描述 → 面板展示「status → abandoned」。

### 行操作

- ⋯ 菜单：详情（展开 relations 全览：埋点/推进/回收节点列表 + 依赖链 + involves 关联）· 推进 · 回收 · 废弃 · 编辑（data 表单，同 EntityDetail）· 移入回收站（软删，确认框展示 `cascaded.relations/deltas`）。
- 依赖链：行内「依赖: 玉佩来历」可点击展开递归链（depends_on）。

## 状态

- **空态**：「还没有伏笔。好伏笔要趁早埋下——先新建一个，或在聊天里让 AI 帮你规划。」
- **错误态**：列表失败 → 重试横幅；复合写失败（如目标节点已软删）→ 确认面板内联错误。
- **加载态**：分组骨架。
