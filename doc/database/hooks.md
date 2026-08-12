# 伏笔（Hook）系统设计

伏笔是长篇创作的核心叙事工具。AI Editor 的伏笔系统不依赖 LLM 自动从正文提取，而是**以大纲节点为锚点，用户和 AI 协作管理**。

## 与 InkOS 的本质区别

| 维度 | InkOS | AI Editor |
|------|-------|-----------|
| 伏笔来源 | Architect 建书时播种，Settler 从正文自动提取 | **用户手动创建**或 AI 提案创建 |
| 推进方式 | Writer 写章节时 Settler 自动分析推进 | **用户推进大纲节点时，AI 提案推进对应伏笔** |
| 回收方式 | LLM 在 Settler 中判断并标记 resolved | AI 分析后提案，用户确认 |
| 健康检查 | ContinuityAuditor 自动检查 | **analyze_hook_health 工具按需检查** |
| 数据存储 | Markdown 表格 + JSON + SQLite 三份 | **仅 SQLite（entities + relation_records + delta_records）** |

## 数据模型：伏笔即实体

伏笔作为 entities 表中的一种新类型，无需新建表。所有关联关系通过 relation_records 表达，状态变化通过 delta_records 记录。

### 扩展 entities 表类型

```sql
-- 新增 'hook' 到 type CHECK 约束
CREATE TABLE entities (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('character', 'setting', 'location', 'hook')),
  ...
);
```

### hook 类型的 data 字段结构

```json
{
  "status": "planted",
  "category": "mystery",
  "expected_payoff": "揭示主角是仙界转世",
  "payoff_timing": "slow_burn",
  "half_life": 8,
  "is_core": true,
  "notes": "通过梦境暗示",
  "expected_resolve_node_id": "sc-45"
}
```
（2026-08 修订：示例不再包含 `_health`——健康指标为运行时计算，仅作为响应附加字段返回，不写回 data，见下文。）

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | enum | `planted` → `progressing` → `resolved` 或 `abandoned` |
| `category` | string | 自由填，例如：`mystery` / `relationship` / `item` / `character_growth` / `world_building` |
| `expected_payoff` | string | 预期回收方式描述 |
| `payoff_timing` | enum | `immediate` / `near_term` / `mid_arc` / `slow_burn` / `endgame`（`half_life` 未设置时的缺省映射来源，见决策 21） |
| `half_life` | number | 超过此章数未推进算"遗忘"（stale）；显式值优先，缺省按 `payoff_timing` 映射（决策 21） |
| `is_core` | boolean | 主线伏笔 |
| `notes` | string | 自由备注 |
| `expected_resolve_node_id` | string \| null | 可选：预计回收的大纲节点 id（`ready_to_resolve` 指标依据，决策 21） |

### 伏笔关系约定（relation_records）

沿用通用关系表，通过 `relation_type` 区分语义：

```sql
-- 埋下伏笔的大纲节点
INSERT INTO relation_records (source_type, source_id, target_type, target_id, relation_type, metadata)
VALUES ('outline_node', 'sc-5', 'hook', 'hook-1', 'plants',
  '{"chapter": 5, "description": "主角梦见自己站在云端"}');

-- 推进伏笔的大纲节点
VALUES ('outline_node', 'sc-12', 'hook', 'hook-1', 'advances', '{}');
VALUES ('outline_node', 'sc-20', 'hook', 'hook-1', 'advances', '{}');

-- 回收伏笔的大纲节点
VALUES ('outline_node', 'sc-45', 'hook', 'hook-1', 'resolves', '{}');

-- 伏笔间的依赖关系（B 依赖 A 先解开）
VALUES ('hook', 'hook-2', 'hook', 'hook-1', 'depends_on',
  '{"description": "先揭示玉佩来历，才能触及转世秘密"}');

-- 伏笔关联的人物/设定/地点
VALUES ('hook', 'hook-1', 'character', 'char-3', 'involves', '{}');
VALUES ('hook', 'hook-1', 'setting', 'set-7', 'involves', '{}');
```

> **chapter 不落库（2026-08 修订）**：`plants` / `advances` / `resolves` 关系的章节信息**不写入 metadata**——由服务端基于 `source_id` 从大纲树**查询时现推**（章节序推导规则见决策 21；节点 move 后不陈旧），调用方（AI 工具 / 前端）不必手工填写。

### 伏笔状态变化（delta_records）

```sql
INSERT INTO delta_records (node_id, target_type, target_id, changes, description, "order")
VALUES ('sc-12', 'hook', 'hook-1',
  '[{"field": "status", "op": "update", "from": "planted", "to": "progressing"}]',
  '主角在第12章发现了玉佩的秘密', 1);

VALUES ('sc-45', 'hook', 'hook-1',
  '[{"field": "status", "op": "update", "from": "progressing", "to": "resolved"}]',
  '在第45章揭示主角是转世仙尊', 2);
```

## 伏笔生命周期

```
创建（用户手动 or AI 提案确认）
  │  entities 中插入 type='hook' 的记录
  ▼
埋下（关联到大纲节点）
  │  relation_records 中插入 plants 关系
  │  status = planted
  ▼
推进（大纲推进到新节点时触发）
  │  AI 提案: "主角在大纲第20章获得玉佩，伏笔『身世之谜』应该推进了"
  │  用户确认 → Tool Executor 调用 advance_hook（复合写：delta_records 记 status = progressing
  │             + relation_records 插入 advances 关系，一次提交，见 tools.md）
  │  _health.dormancy 重置
  ▼
回收（大纲到达回收节点）
  │  AI 提案: "第45章达到了回收『身世之谜』的条件"
  │  用户确认 → Tool Executor 调用 resolve_hook（复合写：delta 记 status = resolved
  │             + relation 插 resolves 关系，见 tools.md）
  │  _health.dormancy 重置
废弃（主动放弃）
  │  AI 提案 propose_abandon_hook → 用户确认 → executor abandon_hook
  │  （delta_records 记 status = abandoned，见 tools.md）
```

## 健康指标（运行时计算，不持久化）

> **MVP 简化（2026-08 决策，backlog #13）**：以下 `_health` 附加字段**契约未定义、不对外承诺**——REST 响应不含该字段，伏笔面板不展示健康指标与章节序（见 `doc/ui/pages/hook-panel.md`）；本节为后续迭代的设计草案。

每次查询伏笔时实时计算 `_health`，**仅作为响应附加字段返回，不写回 data**。**「当前章节」来源于 project.json 的 `current_position`**（已纳入 project.json 契约，见 `schema.md`；`current_position` 指向某大纲节点，**章节序推导规则见决策 21**：全局章序号、scene 归入所属章）；未设置时为 null，相关指标返回未计算。

| 指标 | 计算方式 |
|------|---------|
| `age` | 当前章节 - 埋下章节（`plants` 关系的节点现推章节序） |
| `dormancy` | 当前章节 - 最近推进章节（`advances` 关系的最新节点章节序） |
| `stale` | `dormancy > half_life`（`half_life` 缺省映射见决策 21） |
| `overdue` | `age > half_life * 2` |
| `ready_to_resolve` | `expected_resolve_node_id` 已设置时：当前章节 >= 该节点章节序；未设置返回未计算 |
| `blocked` | 存在 `depends_on` 关系的伏笔尚未 resolved |

## 工具扩展

在已有工具分类中增加伏笔相关工具：

```typescript
// === 分析工具（自动）===
analyze_hook_health()
  → { active_count: 5, stale: ["hook-3"], overdue: [], blocked_chains: [...],
      warnings: ["hook-3 已 10 章未推进，半衰期 5"] }

trace_hook_lifecycle(hook_id)
  → { hook, plant, advances, resolve, dormancy: 7, timeline_graph }

suggest_hook_payoff(hook_id)
  → { suggestions: [{ at_node: "sc-42", reason: "此时已揭示玉佩来历" }] }

find_hook_opportunities(outline_node_id)
  → { opportunities: [{ category: "mystery", reason: "新登场角色" }] }

detect_hook_conflicts()
  → { conflicts: [{ hook_a, hook_b, description }] }

// === 提案工具（确认）===
propose_create_hook(name, data, plant_at_node_id?)
propose_update_hook(hook_id, patches)
propose_advance_hook(hook_id, node_id, description)
propose_resolve_hook(hook_id, node_id, description)
propose_abandon_hook(hook_id, description)
```

## GUI 中的伏笔视图

```
伏笔面板（侧栏或独立页面）:
┌────────────────────────────────────────────┐
│  伏笔池                          [+新建]    │
│                                            │
│  🔴 活跃 (3)                               │
│  ├─ 📌 身世之谜     sc:5 → 45    stale ⚠️  │
│  │   └── 依赖: 玉佩来历 ✋                   │
│  ├─ 📌 玉佩来历     sc:12 → 30   ok         │
│  └─ 📌 断剑认主     sc:3  → 60   ok         │
│                                            │
│  ✅ 已回收 (1)                              │
│  └─ ✅ 灵根测试     sc:1  → 8              │
│                                            │
│  关联大纲: sc-12 ──advances──▶ 身世之谜     │
└────────────────────────────────────────────┘
```

大纲节点上的伏笔标记：
```
sc-12 (玉佩的秘密) [📌身世之谜↑][📌玉佩来历↑]
                          ↑advances  ↑plants
```
