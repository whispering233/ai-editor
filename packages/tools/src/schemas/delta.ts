// 工具参数 schema：Delta 域（compute_state / get_delta_history + 单条变更共用 schema）
//
// deltaChangeSchema 与 shared `types/api.ts` 的 zod `deltaChangeSchema`（REST 入参校验）
// 同构：字段/可选性/联合类型逐项对齐；此处用 TypeBox 是为工具参数校验与模型 schema 同源。
// 嵌套对象 `additionalProperties: false` 与旧 zod `toJSONSchema()` 输出一致（模型-facing schema 不变）。

import { Type, type Static } from "@earendil-works/pi-ai";
import { stringEnum } from "./helpers.js";

/** 变更操作类型（set/update/add/remove） */
export const deltaOpSchema = stringEnum(["set", "update", "add", "remove"] as const);

/** 单条属性变更（复用：propose_add_delta 的 changes 项） */
export const deltaChangeSchema = Type.Object(
  {
    field: Type.String(),
    op: deltaOpSchema,
    /** 旧值（op=update 时服务端要求必填） */
    from: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()])),
    /** 新值（op=set/update 时服务端要求必填；add/remove 用 value） */
    to: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()])),
    /** 值（op=add/remove 时使用） */
    value: Type.Optional(Type.Union([Type.String(), Type.Number()])),
  },
  { additionalProperties: false },
);

export type DeltaChangeArg = Static<typeof deltaChangeSchema>;

/**
 * compute_state 入参（与 POST /api/v1/delta/compute 同构，api.ts deltaComputeReqSchema）：
 * 目标实体到达 at_node_id 时的累积状态（只沿大纲树父链累积已确认 Delta）
 */
export const computeStateArgsSchema = Type.Object(
  {
    target_type: Type.String(),
    target_id: Type.String(),
    at_node_id: Type.String(),
  },
  { additionalProperties: false },
);

export type ComputeStateArgs = Static<typeof computeStateArgsSchema>;

/** get_delta_history 入参：target_type + target_id（该实体的全部属性变更记录，按时间/节点排序） */
export const getDeltaHistoryArgsSchema = Type.Object(
  {
    target_type: Type.String(),
    target_id: Type.String(),
  },
  { additionalProperties: false },
);

export type GetDeltaHistoryArgs = Static<typeof getDeltaHistoryArgsSchema>;
