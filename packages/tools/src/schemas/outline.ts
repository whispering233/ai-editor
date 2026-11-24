// 工具参数 schema：大纲域（get_outline / get_outline_path / search_outline）+ 大纲层级共用枚举

import { Type, type Static } from "@earendil-works/pi-ai";
import { OUTLINE_STATUS } from "@whispering233/ai-editor-shared";
import { stringEnum } from "./helpers.js";

/** 大纲节点层级（严格三层：卷 → 章 → 场景） */
export const outlineNodeTypeSchema = stringEnum(["volume", "chapter", "scene"] as const);

/**
 * get_outline 入参：depth 从树根算层数（缺省 1 = 只回卷；2 = 卷+章；3 = 卷+章+场景），
 * volume_id 只做过滤（只留该卷，depth 语义不变）——大纲不再整树返回（千章书远超单条结果上限）。
 */
export const getOutlineArgsSchema = Type.Object(
  {
    depth: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)])),
    volume_id: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type GetOutlineArgs = Static<typeof getOutlineArgsSchema>;


/** get_outline_path 入参：node_id（根 → 该节点的路径 ID 列表，含 root） */
export const getOutlinePathArgsSchema = Type.Object(
  {
    node_id: Type.String(),
  },
  { additionalProperties: false },
);

export type GetOutlinePathArgs = Static<typeof getOutlinePathArgsSchema>;

/**
 * search_outline 入参：query（标题 / 计划摘要 / 实际摘要模糊匹配）+ status（章写作状态）
 * + tags（data.tags 全含）+ volume_id（限定卷）+ offset（分页）。
 * schema 表达不了「至少一个条件」——`runSearchOutline` 里拒绝全空（不给「列全书」入口）。
 */
export const searchOutlineArgsSchema = Type.Object(
  {
    query: Type.Optional(Type.String()),
    status: Type.Optional(stringEnum(OUTLINE_STATUS)),
    tags: Type.Optional(Type.Array(Type.String())),
    volume_id: Type.Optional(Type.String()),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export type SearchOutlineArgs = Static<typeof searchOutlineArgsSchema>;
