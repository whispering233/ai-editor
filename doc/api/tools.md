# Tool Calling 设计

## 工具分级

InkOS 按 sessionKind 切换工具集（chat/play/write 各有不同工具），而 AI Editor 是**单一交互场景**——始终是"创作者对话创作顾问"。所以不切换工具集，而是按操作风险分为三级权限：

| 级别 | 行为 | 用户感知 |
|------|------|---------|
| **自动** | 直接执行，结果返回 LLM | 无感 |
| **提案确认** | 展示提案卡片，用户审阅后确认/拒绝修改后再执行 | 弹窗卡片 |
| **二次确认** | 展示 diff + 警告，用户二次确认 | 强警告弹窗 |

## 工具目录

### 查询类（自动）

目标是让 AI 有能力探索整个创作数据库，不需要用户干预。

> 所有查询类工具**默认过滤软删对象**（决策 12 修订）：`get_entity` / `search_entities` / `query_relationships` 等不会返回或遍历回收站中的对象。

```typescript
// === 实体查询 ===
get_entity(type, id)
  → 实体详情（含 data JSON 解析后的字段）

search_entities(type, query, filters?)
  → 匹配的实体列表（名称 + 类型 + 关键字段摘要）
  filters: { tags?: string[], status?: string }

// === 关系查询 ===
query_relationships(opts: {
  source_type?: string, source_id?: string,
  target_type?: string, target_id?: string,
  relation_type?: string,
  depth: 1 | 2 | 3  // 1=紧邻, 2=k跳, 3=全量
})
  → 关系图子图 [{ source, target, type, metadata }]

// === 大纲查询 ===
get_outline()
  → 完整大纲树

get_outline_path(node_id)
  → 从根到该节点的路径 ID 列表
  用途：AI 说"从卷1第3章到结局有哪几条路径"

// === 状态查询（Delta 相关）===
compute_state(target_type, target_id, at_node_id?)
  → 实体到达指定节点时的累积状态
  用途：AI 说"张三在第30章时的战力是多少"
  语义：只沿大纲树父链（根 → at_node_id）累积已确认 Delta（决策 9）；
        plot_edge 连线不参与；游离节点仅累积直接挂载在它上面的 Delta

get_delta_history(target_type, target_id)
  → 该实体的所有属性变更记录（按时间/节点排序）

// === 聚合分析 ===
get_entity_summary(type)
  → 指定类型实体的统计数据（总数、角色分布、能力分布等）
```

### 分析类（自动）

AI 的核心价值——**分析**而非操作。这些工具不是简单查数据，而是做一定程度的结构化分析。

```typescript
// === 一致性分析 ===
analyze_consistency(entity_id)
  → { issues: [{ severity, field, description }] }
  用途：检查人物档案内部是否有矛盾（"性格坚韧但曾因小事放弃"）

detect_conflicts(opts: {
  types?: string[],
  relation_filter?: string[]
})
  → { conflicts: [{ entity_a, entity_b, field, description }] }
  用途：AI 自动发现设定矛盾

// === 路径分析 ===
trace_plot_paths(from_node_id, to_node_id)
  → { paths: [{ nodes: [], description, risk_factors: [] }] }
  用途：从节点A到节点B推演可能的剧情路径

find_orphan_elements()
  → { unused_characters: [], unresolved_deltas: [], dangling_relations: [] }
  用途：发现"写到第30章，但角色C第10章后就没出现"
  另：跨存储（data.db / outline.json）不一致的兜底修复入口（决策 16 修订）——
      取消/断电可能造成「DB 已写、JSON 未写」的不一致，由本工具检测并引导修复

// === 关系发现 ===
suggest_connections(entity_id)
  → { suggestions: [{ target_id, relation_type, reason }] }
  用途：AI 主动发现"这个新角色和已有角色B有潜在关联"
```

### 伏笔分析工具

参见 [`../database/hooks.md`](../database/hooks.md) 中的工具扩展部分。

### 提案类（需确认）

AI **不能直接修改数据**，而是通过 `propose_*` 工具向用户提案，用户在 GUI 中审阅后确认。

```typescript
propose_create_entity(type, name, data)
  → { proposal_id, preview, conflicts_with? }

propose_update_entity(entity_id, patches)
  → { proposal_id, diff }

propose_delete_entity(entity_id)
  → { proposal_id, cascade_warning }

propose_add_relation(source, target, type, metadata?)
propose_remove_relation(relation_id)
  → 同上，展示 diff

propose_add_delta(node_id, target, changes)
  → { proposal_id, preview }

propose_outline_node(type, title, parent_id?)
propose_move_node(node_id, parent_id, order)
propose_delete_node(node_id)
  → 同上，展示在大纲树上的位置变化
```

### 执行类（用户通过 GUI 直接操作）

这部分**不由 AI 调用**，而是用户通过 GUI 界面直接完成。AI 的 `propose_*` 产生提案卡片后，用户可以选择确认，由 Tool Executor 执行对应的底层操作。

```typescript
// 底层执行工具（不暴露给 LLM，由 Tool Executor 在用户确认后调用）
create_entity(type, name, data)       → id
update_entity(id, patches)            → updated
delete_entity(id)                     → void
add_relation(source, target, type)    → id
remove_relation(id)                   → void
add_delta(node_id, target, changes)   → id
create_outline_node(type, title, parent) → id
move_node(node_id, parent, order)     → void
delete_node(node_id)                  → void
```

## 与 InkOS 的关键差异对比

| 维度 | InkOS | AI Editor |
|------|-------|-----------|
| **工具集** | 按 sessionKind 切换（chat/play/book 不同） | **单一工具集**，一次注册 |
| **生产工具** | LLM 可直接调用 sub_agent/write/edit（部分模式） | LLM **只能提案**，不暴露写入工具 |
| **确认机制** | `propose_action` → 切换 session | `propose_*` → 提案卡片 → 用户确认 → Tool Executor 执行 |
| **写入方式** | LLM 输出 delta，服务端归约渲染 | 用户确认后，Tool Executor 直接写 SQLite/JSON |
| **analysis 工具** | 无独立分析工具（由 Agent 对话完成） | **分析工具是一等公民** |
| **数据写入路径** | LLM → delta → 归约 → 渲染 | 用户确认 → Tool Executor → SQLite/JSON |

## 核心设计原则

```
AI 角色是分析顾问，不是操作员。

AI 可以：
  ✅ 自由查询任何数据（自动）
  ✅ 运行结构化分析（自动）
  ✅ 向用户提出修改建议（提案确认）

AI 不可以：
  ❌ 直接写入或修改数据
  ❌ 直接删除任何内容
  ❌ 调用执行类工具

用户始终是最终决策者。
```

## agent 循环终止与失败处理

对应 [`../design/decisions.md`](../design/decisions.md) 决策 15。主循环设三重保险，任一超限即终止：

| 保险 | 上限 | 超限行为 |
|------|------|---------|
| max iterations | 8 轮 | 发 `error` 事件终止循环 |
| 单轮超时 | 120s | 同上 |
| token 预算 | 上下文窗口内预算上限 | 同上 |
| 工具结果 token 预算 | 工具返回值序列化后估算 token 上限 | 截断/拒绝该工具结果并提示 LLM 缩小范围 |

失败处理：
- **工具执行失败**：以结构化文本（工具名 + 参数 + 错误信息）喂回 LLM 自纠，不直接终止。
- **模型调用失败**（429/5xx/超时）：按 `llm/retry.ts` 的退避重试策略重试，最终失败以 `error` 事件呈现给用户。
- **工具结果过大**：`get_outline` 整树或 `depth=3` 全图可能撑爆上下文窗口，工具结果序列化后先估算 token，超限即截断/拒绝（决策 15 补充）。
- SSE 断开时全链路取消见 [`endpoints.md`](./endpoints.md) chat 端点（决策 16）。
