// ID 生成工具
// 契约来源：doc/api/endpoints.md「id 约定」：{前缀}-{nanoid}；前缀表 char-/set-/loc-/hook-/ev-、
//   sc-/ch-/vol-、proj-（连字符分隔）；prop_/sess_/call_（下划线分隔的运行时对象）
// nanoid 为环境无关包（浏览器可用），仅在本模块引入，无副作用

import { nanoid } from "nanoid";
import type { EntityType } from "../types/entity.js";
import type { OutlineNodeType } from "../types/outline.js";

/** 实体类型 → id 前缀（endpoints.md id 约定；event 时间轴事件 ev-，决策 26；timepoint 时间标签点 tp-，G2） */
export const ENTITY_ID_PREFIX: Record<EntityType, string> = {
  character: "char-",
  setting: "set-",
  location: "loc-",
  hook: "hook-",
  event: "ev-",
  timepoint: "tp-",
  reference: "ref-", // 参考资料（决策 36）
};

/** 大纲节点类型 → id 前缀（endpoints.md id 约定；root 不生成 id） */
export const OUTLINE_NODE_ID_PREFIX: Record<Exclude<OutlineNodeType, "root">, string> = {
  volume: "vol-",
  chapter: "ch-",
  scene: "sc-",
};

/** 运行时对象 id 前缀（endpoints.md：提案 prop_/会话 sess_/工具调用 call_，下划线分隔） */
export const RUNTIME_ID_PREFIX = {
  proposal: "prop_",
  session: "sess_",
  toolCall: "call_",
} as const;

/** 运行时对象种类（prop_/sess_/call_） */
export type RuntimeIdKind = keyof typeof RUNTIME_ID_PREFIX;

/**
 * 生成 `{prefix}{nanoid}` 形式 id（nanoid 默认 21 字符，URL 安全字母表）
 * 示例：generateId("char-") → "char-9f3k2m..."
 */
export function generateId(prefix: string): string {
  return `${prefix}${nanoid()}`;
}

/** 生成实体 id（按类型映射前缀：character→char-、setting→set-、location→loc-、hook→hook-、event→ev-） */
export function generateEntityId(type: EntityType): string {
  return generateId(ENTITY_ID_PREFIX[type]);
}

/** 生成大纲节点 id（按类型映射前缀：volume→vol-、chapter→ch-、scene→sc-） */
export function generateOutlineNodeId(type: Exclude<OutlineNodeType, "root">): string {
  return generateId(OUTLINE_NODE_ID_PREFIX[type]);
}

/** 生成项目 id（proj- 前缀，跨启动稳定，决策 8/10） */
export function generateProjectId(): string {
  return generateId("proj-");
}

/** 生成运行时对象 id（提案 prop_ / 会话 sess_ / 工具调用 call_，不落盘或仅内存） */
export function generateRuntimeId(kind: RuntimeIdKind): string {
  return generateId(RUNTIME_ID_PREFIX[kind]);
}
