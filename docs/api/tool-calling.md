# Tool Calling 设计

> 工具 schema 的写法、执行契约、提案载荷的传递方式。循环/重试/压缩语义见 [`../design/30-agent-loop.md`](../design/30-agent-loop.md)。

## 工具定义（TypeBox）

工具参数 schema 用 **TypeBox** 定义（`packages/tools` 内），经 `@earendil-works/pi-ai` 重导出使用（`import { Type, type Static } from "@earendil-works/pi-ai"`，不单独装 typebox）：

- **一份定义三用**：运行时对象即 JSON Schema（直接作为模型 tool parameters）、`Static<typeof schema>` 给 TS 类型、pi 的 `validateToolArguments` 用它做执行前校验。不需要 zod→JSON Schema 转换。
- **schema 不放在 `shared`**：client 不打包工具 schema（与 Zod API 校验同理）。
- **严格性**：拒绝多余字段需显式 `Type.Object({...}, { additionalProperties: false })`（嵌套对象同理）。
- **校验前原始类型 coerce**（与 pi 循环同一实现）：`"3"` → `3`、`"true"` → `true`、`null` → `""`/`0`/`false`、标量 → 单项数组、小数按 integer 截断（`2.5` → `2`）。即「类型写错」很少直接报错，而是被 coerce 后进入工具——**因此工具实现必须自己校验业务不变量**（如重排提案仍校验「覆盖全量时间点」，见 `propose_reorder_timepoints`）。
- **工具结果**：`execute(toolCallId, params, signal)` 返回 `{ content, details }`；`details` 是结构化载荷（前端展示 / 提案卡数据），不进模型上下文。

## 工具分级

InkOS 按 sessionKind 切换工具集（chat/play/write 各有不同工具），而 AI Editor 是**单一交互场景**——始终是"创作者对话创作顾问"。所以不切换工具集，而是按操作风险分为两级权限：

| 级别 | 行为 | 用户感知 |
|------|------|---------|
| **自动** | 直接执行，结果返回 LLM | 无感 |
| **提案确认** | 展示提案卡片，用户审阅后确认/拒绝修改后再执行 | 弹窗卡片 |

（2026-08 修订：原「二次确认」级无任何工具挂靠，删除。删除操作由提案确认 + 回收站软删兜底覆盖——软删可还原、提案确认，用户始终是最终决策者。）

## 工具目录

### 查询类（自动）

目标是让 AI 有能力探索整个创作数据库，不需要用户干预。

> 所有查询类工具**默认过滤软删对象**：`get_entity` / `search_entities` / `query_relationships` 等不会返回或遍历回收站中的对象；`query_relationships` 额外校验关系端点均未软删（任一端点软删即不可见）。

```typescript
// === 实体查询 ===
get_entity(type, id)
  → 实体详情（含 data JSON 解析后的字段）

search_entities(type, query, filters?)
  → 匹配的实体列表（名称 + 类型 + 关键字段摘要）
  filters: { tags?: string[], status?: string }
  status 口径（2026-09）：匹配 `data.status`——**实际只在伏笔（hook）上有意义**
    （生命周期 planted/progressing/resolved/abandoned）；character 的 status 字段已移除
  character 摘要字段：role / description（截断 100）/ motivation（截断 40）/
    personality 前 2 / **ability_panel 顶层分组名前 2**（完整面板走 get_entity 详情）

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
  → 完整大纲树（严格三层，无游离节点）
  注意：默认不含 metadata 统计（省 token）；需统计走 API `GET /outline?with_metadata=`

get_outline_path(node_id)
  → 从根到该节点的路径 ID 列表
  用途：AI 说"从卷1第3章到结局有哪几条路径"

// === 状态查询（Delta 相关）===
compute_state(target_type, target_id, at_node_id)
  → 实体到达指定节点时的累积状态
  用途：AI 说"张三在第30章时的战力是多少"
  语义：只沿大纲树父链（根 → at_node_id）累积已确认 Delta：
        节点间按树路径顺序、同一节点内按 order 双层排序；plot_edge 连线不参与；
        **at_node_id 不限层级**（章/场景均可——「第3章第2场时他什么状态」是合法查询）；
        op=update 校验当前值等于 from，不匹配**跳过该 change 并继续累积**，结果在
        conflicts 中标注 { field, expected, actual }（不再返回 409——手动编辑 data 是
        正常用户行为，AI 应感知 conflicts 并向用户提示修复）；
        field 支持点分嵌套路径（2026-09，如 `ability_panel.火系.等级`）——逐层下钻定位

get_delta_history(target_type, target_id)
  → 该实体的所有属性变更记录（按时间/节点排序）

// === 聚合分析 ===
get_entity_summary(type)
  → 指定类型实体的统计数据（总数、角色分布、能力分布等）
  character 口径（2026-09）：`byRole` = data.role 分布；`byStatus` **已移除**（status 字段连带删除）；
    `topAbilities` 改读**能力面板顶层分组名**（如「火系」「水系」——叶子名多为「等级/熟练度」
    这类重复词，按叶子计数无意义）
  hook 口径不变：`byStatus`（生命周期）+ `byPayoffTiming`

// === 参考资料查询 ===
search_references(query, type?, tags?)
  → 匹配的参考资料列表（标题 + 类型 + 标签 + 内容摘要截断 120 字）
  用途：AI 不知道书里有哪些参考资料时先搜索（标题+tags 关键词命中）再按需取全文
  （详情取全文走 get_entity('reference', id) 的 reference 分支——列表摘要/详情全文分离防长文撑爆响应）
  type 参数（2026-08 修订）：**自由文本分类**（原预置枚举已取消），建议沿用项目内已有分类；
    过滤为结果层原始值比对（summary.type === type）
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
  → { unused_characters: [], unresolved_deltas: [], dangling_relations: [], inconsistent_soft_deletes: [] }
  用途：发现"写到第30章，但角色C第10章后就没出现"
  inconsistent_soft_deletes：诊断跨存储软删不一致（outline.json 节点已标 deleted 但关联
      relation/delta 未软删——「可见记录指向已软删节点」的幽灵形态）。兜底修复已由**启动
      一致性校验**承担（打开项目时自动比对，以大纲节点软删为准补标 DB 记录
      deleted_at，写日志），本工具保留诊断与引导修复用途

// === 关系发现 ===
suggest_connections(entity_id)
  → { suggestions: [{ target_id, relation_type, reason }] }
  用途：AI 主动发现"这个新角色和已有角色B有潜在关联"
```

### 伏笔分析工具

伏笔工具（`analyze_hook_health` / `trace_hook_lifecycle` / `suggest_hook_payoff` / `find_hook_opportunities` / `detect_hook_conflicts`）的参数与返回结构以 `packages/tools/src/index.ts` 的工具描述为单一来源。

**章级锚点口径（2026-09）**：伏笔的埋设/推进/回收锚点一律为**章**节点——

- `plants` / `advances` / `resolves` 关系的源节点必须是 `chapter`（`POST /relation` + 提案层校验）；
- `suggest_hook_payoff` 的候选由「场景」改为**章**（按与理想回收章的距离升序取 top 3）；
- `find_hook_opportunities(outline_node_id)` 的输入只接受章节点；
- `data.expected_resolve_node_id` 为宽松 data 字段（服务端不硬校验），UI 选择器只列章；
- 「当前章节」= `project.json` 的 `current_position` 所属章（未设置/失效 → 退化树末章），伏笔健康指标与孤儿诊断同口径。

### 提案类（需确认）

AI **不能直接修改数据**，而是通过 `propose_*` 工具向用户提案，用户在 GUI 中审阅后确认。

> **返回语义**：`propose_*` 的 tool result `content` 仅返回「提案已发出」提示（proposal_id + 一句话摘要），**不含预览细节**——避免 LLM 误以为提案已生效而重复提案；完整预览放在同一次调用的 `result.details`（`{ proposal_id, type, preview }`），随 SSE `tool_execution_end` 帧推给 GUI（见 [80-api-chat.md](./80-api-chat.md)）。

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
  node_id **仅章**（2026-09）：卷/场景 → 工具层拒绝（与 POST /delta 同口径）；
  changes 的 field 支持点分嵌套路径（`ability_panel.火系.等级`），嵌套路径仅标量 set/update

propose_outline_node(type, title, parent_id?)
propose_move_node(node_id, parent_id, order)
propose_delete_node(node_id)
  → 同上，展示在大纲树上的位置变化

propose_reorder_timepoints(timepoint_ids)
  → 按时间标签语义先后重排时间轴时间点（2026-08 G2 修订；
    取代 F9 的 propose_reorder_events——G2 后事件不再带 time_label，语义序的载体
    变为时间点实体）
  参数：{ timepoint_ids: string[] }——LLM 按时间点 name（时间标签文本）语义识别
        时间先后后产出的**有序时间点 id 全量序列**（须覆盖当前全部未软删时间点）
  预览：顺序变化说明（如「『玉佩来历揭开』从第 3 位移到第 1 位」）
  确认后：Executor 校验全部时间点 references（存在性 + updated_at 快照，任一过期
        → 409 PROPOSAL_STALE——用户拖拽改序后 AI 提案自动失效）→ 按新序
        事务内重排 timepoint.sort_order（拖拽权威语义不变）
  用途：AI 按时间标签语义（如「第二天黄昏」「少年时」）自动识别先后顺序，
        用户确认后采用——时间点是语义序的天然载体

propose_create_reference(name, type, content, source?, tags?)
  → { proposal_id, preview, conflicts_with? }
  用途：AI 读到灵感/素材后建议保存为参考资料（外部素材/灵感笔记，非本书正文）
  参数说明：type 分类**自由文本**（原枚举已取消，建议沿用项目内已有分类，
    缺省 material 写入侧兜底）；content 为全文长文本；tags 标签数组
  预览：标题 + 内容摘要 + 标签（提案仅内存 + 快照重校验）
  确认后：Executor 校验 references 存在性 + 快照 → create_entity(type='reference') 写入
  AI 创建的条目归 **link 类**（data.kind='link'，source → url；
    无 URL 时 url 留空、content 存摘录）——AI 不直接落盘文件（文件写入走用户编辑器保存）；
    search_references / get_entity 详情全文照常（file 类经 content 镜像纯 DB 读取）
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
advance_hook(hook_id, node_id, description)  → id   // 复合写（2026-08 修订，🟠-7）：
                                                     // delta_records 记 status 变化 + relation_records 插 advances
                                                     // 一次提交，幂等（按 (node_id, hook_id, relation_type)
                                                     // 判重：重复确认或重复提案均不重复推进）
                                                     // node_id **仅章**（2026-09）：伏笔锚点限 chapter
resolve_hook(hook_id, node_id, description)  → id   // 复合写：delta 记 status=resolved + relation 插 resolves
abandon_hook(hook_id, description)          → id   // 复合写：delta 记 status=abandoned（2026-08 修订）
```

> **复合写说明（2026-08 修订）**：`advance_hook` / `resolve_hook` 对应伏笔生命周期的推进/回收动作，确认后由 Tool Executor 调用，封装「delta + relation」两步写为一次提交，失败不产生半状态。

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

## 工具执行契约（由 pi 强制）

- **抛错即失败**：工具执行抛错 = 失败，pi 统一转换为结构化错误 tool result（`isError: true` + 错误信息）喂回 LLM 自纠；工具自身**不得把失败编码进正常 content**。
- **批量先校验后执行**：一条 assistant 消息含多个 tool_call 时，pi **先全部参数校验（fail fast）再执行**，结果按源顺序回填。
- **截断不执行**：`stopReason === "length"` 时该消息内全部 tool call 一律不执行，以错误喂回并要求重发（pi 原生）。
- **截断必须显式告知**：工具结果超 token 上限截断时，返回内容注明「已截断 + 提示缩小范围」——静默截断会让 LLM 基于残缺数据继续推理（如 `get_outline` 整树、`query_relationships` depth=3）。

## 循环终止与失败处理

见 [`../design/30-agent-loop.md`](../design/30-agent-loop.md) §1（无轮次上限；重试/压缩/取消均由 pi 承担）。工具侧只需保证：失败抛错、超限截断并告知、提案走 `details`。