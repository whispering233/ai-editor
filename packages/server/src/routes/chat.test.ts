// 对话历史路由测试（U3 切片 1 + S7.6）：GET /api/v1/chat/sessions 会话列表、
// GET /api/v1/chat/sessions/:id/messages 消息历史、POST /api/v1/chat（POST + SSE 对话端点）
// U3 覆盖：项目隔离（proj-a 消息不出现在 proj-b）、空项目空数组、created_at 升序、
// tool/assistant 消息工具字段（toolCallId/toolCalls）、lastMessage 截断（50 字符）、
// 会话倒序、无当前项目 409、跨项目取消息空数组（不泄露存在性）
// S7.6 覆盖：请求校验（400/409 开流前 JSON）、事件序列（text→tool_call→tool_result→proposal→
// text→done）、落库配对（user/assistant/tool + tool_calls/tool_call_id）、心跳 ping、
// 断开全链路取消（produce signal abort + 未确认提案作废，B2 取舍 b）、
// 会话重建（session_id 续聊：历史喂回 + 新消息落库 + done 回显）、新建会话 sess_ 前缀、
// 模型最终失败 error 事件、工具定义 → LLM function calling（TypeBox schema 直接透传，35 工具全量）
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { appendSessionMessage, readSessionMessages, writeAgentsFile } from "@whispering233/ai-editor-db";
import { defaultProposalStore, type RunAgentDeps, type ToolDispatcher } from "@whispering233/ai-editor-agent";
import { ABORT_ERROR } from "@whispering233/ai-editor-llm";
import type { AbortSignalLike, LLMMessage } from "@whispering233/ai-editor-llm";
import { getTool, listTools } from "@whispering233/ai-editor-tools";
import type { Proposal } from "@whispering233/ai-editor-tools";
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
import { chatRoutes, createChatRoutes, createLLMRequestLogger, toLLMToolDefinitions } from "./chat.js";
import { initDebugConfig, isCategoryEnabled } from "../debug.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "chat-"));
  tmpDirs.push(dir);
  return dir;
}

/** 组装带中间件的测试 app（可选注入自定义 chat 路由实例——S7.6 测试注入 mock deps） */
function buildApp(routes: Hono = chatRoutes): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/chat", routes);
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

/** 便捷写入一条会话消息（时间由调用方给定 ISO 字符串，应用层写入约定） */
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
  appendSessionMessage(project.root, sessionId, {
    role: opts.role,
    content: opts.content ?? null,
    ...(opts.toolCalls !== undefined ? { tool_calls: opts.toolCalls } : {}),
    ...(opts.toolCallId !== undefined ? { tool_call_id: opts.toolCallId } : {}),
    created_at: opts.createdAt,
  });
}

/** 读回会话消息（API 形态；与 GET /messages 同源映射） */
function readMessages(project: ProjectContext, sessionId: string) {
  return readSessionMessages(project.root, sessionId, project.config.id);
}

/** 构造一条最小 Proposal（S7.6 测试预置提案仓用；结构） */
function seedProposal(project: ProjectContext, proposalId = "prop_seed"): Proposal {
  return {
    proposal_id: proposalId,
    type: "propose_create_entity",
    args: { type: "character", name: "张三" },
    project_id: project.config.id,
    references: [],
    summary: "创建角色",
    createdAt: new Date().toISOString(),
  };
}

/** POST /api/v1/chat 请求构造（JSON 体；POST + SSE 端点） */
function postChat(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { ...HOST_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ============ S7.6 SSE 测试辅助 ============

interface SseFrame {
  event: string;
  data: unknown;
}

/** 解析单个 SSE 帧（event/data 提取；data JSON 解析失败保留原文） */
function parseSseFrame(raw: string): SseFrame | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) {
      let value = line.slice("data:".length);
      if (value.startsWith(" ")) value = value.slice(1);
      dataLines.push(value);
    }
  }
  if (dataLines.length === 0) return null;
  const text = dataLines.join("\n");
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
 // 保留原文（非 JSON data 属异常流，测试中不应出现）
  }
  return { event, data };
}

/** 读取 SSE 响应直至流结束/超时（返回全部帧）；超时兜底 cancel 并吸收挂起 read 的拒绝 */
async function readSseFrames(res: Response, timeoutMs = 5000): Promise<SseFrame[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: SseFrame[] = [];
  let pending: Promise<{ done: boolean; value?: Uint8Array }> | null = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    pending = reader.read();
    const remaining = deadline - Date.now();
    const timer = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), Math.max(remaining, 1)));
    const out = await Promise.race([pending, timer]);
    if (out === "timeout") break;
    if (out.done) break;
    buffer += decoder.decode(out.value as Uint8Array, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const frame = parseSseFrame(raw);
      if (frame) frames.push(frame);
    }
  }
  await reader.cancel().catch(() => {});
  await pending?.catch(() => {}); // 吸收 cancel 引起的挂起 read 拒绝（unhandled rejection 防御）
  return frames;
}

/** 轮询等待条件成立（mock 信号就绪 / 取消传播断言用） */
async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("waitFor 超时");
    await new Promise((r) => setTimeout(r, 10));
  }
}

let originalHome: string | undefined;
let originalKey: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-chat-"));
  setCurrentProject(null);
  defaultProposalStore.clear(); // 提案仓为模块级单例（S7.4），测试间隔离（proposal.test.ts 同款）
 // 用户级配置与 key 隔离（key 来源；settings.test.ts 同款临时 HOME 策略）——
 // 保证 effectiveApiKey 在测试内确定（无 key），S7.6 缺 key 用例可稳定复现
  originalHome = process.env.HOME;
  originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.HOME = tmpRoot;
  delete process.env.DEEPSEEK_API_KEY;
  initDebugConfig(undefined); // 调试默认全关（无配置文件）——「关闭零开销」用例确定性依赖此重置
});

afterEach(() => {
  const cur = getCurrentProject();
  if (cur !== null) {
    closeProject(cur);
    setCurrentProject(null);
  }
  defaultProposalStore.clear();
  vi.restoreAllMocks(); // 还原 console.debug spy 等（调试日志用例）
  initDebugConfig(undefined); // 回全关态（防配置态泄漏到后续用例）
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalKey !== undefined) process.env.DEEPSEEK_API_KEY = originalKey;
  else delete process.env.DEEPSEEK_API_KEY;
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
 // sess_a：1 条消息（10:00），lastMessage 超长触发截断
    const longText = "甲".repeat(60);
    seedMessage(project, "sess_a", { role: "user", content: longText, createdAt: "2026-08-01T10:00:00Z" });
 // sess_b：2 条消息（10:02 / 10:05，最后活动更晚 → 排在前）
    seedMessage(project, "sess_b", { role: "user", content: "b-1", createdAt: "2026-08-01T10:02:00Z" });
    seedMessage(project, "sess_b", { role: "assistant", content: "b-2", createdAt: "2026-08-01T10:05:00Z" });

    const res = await buildApp().request("/api/v1/chat/sessions", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.sessions.map((s: { id: string }) => s.id)).toEqual(["sess_b", "sess_a"]);
    expect(data.sessions[0]).toEqual({
      id: "sess_b",
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

  it("项目隔离：proj-a 的会话不出现在 proj-b", async () => {
    const projectA = openProject();
    seedMessage(projectA, "sess_a", { role: "user", content: "仅属于 A", createdAt: "2026-08-01T10:00:00Z" });

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
    const res = await buildApp().request("/api/v1/chat/sessions/sess_x/messages", { headers: HOST_HEADERS });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_PROJECT_OPEN");
  });

  it("created_at 升序 + camelCase 全字段（toolCallId / toolCalls 配对语义）", async () => {
    const project = openProject();
    seedMessage(project, "sess_1", { role: "user", content: "你好", createdAt: "2026-08-01T10:00:00Z" });
    seedMessage(project, "sess_1", {
      role: "assistant",
      content: "正在查询",
      toolCalls: [{ id: "call_1", name: "list_entities", arguments: "{}" }],
      createdAt: "2026-08-01T10:01:00Z",
    });
    seedMessage(project, "sess_1", {
      role: "tool",
      content: "查询结果",
      toolCallId: "call_1",
      createdAt: "2026-08-01T10:02:00Z",
    });

    const res = await buildApp().request("/api/v1/chat/sessions/sess_1/messages", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.sessionId).toBe("sess_1");
    expect(data.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "tool"]);
 // parse 剥离 db 附加字段（sessionId/projectId）；null 保留（toolCallId 列缺省）
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
    seedMessage(projectA, "sess_a", { role: "user", content: "仅属于 A", createdAt: "2026-08-01T10:00:00Z" });

 // 切到项目 B 后按 A 的 session_id 取消息
    openProject();
    const res = await buildApp().request("/api/v1/chat/sessions/sess_a/messages", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { sessionId: "sess_a", messages: [] } });
  });

  it("会话不存在 → 200 空数组", async () => {
    openProject();
    const res = await buildApp().request("/api/v1/chat/sessions/sess_ghost/messages", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ sessionId: "sess_ghost", messages: [] });
  });

  it("非法 session_id（不匹配 sess_ 白名单）→ 200 空数组（不泄露、不 500、不碰文件系统）", async () => {
    const project = openProject();
 // 该 id 会作文件名：含 `sess_` 前缀的硬校验拦下（绝不清洗后拼接，防路径穿越）
    seedMessage(project, "sess_ok", { role: "user", content: "正常会话", createdAt: "2026-08-01T10:00:00Z" });
 // 注：`%2e%2e` 形态在路由层就被规范化成 `..`（不匹配本路由 → 404），到不了处理器
    for (const bad of ["bad-id", "sess-a", "sess_"]) {
      const res = await buildApp().request(`/api/v1/chat/sessions/${bad}/messages`, { headers: HOST_HEADERS });
      expect(res.status, `id=${bad}`).toBe(200);
      expect((await res.json()).data.messages, `id=${bad}`).toEqual([]);
    }
 // 合法会话不受影响
    const ok = await buildApp().request("/api/v1/chat/sessions/sess_ok/messages", { headers: HOST_HEADERS });
    expect((await ok.json()).data.messages).toHaveLength(1);
  });
});

// ============ DELETE /api/v1/chat/sessions/:id（B3：物理删除会话） ============
// 校验顺序硬约定：id 形态（作文件名，防穿越）→ 在途流（防僵尸会话）→ 文件存在性

describe("DELETE /chat/sessions/:id", () => {
  it("无当前项目 → 409 NO_PROJECT_OPEN", async () => {
    const res = await buildApp().request("/api/v1/chat/sessions/sess_x", {
      method: "DELETE",
      headers: HOST_HEADERS,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_PROJECT_OPEN");
  });

  it("session_id 形态非法 → 400 VALIDATION_ERROR（绝不清洗后拼路径）", async () => {
    openProject();
    for (const bad of ["bad-id", "sess-a", "sess_", `sess_${"a".repeat(65)}`, "sess_ok/x", "sess_ok!x"]) {
      const res = await buildApp().request(`/api/v1/chat/sessions/${encodeURIComponent(bad)}`, {
        method: "DELETE",
        headers: HOST_HEADERS,
      });
      expect(res.status, `id=${bad}`).toBe(400);
      expect((await res.json()).error.code, `id=${bad}`).toBe("VALIDATION_ERROR");
    }
  });

  it("会话不存在 → 404 SESSION_NOT_FOUND", async () => {
    openProject();
    const res = await buildApp().request("/api/v1/chat/sessions/sess_ghost", {
      method: "DELETE",
      headers: HOST_HEADERS,
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("SESSION_NOT_FOUND");
  });

  it("存在 → 200 { deleted: true }：文件消失 + 列表不再收录 + 重复删除 404", async () => {
    const project = openProject();
    seedMessage(project, "sess_del", { role: "user", content: "待删除", createdAt: "2026-08-01T10:00:00Z" });
    const file = join(project.root, "sessions", "sess_del.jsonl");
    expect(existsSync(file)).toBe(true);

    const res = await buildApp().request("/api/v1/chat/sessions/sess_del", {
      method: "DELETE",
      headers: HOST_HEADERS,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ deleted: true });
    expect(existsSync(file)).toBe(false); // 物理删（无软删/回收站）

    const list = await buildApp().request("/api/v1/chat/sessions", { headers: HOST_HEADERS });
    expect((await list.json()).data.sessions).toEqual([]);

    const again = await buildApp().request("/api/v1/chat/sessions/sess_del", {
      method: "DELETE",
      headers: HOST_HEADERS,
    });
    expect(again.status).toBe(404);
  });

  it("在途流 → 409 SESSION_BUSY；流结束后同一会话可删（200）", async () => {
    const project = openProject();
    seedMessage(project, "sess_busy", { role: "user", content: "历史", createdAt: "2026-08-01T10:00:00Z" });

 // mock produce：挂起直到测试放行（模拟流仍在生成中）
    let release: (() => void) | null = null;
    let started = false;
    const produce = vi.fn<RunAgentDeps["produce"]>(async () => {
      started = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ok: true, stopReason: "stop", usage: null };
    });

    const res = await buildApp(createChatRoutes({ produce })).request(
      "/api/v1/chat",
      postChat({ message: "你好", session_id: "sess_busy" }),
    );
    await waitFor(() => started); // 流已进入 produce（在途登记已生效）

    const busy = await buildApp().request("/api/v1/chat/sessions/sess_busy", {
      method: "DELETE",
      headers: HOST_HEADERS,
    });
    expect(busy.status).toBe(409);
    expect((await busy.json()).error.code).toBe("SESSION_BUSY");
    expect(existsSync(join(project.root, "sessions", "sess_busy.jsonl"))).toBe(true); // 未被删

 // 放行并读到流结束：客户端见到 EOF ⇒ 服务端回调已退出 ⇒ finally 已注销登记（确定性，无需轮询）
    release?.();
    await readSseFrames(res);

    const afterDone = await buildApp().request("/api/v1/chat/sessions/sess_busy", {
      method: "DELETE",
      headers: HOST_HEADERS,
    });
    expect(afterDone.status).toBe(200);
    expect((await afterDone.json()).data).toEqual({ deleted: true });
    expect(existsSync(join(project.root, "sessions", "sess_busy.jsonl"))).toBe(false);
  });
});

// ============ POST /api/v1/chat（S7.6：POST + SSE 对话端点） ============
// 测试策略：createChatRoutes(deps) 注入 mock produce/dispatcher——不经真实 DeepSeek，
// runAgent（S7.3 已单测）作为黑盒消费，本层断言 SSE 帧序列 / 落库 / 取消链路 / 心跳。

describe("POST /chat 请求校验（开流前 JSON 错误，非 SSE）", () => {
  it("无当前项目 → 409 NO_PROJECT_OPEN", async () => {
    const res = await buildApp(createChatRoutes({ produce: vi.fn() })).request("/api/v1/chat", postChat({ message: "你好" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_PROJECT_OPEN");
  });

  it("请求体非法（缺 message / 未知字段）→ 400 VALIDATION_ERROR", async () => {
    openProject();
    const res = await buildApp(createChatRoutes({ produce: vi.fn() })).request(
      "/api/v1/chat",
      postChat({ context: { focus_node_id: "sc-1" } }), // 缺 message
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields).toContain("message");
  });

  it("未配置 DeepSeek key → 400 LLM_API_KEY_MISSING（隔离 HOME 无 key）", async () => {
    openProject();
    const res = await buildApp(createChatRoutes({})).request("/api/v1/chat", postChat({ message: "你好" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("LLM_API_KEY_MISSING");
  });
});

describe("POST /chat SSE 事件序列与落库", () => {
  it("text → tool_call → tool_result → proposal → text → done 全序列 + 帧形态", async () => {
    const project = openProject();
 // mock produce：第 1 轮流式输出文本 + 一个工具调用；第 2 轮纯文本收尾
 // （显式泛型 vi.fn<RunAgentDeps["produce"]> 使返回字面量保持 ok:true 字面类型——ChatStreamResult 判别联合）
    const produce = vi.fn<RunAgentDeps["produce"]>(async (_messages, _signal, onEvent) => {
      if (produce.mock.calls.length === 1) {
        onEvent?.({ type: "text", delta: "第一段" });
        onEvent?.({ type: "text", delta: "第二段" });
        onEvent?.({
          type: "tool_call",
          toolCall: {
            id: "call_1",
            name: "propose_create_entity",
            rawArguments: JSON.stringify({ type: "character", name: "张三" }),
            arguments: { type: "character", name: "张三" },
          },
        });
        return { ok: true, stopReason: "tool_calls", usage: null };
      }
      onEvent?.({ type: "text", delta: "完成" });
      return { ok: true, stopReason: "stop", usage: null };
    });
 // mock dispatcher：按输入序返回（含提案——触发 proposal 事件，顺序在 tool_result 后）
    const dispatcher = vi.fn<ToolDispatcher>(async (calls) =>
      calls.map((call) => ({
        id: call.id,
        tool: call.tool,
        ok: true,
        isError: false,
        content: JSON.stringify({ proposal_id: "prop_1", summary: "创建角色张三" }),
        proposal: {
          proposal_id: "prop_1",
          type: "propose_create_entity",
          preview: { type: "propose_create_entity", summary: "创建角色张三", args: { type: "character", name: "张三" } },
        },
      })),
    );

    const res = await buildApp(createChatRoutes({ produce, dispatcher })).request(
      "/api/v1/chat",
      postChat({ message: "你好" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const frames = await readSseFrames(res);
 // 事件proposal 在对应 tool_result 之后、循环继续之前
    expect(frames.map((f) => f.event)).toEqual(["text", "text", "tool_call", "tool_result", "proposal", "text", "done"]);
    expect(frames[0].data).toEqual({ delta: "第一段" });
    expect(frames[1].data).toEqual({ delta: "第二段" });
    expect(frames[2].data).toEqual({ tool: "propose_create_entity", args: { type: "character", name: "张三" }, id: "call_1" });
    expect(frames[3].data).toEqual({
      tool: "propose_create_entity",
      result: JSON.stringify({ proposal_id: "prop_1", summary: "创建角色张三" }),
      id: "call_1",
    });
    expect(frames[4].data).toEqual({
      proposal_id: "prop_1",
      type: "propose_create_entity",
      preview: { type: "propose_create_entity", summary: "创建角色张三", args: { type: "character", name: "张三" } },
    });
    expect(frames[5].data).toEqual({ delta: "完成" });
    const done = frames[6].data as { session_id: string };
    expect(done.session_id).toMatch(/^sess_/); // 新建会话（id 约定）

 // 落库：user（路由层）+ assistant/tool（onMessages 层）配对字段
    const msgs = readMessages(project, done.session_id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(msgs[0].content).toBe("你好");
    expect(msgs[1].content).toBe("第一段第二段"); // 流式 delta 累积
 // assistant.tool_calls 存 wire 形态（配对依赖 id ↔ tool.tool_call_id）
    expect(msgs[1].toolCalls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "propose_create_entity", arguments: JSON.stringify({ type: "character", name: "张三" }) },
      },
    ]);
    expect(msgs[2].toolCallId).toBe("call_1");
    expect(msgs[3].content).toBe("完成");
    expect(msgs[3].toolCalls).toBeUndefined();
  });

  it("无 session_id → 新建 sess_ 会话，用户消息落库", async () => {
    const project = openProject();
    const produce = vi.fn<RunAgentDeps["produce"]>(async () => ({ ok: true, stopReason: "stop", usage: null }));
    const res = await buildApp(createChatRoutes({ produce })).request("/api/v1/chat", postChat({ message: "你好" }));
    const frames = await readSseFrames(res);
    const sessionId = (frames[0].data as { session_id: string }).session_id;
    expect(sessionId).toMatch(/^sess_/);
    const msgs = readMessages(project, sessionId);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[0].content).toBe("你好");
  });

  it("非法 session_id → 视为未提供（新建会话落库，不按该值拼路径）", async () => {
    const project = openProject();
    const produce = vi.fn<RunAgentDeps["produce"]>(async () => ({ ok: true, stopReason: "stop", usage: null }));
    const res = await buildApp(createChatRoutes({ produce })).request(
      "/api/v1/chat",
      postChat({ message: "你好", session_id: "../../etc/passwd" }),
    );
    const frames = await readSseFrames(res);
    const sessionId = (frames[0].data as { session_id: string }).session_id;
    expect(sessionId).toMatch(/^sess_/); // 新建，而非回显非法值
    expect(sessionId).not.toContain("..");
    expect(readMessages(project, sessionId).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("模型最终失败（配额类，不可重试）→ error 事件后流关闭（无 done）", async () => {
    openProject();
    const produce = vi.fn<RunAgentDeps["produce"]>(async () => ({
      ok: false,
      aborted: false,
      error: { status: 402, code: "insufficient_quota", message: "余额不足" },
    }));
    const res = await buildApp(createChatRoutes({ produce })).request("/api/v1/chat", postChat({ message: "你好" }));
    const frames = await readSseFrames(res);
 // error 后流立即关闭：只此一帧
    expect(frames).toEqual([{ event: "error", data: { code: "insufficient_quota", message: "余额不足" } }]);
  });

  it("单条工具结果超上限：tool_result 帧为截断内容 + 含提示，对话继续到 done（不发 error）", async () => {
    openProject();
    const huge = "x".repeat(40_000); // 10k tokens > 缺省上限 8000
    const produce = vi.fn<RunAgentDeps["produce"]>(async (_m, _s, onEvent) => {
      if (produce.mock.calls.length === 1) {
        onEvent?.({
          type: "tool_call",
          toolCall: { id: "call_big", name: "list_entities", rawArguments: "{}", arguments: {} },
        });
        return { ok: true, stopReason: "tool_calls", usage: null };
      }
      onEvent?.({ type: "text", delta: "数据不全，我缩小范围" });
      return { ok: true, stopReason: "stop", usage: null };
    });
    const dispatcher = vi.fn<ToolDispatcher>(async (calls) =>
      calls.map((call) => ({ id: call.id, tool: call.tool, ok: true, isError: false, content: huge })),
    );
    const res = await buildApp(createChatRoutes({ produce, dispatcher })).request(
      "/api/v1/chat",
      postChat({ message: "列一下所有实体" }),
    );
    const frames = await readSseFrames(res);
    const toolFrame = frames.find((f) => f.event === "tool_result");
    const result = (toolFrame?.data as { result?: string } | undefined)?.result ?? "";
    expect(result).toContain("[结果已截断：超出 token 预算，数据不完整");
    expect(result.length).toBeLessThan(huge.length);
 // 截断是降级：无 error 帧，正常收尾
    expect(frames.some((f) => f.event === "error")).toBe(false);
    expect(frames[frames.length - 1].event).toBe("done");
  });
});

describe("POST /chat 心跳与断开取消", () => {
  it("心跳：随机间隔 ping（注入毫秒级）先于 done 到达", async () => {
    openProject();
    const produce = vi.fn<RunAgentDeps["produce"]>(async () => {
      await new Promise((r) => setTimeout(r, 200)); // 挂起 200ms 让心跳触发多轮
      return { ok: true, stopReason: "stop", usage: null };
    });
    const res = await buildApp(createChatRoutes({ produce, heartbeat: { minMs: 40, maxMs: 40 } })).request(
      "/api/v1/chat",
      postChat({ message: "你好" }),
    );
    const frames = await readSseFrames(res);
    const pingIdx = frames.findIndex((f) => f.event === "ping");
    expect(pingIdx).toBeGreaterThanOrEqual(0);
    expect(frames[pingIdx].data).toEqual({}); // ping 空 payload
    const doneIdx = frames.findIndex((f) => f.event === "done");
    expect(pingIdx).toBeLessThan(doneIdx);
  });

  it("断开 → 全链路取消（produce 收到 abort）+ 未确认提案作废（B2 取舍 b）", async () => {
    const project = openProject();
    defaultProposalStore.set(seedProposal(project)); // 预置本会话产生的未确认提案
    expect(defaultProposalStore.size()).toBe(1);

 // mock produce：等待 abort 后返回 aborted 结果（模拟 DeepSeek fetch 被取消的 resolve 形态）
 // 注：`null as AbortSignalLike | null`——TS 5.9 对 let 初始化收紧为 null 字面量，
 // 直接 `= null` 会让后续 `attemptSignal?.aborted` 在 never 上报错（闭包赋值不参与窄化）
    let attemptSignal: AbortSignalLike | null = null as AbortSignalLike | null;
    const produce = vi.fn<RunAgentDeps["produce"]>(async (_messages, signal) => {
      attemptSignal = signal ?? null;
      await new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return { ok: false, aborted: true, error: ABORT_ERROR };
    });

    const res = await buildApp(createChatRoutes({ produce })).request("/api/v1/chat", postChat({ message: "你好" }));
    const reader = res.body!.getReader();
    try {
      await waitFor(() => attemptSignal !== null); // 等 runAgent 开始调用 produce
      expect(attemptSignal?.aborted).toBe(false);
      await reader.cancel(); // 模拟客户端断开：响应流 cancel → stream.onAbort → controller.abort()
      await waitFor(() => attemptSignal?.aborted === true); // 取消信号穿透到 produce（四层之①）
    } finally {
      await reader.cancel().catch(() => {});
    }
    expect(produce).toHaveBeenCalled();
 // agent 终止后路由按取舍 b 全量清空提案仓（未确认提案随会话取消作废）
    await waitFor(() => defaultProposalStore.size() === 0);
    expect(defaultProposalStore.size()).toBe(0);
  });
});

describe("POST /chat 会话重建（续聊）", () => {
  it("session_id 提供 → 历史加载喂回 produce + 新消息落库 + done 回显 session_id", async () => {
    const project = openProject();
    seedMessage(project, "sess_old", { role: "user", content: "旧消息一", createdAt: "2026-08-01T10:00:00Z" });
    seedMessage(project, "sess_old", { role: "assistant", content: "旧回复", createdAt: "2026-08-01T10:01:00Z" });

 // `null as LLMMessage[] | null`：同 attemptSignal 的 TS 5.9 收紧问题（闭包赋值不参与窄化）
    let captured: LLMMessage[] | null = null as LLMMessage[] | null;
    const produce = vi.fn<RunAgentDeps["produce"]>(async (messages) => {
      captured = messages;
      return { ok: true, stopReason: "stop", usage: null };
    });
    const res = await buildApp(createChatRoutes({ produce })).request(
      "/api/v1/chat",
      postChat({ message: "新消息", session_id: "sess_old" }),
    );
    const frames = await readSseFrames(res);
    expect(frames.map((f) => f.event)).toEqual(["done"]);
    expect((frames[0].data as { session_id: string }).session_id).toBe("sess_old");
 // 喂回形态（S7.2）：system + 旧历史（loadHistory 重组）+ 本轮新消息（runAgent 追加）
    expect(captured?.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect((captured?.[1] as { content: string }).content).toBe("旧消息一");
    expect((captured?.[2] as { content: string }).content).toBe("旧回复");
    expect((captured?.[3] as { content: string }).content).toBe("新消息");
 // 落库：原 2 条 + 用户消息 + assistant 回复
    const msgs = readMessages(project, "sess_old");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(msgs[2].content).toBe("新消息");
  });

  it("跨项目 session_id → 空历史续聊（不泄露存在性，与 GET /messages 同语义）", async () => {
    const projectA = openProject();
    seedMessage(projectA, "sess_a", { role: "user", content: "仅属于 A", createdAt: "2026-08-01T10:00:00Z" });
    openProject(); // 切到项目 B

    let captured: LLMMessage[] | null = null as LLMMessage[] | null;
    const produce = vi.fn<RunAgentDeps["produce"]>(async (messages) => {
      captured = messages;
      return { ok: true, stopReason: "stop", usage: null };
    });
    const res = await buildApp(createChatRoutes({ produce })).request(
      "/api/v1/chat",
      postChat({ message: "B 的新消息", session_id: "sess_a" }),
    );
    const frames = await readSseFrames(res);
    expect((frames[0].data as { session_id: string }).session_id).toBe("sess_a");
 // 历史为空：只有 system + 本轮新消息（A 的历史不可见）
    expect(captured?.map((m) => m.role)).toEqual(["system", "user"]);
    expect((captured?.[1] as { content: string }).content).toBe("B 的新消息");
  });
});

describe("POST /chat 项目规则注入", () => {
  it("AGENTS.md 存在 → system 消息含「## 项目设定」段（内容原样注入）", async () => {
    const project = openProject();
    writeAgentsFile(project.root, "力量体系：练气→筑基→金丹");

    let captured: LLMMessage[] | null = null as LLMMessage[] | null;
    const produce = vi.fn<RunAgentDeps["produce"]>(async (messages) => {
      captured = messages;
      return { ok: true, stopReason: "stop", usage: null };
    });
    const res = await buildApp(createChatRoutes({ produce })).request(
      "/api/v1/chat",
      postChat({ message: "你好" }),
    );
    const frames = await readSseFrames(res);
    expect(frames.map((f) => f.event)).toEqual(["done"]);
    const system = captured?.[0] as { content: string };
    expect(system.content).toContain("## 项目设定");
    expect(system.content).toContain("力量体系：练气→筑基→金丹");
  });

  it("AGENTS.md 不存在 → 不注入「## 项目设定」段（空规则跳过）", async () => {
    openProject(); // initProject 不创建 

    let captured: LLMMessage[] | null = null as LLMMessage[] | null;
    const produce = vi.fn<RunAgentDeps["produce"]>(async (messages) => {
      captured = messages;
      return { ok: true, stopReason: "stop", usage: null };
    });
    const res = await buildApp(createChatRoutes({ produce })).request(
      "/api/v1/chat",
      postChat({ message: "你好" }),
    );
    const frames = await readSseFrames(res);
    expect(frames.map((f) => f.event)).toEqual(["done"]);
    const system = captured?.[0] as { content: string };
    expect(system.content).not.toContain("## 项目设定");
  });
});

describe("工具定义 → LLM function calling（TypeBox schema 直接透传，见 docs/api/tool-calling.md）", () => {
  it("get_entity 的 parameters 即 OpenAI 兼容 JSON Schema（enum/required/additionalProperties 保留）", () => {
    const defs = toLLMToolDefinitions([getTool("get_entity")!]);
    expect(defs).toHaveLength(1);
    expect(defs[0].parameters).toEqual({
      type: "object",
      properties: {
        type: { enum: ["character", "setting", "location", "hook", "event", "timepoint", "reference"] },
        id: { type: "string" },
      },
      required: ["type", "id"],
      additionalProperties: false,
    });
    expect((defs[0].parameters as { $schema?: unknown }).$schema).toBeUndefined();
  });

  it("registry 35 个 AUTO+PROPOSAL 工具全部暴露且参数为工具定义本体（零转换）", () => {
    const defs = toLLMToolDefinitions(listTools());
    expect(defs.length).toBe(35);
    const byName = new Map(listTools().map((d) => [d.name, d]));
    for (const d of defs) {
      expect(typeof d.name).toBe("string");
      expect(typeof d.description).toBe("string");
      expect(d.parameters).toBe(byName.get(d.name)!.parameters);
    }
  });
});

// ============ [chat] 调试日志（配置文件 chat 类别，服务端对话链路） ============
// 覆盖：类别开启时 onEvent 转发逐事件打 [chat] 日志（工具名/参数摘要/proposal_id/文本长度）、
// 关闭（无配置文件）时 console.debug 零调用（零开销早退）、长参数/长结果截断（200 字符 + 原长标注）

describe("[chat] 调试日志（配置文件 chat 类别）", () => {
  it("开启时 onEvent 转发产生 [chat] 日志（turn_start/text 长度/tool_call 参数/tool_result/proposal/done）", async () => {
    enableDebug(); // 临时创作根写 .ai-editor/config.json（enabled=true，全部类别）+ initDebugConfig
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    openProject();
    const produce = vi.fn<RunAgentDeps["produce"]>(async (_messages, _signal, onEvent) => {
      if (produce.mock.calls.length === 1) {
 // 仅第 1 轮流式输出文本 + 工具调用；第 2 轮无事件 → done（防无限工具循环）
        onEvent?.({ type: "text", delta: "你好" });
        onEvent?.({
          type: "tool_call",
          toolCall: {
            id: "call_1",
            name: "propose_create_entity",
            rawArguments: "{}",
            arguments: { type: "character", name: "张三" },
          },
        });
      }
      return { ok: true, stopReason: "tool_calls", usage: null };
    });
    const dispatcher = vi.fn<ToolDispatcher>(async (calls) =>
      calls.map((call) => ({
        id: call.id,
        tool: call.tool,
        ok: true,
        isError: false,
        content: JSON.stringify({ proposal_id: "prop_1", summary: "创建角色张三" }),
        proposal: { proposal_id: "prop_1", type: "propose_create_entity", preview: {} },
      })),
    );
    const res = await buildApp(createChatRoutes({ produce, dispatcher })).request(
      "/api/v1/chat",
      postChat({ message: "你好" }),
    );
    await readSseFrames(res);

    const lines = spy.mock.calls.map((c) => c.map(String).join(" "));
    expect(lines.some((l) => l.includes("[chat] turn_start round=1"))).toBe(true);
    expect(lines.some((l) => l.includes("[chat] text delta=+2"))).toBe(true); // 只打长度不打内容
    expect(lines.some((l) => l.includes("[chat] tool_call tool=propose_create_entity id=call_1 args="))).toBe(true);
    expect(lines.some((l) => l.includes('"name":"张三"'))).toBe(true); // 参数摘要含实际内容
    expect(lines.some((l) => l.includes("[chat] tool_result tool=propose_create_entity id=call_1 result="))).toBe(true);
    expect(lines.some((l) => l.includes("[chat] proposal id=prop_1 type=propose_create_entity"))).toBe(true);
    expect(lines.some((l) => l.includes("[chat] done session=") && l.includes("round=2"))).toBe(true); // done 附带轮次
  });

  it("工具结果超上限：写 [usage] TOOL_RESULT_TOO_LARGE 日志（不发 error 帧）", async () => {
    enableDebug();
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    openProject();
    const huge = "x".repeat(40_000); // 10k tokens > 缺省上限 8000
    const produce = vi.fn<RunAgentDeps["produce"]>(async (_m, _s, onEvent) => {
      if (produce.mock.calls.length === 1) {
        onEvent?.({ type: "tool_call", toolCall: { id: "call_big", name: "list_entities", rawArguments: "{}", arguments: {} } });
        return { ok: true, stopReason: "tool_calls", usage: null };
      }
      return { ok: true, stopReason: "stop", usage: null };
    });
    const dispatcher = vi.fn<ToolDispatcher>(async (calls) =>
      calls.map((call) => ({ id: call.id, tool: call.tool, ok: true, isError: false, content: huge })),
    );
    const res = await buildApp(createChatRoutes({ produce, dispatcher })).request(
      "/api/v1/chat",
      postChat({ message: "列一下" }),
    );
    await readSseFrames(res);
    const lines = spy.mock.calls.map((c) => c.map(String).join(" "));
    expect(lines.some((l) => l.includes("[agent]") && l.includes("TOOL_RESULT_TOO_LARGE") && l.includes("截断 1 条"))).toBe(true);
  });

  it("关闭（无配置文件）时 onEvent 不调用 console.debug（零开销早退）", async () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    openProject();
    const produce = vi.fn<RunAgentDeps["produce"]>(async () => ({ ok: true, stopReason: "stop", usage: null }));
    const res = await buildApp(createChatRoutes({ produce })).request("/api/v1/chat", postChat({ message: "你好" }));
    await readSseFrames(res);
    expect(spy).not.toHaveBeenCalled();
  });

  it("长参数/长结果截断（200 字符上限 + 原长标注）", async () => {
    enableDebug();
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    openProject();
    const produce = vi.fn<RunAgentDeps["produce"]>(async (_messages, _signal, onEvent) => {
      if (produce.mock.calls.length === 1) {
 // 仅第 1 轮流式输出工具调用（防无限工具循环）
        onEvent?.({
          type: "tool_call",
          toolCall: {
            id: "call_1",
            name: "propose_update_entity",
            rawArguments: "{}",
            arguments: { content: "甲".repeat(500) },
          },
        });
      }
      return { ok: true, stopReason: "tool_calls", usage: null };
    });
    const dispatcher = vi.fn<ToolDispatcher>(async (calls) =>
      calls.map((call) => ({ id: call.id, tool: call.tool, ok: true, isError: false, content: "x".repeat(500) })),
    );
    const res = await buildApp(createChatRoutes({ produce, dispatcher })).request(
      "/api/v1/chat",
      postChat({ message: "你好" }),
    );
    await readSseFrames(res);

    const lines = spy.mock.calls.map((c) => c.map(String).join(" "));
    const callLine = lines.find((l) => l.includes("tool_call"))!;
    expect(callLine.length).toBeLessThan(400); // 截断后远小于原始 500+ 字符参数
    expect(callLine).toContain("…("); // 截断标注（含原长）
    const resultLine = lines.find((l) => l.includes("tool_result"))!;
    expect(resultLine).toContain("…(");
  });
});

// ============ [llm] 请求/usage 调试日志（配置文件 request/usage 类别，produce 装饰器） ============
// 覆盖：request 日志（模型名 + 完整 messages JSON 不截断 + 工具名列表）、usage 日志（真实
// token 数 + stop 原因）、敏感红线（日志中绝不出现密钥值/Bearer/apiKey 字样）、
// 关闭时零开销直通（无日志、onEvent 同引用不包装）
// 注：装饰器独立于路由（createLLMRequestLogger 包 mock produce 直测），不经真实 DeepSeek 调用

describe("[llm] 请求/usage 调试日志（配置文件 request/usage 类别）", () => {
  it("开启时 request 日志含模型名/完整 messages JSON/工具名列表，且无密钥字样", async () => {
    enableDebug({ debug: { enabled: true, categories: ["request", "usage"] } });
    process.env.DEEPSEEK_API_KEY = "sk-test-secret-123456"; // 红线验证：密钥绝不出现在日志
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const inner = vi.fn<RunAgentDeps["produce"]>(async () => ({ ok: true, stopReason: "stop", usage: null }));
    const produce = createLLMRequestLogger(inner, {
      model: "deepseek-v4-flash",
      tools: [
        { name: "get_entity", description: "查询实体", parameters: { type: "object" } },
        { name: "propose_create_entity", description: "创建实体", parameters: { type: "object" } },
      ],
    });
    await produce(
      [
        { role: "system", content: "你是创作顾问" },
        { role: "user", content: "帮我查一下张三" },
      ],
      new AbortController().signal,
    );

    const lines = spy.mock.calls.map((c) => c.map(String).join(" "));
    const reqLine = lines.find((l) => l.includes("[llm] request model="))!;
    expect(reqLine).toContain("model=deepseek-v4-flash");
    expect(reqLine).toContain("tools=[get_entity, propose_create_entity]"); // 工具名列表
    const msgLine = lines.find((l) => l.includes("[llm] request messages="))!;
    expect(msgLine).toContain('"role": "system"'); // 完整 JSON（pretty 打印，不截断）
    expect(msgLine).toContain("帮我查一下张三");
 // 敏感红线：密钥值 / Bearer 头 / apiKey 字样绝不入日志
    for (const l of lines) {
      expect(l).not.toContain("sk-test-secret-123456");
      expect(l).not.toContain("Bearer");
      expect(l).not.toContain("apiKey");
    }
    expect(inner).toHaveBeenCalledTimes(1); // 装饰器只包装不改调用
  });

  it("开启时 finish 事件打 [llm] usage（真实 token 数 + stop 原因）", async () => {
    enableDebug({ debug: { enabled: true, categories: ["usage"] } });
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const inner = vi.fn<RunAgentDeps["produce"]>(async (_messages, _signal, onEvent) => {
      onEvent?.({
        type: "finish",
        stopReason: "tool_calls",
        usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
      });
      return { ok: true, stopReason: "tool_calls", usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 } };
    });
    const produce = createLLMRequestLogger(inner, { model: "m", tools: [] });
    await produce([{ role: "user", content: "hi" }], new AbortController().signal, () => {}); // 需传 onEvent 触发包装
    const lines = spy.mock.calls.map((c) => c.map(String).join(" "));
    expect(
      lines.some((l) => l.includes("[llm] usage prompt_tokens=120 completion_tokens=45 total=165 stop=tool_calls")),
    ).toBe(true);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("关闭（无配置文件）时零开销直通：无日志、onEvent 同引用不包装", async () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const onEvent = (): void => {};
    const inner = vi.fn<RunAgentDeps["produce"]>(async (_messages, _signal, e) => {
      expect(e).toBe(onEvent); // 未包装：同一引用转发
      return { ok: true, stopReason: "stop", usage: null };
    });
    const produce = createLLMRequestLogger(inner, { model: "m", tools: [] });
    await produce([{ role: "user", content: "hi" }], new AbortController().signal, onEvent);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ============ 调试类别隔离（配置文件模式，细粒度开关） ============
// 覆盖：只开 request 时路由 [chat] 事件日志不打（createChatEventLogger 类别门控）、
// request/usage 分开判定（只开 usage → request 不打；只开 request → usage 不打）、
// stream 类别经 isCategoryEnabled 判定（未列 stream 不开启）
// 注：llm client 的 debugStream 选项透传行为（true 开/缺省关）在 llm 包测试覆盖
// 状态：本 describe 用临时创作根写 .ai-editor/config.json + initDebugConfig 进入配置态；
// 文件级 beforeEach/afterEach 已 initDebugConfig(undefined) 重置

/** 写入调试配置文件（<root>/.ai-editor/config.json；创作根 = tmpRoot） */
function writeDebugConfig(projectRoot: string, content: unknown): void {
  const dir = join(projectRoot, ".ai-editor");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(content));
}

/** 启用调试（纯配置文件方式）：向临时创作根写配置并 initDebugConfig（缺省 enabled=true 全部类别） */
function enableDebug(config: unknown = { debug: { enabled: true } }): void {
  writeDebugConfig(tmpRoot, config);
  initDebugConfig(tmpRoot);
}

describe("调试类别隔离（配置文件模式）", () => {

  it("只开 request：路由 [chat] 事件日志不打（类别门控）", async () => {
    enableDebug({ debug: { enabled: true, categories: ["request"] } });
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    openProject();
    const produce = vi.fn<RunAgentDeps["produce"]>(async (_messages, _signal, onEvent) => {
      onEvent?.({ type: "text", delta: "你好" }); // 触发 createChatEventLogger
      return { ok: true, stopReason: "stop", usage: null };
    });
    const res = await buildApp(createChatRoutes({ produce })).request("/api/v1/chat", postChat({ message: "你好" }));
    await readSseFrames(res);
    expect(spy).not.toHaveBeenCalled(); // chat 类别未开 → 无 [chat] 日志
  });

  it("只开 usage：request 不打、usage 打（分开判定）", async () => {
    enableDebug({ debug: { enabled: true, categories: ["usage"] } });
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const inner = vi.fn<RunAgentDeps["produce"]>(async (_messages, _signal, onEvent) => {
      onEvent?.({
        type: "finish",
        stopReason: "stop",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
      return { ok: true, stopReason: "stop", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    });
    const produce = createLLMRequestLogger(inner, { model: "m", tools: [] });
    await produce([{ role: "user", content: "hi" }], new AbortController().signal, () => {});
    const lines = spy.mock.calls.map((c) => c.map(String).join(" "));
    expect(
      lines.some((l) => l.includes("[llm] usage prompt_tokens=10 completion_tokens=5 total=15 stop=stop")),
    ).toBe(true);
    expect(lines.some((l) => l.includes("[llm] request model="))).toBe(false); // request 类别未开
  });

  it("只开 request：usage 不打（分开判定）", async () => {
    enableDebug({ debug: { enabled: true, categories: ["request"] } });
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const inner = vi.fn<RunAgentDeps["produce"]>(async (_messages, _signal, onEvent) => {
      onEvent?.({
        type: "finish",
        stopReason: "stop",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
      return { ok: true, stopReason: "stop", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    });
    const produce = createLLMRequestLogger(inner, { model: "m", tools: [] });
    await produce([{ role: "user", content: "hi" }], new AbortController().signal, () => {});
    const lines = spy.mock.calls.map((c) => c.map(String).join(" "));
    expect(lines.some((l) => l.includes("[llm] request model=m"))).toBe(true);
    expect(lines.some((l) => l.includes("[llm] usage prompt_tokens="))).toBe(false); // usage 类别未开
  });

  it("stream 类别：未列 stream 不开启（细粒度隔离）", () => {
    enableDebug({ debug: { enabled: true, categories: ["chat"] } });
    expect(isCategoryEnabled("chat")).toBe(true);
    expect(isCategoryEnabled("stream")).toBe(false);
  });
});

describe("POST /chat done 帧携带生效预算（A1）", () => {
  it("done 帧带 context_budget：history = 窗口 × history_ratio，total = 四层之和（占用条分母）", async () => {
    openProject();
    const produce = vi.fn<RunAgentDeps["produce"]>(async (_messages, _signal, onEvent) => {
      onEvent?.({ type: "text", delta: "答" });
      return { ok: true, stopReason: "stop", usage: null };
    });
    const res = await buildApp(createChatRoutes({ produce })).request("/api/v1/chat", postChat({ message: "你好" }));
    const frames = await readSseFrames(res);
    const done = frames.find((f) => f.event === "done");
    expect(done).toBeDefined();
    const budget = (done?.data as { context_budget?: { history: number; total: number } }).context_budget;
    expect(budget).toBeDefined();
 // 缺省配置：deepseek-v4-flash 目录 contextWindow = 1_000_000 × 0.15
    expect(budget?.history).toBe(150_000);
    expect(budget?.total).toBeGreaterThanOrEqual(150_000);
    expect(Number.isInteger(budget?.total)).toBe(true);
  });

  it("模型不在目录（配置漂移）→ 不传预算，done 帧无 context_budget（不阻断对话）", async () => {
    openProject();
    const produce = vi.fn<RunAgentDeps["produce"]>(async () => ({ ok: true, stopReason: "stop", usage: null }));
    const res = await buildApp(createChatRoutes({ produce, model: "no-such-model" })).request(
      "/api/v1/chat",
      postChat({ message: "你好" }),
    );
    const frames = await readSseFrames(res);
    const done = frames.find((f) => f.event === "done");
    expect(done).toBeDefined();
 // 兜底：agent 侧常量预算（不因预算解析失败改变行为）；done 帧仍带 runAgent 的 contextBudget
    const budget = (done?.data as { context_budget?: { history: number; total: number } }).context_budget;
    expect(budget?.history).toBe(6000); // DEFAULT_CONTEXT_BUDGETS.history
  });
});
