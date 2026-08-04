// @whispering233/ai-editor-db 对话历史数据层查询（T2.3）
//
// 单一事实来源：doc/database/schema.md（chat_messages 表结构，决策 18）、
// doc/api/endpoints.md（chat/sessions 会话列表、chat/sessions/:id/messages 消息历史）。
// 时间约定（schema.md 第 16 行）：created_at 统一 ISO 8601 字符串、由应用层写入，本模块不生成时间。
// 注意：本模块只处理 chat_messages 表，不涉及会话元数据——会话列表信息（createdAt/updatedAt/
// messageCount/lastMessage）全部由消息行实时聚合得出，无独立会话表。

import { nanoid } from "nanoid";
import { truncate, type ChatMessage, type ChatMessageRow, type ChatRole, type ChatSessionSummary } from "@whispering233/ai-editor-shared";
import type { Db } from "../connection.js";

/** 会话列表 lastMessage 截断长度（endpoints.md 仅要求「截断」，长度为本实现约定，未入文档契约） */
export const SESSION_LAST_MESSAGE_MAX_LEN = 50;

/**
 * 插入一条对话消息。
 *
 * id 生成约定：chat_messages 表 id 无文档前缀（endpoints.md id 约定仅覆盖
 * char-/set-/loc-/hook-、sc-/ch-/vol-、proj- 与运行时 prop_/sess_/call_），
 * 省略 id 时直接用 nanoid 生成（与消息 id 前缀空缺保持一致）。
 *
 * 存储形态转换：row.tool_calls 按 shared 类型契约为「解析后的数组」，
 * 本函数负责 JSON.stringify 落库（列存 TEXT）；created_at 必须由调用方
 * 提供 ISO 8601 字符串（应用层写入，决策 18）。
 */
export function insertChatMessage(
  db: Db,
  row: Pick<ChatMessageRow, "session_id" | "project_id" | "role" | "created_at"> &
    Partial<Pick<ChatMessageRow, "id" | "content" | "tool_calls" | "tool_call_id">>,
): void {
  db.prepare(
    `INSERT INTO chat_messages (id, session_id, project_id, role, content, tool_calls, tool_call_id, created_at)
     VALUES (@id, @session_id, @project_id, @role, @content, @tool_calls, @tool_call_id, @created_at)`,
  ).run({
    id: row.id ?? nanoid(),
    session_id: row.session_id,
    project_id: row.project_id,
    role: row.role,
    content: row.content ?? null,
    tool_calls: row.tool_calls == null ? null : JSON.stringify(row.tool_calls),
    tool_call_id: row.tool_call_id ?? null,
    created_at: row.created_at,
  });
}

/**
 * 会话列表（GET /api/v1/chat/sessions）：
 * - 按 project_id 隔离（决策 18 修订：会话按项目隔离）
 * - 仅返回含消息的会话；updatedAt = 该会话最后一条消息的 created_at
 * - 按最后活动时间（updatedAt）倒序，同时间戳按 session_id 升序保证稳定
 * - lastMessage = 最后一条消息的 content 截断（无 content 时为空串）
 */
export function listSessions(db: Db, projectId: string): ChatSessionSummary[] {
  const rows = db
    .prepare(
      `SELECT
         t.session_id  AS id,
         t.message_count,
         t.created_at,
         t.updated_at,
         (SELECT lm.content FROM chat_messages lm
           WHERE lm.session_id = t.session_id AND lm.project_id = ?
           ORDER BY lm.created_at DESC, lm.rowid DESC LIMIT 1) AS last_content
       FROM (
         SELECT session_id,
                COUNT(*)        AS message_count,
                MIN(created_at) AS created_at,
                MAX(created_at) AS updated_at
         FROM chat_messages
         WHERE project_id = ?
         GROUP BY session_id
       ) t
       ORDER BY t.updated_at DESC, t.session_id ASC`,
    )
    .all(projectId, projectId) as Array<{
    id: string;
    message_count: number;
    created_at: string;
    updated_at: string;
    last_content: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    lastMessage: truncate(r.last_content ?? "", SESSION_LAST_MESSAGE_MAX_LEN),
    messageCount: r.message_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * 解析 chat_messages.tool_calls 的 JSON 文本列为数组（ChatMessage.toolCalls）。
 * 防御性处理：NULL / 非法 JSON / 非数组一律返回 null（视为无工具调用）。
 */
export function parseToolCalls(json: string | null): unknown[] | null {
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // 非法 JSON：按无工具调用处理，不向上抛（查询层不阻断会话恢复）
    return null;
  }
}

/**
 * 消息历史（GET /api/v1/chat/sessions/:id/messages）：
 * - 按 project_id 隔离（决策 18 修订）
 * - 按 created_at 升序，同时间戳按 rowid（插入序）升序保证稳定
 * - 存储形态 → API 形态：tool_calls JSON 解析、tool_call_id → toolCallId、snake_case → camelCase
 */
export function listMessages(db: Db, sessionId: string, projectId: string): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, project_id, role, content, tool_calls, tool_call_id, created_at
       FROM chat_messages
       WHERE session_id = ? AND project_id = ?
       ORDER BY created_at ASC, rowid ASC`,
    )
    .all(sessionId, projectId) as Array<{
    id: string;
    session_id: string;
    project_id: string;
    role: ChatRole;
    content: string | null;
    tool_calls: string | null;
    tool_call_id: string | null;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    projectId: r.project_id,
    role: r.role,
    content: r.content,
    toolCalls: parseToolCalls(r.tool_calls) ?? undefined,
    toolCallId: r.tool_call_id,
    createdAt: r.created_at,
  }));
}

/**
 * 消息历史原始行（S7.6 续聊重建专用）：
 * - listMessages 输出 API 形态（camelCase，供 GET /messages）；本函数输出**存储形态**
 *   （snake_case ChatMessageRow，tool_calls 已解析为数组）——直供 agent 包
 *   loadHistory/restoreSession（决策 18 成对重组），避免 server 层做 API→存储形态反映射。
 * - 查询语义与 listMessages 一致：按 project_id 隔离、created_at 升序 + rowid 稳定序。
 */
export function listMessageRows(db: Db, sessionId: string, projectId: string): ChatMessageRow[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, project_id, role, content, tool_calls, tool_call_id, created_at
       FROM chat_messages
       WHERE session_id = ? AND project_id = ?
       ORDER BY created_at ASC, rowid ASC`,
    )
    .all(sessionId, projectId) as Array<{
    id: string;
    session_id: string;
    project_id: string;
    role: ChatRole;
    content: string | null;
    tool_calls: string | null;
    tool_call_id: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    ...r,
    tool_calls: parseToolCalls(r.tool_calls), // TEXT 列 → 解析后的数组（NULL/损坏 → null）
  }));
}

/** 成对重组后喂给 LLM 的历史消息形态（决策 18 修订：DeepSeek 要求 tool_call 与 tool 结果严格配对） */
export interface ReassembledChatMessage {
  role: ChatRole;
  content?: string | null;
  /** assistant 消息的工具调用数组（仅当该组全部调用均成对成功时保留） */
  toolCalls?: unknown[];
  /** tool 消息关联的调用 id（与所属 assistant 消息 tool_calls[].id 配对） */
  toolCallId?: string | null;
}

/**
 * 成对重组历史消息（决策 18 修订：assistant.tool_calls[].id ↔ tool.tool_call_id 成对重组喂回模型）。
 *
 * 用途：服务重启后凭 session_id 重建「继续上次对话」上下文，或会话级滑动窗口裁剪前的重组。
 * 注意：本函数是纯函数，输入为 ChatMessageRow（tool_calls 已按 shared 类型契约为解析后的数组，
 * 由调用方先经 parseToolCalls / 直接构造）。
 *
 * 算法：
 * 1. 按 created_at 升序稳定排序（同时间戳保持输入顺序）
 * 2. 第一遍收集 tool 消息：tool_call_id → content（同一 id 多条结果取最先到达者，防御性处理）
 * 3. 第二遍顺序扫描：
 *    - user 消息：原样保留
 *    - assistant 消息（无 tool_calls）：原样保留
 *    - assistant 消息（有 tool_calls）：逐个调用校验——任一调用缺 id 或缺对应 tool 结果
 *      即判定为孤儿半对，该 assistant 消息与其工具结果**整组丢弃**（决策 18 修订：
 *      孤儿半对整对丢弃，不返回 409 也不部分保留）；全部配对成功则输出 assistant 消息，
 *      工具结果按 tool_calls 数组顺序紧随其后（tool 消息保留 toolCallId 供模型配对）
 *    - tool 消息：不单独输出——未被任何保留的 assistant 消息引用的即孤儿，整对丢弃
 */
export function reassembleMessages(rows: ChatMessageRow[]): ReassembledChatMessage[] {
  // 1. 按 created_at 升序稳定排序
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));

  // 2. 收集 tool 消息：tool_call_id → content
  const toolResults = new Map<string, string | null>();
  for (const r of sorted) {
    if (r.role === "tool" && r.tool_call_id !== null && !toolResults.has(r.tool_call_id)) {
      toolResults.set(r.tool_call_id, r.content);
    }
  }

  // 3. 顺序扫描重组
  const out: ReassembledChatMessage[] = [];
  for (const r of sorted) {
    if (r.role === "user") {
      out.push({ role: "user", content: r.content });
      continue;
    }
    if (r.role === "assistant") {
      const calls = r.tool_calls ?? [];
      if (calls.length === 0) {
        out.push({ role: "assistant", content: r.content });
        continue;
      }
      const callIds = calls.map((c) => (c as { id?: unknown }).id);
      // 任一调用缺 id 或缺对应结果 → 整组丢弃
      const allPaired = callIds.every(
        (cid): cid is string => typeof cid === "string" && toolResults.has(cid),
      );
      if (!allPaired) continue;
      out.push({ role: "assistant", content: r.content, toolCalls: calls });
      for (const cid of callIds) {
        out.push({ role: "tool", toolCallId: cid, content: toolResults.get(cid) });
      }
      continue;
    }
    // role === "tool"：仅作为上面对应的结果被引用；孤儿在此自然丢弃
  }
  return out;
}
