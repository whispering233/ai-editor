// 关系类型（relation_type）自定义值语法校验的**单一来源**（卡片 8.2）
//
// 口径（docs/api/40-api-relation.md「关系类型自由化」，2026-09）：relation_type 为自由字符串
// = 预定义 17 类 ∪ 自定义类型；语法 = `trim` 后非空、长度 ≤ 32、禁控制字符（U+0000–U+001F / U+007F）。
// 消费方三处共用本文件，禁止各自手抄：REST schema（shared/types/api.ts）、
// db `createRelation` 守卫（packages/db）、client 提交前预校验（packages/client）。
// **不 import zod**：纯函数，客户端可安全经 shared 根入口打包。
// 端点适用性（`endpoints`）谓词也在此（声明源 = constants/entity.ts 的 `RELATION_TYPE_META`）。

import {
  RELATION_TYPES,
  RELATION_TYPE_META,
  type EntityTypeValue,
  type RelationType,
} from "../constants/entity.js";
import type { OutlineNodeType } from "../types/outline.js";

/** 关系端点：实体侧 = 已有实体类型；`outline_node` 侧可带 `nodeType`（章/卷/场景）收窄；`"*"` = 任一端点类型 */
export type RelationEndpointRef = {
  type: EntityTypeValue | "outline_node" | "*";
  nodeType?: OutlineNodeType;
};

/** 端点对匹配：声明侧 `"*"` 通配任意类型；`nodeType` 只在两侧都给出时比较（未给 = 通配） */
function endpointMatches(declared: RelationEndpointRef, actual: RelationEndpointRef): boolean {
  if (declared.type === "*") return true;
  return (
    declared.type === actual.type &&
    (declared.nodeType === undefined || actual.nodeType === undefined || declared.nodeType === actual.nodeType)
  );
}

/**
 * 关系类型是否适用于该端点对（单一实现；消费方 = 对话框/关联页筛选、AI 工具白名单）。
 * 未知 / 自定义类型（不在 `RELATION_TYPE_META`）与无 `endpoints` 声明的类型恒通过。
 */
export function relationTypeAllowedFor(type: string, from: RelationEndpointRef, to: RelationEndpointRef): boolean {
  if (!Object.hasOwn(RELATION_TYPE_META, type)) return true;
  const endpoints = RELATION_TYPE_META[type as RelationType].endpoints;
  if (endpoints === undefined) return true;
  return endpoints.some((pair) => endpointMatches(pair.from, from) && endpointMatches(pair.to, to));
}

/** 该端点对下全部可用关系类型（UI 一次取全，不手抄子集） */
export function allowedRelationTypes(from: RelationEndpointRef, to: RelationEndpointRef): RelationType[] {
  return RELATION_TYPES.filter((type) => relationTypeAllowedFor(type, from, to));
}

/** 关系类型长度上限（`trim` 后计） */
export const RELATION_TYPE_MAX_LENGTH = 32;

/** 控制字符（U+0000–U+001F 与 U+007F）：落库即脏数据，禁 */
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/** 归一：去首尾空白（REST schema 落库前应用，避免「宿敌」与「宿敌 」并存为两个类型） */
export function normalizeRelationType(value: string): string {
  return value.trim();
}

/**
 * 语法校验：合法 → null；非法 → 中文错误消息（直接可回显给作者）。
 * 顺序：trim 后为空 → 控制字符 → 长度（按 trim 后计）。
 */
export function relationTypeSyntaxError(value: unknown): string | null {
  if (typeof value !== "string") return "关系类型必须是字符串";
  const trimmed = value.trim();
  if (trimmed === "") return "关系类型不能为空";
  if (CONTROL_CHAR_RE.test(value)) return "关系类型不能包含控制字符";
  if (trimmed.length > RELATION_TYPE_MAX_LENGTH) {
    return `关系类型不能超过 ${RELATION_TYPE_MAX_LENGTH} 个字符`;
  }
  return null;
}
