// chat store 测试（U3 会话列表/当前会话选择/项目切换联动 + U5 消息流/SSE 运行态/focus/断连）
// 订阅在 chat.ts 模块加载时激活：测试通过操作 useProjectStore.setState({config}) 驱动联动
// mock lib/api 模块（保留 ApiError 类真实实现）与 use-sse（fetchSSE 捕获 options 后手动驱动事件回调）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatSessionSummary,
  ErrorCode,
  ProjectConfig,
} from "@whispering233/ai-editor-shared";
import { ApiError } from "../lib/api";
import type { ChatMessageView } from "./chat";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    listSessions: vi.fn(),
    getSessionMessages: vi.fn(),
    deleteChatSession: vi.fn(),
    confirmProposal: vi.fn(),
    rejectProposal: vi.fn(),
  };
});

vi.mock("../hooks/use-sse", () => ({
  fetchSSE: vi.fn(() => () => {}),
}));

import {
  confirmProposal as apiConfirmProposal,
  deleteChatSession as apiDeleteChatSession,
  getSessionMessages as apiGetSessionMessages,
  listSessions as apiListSessions,
  rejectProposal as apiRejectProposal,
} from "../lib/api";
import { fetchSSE } from "../hooks/use-sse";
import {
  describeProposalActionError,
  describeStreamError,
  parseContextUsage,
  useChatStore,
  type ProposalCard,
} from "./chat";
import { useProjectStore } from "./project";
import { useUiStore } from "./ui";

const mocked = {
  listSessions: vi.mocked(apiListSessions),
  getSessionMessages: vi.mocked(apiGetSessionMessages),
  deleteChatSession: vi.mocked(apiDeleteChatSession),
  confirmProposal: vi.mocked(apiConfirmProposal),
  rejectProposal: vi.mocked(apiRejectProposal),
  fetchSSE: vi.mocked(fetchSSE),
};

/** 最近一次 fetchSSE 调用的 options（sendMessage 用例驱动事件回调用）；store 必然传入全部回调，断言非空 */
const sseOptions = () => {
  const calls = mocked.fetchSSE.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1] as Required<Parameters<typeof fetchSSE>[1]>;
};

const sampleSession: ChatSessionSummary = {
  id: "sess-1",
  lastMessage: "帮我梳理第三章的冲突",
  messageCount: 3,
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T11:00:00Z",
};

const makeConfig = (id: string): ProjectConfig => ({
  id,
  name: "我的小说",
  language: "zh",
  schemaVersion: 1,
  currentPosition: null,
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z",
});

const makeMsg = (over: Partial<ChatMessageView> & { id: string }): ChatMessageView => ({
  sessionId: "sess-1",
  role: "user",
  content: "内容",
  createdAt: "2026-08-01T10:00:00Z",
  ...over,
});

/** 提案卡 fixture（S8.2：confirm/reject 用例用；默认 pending） */
const makeProposal = (over: Partial<ProposalCard> & { proposalId: string }): ProposalCard => ({
  type: "propose_create_entity",
  status: "pending",
  ...over,
});

beforeEach(() => {
 // 默认 mock：历史为空、fetchSSE 返回空 abort 函数（用例内按需覆盖）
  mocked.getSessionMessages.mockResolvedValue({ sessionId: "sess-x", messages: [] });
  mocked.fetchSSE.mockReturnValue(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
 // 先关项目（触发订阅清空，不产生请求），再重置 chat store 与 project store 其余字段
  useProjectStore.setState({
    config: null,
    loadError: null,
    outline: null,
    configLoading: false,
    outlineLoading: false,
    bookshelf: null,
    bookshelfLoading: false,
    bookshelfError: null,
  });
  useChatStore.setState({
    sessions: null,
    sessionsLoading: false,
    sessionsError: null,
    currentSessionId: null,
    messages: [],
    messagesLoading: false,
    streaming: false,
    streamError: null,
    focusContext: null,
    contextUsage: null,
    statusNote: null,
    disconnected: false,
    proposals: [],
    streamTools: [],
  });
 // 全局反馈状态复位（提案动作 toast 断言用；ui store 的 toast 定时器按 id 守卫，旧定时器不污染新 toast）
  useUiStore.setState({ error: null, toast: null, confirmState: null, dataVersion: 0 });
});

describe("loadSessions", () => {
  it("成功 → sessions 设置 + sessionsError 清空", async () => {
    mocked.listSessions.mockResolvedValue([sampleSession]);
    await useChatStore.getState().loadSessions();
    const s = useChatStore.getState();
    expect(s.sessions).toEqual([sampleSession]);
    expect(s.sessionsError).toBeNull();
  });

  it("失败（网络）→ sessions=null + sessionsError=CLIENT_NETWORK_ERROR", async () => {
    mocked.listSessions.mockRejectedValue(new ApiError("CLIENT_NETWORK_ERROR", "网络请求失败"));
    await useChatStore.getState().loadSessions();
    const s = useChatStore.getState();
    expect(s.sessions).toBeNull();
    expect(s.sessionsError).toBe("CLIENT_NETWORK_ERROR");
  });

  it("加载中重复调用被防抖跳过", async () => {
    let resolveFirst: (v: ChatSessionSummary[]) => void = () => {};
    mocked.listSessions.mockImplementationOnce(
      () => new Promise<ChatSessionSummary[]>((r) => (resolveFirst = r)),
    );
    const p1 = useChatStore.getState().loadSessions();
    await useChatStore.getState().loadSessions(); // loading=true → 直接返回
    resolveFirst([sampleSession]);
    await p1;
    expect(mocked.listSessions).toHaveBeenCalledTimes(1);
  });

  it("非空列表且无当前会话 → 自动激活最近会话（问题 2：刷新页面/切项目后恢复最近对话）", async () => {
 // sessions[0] = 服务端按最后活动倒序的最近会话（「一项目一会话」心智）
    const older = { ...sampleSession, id: "sess-older", updatedAt: "2026-08-01T09:00:00Z" };
    mocked.listSessions.mockResolvedValue([sampleSession, older]);
    await useChatStore.getState().loadSessions();
    const s = useChatStore.getState();
    expect(s.sessions).toEqual([sampleSession, older]);
    expect(s.currentSessionId).toBe("sess-1"); // 最近会话（列表 [0]）
 // 激活即恢复历史（setCurrentSession → loadMessages）
    await vi.waitFor(() => expect(mocked.getSessionMessages).toHaveBeenCalledWith("sess-1"));
  });

  it("空列表 → 不激活（保持新会话空态）", async () => {
    mocked.listSessions.mockResolvedValue([]);
    await useChatStore.getState().loadSessions();
    expect(useChatStore.getState().currentSessionId).toBeNull();
  });

  it("已有当前会话 → 不覆盖（done 事件刷新列表 / 用户已手动选择场景）", async () => {
    useChatStore.setState({ currentSessionId: "sess-keep" });
    mocked.listSessions.mockResolvedValue([sampleSession]);
    await useChatStore.getState().loadSessions();
    expect(useChatStore.getState().currentSessionId).toBe("sess-keep");
    expect(mocked.getSessionMessages).not.toHaveBeenCalled(); // 未触发 setCurrentSession
  });

  it("newSession 作废在途列表请求 → 响应不自动激活（ora S1：不拉回开新会话意图）", async () => {
    let resolveList!: (v: ChatSessionSummary[]) => void;
    mocked.listSessions.mockReturnValue(
      new Promise<ChatSessionSummary[]>((r) => {
        resolveList = r;
      }),
    );
    const p = useChatStore.getState().loadSessions(); // 在途（不 await）
    useChatStore.getState().newSession(); // 在途期间点「新会话」（loadSeq++ 作废在途请求）
    resolveList([sampleSession]);
    await p;
    expect(useChatStore.getState().currentSessionId).toBeNull(); // 作废响应不自动激活
    expect(useChatStore.getState().sessions).toBeNull(); // 作废响应不落列表
  });
});

describe("loadMessages（U5：会话历史恢复）", () => {
  it("成功 → messages 设置（响应条目补全 sessionId，shared ChatSessionMessage）", async () => {
    mocked.getSessionMessages.mockResolvedValue({
      sessionId: "sess-1",
      messages: [
        { id: "m1", role: "user", content: "你好", createdAt: "t0" },
        {
          id: "m2",
          role: "assistant",
          content: "你好！",
          toolCalls: [{ id: "call-1", tool: "get_entity" }],
          createdAt: "t1",
        },
        {
          id: "m3",
          role: "tool",
          toolCallId: "call-1",
          content: '{"name":"张三"}',
          createdAt: "t2",
        },
      ],
    });
    await useChatStore.getState().loadMessages("sess-1");
    const s = useChatStore.getState();
    expect(s.messages).toHaveLength(3);
    expect(s.messages[0]).toMatchObject({ sessionId: "sess-1", role: "user" });
    expect(s.messages[1].toolCalls).toHaveLength(1);
    expect(s.messages[2]).toMatchObject({ role: "tool", toolCallId: "call-1" });
    expect(s.messagesLoading).toBe(false);
  });

  it("失败 → messages 清空（静默 → 空态引导语）", async () => {
    mocked.getSessionMessages.mockRejectedValue(
      new ApiError("CLIENT_NETWORK_ERROR", "网络请求失败"),
    );
    useChatStore.setState({ messages: [makeMsg({ id: "old" })] });
    await useChatStore.getState().loadMessages("sess-1");
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().messagesLoading).toBe(false);
  });

  it("切会话竞态：旧请求响应不覆盖新会话消息", async () => {
    let resolveA: (v: { sessionId: string; messages: unknown[] }) => void = () => {};
    mocked.getSessionMessages.mockImplementationOnce(
      () => new Promise((r) => (resolveA = r as typeof resolveA)),
    );
    const pA = useChatStore.getState().loadMessages("sess-a");
    mocked.getSessionMessages.mockResolvedValueOnce({
      sessionId: "sess-b",
      messages: [{ id: "mb", role: "user", content: "B 的", createdAt: "t" }],
    });
    await useChatStore.getState().loadMessages("sess-b");
    resolveA({
      sessionId: "sess-a",
      messages: [{ id: "ma", role: "user", content: "A 的", createdAt: "t" }],
    });
    await pA;
    const s = useChatStore.getState();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].id).toBe("mb");
    expect(s.messagesLoading).toBe(false);
  });
});

describe("setCurrentSession / newSession / clearSessions（U5：选择即恢复历史）", () => {
  it("setCurrentSession 设置当前会话并自动加载历史；newSession 重置为 null 并清空消息", async () => {
    mocked.getSessionMessages.mockResolvedValue({
      sessionId: "sess-1",
      messages: [{ id: "m1", role: "user", content: "历史", createdAt: "t" }],
    });
    useChatStore.getState().setCurrentSession("sess-1");
    expect(useChatStore.getState().currentSessionId).toBe("sess-1");
    await vi.waitFor(() => expect(mocked.getSessionMessages).toHaveBeenCalledWith("sess-1"));
    await vi.waitFor(() => expect(useChatStore.getState().messages).toHaveLength(1));

 // newSession：清空消息区显示「新会话」（含瞬态：streaming/disconnected/focus/提案）
    useChatStore.setState({
      streaming: true,
      disconnected: true,
      focusContext: { focus_entity_type: "character", focus_entity_id: "char-1" },
      proposals: [{ proposalId: "prop-1", type: "propose_create_entity", status: "pending" }],
 // 瞬时占用也属「旧会话视图」，必须一并清零（占用条不得显示上一会话的数值）
      contextUsage: { percent: 12, tokens: 1200, contextWindow: 10000 },
    });
    useChatStore.getState().newSession();
    const s = useChatStore.getState();
    expect(s.currentSessionId).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.streaming).toBe(false);
    expect(s.disconnected).toBe(false);
    expect(s.focusContext).toBeNull();
    expect(s.proposals).toEqual([]);
    expect(s.contextUsage).toBeNull();
  });

  it("切换会话清零瞬时占用（旧会话数值不得残留到新视图）", () => {
    mocked.getSessionMessages.mockResolvedValue({ sessionId: "sess-2", messages: [] });
    useChatStore.setState({
      currentSessionId: "sess-1",
      contextUsage: { percent: 12, tokens: 1200, contextWindow: 10000 },
      statusNote: "上下文已压缩",
    });
    useChatStore.getState().setCurrentSession("sess-2");
    expect(useChatStore.getState().contextUsage).toBeNull();
    expect(useChatStore.getState().statusNote).toBeNull();
  });

  it("切换会话中止在途 SSE 流（旧流事件不得污染新会话视图）", () => {
    const abortFn = vi.fn();
    mocked.fetchSSE.mockReturnValue(abortFn);
    useChatStore.getState().sendMessage("你好");
    expect(abortFn).not.toHaveBeenCalled();
    useChatStore.getState().setCurrentSession("sess-2");
    expect(abortFn).toHaveBeenCalledTimes(1);
  });

  it("同 id 重复点击 → 直接返回：不重载历史、不清 focusContext（避免闪屏）", async () => {
    mocked.getSessionMessages.mockResolvedValue({
      sessionId: "sess-1",
      messages: [{ id: "m1", role: "user", content: "历史", createdAt: "t" }],
    });
    useChatStore.getState().setCurrentSession("sess-1");
    await vi.waitFor(() => expect(useChatStore.getState().messages).toHaveLength(1));
    mocked.getSessionMessages.mockClear();
    useChatStore.setState({ focusContext: { focus_entity_id: "char-1" } });
    useChatStore.getState().setCurrentSession("sess-1"); // 同 id：直接返回
    expect(mocked.getSessionMessages).not.toHaveBeenCalled();
    expect(useChatStore.getState().focusContext).toEqual({ focus_entity_id: "char-1" });
    expect(useChatStore.getState().messagesLoading).toBe(false);
  });

  it("deleteSession 成功：列表移除；删的是当前会话 → 回新会话（清空消息区与瞬时读数）", async () => {
    mocked.deleteChatSession.mockResolvedValue({ deleted: true });
    mocked.getSessionMessages.mockResolvedValue({ sessionId: "sess-1", messages: [] });
    useChatStore.setState({
      sessions: [sampleSession, { ...sampleSession, id: "sess-2" }],
      currentSessionId: "sess-1",
      messages: [makeMsg({ id: "m1" })],
      contextUsage: { percent: 6, tokens: 12, contextWindow: 200 },
    });

    await useChatStore.getState().deleteSession("sess-1");

    const s = useChatStore.getState();
    expect(mocked.deleteChatSession).toHaveBeenCalledWith("sess-1");
    expect(s.sessions?.map((x) => x.id)).toEqual(["sess-2"]);
    expect(s.currentSessionId).toBeNull(); // 当前会话被删 → 新会话
    expect(s.messages).toEqual([]);
    expect(s.contextUsage).toBeNull();
    expect(useUiStore.getState().toast?.text).toBe("会话已删除；推送到云端后，另一台也会同步删除");
  });

  it("deleteSession 删非当前会话：列表移除但当前会话与消息不变", async () => {
    mocked.deleteChatSession.mockResolvedValue({ deleted: true });
    useChatStore.setState({
      sessions: [sampleSession, { ...sampleSession, id: "sess-2" }],
      currentSessionId: "sess-2",
      messages: [makeMsg({ id: "m1" })],
    });

    await useChatStore.getState().deleteSession("sess-1");

    const s = useChatStore.getState();
    expect(s.sessions?.map((x) => x.id)).toEqual(["sess-2"]);
    expect(s.currentSessionId).toBe("sess-2");
    expect(s.messages).toHaveLength(1);
  });

  it("deleteSession 409 SESSION_BUSY：列表不变 + 错误 toast + 抛出（确认框保持打开）", async () => {
    mocked.deleteChatSession.mockRejectedValue(new ApiError("SESSION_BUSY", "该会话有在途流"));
    useChatStore.setState({ sessions: [sampleSession], currentSessionId: "sess-1" });

    await expect(useChatStore.getState().deleteSession("sess-1")).rejects.toThrow("该会话有在途流");

    const s = useChatStore.getState();
    expect(s.sessions?.map((x) => x.id)).toEqual(["sess-1"]); // 不移除
    expect(s.currentSessionId).toBe("sess-1");
    expect(useUiStore.getState().toast?.text).toBe("该会话正在生成中，请稍后再删");
  });

  it("deleteSession 409 DECOMPOSE_JOB_RUNNING：列表不变 + 错误 toast + 抛出（确认框保持打开）", async () => {
    mocked.deleteChatSession.mockRejectedValue(new ApiError("DECOMPOSE_JOB_RUNNING" as never, "拆解任务仍在跑"));
    useChatStore.setState({ sessions: [sampleSession], currentSessionId: null });

    await expect(useChatStore.getState().deleteSession("decompose-job-abc")).rejects.toThrow("拆解任务仍在跑");

    const s = useChatStore.getState();
    expect(s.sessions?.map((x) => x.id)).toEqual(["sess-1"]); // 不移除
    expect(useUiStore.getState().toast?.text).toBe("拆解任务仍在跑，暂不可删该过程记录");
  });

  it("deleteSession 404 SESSION_NOT_FOUND：刷新列表 + 不抛出（对话框可关）", async () => {
    mocked.deleteChatSession.mockRejectedValue(new ApiError("SESSION_NOT_FOUND", "会话不存在"));
    mocked.listSessions.mockResolvedValue([]);
    useChatStore.setState({ sessions: [sampleSession], currentSessionId: null });

    await expect(useChatStore.getState().deleteSession("sess-1")).resolves.toBeUndefined();

    expect(mocked.listSessions).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().sessions).toEqual([]);
    expect(useUiStore.getState().toast?.text).toBe("会话不存在，已刷新列表");
  });

  it("deleteSession 网络失败：列表不变 + 全局错误条 + 抛出", async () => {
    mocked.deleteChatSession.mockRejectedValue(new ApiError("CLIENT_NETWORK_ERROR", "网络请求失败"));
    useChatStore.setState({ sessions: [sampleSession], currentSessionId: "sess-1" });

    await expect(useChatStore.getState().deleteSession("sess-1")).rejects.toThrow("网络请求失败");

    expect(useChatStore.getState().sessions?.map((x) => x.id)).toEqual(["sess-1"]);
    expect(useUiStore.getState().error?.code).toBe("CLIENT_NETWORK_ERROR");
  });

  it("clearSessions 清空列表/当前会话/消息/运行态（含中止在途流）", () => {
    const abortFn = vi.fn();
    mocked.fetchSSE.mockReturnValue(abortFn);
    useChatStore.getState().sendMessage("你好");
    useChatStore.setState({
      currentSessionId: "sess-1",
      disconnected: true,
      contextUsage: { percent: 12, tokens: 1200, contextWindow: 10000 },
    });
    useChatStore.getState().clearSessions();
    const s = useChatStore.getState();
    expect(s.contextUsage).toBeNull();
    expect(s.sessions).toBeNull();
    expect(s.currentSessionId).toBeNull();
    expect(s.sessionsError).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.streaming).toBe(false);
    expect(s.disconnected).toBe(false);
    expect(s.streamError).toBeNull();
    expect(s.focusContext).toBeNull();
    expect(abortFn).toHaveBeenCalled();
  });
});

describe("focus context 与断连标记（U5）", () => {
  it("setFocusContext / clearFocusContext", () => {
    useChatStore.getState().setFocusContext({ focus_node_id: "ch-3" });
    expect(useChatStore.getState().focusContext).toEqual({ focus_node_id: "ch-3" });
    useChatStore.getState().clearFocusContext();
    expect(useChatStore.getState().focusContext).toBeNull();
 // setFocusContext(null) 亦清除
    useChatStore.getState().setFocusContext({ focus_entity_id: "char-1" });
    useChatStore.getState().setFocusContext(null);
    expect(useChatStore.getState().focusContext).toBeNull();
  });

  it("setDisconnected", () => {
    useChatStore.getState().setDisconnected(true);
    expect(useChatStore.getState().disconnected).toBe(true);
    useChatStore.getState().setDisconnected(false);
    expect(useChatStore.getState().disconnected).toBe(false);
  });
});

describe("describeStreamError（错误文案映射）", () => {
  it("HTTP 404 → 通用防御文案「聊天服务暂不可用」（旧构建/服务未起）", () => {
    expect(describeStreamError("CLIENT_NETWORK_ERROR", "SSE 请求失败（HTTP 404）")).toBe(
      "聊天服务暂不可用",
    );
  });

  it("网络失败 → 连接失败提示", () => {
    expect(describeStreamError("CLIENT_NETWORK_ERROR", "fetch failed")).toBe(
      "连接失败，请确认服务已启动",
    );
  });

  it("非 2xx 无 REST 包裹（proxy 500）→ 透传 HTTP 状态文案，不误判「连接失败」", () => {
    expect(describeStreamError("CLIENT_NETWORK_ERROR", "SSE 请求失败（HTTP 500）")).toBe(
      "SSE 请求失败（HTTP 500）",
    );
  });

  it("服务端错误码 → 可执行文案（CHAT_BUSY / SESSION_BUSY / LLM_API_KEY_MISSING / SESSION_NOT_FOUND / NO_PROJECT_OPEN）", () => {
    expect(describeStreamError("CHAT_BUSY", "busy")).toContain("正在生成的对话");
    expect(describeStreamError("SESSION_BUSY", "busy")).toContain("正在生成中");
    expect(describeStreamError("LLM_API_KEY_MISSING", "no key")).toContain("设置页");
    expect(describeStreamError("SESSION_NOT_FOUND", "gone")).toContain("新建会话");
    expect(describeStreamError("NO_PROJECT_OPEN", "none")).toContain("未打开项目");
  });

  it("未知码 → 透传 message（agent_end 的 stopReason=error 走此分支）", () => {
    expect(describeStreamError("AGENT_ERROR", "模型调用失败：429")).toBe("模型调用失败：429");
  });
});
describe("describeProposalActionError（S8.2：提案动作非错误文案）", () => {
  it("INTERNAL_ERROR（500 执行失败）→ 引导重新生成提案", () => {
    expect(describeProposalActionError("INTERNAL_ERROR", "提案执行失败")).toBe(
      "提案执行失败，请让 AI 重新生成提案",
    );
  });

  it("CLIENT_NETWORK_ERROR → 网络重试文案（不透传原始 fetch 错误）", () => {
    expect(describeProposalActionError("CLIENT_NETWORK_ERROR", "fetch failed")).toBe(
      "网络请求失败，请重试",
    );
  });

  it("未知码 → 透传服务端 message（防御兜底）", () => {
    expect(describeProposalActionError("SOMETHING_ELSE", "服务端消息")).toBe("服务端消息");
  });
});

describe("sendMessage（POST /chat + SSE 事件映射，契约 = docs/api/80-api-chat.md）", () => {
  it("发送 → streaming=true + 乐观追加 user 消息与 AI 占位；body 仅 message（新会话）", () => {
    useChatStore.getState().sendMessage("你好");
    const s = useChatStore.getState();
    expect(s.streaming).toBe(true);
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0]).toMatchObject({ role: "user", content: "你好" });
    expect(s.messages[1]).toMatchObject({ role: "assistant", content: "" });
    const opts = sseOptions();
    expect(opts.body).toEqual({ message: "你好" });
    expect(opts.onEvent).toBeTypeOf("function");
  });

  it("带会话与 focus context → body 含 session_id / context（snake_case）", () => {
    useChatStore.setState({
      currentSessionId: "sess-1",
      focusContext: { focus_entity_type: "character", focus_entity_id: "char-1" },
    });
    useChatStore.getState().sendMessage("分析张三");
    expect(sseOptions().body).toEqual({
      message: "分析张三",
      session_id: "sess-1",
      context: { focus_entity_type: "character", focus_entity_id: "char-1" },
    });
  });

  it("空文本 / 纯空白 → 不发送", () => {
    useChatStore.getState().sendMessage("");
    useChatStore.getState().sendMessage("   ");
    expect(mocked.fetchSSE).not.toHaveBeenCalled();
  });

  it("streaming 中重复发送被拒绝", () => {
    useChatStore.setState({ streaming: true });
    useChatStore.getState().sendMessage("再来一句");
    expect(mocked.fetchSSE).not.toHaveBeenCalled();
  });

  it("历史加载中（messagesLoading）发送被拒（乐观消息会被 set({messages}) 整体覆盖）", () => {
    useChatStore.setState({ messagesLoading: true });
    useChatStore.getState().sendMessage("加载中发送");
    expect(mocked.fetchSSE).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("session 首帧 → 记录 currentSessionId（新会话续聊身份）", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("session", { session_id: "sess-new-1" });
    expect(useChatStore.getState().currentSessionId).toBe("sess-new-1");
    // 非法负载忽略（不写入空串）
    onEvent("session", { session_id: "" });
    expect(useChatStore.getState().currentSessionId).toBe("sess-new-1");
  });

  it("message_update 的 text_delta → 正文累积；ping/未知事件不改变状态", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("message_update", { assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "我" } });
    onEvent("ping", {});
    onEvent("turn_start", {});
    onEvent("message_update", { assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "好" } });
    expect(useChatStore.getState().messages[1]).toMatchObject({ role: "assistant", content: "我好" });
  });

  it("message_update 的 thinking 事件 → 全量累积 + 流式标记（thinking_end 收尾）", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("message_update", { assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } });
    expect(useChatStore.getState().messages[1].thinkingStreaming).toBe(true);
    onEvent("message_update", { assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "先看" } });
    onEvent("message_update", { assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "大纲" } });
    expect(useChatStore.getState().messages[1].thinkingText).toBe("先看大纲");
    // thinking_end：帧里只有 240 字预览，客户端保留已累积的全量并收尾折叠
    onEvent("message_update", {
      assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "先看大纲", contentLength: 4 },
    });
    const m = useChatStore.getState().messages[1];
    expect(m.thinkingText).toBe("先看大纲");
    expect(m.thinkingStreaming).toBe(false);
  });

  it("message_end（assistant）→ 终态投影为权威（正文/工具调用/思维链预览）+ 保留全量思维链", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("message_update", { assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "草稿" } });
    onEvent("message_update", { assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "推理全文" } });
    onEvent("message_end", {
      message: {
        role: "assistant",
        content: "终态正文",
        thinking: [{ preview: "推理全文", deferred: true, blockIndex: 0, length: 4 }],
        toolCalls: [{ id: "call-1", name: "get_entity", arguments: { id: "char-1" } }],
        createdAt: "2026-08-01T10:00:00Z",
      },
    });
    const m = useChatStore.getState().messages[1];
    expect(m.content).toBe("终态正文"); // 权威覆盖流式累积
    expect(m.thinkingText).toBe("推理全文");
    expect(m.thinking).toEqual([{ preview: "推理全文", deferred: true, blockIndex: 0, length: 4 }]);
    expect(m.toolCalls).toEqual([{ id: "call-1", name: "get_entity", arguments: { id: "char-1" } }]);
  });

  it("tool_execution_start/end（AUTO 工具）→ 工具卡 running→ok；无 details 不入提案", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("tool_execution_start", { toolCallId: "call-1", toolName: "get_entity", args: { id: "char-1" } });
    expect(useChatStore.getState().streamTools).toEqual([
      { id: "call-1", tool: "get_entity", args: { id: "char-1" }, status: "running" },
    ]);
    onEvent("tool_execution_end", {
      toolCallId: "call-1",
      toolName: "get_entity",
      result: { content: [{ type: "text", text: '{"name":"张三"}' }] },
      isError: false,
    });
    expect(useChatStore.getState().streamTools[0]).toMatchObject({
      status: "ok",
      result: '{"name":"张三"}',
      isError: false,
    });
    expect(useChatStore.getState().proposals).toEqual([]);
  });

  it("tool_execution_end 失败 → 工具卡 error（isError 透传）", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("tool_execution_start", { toolCallId: "call-2", toolName: "detect_conflicts", args: {} });
    onEvent("tool_execution_end", {
      toolCallId: "call-2",
      toolName: "detect_conflicts",
      result: { content: [{ type: "text", text: "工具执行失败：boom" }] },
      isError: true,
    });
    expect(useChatStore.getState().streamTools[0]).toMatchObject({
      status: "error",
      isError: true,
      result: "工具执行失败：boom",
    });
  });

  it("tool_execution_end（PROPOSAL 工具）→ details 载荷生成提案卡", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("tool_execution_start", {
      toolCallId: "call-3",
      toolName: "propose_create_entity",
      args: { type: "character", name: "张三" },
    });
    onEvent("tool_execution_end", {
      toolCallId: "call-3",
      toolName: "propose_create_entity",
      result: {
        content: [{ type: "text", text: "提案已发出" }],
        details: {
          proposal_id: "prop_1",
          type: "propose_create_entity",
          preview: { summary: "创建角色张三" },
        },
      },
      isError: false,
    });
    expect(useChatStore.getState().proposals).toEqual([
      {
        proposalId: "prop_1",
        type: "propose_create_entity",
        preview: { summary: "创建角色张三" },
        status: "pending",
      },
    ]);
  });

  it("turn_end / agent_end 的 contextUsage → 占用条数据（agent_end 同时收尾 + 刷新列表）", async () => {
    mocked.listSessions.mockResolvedValue([sampleSession]);
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("turn_end", { toolResults: [], contextUsage: { percent: 12, tokens: 1200, contextWindow: 10000 } });
    expect(useChatStore.getState().contextUsage).toEqual({ percent: 12, tokens: 1200, contextWindow: 10000 });
    onEvent("agent_end", { contextUsage: { percent: 15, tokens: 1500, contextWindow: 10000 } });
    const s = useChatStore.getState();
    expect(s.streaming).toBe(false);
    expect(s.contextUsage).toEqual({ percent: 15, tokens: 1500, contextWindow: 10000 });
    await vi.waitFor(() => expect(mocked.listSessions).toHaveBeenCalled());
  });

  it("agent_end 无/非法 contextUsage → 不覆盖上一轮数值（parseContextUsage 拦截）", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("turn_end", { contextUsage: { percent: 12, tokens: 1200, contextWindow: 10000 } });
    onEvent("agent_end", { contextUsage: { percent: "12", tokens: 1200, contextWindow: 10000 } });
    expect(useChatStore.getState().contextUsage).toEqual({ percent: 12, tokens: 1200, contextWindow: 10000 });
  });

  it("parseContextUsage：非对象 / 字段非有限数 / 窗口非正 → null", () => {
    expect(parseContextUsage(undefined)).toBeNull();
    expect(parseContextUsage(null)).toBeNull();
    expect(parseContextUsage("12")).toBeNull();
    expect(parseContextUsage({ percent: 12 })).toBeNull();
    expect(parseContextUsage({ percent: "12", tokens: 1, contextWindow: 10 })).toBeNull();
    expect(parseContextUsage({ percent: 12, tokens: 1, contextWindow: 0 })).toBeNull();
    expect(parseContextUsage({ percent: 12, tokens: -1, contextWindow: 10 })).toBeNull();
    expect(parseContextUsage({ percent: Number.NaN, tokens: 1, contextWindow: 10 })).toBeNull();
    expect(parseContextUsage({ percent: 12, tokens: 1, contextWindow: 10 })).toEqual({
      percent: 12,
      tokens: 1,
      contextWindow: 10,
    });
  });

  it("agent_end stopReason=error → 错误条（透传 errorMessage）+ streaming 收尾", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("agent_end", { stopReason: "error", errorMessage: "模型调用失败：429" });
    const s = useChatStore.getState();
    expect(s.streaming).toBe(false);
    expect(s.streamError).toBe("模型调用失败：429");
  });

  it("agent_end stopReason=aborted → 不报错（断连横幅/主动停止表达取消）", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("agent_end", { stopReason: "aborted" });
    expect(useChatStore.getState().streamError).toBeNull();
  });

  it("compaction / auto_retry 事件 → statusNote 轻量提示（agent_end 清空）", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("compaction_start", { reason: "threshold" });
    expect(useChatStore.getState().statusNote).toContain("压缩");
    onEvent("compaction_end", { reason: "threshold", aborted: false, willRetry: false });
    expect(useChatStore.getState().statusNote).toContain("已压缩");
    onEvent("auto_retry_start", { attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "429" });
    expect(useChatStore.getState().statusNote).toContain("1/3");
    onEvent("auto_retry_end", { success: true, attempt: 1 });
    expect(useChatStore.getState().statusNote).toBeNull();
    onEvent("compaction_start", { reason: "overflow" });
    onEvent("agent_end", {});
    expect(useChatStore.getState().statusNote).toBeNull();
  });

  it("error 事件（HTTP 级）→ 文案映射 + streaming=false + 输入恢复", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("error", { code: "CHAT_BUSY", message: "busy" });
    const s = useChatStore.getState();
    expect(s.streaming).toBe(false);
    expect(s.streamError).toBe("当前项目已有正在生成的对话，请稍后再试");
  });

  it("error SESSION_NOT_FOUND → 丢弃会话身份（下一条消息新建会话）", () => {
    useChatStore.setState({ currentSessionId: "sess-gone" });
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("error", { code: "SESSION_NOT_FOUND", message: "会话不存在" });
    const s = useChatStore.getState();
    expect(s.currentSessionId).toBeNull();
    expect(s.streamError).toContain("新建会话");
  });

  it("旧构建/服务未起（HTTP 404）→ 错误条通用防御文案「聊天服务暂不可用」", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("error", { code: "CLIENT_NETWORK_ERROR", message: "SSE 请求失败（HTTP 404）" });
    expect(useChatStore.getState().streamError).toBe("聊天服务暂不可用");
  });

  it("全序列（session→text/thinking→tool→agent_end）：正文/思维链/工具卡/占用条一致", async () => {
    mocked.listSessions.mockResolvedValue([sampleSession]);
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("session", { session_id: "sess_pi_1" });
    onEvent("ping", {});
    onEvent("agent_start", {});
    onEvent("turn_start", {});
    onEvent("message_start", { message: { role: "assistant", content: "", createdAt: "t" } });
    onEvent("message_update", { assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "先查大纲" } });
    onEvent("message_update", { assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "第一段" } });
    onEvent("tool_execution_start", { toolCallId: "call_1", toolName: "get_outline", args: {} });
    onEvent("tool_execution_end", {
      toolCallId: "call_1",
      toolName: "get_outline",
      result: { content: [{ type: "text", text: "{}" }] },
      isError: false,
    });
    onEvent("turn_end", { toolResults: [], contextUsage: { percent: 8, tokens: 800, contextWindow: 10000 } });
    onEvent("message_update", { assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "完成" } });
    onEvent("agent_end", { contextUsage: { percent: 9, tokens: 900, contextWindow: 10000 } });

    const s = useChatStore.getState();
    expect(s.currentSessionId).toBe("sess_pi_1");
    expect(s.messages[1]).toMatchObject({
      role: "assistant",
      content: "第一段完成",
      thinkingText: "先查大纲",
      thinkingStreaming: false,
    });
    expect(s.streamTools).toEqual([
      { id: "call_1", tool: "get_outline", args: {}, result: "{}", isError: false, status: "ok" },
    ]);
    expect(s.contextUsage).toEqual({ percent: 9, tokens: 900, contextWindow: 10000 });
    expect(s.streaming).toBe(false);
    await vi.waitFor(() => expect(mocked.listSessions).toHaveBeenCalled());
  });

  it("onTimeout（60s 无事件）→ disconnected=true + streaming=false + 清空提案/工具卡", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent, onTimeout } = sseOptions();
    onEvent("tool_execution_start", { toolCallId: "call-1", toolName: "get_entity", args: {} });
    onEvent("tool_execution_end", {
      toolCallId: "call-1",
      toolName: "propose_create_entity",
      result: { content: [], details: { proposal_id: "prop_1", type: "propose_create_entity", preview: {} } },
      isError: false,
    });
    expect(useChatStore.getState().proposals).toHaveLength(1);
    onTimeout();
    const s = useChatStore.getState();
    expect(s.disconnected).toBe(true);
    expect(s.streaming).toBe(false);
    expect(s.proposals).toEqual([]);
    expect(s.streamTools).toEqual([]);
  });

  it("onEnd（流正常关闭）→ streaming 兜底复位", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEnd } = sseOptions();
    expect(useChatStore.getState().streaming).toBe(true);
    onEnd();
    expect(useChatStore.getState().streaming).toBe(false);
  });

  it("resendLast（断连横幅 [重新发送]）→ 移除残留重复消息后重发", () => {
    useChatStore.getState().sendMessage("你好");
    const { onTimeout } = sseOptions();
    onTimeout(); // 断连（AI 占位无产出）
    mocked.fetchSSE.mockClear();
    useChatStore.getState().resendLast();
    expect(mocked.fetchSSE).toHaveBeenCalledTimes(1);
    const s = useChatStore.getState();
    expect(s.disconnected).toBe(false);
    expect(s.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(s.messages[0].content).toBe("你好");
  });

  it("resendLast：部分产出后断连 → 半截 AI 回答一并移除（断连语义 = 整轮取消）", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent, onTimeout } = sseOptions();
    onEvent("message_update", { assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "我" } });
    onEvent("message_update", { assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "好" } });
    onTimeout();
    mocked.fetchSSE.mockClear();
    useChatStore.getState().resendLast();
    expect(mocked.fetchSSE).toHaveBeenCalledTimes(1);
    const s = useChatStore.getState();
    const assistants = s.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].content).toBe("");
    expect(s.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(s.messages[0].content).toBe("你好");
  });

  it("流身份守卫：agent_end 后微窗口内新发一轮，旧流 onEnd/onTimeout 不得污染新流", () => {
    useChatStore.getState().sendMessage("第一轮");
    const first = sseOptions();
    first.onEvent("agent_end", {});
    useChatStore.getState().sendMessage("第二轮");
    expect(useChatStore.getState().streaming).toBe(true);
    first.onEnd();
    first.onTimeout();
    const s = useChatStore.getState();
    expect(s.streaming).toBe(true);
    expect(s.disconnected).toBe(false);
    sseOptions().onEnd();
    expect(useChatStore.getState().streaming).toBe(false);
  });

  it("流身份守卫：旧流的迟到事件帧（session / tool_execution_start / compaction）不得污染新视图（K6 oracle D2 回归）", () => {
    useChatStore.getState().sendMessage("第一轮");
    const first = sseOptions();
    first.onEvent("session", { session_id: "sess-first" });
    // 切会话（abort 在途）后开新流
    useChatStore.getState().newSession();
    useChatStore.getState().sendMessage("第二轮");
    sseOptions().onEvent("session", { session_id: "sess-second" });
    const before = useChatStore.getState();

    // 旧流迟到帧：会话身份 / 工具卡 / 状态提示均不得被改写
    first.onEvent("session", { session_id: "sess-stale" });
    first.onEvent("tool_execution_start", { toolCallId: "stale-1", toolName: "get_outline", args: {} });
    first.onEvent("compaction_start", { reason: "threshold" });
    first.onEvent("auto_retry_start", { attempt: 1, maxAttempts: 3, delayMs: 10, errorMessage: "x" });

    const after = useChatStore.getState();
    expect(after.currentSessionId).toBe("sess-second");
    expect(after.streamTools).toEqual(before.streamTools);
    expect(after.statusNote).toBe(before.statusNote);
  });

  it("思维链四条终止路径都收尾折叠（agent_end / error / 超时 / EOF）", () => {
    const cases = [
      (o: ReturnType<typeof sseOptions>) => o.onEvent("agent_end", {}),
      (o: ReturnType<typeof sseOptions>) => o.onEvent("error", { code: "NETWORK_ERROR", message: "x" }),
      (o: ReturnType<typeof sseOptions>) => o.onTimeout(),
      (o: ReturnType<typeof sseOptions>) => o.onEnd(),
    ];
    for (const terminate of cases) {
      useChatStore.getState().newSession();
      useChatStore.getState().sendMessage("问");
      const opts = sseOptions();
      opts.onEvent("message_update", { assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "推理" } });
      expect(useChatStore.getState().messages.some((m) => m.thinkingStreaming === true)).toBe(true);
      terminate(opts);
      expect(useChatStore.getState().messages.some((m) => m.thinkingStreaming === true)).toBe(false);
    }
  });
});
describe("confirmProposal / rejectProposal（S8.2：提案卡接入 S7.5 confirm/reject 真实调用）", () => {
  it("confirm 成功 → status=confirmed + processing 复位（终态，按钮禁用由 status 驱动）", async () => {
    mocked.confirmProposal.mockResolvedValue({ confirmed: true, result: "char-9" });
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    await useChatStore.getState().confirmProposal("prop-1");
    expect(mocked.confirmProposal).toHaveBeenCalledWith("prop-1");
    expect(useChatStore.getState().proposals).toEqual([
      {
        proposalId: "prop-1",
        type: "propose_create_entity",
        status: "confirmed",
        processing: false,
      },
    ]);
  });

  it("confirm 成功 → 触发数据变更信号（问题 1：notifyDataChanged，中栏页面重拉）", async () => {
    mocked.confirmProposal.mockResolvedValue({ confirmed: true, result: "char-9" });
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    const before = useUiStore.getState().dataVersion;
    await useChatStore.getState().confirmProposal("prop-1");
    expect(useUiStore.getState().dataVersion).toBe(before + 1);
  });

  it("reject 成功 → 不触发数据变更信号（不改数据）", async () => {
    mocked.rejectProposal.mockResolvedValue({ rejected: true });
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    const before = useUiStore.getState().dataVersion;
    await useChatStore.getState().rejectProposal("prop-1");
    expect(useUiStore.getState().dataVersion).toBe(before);
  });

  it("reject 成功 → status=rejected", async () => {
    mocked.rejectProposal.mockResolvedValue({ rejected: true });
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    await useChatStore.getState().rejectProposal("prop-1");
    expect(mocked.rejectProposal).toHaveBeenCalledWith("prop-1");
    expect(useChatStore.getState().proposals[0]).toMatchObject({
      status: "rejected",
      processing: false,
    });
  });

  it("409 PROPOSAL_STALE → status=stale（卡标「⚠ 数据已变化，此提案已失效」+ 按钮禁用）", async () => {
    mocked.confirmProposal.mockRejectedValue(
      new ApiError("PROPOSAL_STALE", "提案引用对象已变化: entity char-9"),
    );
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    await useChatStore.getState().confirmProposal("prop-1");
    expect(useChatStore.getState().proposals[0]).toMatchObject({
      status: "stale",
      processing: false,
    });
  });

  it("404 PROPOSAL_NOT_FOUND → 移除卡片（提案已过期清除/SSE 断开作废）", async () => {
    mocked.confirmProposal.mockRejectedValue(
      new ApiError("PROPOSAL_NOT_FOUND", "提案不存在或已过期"),
    );
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    await useChatStore.getState().confirmProposal("prop-1");
    expect(useChatStore.getState().proposals).toEqual([]);
  });

  it("409 PROPOSAL_PROJECT_MISMATCH → 移除卡片（防御：切项目已清空提案，理论不可达）", async () => {
    mocked.rejectProposal.mockRejectedValue(
      new ApiError("PROPOSAL_PROJECT_MISMATCH", "提案所属项目与当前项目不一致"),
    );
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    await useChatStore.getState().rejectProposal("prop-1");
    expect(useChatStore.getState().proposals).toEqual([]);
  });

  it("其他错误（500 INTERNAL_ERROR 执行失败）→ 保持 pending 可重试 + toast 错误提示（U6 全局反馈）", async () => {
 // INTERNAL_ERROR 不在 shared ErrorCode 枚举（proposal.ts 注释：未定义该错误码，前端按通用错误呈现）——
 // 运行时错误码是普通字符串，store default 分支按字符串匹配，测试构造仅需类型断言
    mocked.confirmProposal.mockRejectedValue(
      new ApiError("INTERNAL_ERROR" as ErrorCode, "提案执行失败"),
    );
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    await useChatStore.getState().confirmProposal("prop-1");
    expect(useChatStore.getState().proposals[0]).toMatchObject({
      status: "pending",
      processing: false,
    });
    expect(useUiStore.getState().toast).toMatchObject({
      kind: "error",
      text: "提案执行失败，请让 AI 重新生成提案",
    });
  });

  it("网络失败（CLIENT_NETWORK_ERROR）→ 保持 pending + toast 网络重试文案", async () => {
    mocked.confirmProposal.mockRejectedValue(new ApiError("CLIENT_NETWORK_ERROR", "fetch failed"));
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    await useChatStore.getState().confirmProposal("prop-1");
    expect(useChatStore.getState().proposals[0]).toMatchObject({
      status: "pending",
      processing: false,
    });
    expect(useUiStore.getState().toast?.text).toBe("网络请求失败，请重试");
  });

  it("防重复：处理中（processing）再次调用忽略，API 只调一次", async () => {
    let resolveFirst: (v: { confirmed: true; result: unknown }) => void = () => {};
    mocked.confirmProposal.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    const p1 = useChatStore.getState().confirmProposal("prop-1");
 // 在途（processing=true）：重复点击被状态层忽略
    await useChatStore.getState().confirmProposal("prop-1");
    expect(mocked.confirmProposal).toHaveBeenCalledTimes(1);
    resolveFirst({ confirmed: true, result: undefined });
    await p1;
    expect(useChatStore.getState().proposals[0]).toMatchObject({ status: "confirmed" });
  });

  it("防重复：非 pending（已确认）再次调用忽略", async () => {
    useChatStore.setState({
      proposals: [makeProposal({ proposalId: "prop-1", status: "confirmed" })],
    });
    await useChatStore.getState().confirmProposal("prop-1");
    expect(mocked.confirmProposal).not.toHaveBeenCalled();
  });

  it("卡片不存在（已移除/幽灵 id）→ 忽略，不调 API", async () => {
    await useChatStore.getState().confirmProposal("prop-ghost");
    expect(mocked.confirmProposal).not.toHaveBeenCalled();
  });
});

describe("项目切换联动（U5：清空消息/运行态 + 中止在途流）", () => {
  it("打开项目（config null → id）→ 清空并自动加载会话列表并激活最近会话", async () => {
    mocked.listSessions.mockResolvedValue([sampleSession]);
    useChatStore.setState({ currentSessionId: "sess-old", sessions: [sampleSession] });
    useProjectStore.setState({ config: makeConfig("proj-a") });
    await vi.waitFor(() => expect(useChatStore.getState().sessions).toEqual([sampleSession]));
    expect(mocked.listSessions).toHaveBeenCalledTimes(1);
 // 切项目时旧项目会话不残留；新项目列表加载后自动激活最近会话（问题 2 行为）
    await vi.waitFor(() => expect(useChatStore.getState().currentSessionId).toBe("sess-1"));
  });

  it("关闭项目（config → null）→ 清空会话且不请求", async () => {
    useProjectStore.setState({ config: makeConfig("proj-a") });
    await vi.waitFor(() => expect(mocked.listSessions).toHaveBeenCalledTimes(1));
    mocked.listSessions.mockClear();
    useProjectStore.setState({ config: null });
    const s = useChatStore.getState();
    expect(s.sessions).toBeNull();
    expect(s.currentSessionId).toBeNull();
    expect(mocked.listSessions).not.toHaveBeenCalled();
  });

  it("切项目 → 清空消息/streaming/disconnected/focusContext 并中止在途 SSE 流", async () => {
    const abortFn = vi.fn();
    mocked.fetchSSE.mockReturnValue(abortFn);
 // 在途流：sendMessage 建立（streaming=true + abortCurrentStream 挂载）
    useChatStore.getState().sendMessage("你好");
 // 注入切项目前应被清理的残留状态（focusContext 不被发送流程触碰，可真实模拟）
    useChatStore.setState({
      focusContext: { focus_entity_id: "char-1" },
      disconnected: true,
      proposals: [{ proposalId: "prop-1", type: "propose_create_entity", status: "pending" }],
    });
    expect(abortFn).not.toHaveBeenCalled();
    useProjectStore.setState({ config: makeConfig("proj-b") });
    const s = useChatStore.getState();
    expect(abortFn).toHaveBeenCalledTimes(1);
    expect(s.messages).toEqual([]);
    expect(s.streaming).toBe(false);
    expect(s.disconnected).toBe(false);
    expect(s.focusContext).toBeNull();
    expect(s.proposals).toEqual([]);
    expect(s.streamError).toBeNull();
 // 新项目列表自动加载
    mocked.listSessions.mockResolvedValue([sampleSession]);
    await vi.waitFor(() => expect(useChatStore.getState().sessions).toEqual([sampleSession]));
  });

  it("加载中切项目：旧请求响应不覆盖新项目状态（竞态保护）", async () => {
    let resolveFirst: (v: ChatSessionSummary[]) => void = () => {};
    mocked.listSessions.mockImplementationOnce(
      () => new Promise<ChatSessionSummary[]>((r) => (resolveFirst = r)),
    );
    const sessionA = { ...sampleSession, id: "sess-a", lastMessage: "A 的会话" };
    const sessionB = { ...sampleSession, id: "sess-b", lastMessage: "B 的会话" };
 // 打开项目 A → 列表请求挂起
    useProjectStore.setState({ config: makeConfig("proj-a") });
    expect(useChatStore.getState().sessionsLoading).toBe(true);
 // 切到项目 B → 新请求立即返回
    mocked.listSessions.mockResolvedValueOnce([sessionB]);
    useProjectStore.setState({ config: makeConfig("proj-b") });
    await vi.waitFor(() => expect(useChatStore.getState().sessions).toEqual([sessionB]));
 // 旧请求（A）此刻才完成 → 必须被作废
    resolveFirst([sessionA]);
    await Promise.resolve();
    expect(useChatStore.getState().sessions).toEqual([sessionB]);
    expect(useChatStore.getState().sessionsLoading).toBe(false);
  });

  it("requestFocusInput 递增聚焦信号（问 AI 无焦点时也聚焦输入框）", () => {
    const before = useChatStore.getState().focusInputSeq;
    useChatStore.getState().requestFocusInput();
    useChatStore.getState().requestFocusInput();
    expect(useChatStore.getState().focusInputSeq).toBe(before + 2);
  });
});

