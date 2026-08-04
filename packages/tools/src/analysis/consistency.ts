// 分析类工具：analyze_consistency（实体档案一致性检查，S6.4）
// 契约来源：doc/api/tools.md「一致性分析」→ { issues: [{ severity, field, description }] }
// 语义：检查单个实体 data 档案内部的矛盾（「性格坚韧但曾因小事放弃」类）。
// 规则表驱动（单一职责、可扩展）：每条规则纯函数判定，按实体类型分发。
// 数据访问：db 查询层（getEntity 过滤软删）+ outline.json 读取（引用字段校验），无原生 SQL。

import { getEntity, findOutlineNode, readOutlineFile } from "@whispering233/ai-editor-db";
import type { EntityRow } from "@whispering233/ai-editor-shared";
import type { Db } from "@whispering233/ai-editor-db";
import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { throwIfAborted } from "./utils.js";
import type { AnalyzeConsistencyArgs } from "@whispering233/ai-editor-shared";

/** 一致性问题的严重级别（error = 确定矛盾；warning = 可疑/待确认） */
export type IssueSeverity = "error" | "warning";

/** 单条一致性问题（tools.md analyze_consistency 返回项） */
export interface ConsistencyIssue {
  severity: IssueSeverity;
  /** 矛盾的 data 字段名（如 "personality" / "expected_resolve_node_id"） */
  field: string;
  description: string;
}

/** 内置性格反义词对（R2 矛盾检测词表；「勇敢」与「怯懦」并存 = 档案内部矛盾） */
const PERSONALITY_ANTONYMS: ReadonlyArray<readonly [string, string]> = [
  ["勇敢", "怯懦"],
  ["善良", "残忍"],
  ["慷慨", "吝啬"],
  ["诚实", "狡诈"],
  ["冷静", "冲动"],
] as const;

// ============ 规则集（按实体类型分发） ============

/** R1：character.data.age 为负数 → 数值矛盾（error） */
function checkNegativeAge(data: Record<string, unknown>): ConsistencyIssue[] {
  const age = data.age;
  if (typeof age === "number" && age < 0) {
    return [{ severity: "error", field: "age", description: `年龄为负数（${age}），与常理矛盾` }];
  }
  return [];
}

/** R2：character.data.personality 同时含反义词对 → 性格矛盾（warning，逐对检出） */
function checkPersonalityAntonyms(data: Record<string, unknown>): ConsistencyIssue[] {
  const personality = data.personality;
  if (!Array.isArray(personality)) return [];
  const issues: ConsistencyIssue[] = [];
  for (const [a, b] of PERSONALITY_ANTONYMS) {
    if (personality.includes(a) && personality.includes(b)) {
      issues.push({
        severity: "warning",
        field: "personality",
        description: `性格同时标注「${a}」与「${b}」（互为反义），档案内部矛盾`,
      });
    }
  }
  return issues;
}

/** R3：hook.data.status=resolved 但未标注兑现节点 → 终态缺引用（warning） */
function checkResolvedWithoutNode(data: Record<string, unknown>): ConsistencyIssue[] {
  if (data.status === "resolved" && data.expected_resolve_node_id === undefined) {
    return [
      {
        severity: "warning",
        field: "expected_resolve_node_id",
        description: "伏笔状态为 resolved（已兑现）但未标注 expected_resolve_node_id（兑现节点），无法回溯兑现位置",
      },
    ];
  }
  return [];
}

/** R4：hook.data.expected_resolve_node_id 指向不存在/已软删的节点 → 悬空引用（error） */
function checkResolveNodeReference(data: Record<string, unknown>, tree: OutlineFileTree): ConsistencyIssue[] {
  const nodeId = data.expected_resolve_node_id;
  if (typeof nodeId !== "string" || nodeId === "") return [];
  const node = findOutlineNode(tree, nodeId);
  if (node === undefined) {
    return [{ severity: "error", field: "expected_resolve_node_id", description: `兑现节点 ${nodeId} 不存在（已物理删除或 id 拼写错误）` }];
  }
  if (node.deleted === true) {
    return [{ severity: "error", field: "expected_resolve_node_id", description: `兑现节点「${node.title}」已被软删，引用悬空` }];
  }
  return [];
}

/** R5：setting/location.data.parent_id 指向不存在/已软删的实体 → 悬空引用（warning） */
function checkParentReference(data: Record<string, unknown>, db: Db): ConsistencyIssue[] {
  const parentId = data.parent_id;
  if (typeof parentId !== "string" || parentId === "") return [];
  if (getEntity(db, parentId) === null) {
    return [{ severity: "warning", field: "parent_id", description: `parent_id 指向的实体 ${parentId} 不存在或已软删，层级引用悬空` }];
  }
  return [];
}

/**
 * 实体档案一致性检查（tools.md analyze_consistency(entity_id)）。
 * 规则表（按类型分发，均纯函数判定）：
 * - character：R1 负年龄（error）、R2 性格反义词对（warning）
 * - hook：R3 已兑现未标注节点（warning）、R4 兑现节点悬空引用（error）
 * - setting/location：R5 parent_id 悬空引用（warning）
 * 实体不存在/已软删 → null（查询无结果，LLM 自纠）。
 */
export function analyzeEntityConsistency(row: EntityRow, tree: OutlineFileTree, db: Db): ConsistencyIssue[] {
  const data = row.data;
  switch (row.type) {
    case "character":
      return [...checkNegativeAge(data), ...checkPersonalityAntonyms(data)];
    case "hook":
      return [...checkResolvedWithoutNode(data), ...checkResolveNodeReference(data, tree)];
    case "setting":
    case "location":
      return checkParentReference(data, db);
  }
}

/** 工具执行入口（注册表 run 形态：signal 供长任务取消；中止优先于参数校验） */
export function runAnalyzeConsistency(
  ctx: ToolContext,
  args: AnalyzeConsistencyArgs,
  signal?: AbortSignal,
): { issues: ConsistencyIssue[] } | null {
  throwIfAborted(signal);
  const row = getEntity(ctx.db, args.entity_id);
  if (row === null) return null;
  const tree = readOutlineFile(ctx.outlineDir);
  return { issues: analyzeEntityConsistency(row, tree, ctx.db) };
}
