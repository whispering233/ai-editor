// 对话路由测试：POST /api/v1/chat（POST + SSE）、会话列表 / 消息历史 / 思维链全文 / 删除会话
//
// 契约 = docs/api/80-api-chat.md。测试全部**离线**：faux provider（pi-ai）+ 临时项目目录 +
// 真实 SessionManager 落盘，不触碰真实 provider、不读写 ~/.pi/agent（HOME 隔离）。
//
// 覆盖：
// - 会话列表：空 / 落盘后可列 / 倒序 + 50 字截断 / 项目隔离 / 旧 v1 文件被 pi 跳过
// - 消息历史：角色顺序与 toolCalls/toolCallId、思维链只给预览、未知 id → 404
// - 思维链端点：全文 / blockIndex 非法 400 / 非 thinking 块 404 / 未知会话 404
// - 删除会话：未知 404 / 在途 409 SESSION_BUSY / 删除后列表消失 + 重复删 404
// - POST /chat：开流前校验（400/404/409/LLM_API_KEY_MISSING）、首帧 session、事件集与
//   `partial` 剥离、AUTO 工具 details 不下发、提案 details 下发、AGENTS.md 与聚焦注入、
//   续聊历史喂回、单项目单流 409 CHAT_BUSY、断开取消（provider signal aborted + 提案作废）
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  InMemoryCredentialStore,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  createProjectRuntime,
  defaultProposalStore,
  openProjectSessionManager,
  projectSessionsDir,
  type Proposal,
} from "@whispering233/ai-editor-agent";
import { createDecomposeJob, createEntity, nowIso, SCHEMA_VERSION, updateJobStatus, upsertDocument, writeOutlineFile } from "@whispering233/ai-editor-db";
import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { RuntimeFactory } from "../chat-runtime.js";
import { decomposeSessionId } from "../decompose/llm.js";
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
import { buildFocusText, createChatRoutes, FOCUS_CHAPTER_EXCERPT_CHARS } from "./chat.js";
import { initDebugConfig } from "../debug.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" };

let tmpRoot: string;
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpRoot, "chat-"));
  tmpDirs.push(dir);
  return dir;
}

/** 组装带中间件的测试 app */
function buildApp(routes: Hono): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.use("*", originCheckMiddleware());
  app.use("*", projectMiddleware());
  app.route("/api/v1/chat", routes);
  return app;
}

/** 打开新项目并设为当前项目（每次 initProject 生成独立 project_id，天然隔离） */
function openProject(): ProjectContext {
  const prev = getCurrentProject();
  if (prev) closeProject(prev);
  const project = initProject(makeTmpDir());
  setCurrentProject(project);
  return project;
}

/** 聚焦注入测试用大纲树（单卷 → 两章：ch-1[sc-focus]，ch-2 用作「无正文的章」） */
function focusOutline(): OutlineFileTree {
  return {
    id: "root",
    type: "root",
    schema_version: SCHEMA_VERSION,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updated_at: "2026-08-01T10:00:00Z",
        children: [
          {
            id: "ch-1",
            type: "chapter",
            title: "第一章",
            updated_at: "2026-08-01T10:00:00Z",
            children: [
              { id: "sc-focus", type: "scene", title: "灵根测试失败", updated_at: "2026-08-01T10:00:00Z" },
            ],
          },
          // 无正文的章（聚焦注入测试用：未写过正文 → 不注入节选）
          { id: "ch-2", type: "chapter", title: "第二章", updated_at: "2026-08-01T10:00:00Z" },
        ],
      },
    ],
  };
}

// ============ faux 环境（离线模型 + 运行时工厂） ============

interface FauxEnv {
  /** 运行时工厂（注入 faux 模型；会话仍然真实落盘到项目 sessions/） */
  factory: RuntimeFactory;
  faux: ReturnType<typeof fauxProvider>;
  model: Model<string>;
  /** 每次模型请求的 Context（断言系统提示词/历史/工具注入用） */
  requests: Context[];
}

/** 单次 provider 请求的自定义响应：可挂起（gate）、可捕获 options.signal */
type FauxStep = (
  context: Context,
  options: SimpleStreamOptions | undefined,
) => ReturnType<typeof fauxAssistantMessage> | Promise<ReturnType<typeof fauxAssistantMessage>>;

async function createFauxEnv(): Promise<FauxEnv> {
  const faux = fauxProvider({
    models: [{ id: "faux-1", name: "Faux 1", contextWindow: 128_000, maxTokens: 8192 }],
  });
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(faux.provider.id, async () => ({ type: "api_key", key: "faux-key" }));
  const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.refresh({ allowNetwork: false });
  const model = modelRuntime.getModel(faux.provider.id, "faux-1");
  if (model === undefined) throw new Error("faux 模型未注册进 ModelRuntime");

  const requests: Context[] = [];
  // 与生产 defaultRuntimeFactory 同款：项目 sessions/ + 真实 SessionManager（续聊打开既有文件）
  const factory: RuntimeFactory = ({ target, sessionFile }) =>
    createProjectRuntime({
      projectRoot: target.root,
      toolContext: { db: target.db, outlineDir: target.root, projectId: target.projectId },
      modelRuntime,
      model,
      sessionManager: openProjectSessionManager(target.root, sessionFile),
    });
  return { factory, faux, model, requests };
}

/** 把下一步响应设成「捕获 Context 的固定回复」 */
function scripted(env: FauxEnv, steps: FauxStep[]): void {
  env.faux.setResponses(wrapSteps(env, steps));
}

/** 追加下一步响应（与 scripted 同款捕获包装） */
function appendScripted(env: FauxEnv, steps: FauxStep[]): void {
  env.faux.appendResponses(wrapSteps(env, steps) as never);
}

/** 包装：每次 provider 请求都把 Context 记进 env.requests（断言提示词/历史注入用） */
function wrapSteps(env: FauxEnv, steps: FauxStep[]) {
  return steps.map(
    (step) =>
      (context: Context, options?: SimpleStreamOptions) => {
        env.requests.push(context);
        return step(context, options);
      },
  );
}

/** 未配置凭据的运行时工厂（断言 400 LLM_API_KEY_MISSING）
 * 用真实 provider（deepseek）注册：它要求 API key，而测试 HOME 隔离 + 无 env → 无可用模型 */
async function createUncredentialedFactory(): Promise<RuntimeFactory> {
  const { deepseekProvider } = await import("@earendil-works/pi-ai/providers/deepseek");
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(deepseekProvider());
  await modelRuntime.refresh({ allowNetwork: false });
  return ({ target, sessionFile }) =>
    createProjectRuntime({
      projectRoot: target.root,
      toolContext: { db: target.db, outlineDir: target.root, projectId: target.projectId },
      modelRuntime,
      sessionManager: openProjectSessionManager(target.root, sessionFile),
    });
}

// ============ SSE 解析辅助 ============

interface SseFrame {
  event: string;
  data: unknown;
}

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
    // 非 JSON data 属异常流；测试中不应出现
  }
  return { event, data };
}

/** 读取 SSE 响应直至流结束/超时（返回全部帧） */
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
  await pending?.catch(() => {});
  return frames;
}

/** 收集帧里出现的所有键（断言 `partial` 不泄漏） */
function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
    return into;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      into.add(key);
      collectKeys(child, into);
    }
  }
  return into;
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("waitFor 超时");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function postChat(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { ...HOST_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** 预置一条提案（断言「断开 → 未确认提案作废」用） */
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

// ============ 环境隔离 ============

let originalHome: string | undefined;
let originalDeepseekKey: string | undefined;
let originalOpencodeKey: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ai-editor-chat-"));
  setCurrentProject(null);
  defaultProposalStore.clear();
  originalHome = process.env.HOME;
  process.env.HOME = tmpRoot; // pi agent dir 隔离（getAgentDir → $HOME/.pi/agent）
  // 凭据隔离：本机可能已设 provider env key——“未配置凭据”用例需要确定性的“无凭据”状态
  originalDeepseekKey = process.env.DEEPSEEK_API_KEY;
  originalOpencodeKey = process.env.OPENCODE_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENCODE_API_KEY;
  initDebugConfig(undefined);
});

afterEach(() => {
  const cur = getCurrentProject();
  if (cur !== null) {
    closeProject(cur);
    setCurrentProject(null);
  }
  defaultProposalStore.clear();
  vi.restoreAllMocks();
  initDebugConfig(undefined);
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalDeepseekKey !== undefined) process.env.DEEPSEEK_API_KEY = originalDeepseekKey;
  else delete process.env.DEEPSEEK_API_KEY;
  if (originalOpencodeKey !== undefined) process.env.OPENCODE_API_KEY = originalOpencodeKey;
  else delete process.env.OPENCODE_API_KEY;
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ============ GET /api/v1/chat/sessions ============

describe("GET /chat/sessions 会话列表", () => {
  it("无当前项目 → 409 NO_PROJECT_OPEN", async () => {
    const res = await buildApp(createChatRoutes()).request("/api/v1/chat/sessions", { headers: HOST_HEADERS });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_PROJECT_OPEN");
  });

  it("空项目 → 200 { sessions: [] }", async () => {
    openProject();
    const res = await buildApp(createChatRoutes()).request("/api/v1/chat/sessions", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { sessions: [] } });
  });

  it("会话落盘后可列：camelCase 全字段 + lastMessage 截断 + 按最后活动倒序", async () => {
    openProject();
    const env = await createFauxEnv();
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));

    // 会话 1：一问一答
    scripted(env, [() => fauxAssistantMessage("第一答")]);
    const first = await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "第一个问题" })));
    const firstId = (first.find((f) => f.event === "session")!.data as { session_id: string }).session_id;

    // 会话 2：另一轮新会话（不带 session_id → 新会话；末条超长触发 50 字截断）
    scripted(env, [() => fauxAssistantMessage("甲".repeat(80))]);
    const second = await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "第二问" })));
    const secondId = (second.find((f) => f.event === "session")!.data as { session_id: string }).session_id;
    expect(secondId).not.toBe(firstId);

    const res = await app.request("/api/v1/chat/sessions", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const ids = data.sessions.map((s: { id: string }) => s.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids)).toEqual(new Set([firstId, secondId]));

    const secondSummary = data.sessions.find((s: { id: string }) => s.id === secondId);
    expect(secondSummary.messageCount).toBe(2); // user + assistant
    expect(secondSummary.lastMessage).toBe(`${"甲".repeat(49)}…`);
    expect(secondSummary.lastMessage).toHaveLength(50);
    expect(typeof secondSummary.createdAt).toBe("string");
    expect(new Date(secondSummary.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(secondSummary.createdAt).getTime(),
    );

    // 按最后活动倒序：后创建的会话排在前
    expect(ids[0]).toBe(secondId);
  });

  it("项目隔离：proj-a 的会话不出现在 proj-b", async () => {
    openProject();
    const env = await createFauxEnv();
    scripted(env, [() => fauxAssistantMessage("A 的回复")]);
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));
    await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "只属于 A" })));

    openProject(); // 切换项目（新目录）
    const res = await buildApp(createChatRoutes({ runtimeFactory: env.factory })).request("/api/v1/chat/sessions", {
      headers: HOST_HEADERS,
    });
    expect((await res.json()).data).toEqual({ sessions: [] });
  });

  it("旧 v1 格式文件被 pi 的发现逻辑跳过（不出现在列表）", async () => {
    const project = openProject();
    const sessionsDir = join(project.root, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "sess_legacy.jsonl"),
      `${JSON.stringify({ type: "session", version: 1, id: "sess_legacy", created_at: "2026-08-01T10:00:00Z" })}\n` +
        `${JSON.stringify({ type: "message", id: "m1", role: "user", content: "旧会话", created_at: "2026-08-01T10:00:00Z" })}\n`,
    );

    const res = await buildApp(createChatRoutes()).request("/api/v1/chat/sessions", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ sessions: [] });
    // 文件仍在磁盘（不迁移、不删除）
    expect(readdirSync(sessionsDir)).toContain("sess_legacy.jsonl");
  });
});

// ============ GET /api/v1/chat/sessions/:id/messages ============

describe("GET /chat/sessions/:id/messages 消息历史", () => {
  it("无当前项目 → 409 NO_PROJECT_OPEN", async () => {
    const res = await buildApp(createChatRoutes()).request("/api/v1/chat/sessions/unknown/messages", {
      headers: HOST_HEADERS,
    });
    expect(res.status).toBe(409);
  });

  it("未知/路径穿越形状的 id → 404 SESSION_NOT_FOUND（磁盘发现未命中，不拼路径）", async () => {
    openProject();
    const app = buildApp(createChatRoutes());
    const unknown = await app.request("/api/v1/chat/sessions/unknown-session/messages", { headers: HOST_HEADERS });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe("SESSION_NOT_FOUND");

    // 客户端传来的 id 含路径分隔符也只当普通字符串（不拼路径、不看文件系统）
    const traversal = await app.request(
      `/api/v1/chat/sessions/${encodeURIComponent("../../etc/passwd")}/messages`,
      { headers: HOST_HEADERS },
    );
    expect(traversal.status).toBe(404);
    expect((await traversal.json()).error.code).toBe("SESSION_NOT_FOUND");
  });

  it("真实会话：角色顺序 / toolCalls / toolCallId / 思维链只给预览", async () => {
    openProject();
    const env = await createFauxEnv();
    scripted(env, [
      () => fauxAssistantMessage([fauxToolCall("get_outline", {})]),
      () => fauxAssistantMessage([fauxThinking("先看大纲"), fauxText("大纲读取完成")]),
    ]);
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));
    const frames = await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "看下大纲" })));
    const sessionId = (frames.find((f) => f.event === "session")!.data as { session_id: string }).session_id;

    const res = await app.request(`/api/v1/chat/sessions/${sessionId}/messages`, { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.sessionId).toBe(sessionId);
    expect(data.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(data.messages[0].content).toBe("看下大纲");
    // assistant（工具调用轮）：toolCalls 投影
    expect(data.messages[1].toolCalls[0].name).toBe("get_outline");
    // tool 结果：toolCallId 与 assistant 的工具调用 id 成对
    expect(data.messages[2].toolCallId).toBe(data.messages[1].toolCalls[0].id);
    // 末条 assistant：正文 + thinking 预览（不含全文）
    expect(data.messages[3].content).toBe("大纲读取完成");
    expect(data.messages[3].thinking).toHaveLength(1);
    expect(data.messages[3].thinking[0]).toEqual({
      preview: "先看大纲",
      deferred: true,
      blockIndex: expect.any(Number),
      length: "先看大纲".length,
    });
  });
});

// ============ GET .../messages/:messageId/thinking ============

describe("GET 思维链全文", () => {
  it("blockIndex 非法 → 400 VALIDATION_ERROR；未知会话 → 404 SESSION_NOT_FOUND", async () => {
    openProject();
    const app = buildApp(createChatRoutes());
    const bad = await app.request("/api/v1/chat/sessions/s1/messages/m1/thinking", { headers: HOST_HEADERS });
    expect(bad.status).toBe(400);
    const missing = await app.request("/api/v1/chat/sessions/s1/messages/m1/thinking?blockIndex=0", {
      headers: HOST_HEADERS,
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("SESSION_NOT_FOUND");
  });

  it("thinking 块 → 200 全文；非 thinking 块/越界 → 404 THINKING_NOT_FOUND", async () => {
    openProject();
    const env = await createFauxEnv();
    const longThinking = "思".repeat(1000);
    scripted(env, [() => fauxAssistantMessage([fauxThinking(longThinking), fauxText("结论")])]);
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));
    const frames = await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "想想" })));
    const sessionId = (frames.find((f) => f.event === "session")!.data as { session_id: string }).session_id;

    const messages = await (
      await app.request(`/api/v1/chat/sessions/${sessionId}/messages`, { headers: HOST_HEADERS })
    ).json();
    const assistant = messages.data.messages.find((m: { role: string }) => m.role === "assistant");
    const blockIndex = assistant.thinking[0].blockIndex;

    const ok = await app.request(
      `/api/v1/chat/sessions/${sessionId}/messages/${assistant.id}/thinking?blockIndex=${blockIndex}`,
      { headers: HOST_HEADERS },
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.thinking).toBe(longThinking);

    const textBlock = await app.request(
      `/api/v1/chat/sessions/${sessionId}/messages/${assistant.id}/thinking?blockIndex=${blockIndex + 1}`,
      { headers: HOST_HEADERS },
    );
    expect(textBlock.status).toBe(404);
    expect((await textBlock.json()).error.code).toBe("THINKING_NOT_FOUND");
  });
});

// ============ DELETE /api/v1/chat/sessions/:id ============

describe("DELETE /chat/sessions/:id", () => {
  it("未知会话 → 404 SESSION_NOT_FOUND；已删除 → 列表不再收录 + 重复删除 404", async () => {
    openProject();
    const env = await createFauxEnv();
    scripted(env, [() => fauxAssistantMessage("回复")]);
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));
    const frames = await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "你好" })));
    const sessionId = (frames.find((f) => f.event === "session")!.data as { session_id: string }).session_id;

    const unknown = await app.request("/api/v1/chat/sessions/nope", { method: "DELETE", headers: HOST_HEADERS });
    expect(unknown.status).toBe(404);

    const deleted = await app.request(`/api/v1/chat/sessions/${sessionId}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ success: true, data: { deleted: true } });

    const again = await app.request(`/api/v1/chat/sessions/${sessionId}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(again.status).toBe(404);

    const list = await (await app.request("/api/v1/chat/sessions", { headers: HOST_HEADERS })).json();
    expect(list.data.sessions).toEqual([]);
  });

  it("在途流 → 409 SESSION_BUSY；流结束后可删（200）", async () => {
    openProject();
    const env = await createFauxEnv();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    scripted(env, [
      async () => {
        await gate;
        return fauxAssistantMessage("慢回复");
      },
    ]);
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));

    // 第一轮：先建会话
    scripted(env, [() => fauxAssistantMessage("快")]);
    const first = await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "建会话" })));
    const sessionId = (first.find((f) => f.event === "session")!.data as { session_id: string }).session_id;

    // 第二轮（同一会话）：挂起中 → DELETE 409
    appendScripted(env, [
      async () => {
        await gate;
        return fauxAssistantMessage("慢回复");
      },
    ]);
    const pendingResponse = await app.request("/api/v1/chat", postChat({ message: "慢问题", session_id: sessionId }));
    expect(pendingResponse.status).toBe(200);
    const drain = readSseFrames(pendingResponse);
    await waitFor(() => env.requests.length >= 2);

    const busy = await app.request(`/api/v1/chat/sessions/${sessionId}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(busy.status).toBe(409);
    expect((await busy.json()).error.code).toBe("SESSION_BUSY");

    release();
    await drain;
    const after = await app.request(`/api/v1/chat/sessions/${sessionId}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(after.status).toBe(200);
  });
});

// ============ POST /api/v1/chat（开流前校验） ============

describe("POST /chat 开流前校验（JSON 错误，非 SSE）", () => {
  it("无当前项目 → 409 NO_PROJECT_OPEN", async () => {
    const res = await buildApp(createChatRoutes()).request("/api/v1/chat", postChat({ message: "hi" }));
    expect(res.status).toBe(409);
  });

  it("请求体非法（缺 message / 未知字段）→ 400 VALIDATION_ERROR", async () => {
    openProject();
    const app = buildApp(createChatRoutes());
    expect((await app.request("/api/v1/chat", postChat({}))).status).toBe(400);
    expect((await app.request("/api/v1/chat", postChat({ message: "hi", nope: 1 }))).status).toBe(400);
  });

  it("未配置凭据 → 400 LLM_API_KEY_MISSING", async () => {
    openProject();
    const factory = await createUncredentialedFactory();
    const res = await buildApp(createChatRoutes({ runtimeFactory: factory })).request(
      "/api/v1/chat",
      postChat({ message: "hi" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("LLM_API_KEY_MISSING");
  });

  it("session_id 未知 → 404 SESSION_NOT_FOUND", async () => {
    openProject();
    const env = await createFauxEnv();
    const res = await buildApp(createChatRoutes({ runtimeFactory: env.factory })).request(
      "/api/v1/chat",
      postChat({ message: "hi", session_id: "no-such-session" }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("SESSION_NOT_FOUND");
  });

  it("单项目单在途流 → 409 CHAT_BUSY", async () => {
    openProject();
    const env = await createFauxEnv();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    scripted(env, [
      async () => {
        await gate;
        return fauxAssistantMessage("慢");
      },
    ]);
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));
    const first = await app.request("/api/v1/chat", postChat({ message: "一" }));
    expect(first.status).toBe(200);
    const drain = readSseFrames(first);
    await waitFor(() => env.requests.length >= 1);

    const second = await app.request("/api/v1/chat", postChat({ message: "二" }));
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("CHAT_BUSY");

    release();
    await drain;
    // 释放后可再次发送
    scripted(env, [() => fauxAssistantMessage("二")]);
    const third = await app.request("/api/v1/chat", postChat({ message: "三" }));
    expect(third.status).toBe(200);
    await readSseFrames(third);
  });
});

// ============ POST /api/v1/chat（SSE 事件集） ============

describe("POST /chat SSE 事件集与过滤", () => {
  it("心跳：流存活期间周期性发 ping（空载荷），首帧仍为 session", async () => {
    openProject();
    const env = await createFauxEnv();
    // 响应挂起 60ms 再返回：期间心跳（5ms 间隔）应发出多帧 ping
    scripted(env, [
      () => new Promise((resolve) => setTimeout(() => resolve(fauxAssistantMessage("慢答")), 60)) as never,
    ]);
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory, heartbeat: { minMs: 5, maxMs: 5 } }));

    const frames = await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "心跳测试" })));
    const pings = frames.filter((f) => f.event === "ping");
    expect(pings.length).toBeGreaterThan(0);
    expect(pings.every((f) => JSON.stringify(f.data) === "{}")).toBe(true);
    expect(frames[0]!.event).toBe("session");
    expect(frames.at(-1)!.event).toBe("agent_end");
  });

  it("首帧 session + 事件序列 + 无 partial 泄漏 + AUTO 工具 details 不下发", async () => {
    openProject();
    const env = await createFauxEnv();
    scripted(env, [
      () => fauxAssistantMessage([fauxText("让我看看大纲。"), fauxToolCall("get_outline", {})]),
      () => fauxAssistantMessage("大纲已读取。"),
    ]);
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));

    const frames = await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "看下大纲" })));
    const names = frames.map((f) => f.event);
    expect(names[0]).toBe("session");
    expect(names).toContain("agent_start");
    expect(names).toContain("turn_start");
    expect(names).toContain("message_start");
    expect(names).toContain("message_update");
    expect(names).toContain("message_end");
    expect(names).toContain("tool_execution_start");
    expect(names).toContain("tool_execution_end");
    expect(names).toContain("turn_end");
    expect(names[names.length - 1]).toBe("agent_end");

    // 会话 id 首帧回给客户端
    const sessionFrame = frames[0].data as { session_id: string };
    expect(sessionFrame.session_id).toMatch(/[a-zA-Z0-9_-]{4,}/);

    // 事件表之外的内部状态事件不转发
    for (const dropped of ["entry_appended", "queue_update", "session_info_changed", "agent_settled"]) {
      expect(names).not.toContain(dropped);
    }

    // `partial` 大对象不泄漏（含消息快照）
    for (const frame of frames) {
      expect(collectKeys(frame).has("partial")).toBe(false);
    }

    // message_update：assistant 增量 + 工具调用元数据（id/toolName）
    const update = frames.find(
      (f) => f.event === "message_update" && (f.data as { assistantMessageEvent: { type: string } }).assistantMessageEvent.type === "toolcall_start",
    );
    expect(update).toBeDefined();
    const delta = (update!.data as { assistantMessageEvent: { id?: string; toolName?: string } }).assistantMessageEvent;
    expect(delta.toolName).toBe("get_outline");
    expect(typeof delta.id).toBe("string");

    // AUTO 工具：result 只有 content，details 不下发
    const toolEnd = frames.find((f) => f.event === "tool_execution_end")!;
    const toolData = toolEnd.data as { toolName: string; isError: boolean; result: Record<string, unknown> };
    expect(toolData.toolName).toBe("get_outline");
    expect(toolData.isError).toBe(false);
    expect(toolData.result.details).toBeUndefined();
    expect(toolData.result.content).toBeDefined();

    // agent_end 无错误信息（正常结束）
    const agentEnd = frames[frames.length - 1].data as { stopReason?: string; errorMessage?: string };
    expect(agentEnd.stopReason).toBeUndefined();

    // 占用条口径：turn_end / agent_end 带 contextUsage（tokens 可能为 null，字段存在即可）
    const turnEnd = frames.find((f) => f.event === "turn_end")!.data as { contextUsage?: unknown };
    expect(turnEnd.contextUsage).toBeDefined();
  });

  it("PROPOSAL 工具：tool_execution_end 的 details 携带提案载荷 + 入仓", async () => {
    const project = openProject();
    const env = await createFauxEnv();
    scripted(env, [
      () => fauxAssistantMessage([fauxToolCall("propose_create_entity", { type: "character", name: "AI 提案角色" })]),
      () => fauxAssistantMessage("已提交提案，请确认。"),
    ]);
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));

    const frames = await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "新建一个角色" })));
    const toolEnd = frames.find((f) => f.event === "tool_execution_end")!;
    const data = toolEnd.data as {
      toolName: string;
      result: { content: unknown; details?: { proposal_id: string; type: string; preview: Record<string, unknown> } };
    };
    expect(data.toolName).toBe("propose_create_entity");
    expect(data.result.details).toBeDefined();
    expect(data.result.details!.type).toBe("propose_create_entity");
    expect(data.result.details!.proposal_id).toMatch(/^prop_/);
    expect(typeof data.result.details!.preview.summary).toBe("string");

    // 入仓（confirm 路由与对话链路同仓消费）
    expect(defaultProposalStore.get(data.result.details!.proposal_id, project.config.id)).not.toBeNull();
  });

  it("模型/提示词注入：内核提示词 + 项目 AGENTS.md（仅项目根）+ 聚焦段进用户消息", async () => {
    const project = openProject();
    writeFileSync(join(project.root, "AGENTS.md"), "PROJECT_RULE_TOKEN 力量体系：练气→筑基");
    const entity = createEntity(project.db, { type: "character", name: "阿强", data: { tags: ["剑"] } });
    writeOutlineFile(project.root, focusOutline());
    const env = await createFauxEnv();
    scripted(env, [() => fauxAssistantMessage("收到")]);
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));

    await readSseFrames(
      await app.request(
        "/api/v1/chat",
        postChat({
          message: "本轮问题",
          context: { focus_entity_id: entity.id, focus_node_id: "sc-focus" },
        }),
      ),
    );

    const request = env.requests[0]!;
    expect(request.systemPrompt).toContain("创作顾问"); // 内核提示词
    expect(request.systemPrompt).toContain("PROJECT_RULE_TOKEN"); // 项目规则（<project_instructions>）
    const userTexts = request.messages
      .filter((m) => m.role === "user")
      .map((m) => JSON.stringify(m.content))
      .join("\n");
    expect(userTexts).toContain("本轮问题");
    // 聚焦注入正向路径：实体 + 大纲节点都以「当前聚焦」段进入**本轮用户消息**（不是 system）
    expect(userTexts).toContain("当前聚焦");
    expect(userTexts).toContain("阿强");
    expect(userTexts).toContain("灵根测试失败");
    // 聚焦内容只能在本轮消息（内核提示词里的「当前聚焦」字样是行为准则第 6 条，不代表注入）
    expect(request.systemPrompt).not.toContain("阿强");
    expect(request.systemPrompt).not.toContain("灵根测试失败");
  });

  it("聚焦上下文：两项皆无效（已删除/未知）时不注入聚焦段", async () => {
    openProject();
    const env = await createFauxEnv();
    scripted(env, [() => fauxAssistantMessage("收到")]);
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));

    await readSseFrames(
      await app.request(
        "/api/v1/chat",
        postChat({ message: "无聚焦本轮", context: { focus_entity_id: "char-missing", focus_node_id: "sc-404" } }),
      ),
    );
    const userTexts = env.requests[0]!.messages
      .filter((m) => m.role === "user")
      .map((m) => JSON.stringify(m.content))
      .join("\n");
    expect(userTexts).toContain("无聚焦本轮");
    expect(userTexts).not.toContain("当前聚焦");
  });

  it("聚焦章注入正文节选（节选标注 + 截断到 2000 字符）；非章/无正文维持现状", () => {
 // 直接调 buildFocusText（SSE 链路已在上一例覆盖；本卡只验注入内容与截断长度）
    const project = openProject();
    writeOutlineFile(project.root, focusOutline());
    const longText = "甲".repeat(FOCUS_CHAPTER_EXCERPT_CHARS + 500);
    upsertDocument(project.db, {
      ownerKind: "chapter",
      ownerId: "ch-1",
      content: "[]",
      contentText: longText,
      now: "2026-08-01T10:00:00Z",
    });

    const focused = buildFocusText(project, { focus_node_id: "ch-1" })!;
    expect(focused).toContain("大纲节点：chapter「第一章」");
    expect(focused).toContain("正文（节选，完整正文请用 get_chapter_text 读取）：");
    expect(focused).toContain("甲".repeat(FOCUS_CHAPTER_EXCERPT_CHARS)); // 前 2000 字符在内
    expect(focused).not.toContain("甲".repeat(FOCUS_CHAPTER_EXCERPT_CHARS + 1)); // 第 2001 字符已被截断

 // 场景节点：不注入正文（正文只挂章）
    const scene = buildFocusText(project, { focus_node_id: "sc-focus" })!;
    expect(scene).toContain("大纲节点：scene「灵根测试失败」");
    expect(scene).not.toContain("节选");

 // 未写过正文的章：不注入正文段
    const empty = buildFocusText(project, { focus_node_id: "ch-2" })!;
    expect(empty).toContain("大纲节点：chapter「第二章」");
    expect(empty).not.toContain("节选");
  });

  it("续聊：携带 session_id → 历史喂回模型（第二轮请求含首轮消息）", async () => {
    openProject();
    const env = await createFauxEnv();
    scripted(env, [() => fauxAssistantMessage("第一答")]);
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));
    const first = await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "第一问" })));
    const sessionId = (first.find((f) => f.event === "session")!.data as { session_id: string }).session_id;

    scripted(env, [() => fauxAssistantMessage("第二答")]);
    const second = await readSseFrames(
      await app.request("/api/v1/chat", postChat({ message: "第二问", session_id: sessionId })),
    );
    expect((second.find((f) => f.event === "session")!.data as { session_id: string }).session_id).toBe(sessionId);

    const secondRequest = env.requests[1]!;
    const texts = secondRequest.messages.map((m) => JSON.stringify(m.content)).join("\n");
    expect(texts).toContain("第一问");
    expect(texts).toContain("第二问");
  });

  it("断开取消：provider signal 被 abort + 未确认提案作废 + 在途登记释放", async () => {
    const project = openProject();
    const env = await createFauxEnv();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let providerSignal: AbortSignal | undefined;
    scripted(env, [
      async (_context, options) => {
        providerSignal = options?.signal as AbortSignal | undefined;
        await gate;
        return fauxAssistantMessage("迟到回复");
      },
    ]);
    defaultProposalStore.set(seedProposal(project, "prop_pending"));

    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));
    const pending = await app.request("/api/v1/chat", postChat({ message: "慢问题" }));
    const reader = pending.body!.getReader();
    await reader.read(); // 触发流启动（首帧 session）
    await waitFor(() => env.requests.length >= 1);

    // 模拟客户端断开（刷新/断网）
    await reader.cancel().catch(() => {});

    await waitFor(() => providerSignal?.aborted === true);
    release();
    await waitFor(() => defaultProposalStore.size() === 0);

    // 在途登记已释放：同项目可再次发送（不再 409 CHAT_BUSY）
    scripted(env, [() => fauxAssistantMessage("新的回复")]);
    const again = await app.request("/api/v1/chat", postChat({ message: "再来" }));
    expect(again.status).toBe(200);
    await readSseFrames(again);
  });
});

// ============ 调试日志（配置文件 debug 段；关闭时零开销） ============

/** 写调试配置到临时创作根并生效（类别子集） */
function enableDebug(categories: string[] | null): void {
  const root = mkdtempSync(join(tmpRoot, "debug-root-"));
  tmpDirs.push(root);
  mkdirSync(join(root, ".ai-editor"), { recursive: true });
  writeFileSync(
    join(root, ".ai-editor", "config.json"),
    JSON.stringify({ debug: { enabled: true, ...(categories === null ? {} : { categories }) } }),
  );
  initDebugConfig(root);
}

describe("[chat]/[llm] 调试日志", () => {
  it("全关（无配置文件）→ 不调用 console.debug（零开销）", async () => {
    openProject();
    const env = await createFauxEnv();
    scripted(env, [() => fauxAssistantMessage([fauxToolCall("get_outline", {})]), () => fauxAssistantMessage("完成")]);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));
    await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "看下大纲" })));
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("chat 类别：turn/tool_call/tool_result/done 日志（不打印正文内容）", async () => {
    openProject();
    const env = await createFauxEnv();
    scripted(env, [() => fauxAssistantMessage([fauxToolCall("get_outline", {})]), () => fauxAssistantMessage("完成")]);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    enableDebug(["chat"]);

    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));
    await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "看下大纲" })));
    const lines = debugSpy.mock.calls.map((call) => call.map((part) => String(part)).join(" ")).join("\n");
    expect(lines).toContain("[chat] turn_start");
    expect(lines).toContain("tool_call tool=get_outline");
    expect(lines).toContain("tool_result tool=get_outline");
    expect(lines).toContain("[chat] done");
  });

  it("request 类别：模型 + 完整 messages JSON + 工具名（类别隔离：不打 [chat]）", async () => {
    openProject();
    const env = await createFauxEnv();
    scripted(env, [() => fauxAssistantMessage("收到")]);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    enableDebug(["request"]);

    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));
    await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "完整提示词检查" })));
    const lines = debugSpy.mock.calls.map((call) => call.map((part) => String(part)).join(" ")).join("\n");
    expect(lines).toContain("[llm] request model=faux-1");
    expect(lines).toContain("request messages=");
    expect(lines).toContain("完整提示词检查"); // 不截断：用户原话出现在 messages JSON 里
    expect(lines).toContain("get_outline"); // 工具名列表
    expect(lines).not.toContain("[chat]");
  });

  it("usage 类别：assistant 消息的真实 usage tokens", async () => {
    openProject();
    const env = await createFauxEnv();
    scripted(env, [() => fauxAssistantMessage("统计一下")]);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    enableDebug(["usage"]);

    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));
    await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "帮我统计" })));
    const lines = debugSpy.mock.calls.map((call) => call.map((part) => String(part)).join(" ")).join("\n");
    expect(lines).toContain("[llm] usage input_tokens=");
    expect(lines).not.toContain("[chat]");
  });
});

describe("工具结果截断可观测性", () => {
  it("超上限的工具结果：截断 + 提示 + [usage] TOOL_RESULT_TOO_LARGE 日志", async () => {
    const project = openProject();
    // 大 outline（严格三层）：让 get_outline 的结果远超 8000 token 上限
    const bigTree = {
      id: "root",
      type: "root",
      schema_version: 1,
      children: Array.from({ length: 40 }, (_, v) => ({
        id: `vol-${v}`,
        type: "volume",
        title: `第${v + 1}卷今日方知我是我此生无悔入江湖长歌一曲天涯路`,
        updated_at: "2026-08-01T10:00:00Z",
        children: Array.from({ length: 6 }, (_, c) => ({
          id: `ch-${v}-${c}`,
          type: "chapter",
          title: `第${c + 1}章风雪夜归人千里孤坟无处话凄凉`,
          updated_at: "2026-08-01T10:00:00Z",
          children: Array.from({ length: 4 }, (_, s) => ({
            id: `sc-${v}-${c}-${s}`,
            type: "scene",
            title: `场景${s + 1}灵根测试失败被逐出师门流落街头`,
            updated_at: "2026-08-01T10:00:00Z",
          })),
        })),
      })),
    };
    writeFileSync(join(project.root, "outline.json"), JSON.stringify(bigTree));

    const env = await createFauxEnv();
    scripted(env, [
      () => fauxAssistantMessage([fauxToolCall("get_outline", {})]),
      () => fauxAssistantMessage("收到"),
    ]);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    enableDebug(["usage", "chat"]);

    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));
    const frames = await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "看下大纲" })));
    const toolEnd = frames.find((f) => f.event === "tool_execution_end")!.data as {
      result: { content: Array<{ text: string }> };
    };
    expect(toolEnd.result.content[0]!.text).toContain("工具结果已截断");

    const lines = debugSpy.mock.calls.map((call) => call.map((part) => String(part)).join(" ")).join("\n");
    expect(lines).toContain("TOOL_RESULT_TOO_LARGE");
  });
});

// ============ 项目切换：释放运行时 + 中止在途流 + 清空提案 ============

describe("项目切换清理", () => {
  it("切项目 → 在途流被中止（provider signal aborted）+ 未确认提案作废", async () => {
    const project = openProject();
    const env = await createFauxEnv();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let providerSignal: AbortSignal | undefined;
    scripted(env, [
      async (_context, options) => {
        providerSignal = options?.signal as AbortSignal | undefined;
        await gate;
        return fauxAssistantMessage("迟到回复");
      },
    ]);
    defaultProposalStore.set(seedProposal(project, "prop_before_switch"));
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));

    const pending = await app.request("/api/v1/chat", postChat({ message: "慢问题" }));
    const reader = pending.body!.getReader();
    await reader.read();
    await waitFor(() => env.requests.length >= 1);

    // 切换项目（create/open/close 全部经 setCurrentProject 单点）
    setCurrentProject(null);

    expect(providerSignal?.aborted).toBe(true);
    expect(defaultProposalStore.size()).toBe(0);

    release();
    await reader.cancel().catch(() => {});
  });
});

// ============ 拆解会话守卫（docs/design/60-decompose.md §2.1 只读 / §7.2 在跑禁删） ============

describe("拆解会话守卫（decompose- 前缀）", () => {
  /** 落一枚真拆解会话文件（id = `decompose-<jobId>`，与 llm.ts 同一组装函数） */
  function seedDecomposeSession(project: ProjectContext, jobId: string): { sessionId: string; file: string } {
    const sessionId = decomposeSessionId(jobId);
    const manager = SessionManager.create(project.root, projectSessionsDir(project.root), { id: sessionId });
    manager.appendSessionInfo("《测试书》拆解");
    // pi 要等 assistant 消息才落盘（`SessionManager._persist`）⇒ 夹具补一轮问答，文件才真的在磁盘上
    manager.appendMessage({ role: "user", content: [{ type: "text", text: "批 1 正文" }], timestamp: Date.now() });
    manager.appendMessage(fauxAssistantMessage("拆解产物"));
    const file = manager.getSessionFile();
    if (file === undefined) throw new Error("拆解会话未落盘");
    return { sessionId, file };
  }

  /** 建一个 job 行（无批规划即可：守卫只看状态） */
  function seedJob(project: ProjectContext, status: "running" | "done"): string {
    const job = createDecomposeJob(project.db, {
      scopeStart: 1,
      scopeEnd: 1,
      batchTargetChars: 6000,
      concurrency: 1,
      model: null,
      batches: [],
      now: nowIso(),
    });
    updateJobStatus(project.db, job.id, status, nowIso());
    return job.id;
  }

  it("POST /chat：拆解会话 → 409 SESSION_READONLY（请求没到模型）；非前缀仍走既有 404", async () => {
    const project = openProject();
    const { sessionId } = seedDecomposeSession(project, seedJob(project, "running"));
    const env = await createFauxEnv();
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));

    const res = await app.request("/api/v1/chat", postChat({ message: "接着聊这本小说", session_id: sessionId }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("SESSION_READONLY");
    expect(env.requests).toEqual([]); // 只读判定在装配与 prompt 之前

    // 只是「名字里含 decompose」但非前缀 → 既有行为逐字不变（磁盘发现未命中即 404）
    const other = await app.request("/api/v1/chat", postChat({ message: "hi", session_id: "my-decompose-1" }));
    expect(other.status).toBe(404);
    expect((await other.json()).error.code).toBe("SESSION_NOT_FOUND");
  });

  it("GET /sessions：拆解会话带 name（会话名）；普通 chat 会话无 name 字段", async () => {
    const project = openProject();
    const { sessionId } = seedDecomposeSession(project, seedJob(project, "done"));
    const env = await createFauxEnv();
    const app = buildApp(createChatRoutes({ runtimeFactory: env.factory }));
    scripted(env, [() => fauxAssistantMessage("普通会话回复")]);
    const chat = await readSseFrames(await app.request("/api/v1/chat", postChat({ message: "普通提问" })));
    const chatId = (chat.find((f) => f.event === "session")!.data as { session_id: string }).session_id;

    const res = await app.request("/api/v1/chat/sessions", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const byId = (id: string) => data.sessions.find((s: { id: string }) => s.id === id);
    expect(byId(sessionId).name).toBe("《测试书》拆解"); // pi session_info 条目
    expect(byId(chatId)).not.toHaveProperty("name"); // 普通 chat 会话 pi 不写 name ⇒ 字段不下发
  });

  it("DELETE /chat/sessions/:id：在跑 job 的拆解会话 409 DECOMPOSE_JOB_RUNNING；终态后可删（物理删）", async () => {
    const project = openProject();
    const jobId = seedJob(project, "running");
    const { sessionId, file } = seedDecomposeSession(project, jobId);
    const app = buildApp(createChatRoutes());

    const running = await app.request(`/api/v1/chat/sessions/${sessionId}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(running.status).toBe(409);
    expect((await running.json()).error.code).toBe("DECOMPOSE_JOB_RUNNING");
    expect(existsSync(file)).toBe(true); // 拒删时文件原地不动（在途任务会把文件重建）

    updateJobStatus(project.db, jobId, "done", nowIso());
    const done = await app.request(`/api/v1/chat/sessions/${sessionId}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(done.status).toBe(200);
    expect(existsSync(file)).toBe(false);

    // 历史 job 的拆解会话（job 行已不是它）→ 无在跑轮次，同样可删
    const old = seedDecomposeSession(project, "job-old");
    const removed = await app.request(`/api/v1/chat/sessions/${old.sessionId}`, { method: "DELETE", headers: HOST_HEADERS });
    expect(removed.status).toBe(200);
    expect(existsSync(old.file)).toBe(false);
  });
});
