// 对话历史路由测试（U3 切片 1）：GET /api/v1/chat/sessions 会话列表、GET /api/v1/chat/sessions/:id/messages 消息历史
// 覆盖：项目隔离（proj-a 消息不出现在 proj-b）、空项目空数组、created_at 升序、
//   tool/assistant 消息工具字段（toolCallId/toolCalls）、lastMessage 截断（50 字符）、
//   会话倒序、无当前项目 409、跨项目取消息空数组（不泄露存在性）
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { insertChatMessage } from "@ai-editor/db";
import { errorHandler } from "../middleware/error.js";
import {
  closeProject,
  getCurrentProject,
  initProject,
  originCheckMiddleware,
  projectMiddleware,
  setCurrentProject,
  type ProjectContext,
} from "../middleware/project.js";
import { chatRoutes } from "./chat.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "chat-"));
  tmpDirs.push(dir);
  return dir;
}

function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/chat", chatRoutes);
  return app;
}

/** 打开新项目并设为当前项目（每次 initProject 生成独立 project_id，天然隔离）
 * 对齐真实 open 路由语义（project.ts：切换单例前释放旧项目连接，避免 fd 泄漏） */
function openProject(): ProjectContext {
  const prev = getCurrentProject();
  if (prev) closeProject(prev);
  const project = initProject(makeTmpDir());
  setCurrentProject(project);
  return project;
}

/** 便捷插入一条消息（时间由调用方给定 ISO 字符串，应用层写入约定） */
function seedMessage(
  project: ProjectContext,
  sessionId: string,
  opts: {
    role: "user" | "assistant" | "tool";
    content?: string;
    toolCalls?: unknown[];
    toolCallId?: string;
    createdAt: string;
  },
): void {
  insertChatMessage(project.db, {
    session_id: sessionId,
    project_id: project.config.id,
    role: opts.role,
    content: opts.content ?? null,
    ...(opts.toolCalls !== undefined ? { tool_calls: opts.toolCalls } : {}),
    ...(opts.toolCallId !== undefined ? { tool_call_id: opts.toolCallId } : {}),
    created_at: opts.createdAt,
  });
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-chat-"));
  setCurrentProject(null);
});

afterEach(() => {
  const cur = getCurrentProject();
  if (cur !== null) {
    closeProject(cur);
    setCurrentProject(null);
  }
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ============ GET /api/v1/chat/sessions ============

describe("GET /chat/sessions 会话列表", () => {
  it("无当前项目 → 409 NO_PROJECT_OPEN", async () => {
    const res = await buildApp().request("/api/v1/chat/sessions", { headers: HOST_HEADERS });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_PROJECT_OPEN");
  });

  it("空项目 → 200 { sessions: [] }", async () => {
    openProject();
    const res = await buildApp().request("/api/v1/chat/sessions", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { sessions: [] } });
  });

  it("camelCase 全字段 + 按最后活动倒序 + lastMessage 截断（50 字符）", async () => {
    const project = openProject();
    // sess-a：1 条消息（10:00），lastMessage 超长触发截断
    const longText = "甲".repeat(60);
    seedMessage(project, "sess-a", { role: "user", content: longText, createdAt: "2026-08-01T10:00:00Z" });
    // sess-b：2 条消息（10:02 / 10:05，最后活动更晚 → 排在前）
    seedMessage(project, "sess-b", { role: "user", content: "b-1", createdAt: "2026-08-01T10:02:00Z" });
    seedMessage(project, "sess-b", { role: "assistant", content: "b-2", createdAt: "2026-08-01T10:05:00Z" });

    const res = await buildApp().request("/api/v1/chat/sessions", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.sessions.map((s: { id: string }) => s.id)).toEqual(["sess-b", "sess-a"]);
    expect(data.sessions[0]).toEqual({
      id: "sess-b",
      lastMessage: "b-2",
      messageCount: 2,
      createdAt: "2026-08-01T10:02:00Z",
      updatedAt: "2026-08-01T10:05:00Z",
    });
    // 截断：总长（含省略号）≤ 50，即前 49 字符 + …
    expect(data.sessions[1].lastMessage).toBe(`${"甲".repeat(49)}…`);
    expect(data.sessions[1].lastMessage).toHaveLength(50);
    expect(data.sessions[1].messageCount).toBe(1);
  });

  it("项目隔离：proj-a 的会话不出现在 proj-b（决策 18）", async () => {
    const projectA = openProject();
    seedMessage(projectA, "sess-a", { role: "user", content: "仅属于 A", createdAt: "2026-08-01T10:00:00Z" });

    // 切换到项目 B（新 initProject → 新 project_id）
    openProject();
    const res = await buildApp().request("/api/v1/chat/sessions", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ sessions: [] });
  });
});

// ============ GET /api/v1/chat/sessions/:id/messages ============

describe("GET /chat/sessions/:id/messages 消息历史", () => {
  it("无当前项目 → 409 NO_PROJECT_OPEN", async () => {
    const res = await buildApp().request("/api/v1/chat/sessions/sess-x/messages", { headers: HOST_HEADERS });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_PROJECT_OPEN");
  });

  it("created_at 升序 + camelCase 全字段（toolCallId / toolCalls 配对语义）", async () => {
    const project = openProject();
    seedMessage(project, "sess-1", { role: "user", content: "你好", createdAt: "2026-08-01T10:00:00Z" });
    seedMessage(project, "sess-1", {
      role: "assistant",
      content: "正在查询",
      toolCalls: [{ id: "call_1", name: "list_entities", arguments: "{}" }],
      createdAt: "2026-08-01T10:01:00Z",
    });
    seedMessage(project, "sess-1", {
      role: "tool",
      content: "查询结果",
      toolCallId: "call_1",
      createdAt: "2026-08-01T10:02:00Z",
    });

    const res = await buildApp().request("/api/v1/chat/sessions/sess-1/messages", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.sessionId).toBe("sess-1");
    expect(data.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "tool"]);
    // 契约 parse 剥离 db 附加字段（sessionId/projectId）；null 保留（toolCallId 列缺省）
    expect(data.messages[0]).toEqual({
      id: expect.any(String),
      role: "user",
      content: "你好",
      toolCallId: null,
      createdAt: "2026-08-01T10:00:00Z",
    });
    expect(data.messages[1]).toEqual({
      id: expect.any(String),
      role: "assistant",
      content: "正在查询",
      toolCalls: [{ id: "call_1", name: "list_entities", arguments: "{}" }],
      toolCallId: null,
      createdAt: "2026-08-01T10:01:00Z",
    });
    expect(data.messages[2]).toEqual({
      id: expect.any(String),
      role: "tool",
      content: "查询结果",
      toolCallId: "call_1",
      createdAt: "2026-08-01T10:02:00Z",
    });
  });

  it("跨项目取消息 → 200 空数组（sessionId 回显，不泄露存在性）", async () => {
    const projectA = openProject();
    seedMessage(projectA, "sess-a", { role: "user", content: "仅属于 A", createdAt: "2026-08-01T10:00:00Z" });

    // 切到项目 B 后按 A 的 session_id 取消息
    openProject();
    const res = await buildApp().request("/api/v1/chat/sessions/sess-a/messages", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { sessionId: "sess-a", messages: [] } });
  });

  it("会话不存在 → 200 空数组（endpoints.md 未定义 404 语义）", async () => {
    openProject();
    const res = await buildApp().request("/api/v1/chat/sessions/sess-ghost/messages", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ sessionId: "sess-ghost", messages: [] });
  });
});
