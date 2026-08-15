// 执行层公共类型与参数提取辅助（S6.7）
//
// 执行函数统一签名 (ctx, proposal)：proposal.args 是 S6.6 已规范化的执行形态（add_relation
// 已派生 source_type/target_type、hook 变更 args.description 承载描述），可直接消费；
// proposal.summary 供 add_delta 取人类可读描述（S6.6 delta.ts 注释：description 由执行器取
// summary）。参数提取做运行时防御（防脏调用），提取失败抛错即失败（S7.5 转错误响应）。
// **执行类不注册 registry**（registry 是 LLM 可见工具表；执行函数仅由 executor 门面调用）。

import type { ToolContext } from "../context.js";
import type { Proposal } from "../proposal/types.js";

/**
 * 执行结果（统一携带 id：新对象 id 或操作对象 id；扩展字段 camelCase）。
 * duplicated=true：幂等命中——(node_id, hook_id, relation_type) 已有记录，未重复写（tools.md 复合写说明）。
 * id 可选（F9）：reorder_events 是批量操作无单对象 id，返回 { reordered: n } 即可；
 * 其余执行器均携带 id（S7.5 响应 result 透传，契约未要求 id 必在）。
 */
export type ExecutorResult = { id?: string; duplicated?: boolean } & Record<string, unknown>;

/** 执行函数统一签名：直接消费 Proposal（args 规范化形态 + summary），返回可序列化结果或抛错 */
export type ExecutorFn = (ctx: ToolContext, proposal: Proposal) => ExecutorResult;

/** 必填字符串参数（缺失/空串/非字符串 → 抛错，防脏调用写脏数据） */
export function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v === "") {
    throw new Error(`执行参数缺失或非法: ${key}`);
  }
  return v;
}

/** 可选字符串参数（缺失返回 undefined；存在但非字符串 → 抛错） */
export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  return requireString(args, key);
}

/** 必填对象参数（patches/metadata 等） */
export function requireRecord(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = args[key];
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error(`执行参数缺失或非法: ${key}`);
  }
  return v as Record<string, unknown>;
}

/** 可选对象参数（缺失返回 undefined） */
export function optionalRecord(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  return requireRecord(args, key);
}

/** 必填数组参数（changes 等） */
export function requireArray(args: Record<string, unknown>, key: string): unknown[] {
  const v = args[key];
  if (!Array.isArray(v)) {
    throw new Error(`执行参数缺失或非法: ${key}`);
  }
  return v;
}

/** 必填数字参数（order 等；NaN 拒绝） */
export function requireNumber(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== "number" || Number.isNaN(v)) {
    throw new Error(`执行参数缺失或非法: ${key}`);
  }
  return v;
}
