// AI 工具参数 Zod schema（@ai-editor/shared/types/tool.ts，S6.3）
// 契约来源：doc/api/tools.md「查询类（自动）」——8 个查询工具的入参/返回语义；
//   字段名沿用 tools.md 的 snake_case 参数约定（工具参数由 LLM 直接生成，snake_case 与
//   REST 请求体一致）；取值范围引用 constants/entity.ts 既有枚举（EntityType/RelationType），
//   不另造类型。
// **导出边界**：运行时 schema 仅经 @ai-editor/shared/schemas/tools 子路径导出（供服务端
//   tools 包/executor 使用）；types/index.ts 的 type-only barrel 只导出推断类型——
//   client 浏览器包不打包 zod 校验函数（与 types/api.ts 同款约束，见 index.ts 头注释）。

import { z } from "zod";
import { ENTITY_TYPES, RELATION_TYPES } from "../constants/entity.js";

// ============ get_entity（实体详情，tools.md「实体查询」） ============

/** get_entity 入参：type（实体类型）+ id；id 前缀体系全局唯一，type 用于回显与一致性校验 */
export const getEntityArgsSchema = z
  .object({
    type: z.enum(ENTITY_TYPES),
    id: z.string(),
  })
  .strict();

export type GetEntityArgs = z.infer<typeof getEntityArgsSchema>;

// ============ search_entities（实体搜索，tools.md「实体查询」） ============

/**
 * search_entities 入参：type + query（name 模糊匹配）+ filters（data 字段过滤）
 * filters.status：data.status 字符串相等匹配；filters.tags：data.tags 数组须包含全部指定 tags（AND）
 */
export const searchEntitiesArgsSchema = z
  .object({
    type: z.enum(ENTITY_TYPES),
    query: z.string(),
    filters: z
      .object({
        tags: z.array(z.string()).optional(),
        status: z.string().optional(),
      })
      .optional(),
  })
  .strict();

export type SearchEntitiesArgs = z.infer<typeof searchEntitiesArgsSchema>;

// ============ query_relationships（关系图子图，tools.md「关系查询」） ============

/**
 * query_relationships 入参：source_type/target_type 为自由字符串（实体类型或 outline_node）；
 * relation_type 用 z.enum(RELATION_TYPES) **白名单校验**（schema.md 预定义 16 种，
 * 与 REST relationQuerySchema 的宽松 string 不同——工具参数由 LLM 生成，枚举提前拦非法值）；
 * depth 1=紧邻 / 2=k跳 / 3=全量（必填，与 API 层一致）
 */
export const queryRelationshipsArgsSchema = z
  .object({
    source_type: z.string().optional(),
    source_id: z.string().optional(),
    target_type: z.string().optional(),
    target_id: z.string().optional(),
    relation_type: z.enum(RELATION_TYPES).optional(),
    depth: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict();

export type QueryRelationshipsArgs = z.infer<typeof queryRelationshipsArgsSchema>;

// ============ get_outline（完整大纲树，tools.md「大纲查询」） ============

/** get_outline 入参：无参；默认不含 metadata 统计（省 token，需统计走 API with_metadata） */
export const getOutlineArgsSchema = z.object({}).strict();

export type GetOutlineArgs = z.infer<typeof getOutlineArgsSchema>;

// ============ get_outline_path（节点路径，tools.md「大纲查询」） ============

/** get_outline_path 入参：node_id（根 → 该节点的路径 ID 列表，含 root） */
export const getOutlinePathArgsSchema = z
  .object({
    node_id: z.string(),
  })
  .strict();

export type GetOutlinePathArgs = z.infer<typeof getOutlinePathArgsSchema>;

// ============ compute_state（状态计算，tools.md「状态查询」） ============

/**
 * compute_state 入参（与 POST /api/v1/delta/compute 同构，api.ts deltaComputeReqSchema）：
 * 目标实体到达 at_node_id 时的累积状态（只沿大纲树父链累积已确认 Delta，决策 9）
 */
export const computeStateArgsSchema = z
  .object({
    target_type: z.string(),
    target_id: z.string(),
    at_node_id: z.string(),
  })
  .strict();

export type ComputeStateArgs = z.infer<typeof computeStateArgsSchema>;

// ============ get_delta_history（Delta 历史，tools.md「状态查询」） ============

/** get_delta_history 入参：target_type + target_id（该实体的全部属性变更记录，按时间/节点排序） */
export const getDeltaHistoryArgsSchema = z
  .object({
    target_type: z.string(),
    target_id: z.string(),
  })
  .strict();

export type GetDeltaHistoryArgs = z.infer<typeof getDeltaHistoryArgsSchema>;

// ============ get_entity_summary（聚合统计，tools.md「聚合分析」） ============

/** get_entity_summary 入参：type（指定类型实体的统计数据：总数 + 类型专属分布） */
export const getEntitySummaryArgsSchema = z
  .object({
    type: z.enum(ENTITY_TYPES),
  })
  .strict();

export type GetEntitySummaryArgs = z.infer<typeof getEntitySummaryArgsSchema>;
