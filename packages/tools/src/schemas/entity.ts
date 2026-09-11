// 工具参数 schema：实体域（get_entity / search_entities / get_entity_summary）
// 写法契约见 docs/api/tool-calling.md「工具定义（TypeBox）」：schema 运行时即 JSON Schema，
// 一份定义同时给模型（tool parameters）、TS（Static<>）、pi 校验（validateToolArguments）。
// 严格性：顶层对象 `additionalProperties: false` 等价原 zod `.strict()`（拒绝未知字段）。

import { Type, type Static } from "@earendil-works/pi-ai";
import { ENTITY_TYPES } from "@whispering233/ai-editor-shared";
import { stringEnum } from "./helpers.js";

/** 实体类型白名单（跨 schema 复用；非法值在校验期拦下） */
export const entityTypeSchema = stringEnum(ENTITY_TYPES);

/** get_entity 入参：type + id（id 前缀体系全局唯一，type 用于回显与一致性校验） */
export const getEntityArgsSchema = Type.Object(
  {
    type: entityTypeSchema,
    id: Type.String(),
  },
  { additionalProperties: false },
);

export type GetEntityArgs = Static<typeof getEntityArgsSchema>;

/**
 * search_entities 入参：type + query（name 模糊匹配）+ filters（data 字段过滤）
 * filters.status：data.status 字符串相等匹配；filters.tags：data.tags 数组须包含全部指定 tags（AND）
 */
export const searchEntitiesArgsSchema = Type.Object(
  {
    type: entityTypeSchema,
    query: Type.String(),
    filters: Type.Optional(
      Type.Object(
        {
          tags: Type.Optional(Type.Array(Type.String())),
          status: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export type SearchEntitiesArgs = Static<typeof searchEntitiesArgsSchema>;

/** get_entity_summary 入参：type（指定类型实体的统计数据：总数 + 类型专属分布） */
export const getEntitySummaryArgsSchema = Type.Object(
  {
    type: entityTypeSchema,
  },
  { additionalProperties: false },
);

export type GetEntitySummaryArgs = Static<typeof getEntitySummaryArgsSchema>;
