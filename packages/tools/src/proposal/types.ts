// 提案对象类型 + 构造辅助（S6.6，proposal/ 模块公共层）
//
// **提案是服务端运行时对象**（决策 14：仅内存、不落盘、随 SSE 推送 GUI；prop_ 前缀运行时 id，
// 不跨 client——故定义在 tools 包而非 shared）。提案仓（TTL 10 分钟 + 条数上限 + 项目绑定）
// 属 S7.4 范围，本模块只负责**产出提案对象结构**。
//
// 提案对象结构（决策 14/19）：
// - proposal_id：prop_ 前缀（generateRuntimeId，endpoints.md id 约定）
// - type：工具名（PROPOSAL_TOOLS 一员，S7.4 executor 按名调度）
// - args：**执行信息**——确认后调用 S6.7 执行工具所需的全部参数（端点类工具已把
//   id 解析为 {source_type, source_id} 等规范化形态，执行时可直接透传）
// - project_id：项目绑定（决策 14 修订，confirm/reject 校验归属）
// - references：被引用对象 id + updated_at 快照——实体/关系用自身 updated_at、
//   大纲节点用节点级 updated_at（决策 14/19）；确认（S7.5）时按 kind 重校验
//   （存在性 + updated_at 比对，失败 409 PROPOSAL_STALE）
// - summary：一句话摘要（tool_result + GUI 展示）
// - createdAt：ISO 8601（应用层写入约定；TTL 计算基准）
// - preview（F9 起可选）：结构化预览细节（如 propose_reorder_timepoints 的 { changes: [...] }）——
//   经 SSE proposal 事件推送 GUI 展示提案卡；未设置时 S7.4 executor 回退为
//   { type, summary, args }（既有提案工具的默认预览形态）。
//
// tool_result 语义（tools.md「返回语义」2026-08 修订）：propose_* 的 run 只返回
// { proposal_id, summary }，**不含预览细节**——避免 LLM 误以为提案已生效而重复提案；
// 完整预览经 SSE proposal 事件推送 GUI（S7 实现）。

import { getEntity } from "@whispering233/ai-editor-db";
import { nowIso } from "@whispering233/ai-editor-db";
import { generateRuntimeId } from "@whispering233/ai-editor-shared";
import type { EntityRow, OutlineFileNode, RelationRow } from "@whispering233/ai-editor-shared";
import { findOutlineNode, readOutlineFile } from "@whispering233/ai-editor-db";
import type { ToolContext } from "../context.js";
import { throwIfAborted } from "../analysis/utils.js";

/** 被引用对象种类（决策 14/19：确认时按 kind 走对应存在性 + updated_at 重校验路径） */
export type ProposalReferenceKind = "entity" | "relation" | "delta" | "outline_node";

/** 单个引用快照：被引用对象 id + updated_at（决策 14 快照比对） */
export interface ProposalReference {
  kind: ProposalReferenceKind;
  id: string;
  /** 快照：实体/关系用自身 updated_at；大纲节点用节点级 updated_at（决策 14/19） */
  updated_at: string;
}

/** 提案对象（决策 14：仅内存；S7.4 提案仓存储，S7.5 confirm/reject 消费） */
export interface Proposal {
  /** 运行时 id（prop_ 前缀，endpoints.md id 约定） */
  proposal_id: string;
  /** 工具名（propose_*，PROPOSAL_TOOLS 一员） */
  type: string;
  /** 执行信息：确认后 S6.7 执行工具可直接使用的参数（含派生端点类型等规范化形态） */
  args: Record<string, unknown>;
  /** 项目绑定（决策 14 修订；confirm/reject 校验与当前项目一致） */
  project_id: string;
  /** 引用对象快照（决策 14/19：存在性 + updated_at） */
  references: ProposalReference[];
  /** 一句话摘要（tool_result + GUI 展示） */
  summary: string;
  /**
   * 结构化预览细节（F9 起可选）：如 propose_reorder_timepoints 的 { changes: string[] }（顺序变化
   * 说明，供前端提案卡 JSON 展示）；经 SSE proposal 事件推送 GUI。未设置时 S7.4 executor
   * 回退为 { type, summary, args }（既有提案工具默认预览形态，行为不变）。
   */
  preview?: Record<string, unknown>;
  /** ISO 8601 创建时间（应用层写入约定；TTL 计算基准，S7.4） */
  createdAt: string;
}

/** propose_* tool_result（tools.md 2026-08 修订：仅「提案已发出」提示，不含预览细节） */
export interface ToolProposalResult {
  proposal_id: string;
  summary: string;
}

/**
 * 构造提案对象（S6.6 产出）：生成 prop_ id + 绑定 project_id + 应用层写入 createdAt。
 * 返回**完整 Proposal**（供 S7.4 提案仓存储）；run 函数只把 { proposal_id, summary }
 * 作为 tool_result 返回（S7.4 同时需要完整对象，故此处返回完整结构）。
 *
 * **入口约定**：build 为纯产出层（无 signal 参数，不做中止检查）——S7.4 提案仓统一走
 * 各工具 run 入口（含 checkProposalAborted）；build 仅供构建期复用（测试断言结构、
 * S7.4 需要完整对象时经 run 内部产出路径间接获取），直接调用方自行保证无并发取消语义。
 */
export function buildProposal(
  ctx: ToolContext,
  type: string,
  args: Record<string, unknown>,
  references: ProposalReference[],
  summary: string,
  preview?: Record<string, unknown>,
): Proposal {
  return {
    proposal_id: generateRuntimeId("proposal"),
    type,
    args,
    project_id: ctx.projectId,
    references,
    summary,
    ...(preview === undefined ? {} : { preview }),
    createdAt: nowIso(),
  };
}

/** 实体引用快照（决策 14：用实体自身 updated_at） */
export function refEntity(row: EntityRow): ProposalReference {
  return { kind: "entity", id: row.id, updated_at: row.updated_at };
}

/** 关系引用快照（决策 14：用关系自身 updated_at） */
export function refRelation(row: RelationRow): ProposalReference {
  return { kind: "relation", id: row.id, updated_at: row.updated_at };
}

/** 大纲节点引用快照（决策 19：用节点级 updated_at） */
export function refOutlineNode(node: OutlineFileNode): ProposalReference {
  return { kind: "outline_node", id: node.id, updated_at: node.updated_at };
}

/**
 * 解析端点（关系 source/target、Delta target 共用）：id → { 类型, 引用快照 }。
 * 判定顺序：实体表优先（getEntity 已过滤软删，决策 12），其次大纲树（存在且未软删）；
 * 两者皆不命中抛错（工具执行契约「抛错即失败」，executor 转结构化结果喂回 LLM 自纠）。
 * root 是树根而非端点，直接拒绝。
 */
export function resolveEndpoint(
  ctx: ToolContext,
  id: string,
): { type: string; ref: ProposalReference } {
  if (id === "root") {
    throw new Error(`端点不存在或已软删: ${id}`);
  }
  const entity = getEntity(ctx.db, id);
  if (entity !== null) {
    return { type: entity.type, ref: refEntity(entity) };
  }
  const node = findOutlineNode(readOutlineFile(ctx.outlineDir), id);
  if (node !== undefined && node.deleted !== true) {
    return { type: "outline_node", ref: refOutlineNode(node) };
  }
  throw new Error(`端点不存在或已软删: ${id}`);
}

/**
 * 按 id 取大纲节点（存在且未软删，决策 12）；否则抛错。
 * 供 propose_add_delta 触发节点 / propose_outline_node 父节点 / move / delete / hook 埋设节点复用。
 */
export function requireOutlineNode(ctx: ToolContext, nodeId: string): OutlineFileNode {
  const node = findOutlineNode(readOutlineFile(ctx.outlineDir), nodeId);
  if (node === undefined || node.deleted === true) {
    throw new Error(`大纲节点不存在或已软删: ${nodeId}`);
  }
  return node;
}

/**
 * 按 id 取伏笔实体（type === "hook" 且未软删，类型一致性校验）；否则抛错。
 * 伏笔即 type=hook 的实体（hooks.md：用户手动创建或 AI 提案创建），快照用实体自身 updated_at（决策 14）。
 */
export function requireHook(ctx: ToolContext, hookId: string): EntityRow {
  const entity = getEntity(ctx.db, hookId);
  if (entity === null || entity.type !== "hook") {
    throw new Error(`伏笔不存在或已软删: ${hookId}`);
  }
  return entity;
}

/** 提案工具入口统一中止检查（决策 16 ③：长工具执行中检查 signal；提案生成是同步短操作，入口检查一次即可） */
export function checkProposalAborted(signal?: AbortSignal): void {
  throwIfAborted(signal);
}
