// 提案类工具：参考资料（决策 36，批次九）
// propose_create_reference——AI 读到灵感/素材后建议保存为参考资料（外部素材/灵感笔记，非本书正文）
//
// 语义对齐 S6.6 提案工具：build 只产出提案对象（不落盘），run 返回 { proposal_id, summary }
// （tool_result 不含预览细节，防 LLM 重复提案）；无引用对象（新实体 id 由执行时生成）。
// 参数契约：shared types/tool.ts ProposeCreateReferenceArgs（name 必填 + type/content/source/tags 可选）
// 执行：确认后 executeCreateReference 经 executeProposal 调度（executor/reference.ts）。

import type { ProposeCreateReferenceArgs } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { buildProposal, checkProposalAborted, type ToolProposalResult } from "./types.js";

/** 产出创建参考资料提案（无引用对象——新实体 id 由执行时生成，决策 36）
 *  决策 43：AI 创建的条目归 link 类（data.kind='link'）——source 参数映射为 url（无 URL 时 url 留空、
 *  content 存摘录）；AI 不直接落盘文件（文件写入走用户编辑器保存） */
export function buildProposeCreateReference(ctx: ToolContext, args: ProposeCreateReferenceArgs): ReturnType<typeof buildProposal> {
  const data: Record<string, unknown> = { kind: "link" };
  if (args.type !== undefined) data.type = args.type;
  if (args.content !== undefined) data.content = args.content;
  // 决策 43：source → url（link 类来源列渲染依据）；无 source 时 url 留空（content 存摘录）
  if (args.source !== undefined) data.url = args.source;
  if (args.tags !== undefined) data.tags = args.tags;
  return buildProposal(
    ctx,
    "propose_create_reference",
    { name: args.name, data },
    [],
    `创建参考资料「${args.name}」${args.type !== undefined ? `（${args.type}）` : ""}`,
  );
}

/** propose_create_reference run：中止检查 + 产出结果 */
export function runProposeCreateReference(
  ctx: ToolContext,
  args: ProposeCreateReferenceArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeCreateReference(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}
