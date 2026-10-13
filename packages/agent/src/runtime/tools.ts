// pi 运行时：领域工具 → pi 工具定义（TypeBox 直通，不转换）
//
// 适配面很薄：name/label/description/parameters 直通；execute 注入 ToolContext（db/outlineDir/projectId），
// 把 tools 包的返回值文本化回填并做截断；PROPOSAL 权限工具的提案载荷走 `details`（K3 接提案仓）。
//
// 工作区过滤（2026-10）：只装配属于当前工作区 `kind` 的工具（shared `isToolScopeRegistered`）——
// 练习工作区根本没有小说工具与 `propose_*`，这是**结构性边界**（靠注册过滤，不靠提示词）。
//
// 契约见 docs/api/tool-calling.md：抛错即失败（不把失败编码进 content）；提案 content 只给
// 「提案已发出」提示，预览细节在 details 里随 SSE 推给 GUI。

import type { ToolDefinition as PiToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  isToolScopeRegistered,
  TOOL_PERMISSION,
  type WorkspaceKind,
} from "@whispering233/ai-editor-shared";
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
  /**
   * 当前工作区类型（**必填**）：决定装配哪些工具（`scope` 过滤）。
   * 刻意不给缺省值——「忘了传 = 注册全量」会让收窄静默失效。
   */
  kind: WorkspaceKind;
  proposalSink?: ProposalSink;
}

/** 装配入参的必填键（同一份清单做两件事：下面的编译期断言 + 运行时守卫） */
const requiredOptionKeys = ["toolContext", "kind"] as const satisfies readonly RequiredKeys<CreateCustomToolsOptions>[];

/** 必填键 = 类型上不接纳 `undefined` 的键 */
type RequiredKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? never : K }[keyof T];

/**
 * 编译期防回归（本仓约定：编译期断言写 src，`*.test.ts` 不进 `pnpm typecheck`）：
 * `requiredOptionKeys` 必须恰好是入参的必填键——把 `kind` 改成可选 / 加缺省值，上面那行即报红。
 * 运行时同一份清单再拦一次：缺必填项直接抛错，**不退化为「注册全量」**。
 */
function assertRequiredOptions(options: CreateCustomToolsOptions): void {
  const provided: Partial<CreateCustomToolsOptions> = options;
  const missing = requiredOptionKeys.filter((key) => provided[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`createCustomTools: 缺少必填入参 ${missing.join(" / ")}（工具集按工作区类型收窄，不接受缺省）`);
  }
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

/** registry 中属于该工作区的工具 → pi 工具定义（顺序 = listTools 的稳定序） */
export function createCustomTools(options: CreateCustomToolsOptions): PiToolDefinition[] {
  assertRequiredOptions(options);
  return listTools()
    .filter((tool) => isToolScopeRegistered(options.kind, tool.scope))
    .map((tool) => toPiTool(tool, options));
}

/** 工具参数 schema 类型（测试/调用方按需引用） */
