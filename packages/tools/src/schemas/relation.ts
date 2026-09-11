// 工具参数 schema：关系域（query_relationships）

import { Type, type Static } from "@earendil-works/pi-ai";
import { RELATION_TYPES } from "@whispering233/ai-editor-shared";
import { stringEnum } from "./helpers.js";

/** 关系类型白名单（预定义 16 种；工具参数由 LLM 生成，枚举提前拦非法值——与 REST 层的宽松 string 不同） */
export const relationTypeSchema = stringEnum(RELATION_TYPES);

/**
 * query_relationships 入参：source_type/target_type 为自由字符串（实体类型或 outline_node）；
 * relation_type 白名单；depth 1=紧邻 / 2=k跳 / 3=全量（必填，与 API 层一致）
 */
export const queryRelationshipsArgsSchema = Type.Object(
  {
    source_type: Type.Optional(Type.String()),
    source_id: Type.Optional(Type.String()),
    target_type: Type.Optional(Type.String()),
    target_id: Type.Optional(Type.String()),
    relation_type: Type.Optional(relationTypeSchema),
    depth: Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)]),
  },
  { additionalProperties: false },
);

export type QueryRelationshipsArgs = Static<typeof queryRelationshipsArgsSchema>;
