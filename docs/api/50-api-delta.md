# Delta 变更追踪

> 变更记录与 computeState 累积计算。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；接口索引见 [00-api-index.md](./00-api-index.md)。

### POST /api/v1/delta

追加属性变更记录。

```typescript
// Req
{
  node_id: string;                // 触发变更的大纲节点 ID
  target_type: string;            // 变更目标类型——**仅实体类型**（白名单由 ENTITY_TYPES 派生：
                                  //   character/setting/location/hook/event，event 自动扩入）
                                  //   （2026-08 收紧：大纲节点不可作为变更目标——节点代表的故事导致实体
                                  //   发生变更，节点结构化信息不出现在变更记录中；历史 outline_node 目标
                                  //   数据保留展示，仅创建路径拒绝；校验在路由层，shared schema 不动）
  target_id: string;              // 变更目标 ID
  changes: {
    field: string;                // 字段名
    op: "set" | "update" | "add" | "remove";
    from?: string | number | null;  // 旧值（op=update 时必填）
    to?: string | number | null;    // 新值（op=set/update 时必填；add/remove 用 value）
    value?: string | number;         // 值（op=add/remove 时使用）
  }[];
  description: string;            // 人类可读描述
  // 注意：无 order 入参——order 由服务端生成，全局单调递增（与 db schema 一致）
  // op 语义（2026-08 修订）：set=直接替换；update=旧值→新值（写入端不校验 from，
  //   冲突在 computeState 时以跳过+conflicts 呈现）；add=按 value 向数组追加；
  //   remove=按值匹配从数组移除（不存在的值静默忽略）
}

// Res: 201
{
  id: string;
  applied: DeltaRecord;           // 完整的 Delta 记录
}

// Res: 400
// { error: { code: "VALIDATION_ERROR" } }
// 触发条件：schema 校验失败（含 fields）；per-op 必填缺失（set→to、update→from+to、add/remove→value）；
//   target_type 非实体类型（2026-08 收紧：仅实体类型，白名单由 ENTITY_TYPES 派生——含 event；路由层白名单校验）

// 示例
// Req: { node_id: "sc-37", target_type: "character", target_id: "char-3",
//        changes: [{ field: "combat_power", op: "update", from: "100", to: "150" }],
//        description: "张三获得断剑认可" }
```

### GET /api/v1/delta/node/:nodeId

获取指定大纲节点触发的所有 Delta。

```typescript
// Path
nodeId: string;

// Res: 200
{
  nodeId: string;
  deltas: DeltaRecord[];
}

// DeltaRecord
{
  id: string;
  nodeId: string;
  targetType: string;
  targetId: string;
  targetName?: string;        // 联表填充
  changes: { field: string; op: string; from?: unknown; to?: unknown }[];
  description: string;
  order: number;
  createdAt: string;
}
```

### POST /api/v1/delta/compute

计算实体到达指定大纲节点时的累积状态。

```typescript
// Req
{
  target_type: string;          // 目标实体类型
  target_id: string;            // 目标实体 ID
  at_node_id: string;           // 到达的大纲节点 ID（服务端自动计算根 → at_node 的树路径）
}

// Res: 200
{
  targetType: string;
  targetId: string;
  atNodeId: string;
  state: Record<string, unknown>;   // 初始 data + 路径上所有 Delta 累积后的结果
  appliedDeltas: {                   // 参与计算的 Delta 列表
    nodeId: string;
    description: string;
    changes: unknown[];
    skipped?: { index: number; field: string; expected: unknown; actual: unknown }[];
    // skipped：该 delta 中被跳过的 change（op=update 且当前值 ≠ from）
  }[];
  conflicts: {                       // 汇总的冲突字段（2026-08 修订，替代原 409 DELTA_CONFLICT）
    deltaId: string;
    field: string;
    expected: unknown;               // delta 中 from
    actual: unknown;                 // 应用时实际值
  }[];
}

// Res: 404
{ error: { code: "OUTLINE_NODE_NOT_FOUND" } }  // at_node_id 不存在（已 purge）

// Delta 累积规则：
//   到达目标节点的状态 = 实体初始 data + 树路径上所有 Delta 累积
//   双层排序：节点间按树路径顺序（根 → at_node）；同一节点内按 order 递增
//   set:     直接替换值
//   update:  旧值→新值（校验当前值等于 from；不匹配**跳过该 change 并继续累积**，
//            在 skipped / conflicts 中标注——手动编辑 data 不产生 Delta 属正常用户
//            行为，不再返回 409，2026-08 修订）
//   add:     向数组追加
//   remove:  按值匹配从数组移除
//   Delta 可见性：触发节点或目标实体任一软删即不参与计算
```

---
