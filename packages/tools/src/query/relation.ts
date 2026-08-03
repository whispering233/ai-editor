// 查询类工具：关系侧实现（S6.3）
// query_relationships（tools.md「关系查询」→ 关系图子图）
// 契约来源：doc/api/tools.md；doc/api/endpoints.md 关系端点；决策 12 修订
//   （关系可见性联动端点状态：任一端点软删即不可见）、决策 10（plot_edge 同规则）。
//
// db 层能力确认：listRelations（db relation.ts）已实现全部所需语义——
// 1. 关系自身软删过滤（SQL 层）
// 2. **端点软删可见性校验**（buildEndpointContext：实体端点查 entities 软删集合、
//    大纲端点读 outline.json 收集软删节点——决策 12 修订）
// 3. name 联表填充（实体 entities.name、大纲节点 outline.json title）
// 4. depth>=2 的 k 跳 BFS 路径（防环、多起点）
// 工具层仅做参数映射透传，无额外过滤逻辑。

import { listRelations } from "@ai-editor/db";
import type { RelationQueryResult } from "@ai-editor/shared";
import type { ToolContext } from "../context.js";
import type { QueryRelationshipsArgs } from "@ai-editor/shared";

/**
 * 关系图子图（tools.md query_relationships → [{source,target,type,metadata}] 简写；
 * 实际透传 db 的 RelationQueryResult 完整形态：relations: RelationRecord[]（含
 * sourceName/targetName 联表名）+ depth>=2 时 paths: RelationPath[]）。
 * 参数映射：snake_case 工具参数 → db 层 camelCase RelationQuery（字段一一对应）；
 * depth 1=紧邻 / 2=k跳 / 3=全量。
 */
export function runQueryRelationships(ctx: ToolContext, args: QueryRelationshipsArgs): RelationQueryResult {
  return listRelations(
    ctx.db,
    {
      sourceType: args.source_type,
      sourceId: args.source_id,
      targetType: args.target_type,
      targetId: args.target_id,
      relationType: args.relation_type,
    },
    args.depth,
    ctx.outlineDir,
  );
}
