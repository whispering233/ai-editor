// 工具参数 schema：提案域（propose_* 16 个）
//
// 语义（docs/api/tool-calling.md「提案类（需确认）」）：AI 不能直接修改数据——propose_*
// 只产出提案对象；参数签名与工具目录逐字对齐（端点 id 的类型识别与 updated_at 快照
// 由服务端生成时完成，故入参只需 id 字符串）。
// patches（部分更新字段）以 `minProperties: 1` 表达「拒绝空对象」（等价原 zod `.refine`）。

import { Type, type Static } from "@earendil-works/pi-ai";
import { entityTypeSchema } from "./entity.js";
import { relationTypeSchema } from "./relation.js";
import { outlineNodeTypeSchema } from "./outline.js";
import { deltaChangeSchema } from "./delta.js";
import { freeFormObject } from "./helpers.js";

/** 任意结构化的 data / metadata 载荷（record 形状与旧 zod `toJSONSchema()` 一致） */
const dataRecordSchema = freeFormObject();

// ============ 实体（proposal/entity.ts） ============

/** propose_create_entity 入参：type + name（必填）+ data（可选自定义字段） */
export const proposeCreateEntityArgsSchema = Type.Object(
  {
    type: entityTypeSchema,
    name: Type.String({ minLength: 1 }),
    data: Type.Optional(dataRecordSchema),
  },
  { additionalProperties: false },
);

export type ProposeCreateEntityArgs = Static<typeof proposeCreateEntityArgsSchema>;

/** propose_update_entity 入参：entity_id + patches（data 部分字段，至少一项） */
export const proposeUpdateEntityArgsSchema = Type.Object(
  {
    entity_id: Type.String(),
    patches: freeFormObject({ minProperties: 1 }),
  },
  { additionalProperties: false },
);

export type ProposeUpdateEntityArgs = Static<typeof proposeUpdateEntityArgsSchema>;

/** propose_delete_entity 入参：entity_id（软删 + 级联，可回收站还原） */
export const proposeDeleteEntityArgsSchema = Type.Object(
  {
    entity_id: Type.String(),
  },
  { additionalProperties: false },
);

export type ProposeDeleteEntityArgs = Static<typeof proposeDeleteEntityArgsSchema>;

// ============ 关系（proposal/relation.ts） ============

/**
 * propose_add_relation 入参：source/target 为端点 id（实体 id 或大纲节点 id，类型生成时自动识别）；
 * type 白名单（预定义全集 = `RELATION_TYPES`，含 plot_edge/plants/advances/resolves…；
 * **作者在界面自定义的类型 AI 不可创建**）；metadata 可选
 */
export const proposeAddRelationArgsSchema = Type.Object(
  {
    source: Type.String(),
    target: Type.String(),
    type: relationTypeSchema,
    metadata: Type.Optional(dataRecordSchema),
  },
  { additionalProperties: false },
);

export type ProposeAddRelationArgs = Static<typeof proposeAddRelationArgsSchema>;

/** propose_remove_relation 入参：relation_id（手动删关系 = 物理删，不进回收站） */
export const proposeRemoveRelationArgsSchema = Type.Object(
  {
    relation_id: Type.String(),
  },
  { additionalProperties: false },
);

export type ProposeRemoveRelationArgs = Static<typeof proposeRemoveRelationArgsSchema>;

// ============ Delta（proposal/delta.ts） ============

/** propose_add_delta 入参：node_id（触发节点，**仅章**）+ target（变更目标）+ changes（至少一项） */
export const proposeAddDeltaArgsSchema = Type.Object(
  {
    node_id: Type.String(),
    target: Type.String(),
    changes: Type.Array(deltaChangeSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export type ProposeAddDeltaArgs = Static<typeof proposeAddDeltaArgsSchema>;

// ============ 大纲（proposal/outline.ts） ============

/** propose_outline_node 入参：type（volume|chapter|scene）+ title + parent_id（缺省挂根；scene 必须挂 chapter） */
export const proposeOutlineNodeArgsSchema = Type.Object(
  {
    type: outlineNodeTypeSchema,
    title: Type.String({ minLength: 1 }),
    parent_id: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type ProposeOutlineNodeArgs = Static<typeof proposeOutlineNodeArgsSchema>;

/**
 * propose_move_node 入参：node_id + parent_id（目标父节点，**可为 "root"**）+ order（目标位置，0 起）。
 * order 无上限：超出目标父 children 长度的行为由执行层定义（提案只承载意图）。
 */
export const proposeMoveNodeArgsSchema = Type.Object(
  {
    node_id: Type.String(),
    parent_id: Type.String(),
    order: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type ProposeMoveNodeArgs = Static<typeof proposeMoveNodeArgsSchema>;

/** propose_delete_node 入参：node_id（软删 + 递归子树，可回收站还原） */
export const proposeDeleteNodeArgsSchema = Type.Object(
  {
    node_id: Type.String(),
  },
  { additionalProperties: false },
);

export type ProposeDeleteNodeArgs = Static<typeof proposeDeleteNodeArgsSchema>;

// ============ 伏笔（proposal/hook.ts） ============

/** propose_create_hook 入参：name + data（可选伏笔字段）+ plant_at_node_id（可选埋设节点） */
export const proposeCreateHookArgsSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    data: Type.Optional(dataRecordSchema),
    plant_at_node_id: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type ProposeCreateHookArgs = Static<typeof proposeCreateHookArgsSchema>;

/** propose_update_hook 入参：hook_id + patches（data 部分字段，至少一项） */
export const proposeUpdateHookArgsSchema = Type.Object(
  {
    hook_id: Type.String(),
    patches: freeFormObject({ minProperties: 1 }),
  },
  { additionalProperties: false },
);

export type ProposeUpdateHookArgs = Static<typeof proposeUpdateHookArgsSchema>;

/** propose_advance_hook 入参：hook_id + node_id + description（确认后复合写 delta+relations） */
export const proposeAdvanceHookArgsSchema = Type.Object(
  {
    hook_id: Type.String(),
    node_id: Type.String(),
    description: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ProposeAdvanceHookArgs = Static<typeof proposeAdvanceHookArgsSchema>;

/** propose_resolve_hook 入参：hook_id + node_id + description（确认后复合写 delta+relations） */
export const proposeResolveHookArgsSchema = Type.Object(
  {
    hook_id: Type.String(),
    node_id: Type.String(),
    description: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ProposeResolveHookArgs = Static<typeof proposeResolveHookArgsSchema>;

/** propose_abandon_hook 入参：hook_id + description（确认后复合写 delta 记 status=abandoned） */
export const proposeAbandonHookArgsSchema = Type.Object(
  {
    hook_id: Type.String(),
    description: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ProposeAbandonHookArgs = Static<typeof proposeAbandonHookArgsSchema>;

// ============ 时间轴（proposal/reorder-timepoints.ts，G2） ============

/**
 * propose_reorder_timepoints 入参：timepoint_ids——LLM 按时间点 name 语义识别先后后产出的
 * **有序时间点 id 全量序列**（须覆盖当前全部未软删时间点，缺/多/重复由生成时校验拒绝）；
 * maxItems 与列表 limit 的 db clamp 上限对齐（数值单源在 db，本 schema 不复述）。
 */
export const proposeReorderTimepointsArgsSchema = Type.Object(
  {
    timepoint_ids: Type.Array(Type.String(), { minItems: 1, maxItems: 200 }),
  },
  { additionalProperties: false },
);

export type ProposeReorderTimepointsArgs = Static<typeof proposeReorderTimepointsArgsSchema>;

// ============ 参考资料（proposal/reference.ts） ============

/**
 * propose_create_reference 入参：name 标题（必填）+ type 分类（自由文本，缺省 material
 * 写入侧兜底）+ content 全文长文本 + source 来源（可选）+ tags 标签数组（可选）。
 */
export const proposeCreateReferenceArgsSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    type: Type.Optional(Type.String()),
    content: Type.Optional(Type.String()),
    source: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export type ProposeCreateReferenceArgs = Static<typeof proposeCreateReferenceArgsSchema>;
