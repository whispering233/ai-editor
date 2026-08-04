// @whispering233/ai-editor-agent 会话管理（S7.1）
//
// 契约来源：doc/design/tasks.md S7.1、doc/design/decisions.md 决策 18（历史重建 / 成对裁剪 /
// 孤儿半对整对丢弃 / 末条约束）、packages/llm/src/types.ts（LLMMessage 四角色 wire 形态）、
// packages/db/src/queries/chat.ts（数据层参照——本包**不依赖 db**，仅对齐重组算法语义）。
//
// 架构边界：本模块是**纯内存消息处理**（函数式、无 I/O）——输入历史消息数组 + 运行时
// 追加消息，输出裁剪后的喂回格式；持久化读写由 server 层负责（db 包 chat 查询）。
// 使用链（S7.3 主循环消费）：loadHistory（服务重启续聊）→ appendMessage（运行时追加）→
// trimSession（滑动窗口成对裁剪）→ buildPayload（喂回格式 + 末条约束）→
// 失败重试时 retryPayload（复用原 payload，不追加失败轮半条 assistant）。

import type { ChatMessageRow } from "@whispering233/ai-editor-shared";
import type { LLMMessage, LLMToolCallRequest } from "@whispering233/ai-editor-llm";

// ============ 运行时消息形态 ============

/**
 * 运行时会话消息：LLMMessage 的子集（不含 system——系统指令由 S7.2 上下文组装注入）。
 * 与 llm 包 wire 形态完全一致，喂回模型时无需二次转换。
 */
export type SessionMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LLMToolCallRequest[] }
  | { role: "tool"; content: string; tool_call_id: string };

/** 会话状态：按时间序排列的消息数组（immutable，追加/裁剪均返回新数组） */
export type SessionState = SessionMessage[];

// ============ 内部辅助 ============

/**
 * 行内 tool_calls（unknown[]，来自 chat_messages.tool_calls JSON 列）→ wire 形态。
 * 任一调用形态不合法（缺 id / type 非 function / function 字段缺失）即返回 null——
 * 决策 18：缺 id 即孤儿半对，该 assistant 消息与其工具结果**整组丢弃**（由调用方判定）。
 */
function toToolCallRequests(raw: unknown[]): LLMToolCallRequest[] | null {
  const out: LLMToolCallRequest[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const call = item as Record<string, unknown>;
    const fn = call.function;
    if (
      typeof call.id !== "string" ||
      call.type !== "function" ||
      typeof fn !== "object" ||
      fn === null ||
      typeof (fn as Record<string, unknown>).name !== "string" ||
      typeof (fn as Record<string, unknown>).arguments !== "string"
    ) {
      return null;
    }
    out.push({
      id: call.id,
      type: "function",
      function: {
        name: (fn as Record<string, unknown>).name as string,
        arguments: (fn as Record<string, unknown>).arguments as string,
      },
    });
  }
  return out;
}

/**
 * 收集全部 tool 结果：tool_call_id → content（决策 18 修订：同一 id 多条结果取最先到达者）。
 * 与 db 包 reassembleMessages 的收集口径一致（本包不依赖 db，按文档契约独立实现）。
 */
function collectToolResults(messages: readonly SessionMessage[]): Map<string, string | null> {
  const toolResults = new Map<string, string | null>();
  for (const m of messages) {
    if (m.role === "tool" && !toolResults.has(m.tool_call_id)) {
      toolResults.set(m.tool_call_id, m.content);
    }
  }
  return toolResults;
}

/** 完整配对块：可独立喂回模型的单元（user 单条 / 普通 assistant 单条 / assistant + 其全部 tool 结果） */
interface Block {
  messages: SessionMessage[];
}

/**
 * 把消息序列切成「配对块」（决策 18 成对重组算法）：
 * - user 消息：独立块
 * - assistant 无 tool_calls：独立块
 * - assistant 带 tool_calls：全部调用有对应结果才成块（assistant + 结果按 tool_calls 顺序）；
 *   任一调用缺结果 / 形态不合法 → 孤儿半对，**整块丢弃**
 * - tool 消息：仅作为其 assistant 块的组成部分；未被任何 assistant 引用的孤儿在此自然丢弃
 * 输出天然无孤儿，是成对裁剪与重建喂回的共同基础。
 */
function toBlocks(messages: readonly SessionMessage[]): Block[] {
  const toolResults = collectToolResults(messages);
  const blocks: Block[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      blocks.push({ messages: [m] });
      continue;
    }
    if (m.role === "assistant") {
      const calls = m.tool_calls ?? [];
      if (calls.length === 0) {
        blocks.push({ messages: [m] });
        continue;
      }
      // 任一调用缺对应 tool 结果 → 整组丢弃（不部分保留）
      if (!calls.every((c) => toolResults.has(c.id))) continue;
      blocks.push({
        messages: [
          m,
          ...calls.map((c) => ({
            role: "tool" as const,
            content: toolResults.get(c.id) ?? "",
            tool_call_id: c.id,
          })),
        ],
      });
      continue;
    }
    // role === "tool"：仅作为上面 assistant 块的组成部分；孤儿在此自然丢弃
  }
  return blocks;
}

// ============ 状态机函数链（加载历史 → 重建 → 追加 → 裁剪 → 喂回） ============

/** 新建空会话（初始状态；随后 loadHistory 或 appendMessage 填充） */
export function createSession(): SessionState {
  return [];
}

/**
 * 加载历史：持久化行 → 运行时消息（决策 18 成对重组）。
 * 输入 ChatMessageRow[]（由 server 层经 db 包查询得到），纯内存重组、无 I/O。
 * - 按 created_at 升序稳定排序（同时间戳保持输入序，与 db 查询口径一致）
 * - 孤儿半对整对丢弃（tool_call 已写 tool_result 未写，或反之）
 * - 输出为无孤儿的完整配对序列，可直接 trimSession / buildPayload
 */
export function loadHistory(rows: ChatMessageRow[]): SessionState {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  // 预收集 tool 结果（决策 18 修订：同一 id 多条结果取最先到达者）
  const toolResults = new Map<string, string | null>();
  for (const r of sorted) {
    if (r.role === "tool" && r.tool_call_id !== null && !toolResults.has(r.tool_call_id)) {
      toolResults.set(r.tool_call_id, r.content);
    }
  }
  const out: SessionState = [];
  for (const r of sorted) {
    if (r.role === "user") {
      out.push({ role: "user", content: r.content ?? "" });
      continue;
    }
    if (r.role === "assistant") {
      const rawCalls = r.tool_calls;
      if (rawCalls == null || rawCalls.length === 0) {
        // 普通 assistant（无工具调用）：原样保留
        out.push({ role: "assistant", content: r.content });
        continue;
      }
      // 有 tool_calls：形态必须合法且全部配对，否则孤儿整组丢弃（决策 18）
      const calls = toToolCallRequests(rawCalls);
      if (calls === null) continue;
      if (!calls.every((c) => toolResults.has(c.id))) continue;
      out.push({ role: "assistant", content: r.content, tool_calls: calls });
      for (const c of calls) {
        out.push({ role: "tool", content: toolResults.get(c.id) ?? "", tool_call_id: c.id });
      }
      continue;
    }
    // role === "tool"：仅作为上面 assistant 的结果被引用；孤儿在此自然丢弃
  }
  return out;
}

/** 追加一条运行时消息（纯函数，返回新数组，不修改入参） */
export function appendMessage(session: SessionState, message: SessionMessage): SessionState {
  return [...session, message];
}

/**
 * 滑动窗口成对裁剪（决策 18：tool_call 与对应 tool_result **同裁同留**）。
 * 以「配对块」为单位从尾部保留，最多 maxCount 条：
 * - 窗口边界恰在 tool 消息处时**不拆对**——放不下的块整块丢弃（宁可窗口略小，不拆散配对）
 * - 裁剪前先经 toBlocks 清理孤儿（孤儿半对整对丢弃，不进入窗口）
 * - 输出不含孤儿；末条约束（末条必须 user/tool）由 buildPayload 统一兜底修正
 */
export function trimSession(session: SessionState, maxCount: number): SessionState {
  if (maxCount <= 0) return [];
  const blocks = toBlocks(session);
  const kept: SessionMessage[] = [];
  // 从尾部向前累计；放不下的块整块跳过（同裁同留，不拆对）
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.messages.length + kept.length > maxCount) continue;
    kept.unshift(...block.messages);
    if (kept.length >= maxCount) break;
  }
  return kept;
}

/**
 * 输出喂回模型的 messages 数组（决策 18 末条约束的最终防御）。
 * 末条**必须**是 user 或 tool 消息——assistant 结尾 DeepSeek 直接拒绝。
 * 修正策略（最简防御）：从尾部丢弃连续的 assistant 消息。tool 消息的配对 assistant
 * 位于其**前方**，丢弃尾部 assistant 不会产生新孤儿；带 tool_calls 的 assistant 若以
 * 结尾出现（典型：失败轮半条产物），其 tool 结果本就不存在，整条丢弃即「失败轮半条
 * assistant 不喂回」。输入应为 loadHistory / trimSession 处理过的无孤儿序列；
 * 返回空数组时调用方（S7.3）应视为无有效上下文（需重新引导用户输入）。
 */
export function buildPayload(session: SessionState): LLMMessage[] {
  let messages = session;
  while (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
    messages = messages.slice(0, -1);
  }
  return messages;
}

/**
 * 重试 payload 复用（决策 18 末条约束补充，S7.3 主循环消费）。
 * 模型调用失败重试时**必须复用原请求的 messages 数组**——绝不追加失败轮的半条
 * assistant 产物（失败轮未产出完整回复，其内容不入重试序列）。
 * 本函数返回原数组的浅拷贝，防御调用方原地修改；调用方直接传原 payload 亦等效。
 */
export function retryPayload(payload: LLMMessage[]): LLMMessage[] {
  return payload.slice();
}

/** 服务重启续聊组合入口：加载历史 → 成对裁剪（喂回格式由 buildPayload 兜底） */
export function restoreSession(rows: ChatMessageRow[], maxCount: number): SessionState {
  return trimSession(loadHistory(rows), maxCount);
}
