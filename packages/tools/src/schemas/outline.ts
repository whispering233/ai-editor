// 工具参数 schema：大纲域（get_outline / get_outline_path）+ 大纲层级共用枚举

import { Type, type Static } from "@earendil-works/pi-ai";
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
