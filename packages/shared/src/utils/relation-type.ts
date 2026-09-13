// 关系类型（relation_type）自定义值语法校验的**单一来源**（卡片 8.2）
//
// 口径（docs/api/40-api-relation.md「关系类型自由化」，2026-09）：relation_type 为自由字符串
// = 预定义 17 类 ∪ 自定义类型；语法 = `trim` 后非空、长度 ≤ 32、禁控制字符（U+0000–U+001F / U+007F）。
// 消费方三处共用本文件，禁止各自手抄：REST schema（shared/types/api.ts）、
// db `createRelation` 守卫（packages/db）、client 提交前预校验（packages/client）。
// **不 import zod**：纯函数，客户端可安全经 shared 根入口打包。

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
