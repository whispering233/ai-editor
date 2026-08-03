// @ai-editor/agent 上下文组装（S7.2）
//
// 契约来源：doc/design/decisions.md 决策 6（分层上下文策略：系统 ~500 / 聚焦 ~3000 /
// 历史 ~6000；usage 基线——优先最近真实 usage，裁剪历史后重置基线防预算漂移）、决策 7
// （提示词三层注入：内核 + 项目 + 临时）、doc/api/endpoints.md（POST /api/v1/chat 的
// context 字段 focus_entity_type/focus_entity_id/focus_node_id——聚焦数据由调用方查询后
// 以文本传入）、packages/llm/src/token.ts（estimateTokens / estimateMessagesTokens）、
// packages/tools/src/registry.ts（listTools 工具清单）。
//
// 架构边界：本模块**不依赖 db**——聚焦上下文文本与项目提示词均由调用方（S7.6 server 层）
// 查询后传入，context.ts 只做组装与预算控制；工具列表默认内部取 registry（agent 依赖 tools ✓）。
//
// 消费链（S7.3 主循环）：SessionState → buildContext()（本层成对裁剪 + 基线重置）→
// 输出 LLMMessage[]（system + 可选聚焦 system + 历史）直接喂给模型。

import type { LLMMessage, LLMUsage } from "@ai-editor/llm";
import { estimateMessagesTokens, estimateTokens } from "@ai-editor/llm";
import { listTools, type ToolDefinition } from "@ai-editor/tools";
import {
  FOCUS_TITLE,
  FOCUS_TRUNCATION_NOTICE,
  INSTRUCTION_TITLE,
  KERNEL_PROMPT,
  PROJECT_PROMPT_TITLE,
  TOOL_LIST_TITLE,
} from "./prompts.js";
import { buildPayload, trimSession, type SessionMessage } from "./session.js";

// ============ 分层预算常量（决策 6） ============

/** 分层 token 预算（决策 6：系统 ~500 / 聚焦 ~3000 / 历史 ~6000；可整体或单项覆盖）。
 * 分层合计约 11.5K，远低于 DeepSeek 64K 窗口——各层独立校验、不设总预算校验（YAGNI：
 * 分层裁剪已保证各层在其预算内，窗口余量充足） */
export interface ContextBudgets {
  /** 基础 system 层：内核 + 项目提示词 + 临时指令（决策 6 ~500；超限仅记录不裁剪——用户内容不可裁） */
  system: number;
  /** 聚焦上下文层（决策 6 ~3000；超限截断并显式告知） */
  focus: number;
  /** 对话历史层（决策 6 ~6000；超限走 session 成对裁剪——同裁同留不拆对） */
  history: number;
}

export const DEFAULT_CONTEXT_BUDGETS: ContextBudgets = {
  system: 500,
  focus: 3000,
  history: 6000,
};

// ============ 组装输入 / 输出 ============

/** 工具清单注入所需的工具形态（仅消费 name/description，不依赖 registry 全量定义） */
export type ToolListEntry = Pick<ToolDefinition, "name" | "description">;

/** buildContext 输入：除 history 外全部可空（无聚焦 / 无项目提示词 / 无临时指令均为合法态） */
export interface BuildContextInput {
  /**
   * 会话历史（session 状态；本层负责超预算成对裁剪 + 末条约束收尾）。
   * **前置条件**：必须含至少一条 user/tool 消息（决策 18 末条约束）；空历史属调用方错误——
   * S7.3 应在 history 为空时走引导分支（不发请求），勿传入空数组（buildPayload 空数组
   * 语义同源：空历史 = 无有效上下文，两者互相印证）
   */
  history: SessionMessage[];
  /** 内核提示词（默认 KERNEL_PROMPT；测试可覆盖） */
  kernelPrompt?: string;
  /** 项目提示词（决策 7 项目层，调用方从 ProjectConfig.prompt 传入；可空） */
  projectPrompt?: string;
  /** 临时指令（决策 7 临时层，即时输入不持久化；可空） */
  instruction?: string;
  /** 聚焦上下文文本（决策 6 聚焦层，调用方查询实体/大纲节点后拼好传入；空/缺省 = 无聚焦） */
  focus?: string;
  /** 工具清单（默认内部 listTools()；测试可注入 mock） */
  tools?: ToolListEntry[];
  /**
   * 最近一次成功响应的 usage 基线（决策 6；本层触发裁剪后重置为 null）。
   * **口径**：本层把 lastUsage 当作「历史段」基线（与 token.ts estimateMessagesTokens 的
   * lastUsage 语义一致）——调用方（S7.3）须以 `usage.prompt_tokens - (system + toolList +
   * focus + completion 估算)` 换算传入，即只保留历史段分量；meta.tokens 已提供
   * system/toolList/focus 各层估算可供换算（completion 为上一轮输出，可直接从
   * usage.completion_tokens 扣除）。直接传原始 total_tokens 会与非历史层重复计费
   */
  lastUsage?: LLMUsage | null;
  /** 分层预算覆盖（缺省用决策 6 常量） */
  budgets?: Partial<ContextBudgets>;
}

/** buildContext 输出：完整喂回 messages + 各层估算 + 裁剪/截断/基线记录 */
export interface AssembledContext {
  /** 完整喂回数组：[system(基础+工具清单), (system(聚焦) 若有), ...历史]；末条恒 user/tool 或为空 */
  messages: LLMMessage[];
  /** 各层估算 token（history 为裁剪后、无基线重置后的估算） */
  tokens: {
    /** 基础 system（内核+项目+临时） */
    system: number;
    /** 工具清单（独立于 system 层计，不参与裁剪——LLM 需完整工具表） */
    toolList: number;
    /** 聚焦层（截断后；无聚焦为 0） */
    focus: number;
    /** 历史层（裁剪后） */
    history: number;
    /** 四层合计 */
    total: number;
  };
  meta: {
    /** 基础 system 超限（仅记录不裁剪——用户内容不可裁） */
    systemOverBudget: boolean;
    /** 聚焦被截断（含截断提示） */
    focusTruncated: boolean;
    /** 历史被成对裁剪（同裁同留不拆对） */
    historyTrimmed: boolean;
    /** 裁剪后历史条数 */
    historyMessageCount: number;
    /** 基线被重置（触发裁剪/重排后旧 usage 不再可信——决策 6 防预算漂移） */
    lastUsageReset: boolean;
    /**
     * 生效基线：未触发裁剪时保留换算后的 lastUsage；触发后为 null。
     * **回写契约（S7.3 接线）**：本层消费的 lastUsage 是「历史段」口径（见
     * BuildContextInput.lastUsage）；effectiveLastUsage 仅回写「是否重置」这一决策，
     * S7.3 下一轮组装时仍须按换算公式从最新 usage 重新计算历史段分量传入
     */
    effectiveLastUsage: LLMUsage | null;
  };
}

// ============ 内部组装辅助（纯函数） ============

/** 基础 system 文本：内核 + 项目提示词 + 临时指令（决策 7 三层注入，空层跳过） */
function buildSystemBase(kernel: string, project?: string, instruction?: string): string {
  const parts = [kernel];
  if (project !== undefined && project.trim() !== "") {
    parts.push(`${PROJECT_PROMPT_TITLE}\n${project}`);
  }
  if (instruction !== undefined && instruction.trim() !== "") {
    parts.push(`${INSTRUCTION_TITLE}\n${instruction}`);
  }
  return parts.join("\n\n");
}

/** 工具清单文本：name + description 一行（registry listTools 形态；空清单返回空串） */
function buildToolListText(tools: readonly ToolListEntry[]): string {
  if (tools.length === 0) return "";
  const lines = tools.map((t) => `- ${t.name}：${t.description}`);
  return `${TOOL_LIST_TITLE}\n${lines.join("\n")}`;
}

/**
 * 聚焦文本按预算截断（决策 15 精神：显式告知，不静默丢数据）：
 * 按 chars/4 反推可保留字符数（预留截断提示空间），保留前缀 + 截断提示。
 */
function trimFocus(focus: string, maxTokens: number): { text: string; truncated: boolean } {
  if (estimateTokens(focus) <= maxTokens) {
    return { text: focus, truncated: false };
  }
  const maxChars = Math.max(0, Math.floor(maxTokens * 4));
  const keptChars = Math.max(0, maxChars - FOCUS_TRUNCATION_NOTICE.length);
  return { text: focus.slice(0, keptChars) + FOCUS_TRUNCATION_NOTICE, truncated: true };
}

/**
 * 历史按 token 预算成对裁剪（决策 6 + 决策 18）：
 * 用 trimSession 以「配对块」为单位裁剪（同裁同留不拆对），二分找预算内尽量多保留的
 * 最大条数。裁剪后的估算**一律不带 usage 基线**——旧基线描述裁剪前前缀，沿用即预算漂移。
 * 返回 { messages, trimmed }：trimmed=true 表示至少裁掉一条消息。
 */
function trimHistoryToBudget(
  history: SessionMessage[],
  maxTokens: number,
): { messages: SessionMessage[]; trimmed: boolean } {
  if (estimateMessagesTokens(history) <= maxTokens) {
    return { messages: history, trimmed: false };
  }
  // 二分最大可行条数 n：f(n) = estimate(trimSession(history, n))，f(0)=0 ≤ 预算。
  // 单调性论证：n 增大时原放不下的块可能变得可放（swap）——新纳入块的条数严格大于
  // 被其挤出的更早块（否则此前不会被拒），保留**条数**单调不减；条数分布均匀时
  // f(n) 即近似单调不减，二分求最大可行 n 正确。
  // 兜底：即使极端大小构造破坏 token 单调性，lo 不变式（f(lo) ≤ 预算恒成立）保证
  // 二分终止时输出不超预算——最坏只是保留条数略少于最优，绝无超预算风险。
  let lo = 0;
  let hi = history.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateMessagesTokens(trimSession(history, mid)) <= maxTokens) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { messages: trimSession(history, lo), trimmed: lo < history.length };
}

// ============ 主组装 ============

/**
 * 组装完整喂回上下文（决策 6/7）：
 * 1. 基础 system = 内核 + 项目提示词 + 临时指令 + 工具清单（超 system 预算仅记录不裁剪）
 * 2. 聚焦注入 = 独立 system 消息（有 focus 时；超预算截断并显式告知）
 * 3. 历史 = 超预算成对裁剪（同裁同留）+ 末条约束收尾（buildPayload——输出末条恒 user/tool）
 * 4. usage 基线：未触发裁剪时保留 lastUsage（真实用量优先，决策 6）；一旦触发裁剪即重置为
 *    null（旧 usage 描述裁剪前前缀，沿用会导致预算漂移）——meta.effectiveLastUsage 反映
 *    生效基线，S7.3 应回写该值作为下一轮输入
 */
export function buildContext(input: BuildContextInput): AssembledContext {
  const budgets: ContextBudgets = { ...DEFAULT_CONTEXT_BUDGETS, ...input.budgets };
  const kernel = input.kernelPrompt ?? KERNEL_PROMPT;
  const tools = input.tools ?? listTools();

  // ---- 1. 基础 system 层（内核 + 项目 + 临时 + 工具清单） ----
  const baseText = buildSystemBase(kernel, input.projectPrompt, input.instruction);
  const toolListText = buildToolListText(tools);
  const systemContent = toolListText === "" ? baseText : `${baseText}\n\n${toolListText}`;
  const systemTokens = estimateTokens(baseText);
  const toolListTokens = estimateTokens(toolListText);
  const systemOverBudget = systemTokens > budgets.system;

  // ---- 2. 聚焦层（独立 system 消息；超预算截断） ----
  let focusMessage: LLMMessage | null = null;
  let focusTokens = 0;
  let focusTruncated = false;
  if (input.focus !== undefined && input.focus !== "") {
    const trimmed = trimFocus(input.focus, budgets.focus);
    focusTruncated = trimmed.truncated;
    focusTokens = estimateTokens(`${FOCUS_TITLE}\n${trimmed.text}`);
    focusMessage = { role: "system", content: `${FOCUS_TITLE}\n${trimmed.text}` };
  }

  // ---- 3. 历史层（超预算成对裁剪 + 末条约束收尾） ----
  // 预算判定优先真实 usage 基线（决策 6）；一旦判定超限触发裁剪，基线即重置
  const withBaseline = estimateMessagesTokens(input.history, {
    lastUsage: input.lastUsage ?? null,
  });
  const lastUsageReset = withBaseline > budgets.history;
  const trimmedHistory = lastUsageReset
    ? trimHistoryToBudget(input.history, budgets.history)
    : { messages: input.history, trimmed: false };
  const historyPayload = buildPayload(trimmedHistory.messages);
  const historyTokens = estimateMessagesTokens(historyPayload);

  // ---- 4. 汇总 ----
  const messages: LLMMessage[] = [{ role: "system", content: systemContent }];
  if (focusMessage !== null) messages.push(focusMessage);
  messages.push(...historyPayload);

  return {
    messages,
    tokens: {
      system: systemTokens,
      toolList: toolListTokens,
      focus: focusTokens,
      history: historyTokens,
      total: systemTokens + toolListTokens + focusTokens + historyTokens,
    },
    meta: {
      systemOverBudget,
      focusTruncated,
      historyTrimmed: trimmedHistory.trimmed,
      historyMessageCount: historyPayload.length,
      lastUsageReset,
      effectiveLastUsage: lastUsageReset ? null : (input.lastUsage ?? null),
    },
  };
}
