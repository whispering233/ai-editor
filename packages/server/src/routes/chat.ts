// 对话历史路由（U3 切片 1）：GET /api/v1/chat/sessions、GET /api/v1/chat/sessions/:id/messages
//
// 契约来源：doc/api/endpoints.md 第 795-834 行（会话列表 / 消息历史）、
//   doc/design/decisions.md 决策 18（chat_messages 持久化、会话按 project_id 隔离）。
// 本切片只实现只读两个 GET；POST /（POST + SSE 对话端点）属后续切片（S7），此处不实现。
//
// 语义约定：
//   - 会话不存在 / 无消息 / 属于其他项目 → 200 空数组（endpoints.md 未定义 404 语义，
//     与 db 层 listMessages 行为一致——跨项目取消息不泄露存在性）
//   - 无当前项目 → 409 NO_PROJECT_OPEN（requireCurrentProject，与其他业务路由一致）
//   - 响应契约自检：经 shared Zod schema parse；失败是服务端 bug → 500（参照 project.ts
//     listResponse 语义，避免被 errorHandler 误判为入参 400 VALIDATION_ERROR）
import { Hono, type Context } from "hono";
import { listMessages, listSessions } from "@ai-editor/db";
import type { ChatMessage, ChatSessionSummary } from "@ai-editor/shared";
import { chatMessagesResSchema, chatSessionsResSchema } from "@ai-editor/shared/schemas";
import { HttpError, ok } from "../middleware/error.js";
import { requireCurrentProject } from "../middleware/project.js";

/** 对话路由（挂载于 /api/v1/chat，index.ts） */
export const chatRoutes = new Hono();

// GET /api/v1/chat/sessions —— 会话列表（endpoints.md 第 795-811 行）
// listSessions 已按项目隔离（project_id）并返回 camelCase 摘要
// （id/lastMessage/messageCount/createdAt/updatedAt，按最后活动倒序）；
// lastMessage 截断（50 字符，SESSION_LAST_MESSAGE_MAX_LEN）已在 db 查询内完成。
chatRoutes.get("/sessions", (c) => {
  const project = requireCurrentProject();
  return sessionsResponse(c, listSessions(project.db, project.config.id));
});

// GET /api/v1/chat/sessions/:id/messages —— 指定会话消息历史（endpoints.md 第 813-834 行）
// listMessages 已按项目隔离并按 created_at 升序返回 camelCase 消息：
// tool 消息带 toolCallId、assistant 消息带 toolCalls（决策 18 修订配对语义）。
chatRoutes.get("/sessions/:id/messages", (c) => {
  const project = requireCurrentProject();
  const sessionId = c.req.param("id");
  return messagesResponse(c, sessionId, listMessages(project.db, sessionId, project.config.id));
});

/**
 * sessions 响应契约自检出口（参照 project.ts listResponse）：
 * parse 失败 = 服务端构造的响应不符合 shared 契约（服务端 bug），转 500 INTERNAL_ERROR；
 * 不让 ZodError 冒泡——否则 errorHandler 会按入参语义误报 400 VALIDATION_ERROR。
 */
function sessionsResponse(c: Context, sessions: ChatSessionSummary[]): Response {
  try {
    return c.json(ok(chatSessionsResSchema.parse({ sessions })));
  } catch (err) {
    throw new HttpError(
      500,
      "INTERNAL_ERROR",
      `sessions 响应不符合契约: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** messages 响应契约自检出口（同上；db 消息含 sessionId/projectId 附加字段，parse 按契约剥离） */
function messagesResponse(c: Context, sessionId: string, messages: ChatMessage[]): Response {
  try {
    return c.json(ok(chatMessagesResSchema.parse({ sessionId, messages })));
  } catch (err) {
    throw new HttpError(
      500,
      "INTERNAL_ERROR",
      `messages 响应不符合契约: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
