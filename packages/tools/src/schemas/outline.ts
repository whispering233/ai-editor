// 工具参数 schema：大纲域（get_outline / get_outline_path）+ 大纲层级共用枚举

import { Type, type Static } from "@earendil-works/pi-ai";
import { stringEnum } from "./helpers.js";

/** 大纲节点层级（严格三层：卷 → 章 → 场景） */
export const outlineNodeTypeSchema = stringEnum(["volume", "chapter", "scene"] as const);

/** get_outline 入参：无参；默认不含 metadata 统计（省 token，需统计走 API with_metadata） */
export const getOutlineArgsSchema = Type.Object({}, { additionalProperties: false });

export type GetOutlineArgs = Static<typeof getOutlineArgsSchema>;

/** get_outline_path 入参：node_id（根 → 该节点的路径 ID 列表，含 root） */
export const getOutlinePathArgsSchema = Type.Object(
  {
    node_id: Type.String(),
  },
  { additionalProperties: false },
);

export type GetOutlinePathArgs = Static<typeof getOutlinePathArgsSchema>;
