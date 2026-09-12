// pi 运行时：领域工具 → pi 工具定义（TypeBox 直通，不转换）
//
// 适配面很薄：name/label/description/parameters 直通；execute 注入 ToolContext（db/outlineDir/projectId），
// 把 tools 包的返回值文本化回填并做截断；PROPOSAL 权限工具的提案载荷走 `details`（K3 接提案仓）。
//
// 契约见 docs/api/tool-calling.md：抛错即失败（不把失败编码进 content）；提案 content 只给
// 「提案已发出」提示，预览细节在 details 里随 SSE 推给 GUI。

import type { ToolDefinition as PiToolDefinition } from "@earendil-works/pi-coding-agent";
import { TOOL_PERMISSION } from "@whispering233/ai-editor-shared";
import { listTools, type ToolContext, type ToolDefinition as EditorToolDefinition } from "@whispering233/ai-editor-tools";
import { stringifyToolResult, truncateToolResultText } from "./tool-result.js";

/** 提案载荷（`propose_*` 工具的 details；推送前端的形态见 docs/api/80-api-chat.md） */
export interface ProposalPayload {
  proposal_id: string;
  type: string;
  preview: Record<string, unknown>;
}

/** 提案登记入参（K3 的提案仓消费：可据此重建完整 Proposal 并入仓；未接线返回 undefined） */
export interface ProposalSinkInput {
  toolName: string;
  toolCallId: string;
  /** 校验/coerce 后的工具参数（重建 Proposal 需要，与 run 内部同源） */
  params: unknown;
  /** run 的返回值（propose_* 为 `{ proposal_id, summary }`，不含预览细节） */
  result: unknown;
  toolContext: ToolContext;
}

/** 提案登记回调（K2 只留接线点，缺省 no-op；K3 接提案仓） */
export type ProposalSink = (input: ProposalSinkInput) => ProposalPayload | undefined;

export interface CreateCustomToolsOptions {
  toolContext: ToolContext;
  proposalSink?: ProposalSink;
}

/** 提案已发出提示（content 不含预览细节——避免模型误以为提案已生效）
 * 一句话摘要取自 preview.summary（结构化 preview 的提案没有该字段，则只给 id） */
function proposalAckText(payload: ProposalPayload): string {
  const summary = payload.preview.summary;
  const summaryText = typeof summary === "string" && summary !== "" ? `${summary}；` : "";
  return `提案已发出（proposal_id=${payload.proposal_id}）：${summaryText}需用户确认后才会生效；确认前不要假设任何修改已发生。`;
}

/** 单个领域工具 → pi 工具定义 */
function toPiTool(tool: EditorToolDefinition, options: CreateCustomToolsOptions): PiToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (toolCallId, params, signal) => {
      const result: unknown = await tool.run(options.toolContext, params as never, signal);

      if (tool.permission === TOOL_PERMISSION.PROPOSAL) {
        const proposal = options.proposalSink?.({
          toolName: tool.name,
          toolCallId,
          params,
          result,
          toolContext: options.toolContext,
        });
        if (proposal !== undefined) {
          return {
            content: [{ type: "text" as const, text: proposalAckText(proposal) }],
            details: proposal,
          };
        }
      }

      return {
        content: [{ type: "text" as const, text: truncateToolResultText(stringifyToolResult(result)) }],
        details: result,
      };
    },
  };
}

/** registry 全部工具 → pi 工具定义（顺序 = listTools 的稳定序） */
export function createCustomTools(options: CreateCustomToolsOptions): PiToolDefinition[] {
  return listTools().map((tool) => toPiTool(tool, options));
}

/** 工具参数 schema 类型（测试/调用方按需引用） */
