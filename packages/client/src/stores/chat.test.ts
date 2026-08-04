// chat store 测试（U3 会话列表/当前会话选择/项目切换联动 + U5 消息流/SSE 运行态/focus/断连）
// 订阅在 chat.ts 模块加载时激活：测试通过操作 useProjectStore.setState({config}) 驱动联动
// mock lib/api 模块（保留 ApiError 类真实实现）与 use-sse（fetchSSE 捕获 options 后手动驱动事件回调）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatSessionSummary, ErrorCode, ProjectConfig } from "@whispering233/ai-editor-shared";
import { ApiError } from "../lib/api";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    listSessions: vi.fn(),
    getSessionMessages: vi.fn(),
    confirmProposal: vi.fn(),
    rejectProposal: vi.fn(),
  };
});

vi.mock("../hooks/use-sse", () => ({
  fetchSSE: vi.fn(() => () => {}),
}));

import {
  confirmProposal as apiConfirmProposal,
  getSessionMessages as apiGetSessionMessages,
  listSessions as apiListSessions,
  rejectProposal as apiRejectProposal,
} from "../lib/api";
import { fetchSSE } from "../hooks/use-sse";
import { describeProposalActionError, describeStreamError, useChatStore, type ProposalCard } from "./chat";
import { useProjectStore } from "./project";
import { useUiStore } from "./ui";

const mocked = {
  listSessions: vi.mocked(apiListSessions),
  getSessionMessages: vi.mocked(apiGetSessionMessages),
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
  prompt: "",
  schemaVersion: 1,
  currentPosition: null,
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z",
});

const makeMsg = (over: Partial<ChatMessage> & { id: string }): ChatMessage => ({
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
    // sessions[0] = 服务端按最后活动倒序的最近会话（决策 22「一项目一会话」心智）
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
  it("成功 → messages 设置（响应条目补全 sessionId，shared ChatMessage 契约）", async () => {
    mocked.getSessionMessages.mockResolvedValue({
      sessionId: "sess-1",
      messages: [
        { id: "m1", role: "user", content: "你好", createdAt: "t0" },
        { id: "m2", role: "assistant", content: "你好！", toolCalls: [{ id: "call-1", tool: "get_entity" }], createdAt: "t1" },
        { id: "m3", role: "tool", toolCallId: "call-1", content: "{\"name\":\"张三\"}", createdAt: "t2" },
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
    mocked.getSessionMessages.mockRejectedValue(new ApiError("CLIENT_NETWORK_ERROR", "网络请求失败"));
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
    resolveA({ sessionId: "sess-a", messages: [{ id: "ma", role: "user", content: "A 的", createdAt: "t" }] });
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
    });
    useChatStore.getState().newSession();
    const s = useChatStore.getState();
    expect(s.currentSessionId).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.streaming).toBe(false);
    expect(s.disconnected).toBe(false);
    expect(s.focusContext).toBeNull();
    expect(s.proposals).toEqual([]);
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

  it("clearSessions 清空列表/当前会话/消息/运行态（含中止在途流）", () => {
    const abortFn = vi.fn();
    mocked.fetchSSE.mockReturnValue(abortFn);
    useChatStore.getState().sendMessage("你好");
    useChatStore.setState({ currentSessionId: "sess-1", disconnected: true });
    useChatStore.getState().clearSessions();
    const s = useChatStore.getState();
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

describe("describeStreamError（U5：错误文案映射）", () => {
  it("HTTP 404 → 通用防御文案「聊天服务暂不可用」（S8.1：S7 已实现，分支仅防旧构建/服务未起）", () => {
    expect(describeStreamError("CLIENT_NETWORK_ERROR", "SSE 请求失败（HTTP 404）")).toBe("聊天服务暂不可用");
  });

  it("网络失败 → 连接失败提示", () => {
    expect(describeStreamError("CLIENT_NETWORK_ERROR", "fetch failed")).toBe("连接失败，请确认服务已启动");
  });

  it("非 2xx 无 REST 包裹（proxy 500）→ 透传 HTTP 状态文案，不误判「连接失败」（S8.1 oracle S2）", () => {
    expect(describeStreamError("CLIENT_NETWORK_ERROR", "SSE 请求失败（HTTP 500）")).toBe("SSE 请求失败（HTTP 500）");
  });

  it("服务端 error 事件 → 透传 message", () => {
    expect(describeStreamError("AGENT_TIMEOUT", "单轮超时")).toBe("单轮超时");
  });
});

describe("describeProposalActionError（S8.2：提案动作非契约错误文案）", () => {
  it("INTERNAL_ERROR（500 执行失败）→ 引导重新生成提案", () => {
    expect(describeProposalActionError("INTERNAL_ERROR", "提案执行失败")).toBe("提案执行失败，请让 AI 重新生成提案");
  });

  it("CLIENT_NETWORK_ERROR → 网络重试文案（不透传原始 fetch 错误）", () => {
    expect(describeProposalActionError("CLIENT_NETWORK_ERROR", "fetch failed")).toBe("网络请求失败，请重试");
  });

  it("未知码 → 透传服务端 message（防御兜底）", () => {
    expect(describeProposalActionError("SOMETHING_ELSE", "服务端消息")).toBe("服务端消息");
  });
});

describe("sendMessage（U5：POST /chat + SSE 事件映射）", () => {
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

  it("text 事件 → delta 追加到流式 AI 消息（直接追加，无打字效果）", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("text", { delta: "我" });
    onEvent("text", { delta: "好" });
    onEvent("ping", {});
    expect(useChatStore.getState().messages[1]).toMatchObject({ role: "assistant", content: "我好" });
  });

  it("tool_call / tool_result 事件 → 运行时工具记录（成对更新；result 为字符串——S8.1 对齐 S7.6 帧契约）", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("tool_call", { tool: "get_entity", args: { id: "char-1" }, id: "call-1" });
    expect(useChatStore.getState().streamTools).toEqual([
      { id: "call-1", tool: "get_entity", args: { id: "char-1" }, status: "running" },
    ]);
    // S7.6 帧事实契约（chat.test.ts）：result 为字符串——JSON.stringify 结果或错误文案，非对象
    onEvent("tool_result", { tool: "get_entity", result: JSON.stringify({ name: "张三" }), id: "call-1" });
    expect(useChatStore.getState().streamTools[0]).toMatchObject({
      status: "ok",
      result: JSON.stringify({ name: "张三" }),
    });
  });

  it("proposal 事件 → 提案卡累积（pending）", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("proposal", { proposal_id: "prop-1", type: "propose_update_entity", preview: { from: 1, to: 2 } });
    expect(useChatStore.getState().proposals).toEqual([
      { proposalId: "prop-1", type: "propose_update_entity", preview: { from: 1, to: 2 }, status: "pending" },
    ]);
  });

  it("done 事件 → streaming=false + currentSessionId 更新（续聊）+ 刷新会话列表", async () => {
    mocked.listSessions.mockResolvedValue([sampleSession]);
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("done", { session_id: "sess-new" });
    const s = useChatStore.getState();
    expect(s.streaming).toBe(false);
    expect(s.currentSessionId).toBe("sess-new");
    await vi.waitFor(() => expect(mocked.listSessions).toHaveBeenCalled());
  });

  it("S8.1 联调：ping+text×n+tool_call+tool_result+proposal+done 全序列（对齐 chat.test.ts 帧断言）", async () => {
    mocked.listSessions.mockResolvedValue([sampleSession]);
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    // 心跳（空 payload，决策 20）：不产生任何状态变化
    onEvent("ping", {});
    // text 流式追加（多段；与 tool 轮次交错）
    onEvent("text", { delta: "第一段" });
    onEvent("text", { delta: "第二段" });
    // tool_call → 工具行 running
    onEvent("tool_call", { tool: "propose_create_entity", args: { type: "character", name: "张三" }, id: "call_1" });
    // tool_result（S7.6 帧契约：result 为字符串；proposal 在对应 tool_result 之后）
    onEvent("tool_result", {
      tool: "propose_create_entity",
      result: JSON.stringify({ proposal_id: "prop_1", summary: "创建角色张三" }),
      id: "call_1",
    });
    onEvent("proposal", {
      proposal_id: "prop_1",
      type: "propose_create_entity",
      preview: { type: "propose_create_entity", summary: "创建角色张三", args: { type: "character", name: "张三" } },
    });
    // 收尾文本 + done（新会话 sess_ 前缀，endpoints.md id 约定）
    onEvent("text", { delta: "完成" });
    onEvent("done", { session_id: "sess_1" });

    const s = useChatStore.getState();
    // 文本流式追加累积（含工具轮之间的段落）
    expect(s.messages[1]).toMatchObject({ role: "assistant", content: "第一段第二段完成" });
    // 工具行状态迁移 running → ok，result 按字符串原文挂载
    expect(s.streamTools).toEqual([
      {
        id: "call_1",
        tool: "propose_create_entity",
        args: { type: "character", name: "张三" },
        result: JSON.stringify({ proposal_id: "prop_1", summary: "创建角色张三" }),
        status: "ok",
      },
    ]);
    // 提案卡填充（pending）
    expect(s.proposals).toEqual([
      {
        proposalId: "prop_1",
        type: "propose_create_entity",
        preview: { type: "propose_create_entity", summary: "创建角色张三", args: { type: "character", name: "张三" } },
        status: "pending",
      },
    ]);
    // done：流结束 + currentSessionId 更新 + 会话列表刷新
    expect(s.streaming).toBe(false);
    expect(s.currentSessionId).toBe("sess_1");
    await vi.waitFor(() => expect(mocked.listSessions).toHaveBeenCalled());
  });

  it("error 事件 → streamError 文案（透传 message）+ streaming=false + 输入恢复", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("error", { code: "AGENT_TIMEOUT", message: "单轮超时" });
    const s = useChatStore.getState();
    expect(s.streaming).toBe(false);
    expect(s.streamError).toBe("单轮超时");
  });

  it("S8.1 联调：服务端真实错误码（LLM 层非 ErrorCode 枚举）→ 文案透传 message（帧契约 chat.test.ts）", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    // S7.6 帧事实契约：配额类错误帧 { code: "insufficient_quota", message: "余额不足" }——
    // code 不经 ErrorCode 枚举，文案映射只认 message（describeStreamError 透传分支）
    onEvent("error", { code: "insufficient_quota", message: "余额不足" });
    const s = useChatStore.getState();
    expect(s.streaming).toBe(false);
    expect(s.streamError).toBe("余额不足");
  });

  it("旧构建/服务未起（HTTP 404）→ 错误条通用防御文案「聊天服务暂不可用」", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent } = sseOptions();
    onEvent("error", { code: "CLIENT_NETWORK_ERROR", message: "SSE 请求失败（HTTP 404）" });
    expect(useChatStore.getState().streamError).toBe("聊天服务暂不可用");
  });

  it("onTimeout（60s 无事件）→ disconnected=true + streaming=false + 清空提案（决策 16）", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent, onTimeout } = sseOptions();
    onEvent("proposal", { proposal_id: "prop-1", type: "propose_create_entity", preview: {} });
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
    // 残留的 user 消息与空 AI 占位被移除，重发后仅 1 条 user + 新占位
    expect(s.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(s.messages[0].content).toBe("你好");
  });

  it("resendLast：部分产出后断连 → 半截 AI 回答一并移除（断连语义 = 整轮取消）", () => {
    useChatStore.getState().sendMessage("你好");
    const { onEvent, onTimeout } = sseOptions();
    onEvent("text", { delta: "我" });
    onEvent("text", { delta: "好" }); // 已收到部分文本后断连（常见场景）
    onTimeout();
    mocked.fetchSSE.mockClear();
    useChatStore.getState().resendLast();
    expect(mocked.fetchSSE).toHaveBeenCalledTimes(1);
    const s = useChatStore.getState();
    // 半截 assistant（"我好"）被无条件移除，重发后仅 1 条空占位 assistant + 1 条 user（无重复气泡）
    const assistants = s.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].content).toBe("");
    expect(s.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(s.messages[0].content).toBe("你好");
  });

  it("流身份守卫：done 后微窗口内新发一轮，旧流 onEnd/onTimeout 不得污染新流", () => {
    useChatStore.getState().sendMessage("第一轮");
    const first = sseOptions();
    first.onEvent("done", { session_id: "sess-1" }); // 本轮结束（onEnd 尚未触发）
    // 微窗口内新发一轮：streaming 重新为 true，流身份已指向新流
    useChatStore.getState().sendMessage("第二轮");
    expect(useChatStore.getState().streaming).toBe(true);
    // 旧流收尾回调此刻才到 → 身份守卫拦截：不得复位新流 streaming / 置断连
    first.onEnd();
    first.onTimeout();
    const s = useChatStore.getState();
    expect(s.streaming).toBe(true);
    expect(s.disconnected).toBe(false);
    // 新流自身 onEnd 仍正常收尾
    sseOptions().onEnd();
    expect(useChatStore.getState().streaming).toBe(false);
  });
});

describe("confirmProposal / rejectProposal（S8.2：提案卡接入 S7.5 confirm/reject 真实调用）", () => {
  it("confirm 成功 → status=confirmed + processing 复位（终态，按钮禁用由 status 驱动）", async () => {
    mocked.confirmProposal.mockResolvedValue({ confirmed: true, result: "char-9" });
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    await useChatStore.getState().confirmProposal("prop-1");
    expect(mocked.confirmProposal).toHaveBeenCalledWith("prop-1");
    expect(useChatStore.getState().proposals).toEqual([
      { proposalId: "prop-1", type: "propose_create_entity", status: "confirmed", processing: false },
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
    expect(useChatStore.getState().proposals[0]).toMatchObject({ status: "rejected", processing: false });
  });

  it("409 PROPOSAL_STALE → status=stale（卡标「⚠ 数据已变化，此提案已失效」+ 按钮禁用）", async () => {
    mocked.confirmProposal.mockRejectedValue(new ApiError("PROPOSAL_STALE", "提案引用对象已变化: entity char-9"));
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    await useChatStore.getState().confirmProposal("prop-1");
    expect(useChatStore.getState().proposals[0]).toMatchObject({ status: "stale", processing: false });
  });

  it("404 PROPOSAL_NOT_FOUND → 移除卡片（提案已过期清除/SSE 断开作废）", async () => {
    mocked.confirmProposal.mockRejectedValue(new ApiError("PROPOSAL_NOT_FOUND", "提案不存在或已过期"));
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    await useChatStore.getState().confirmProposal("prop-1");
    expect(useChatStore.getState().proposals).toEqual([]);
  });

  it("409 PROPOSAL_PROJECT_MISMATCH → 移除卡片（防御：切项目已清空提案，理论不可达）", async () => {
    mocked.rejectProposal.mockRejectedValue(new ApiError("PROPOSAL_PROJECT_MISMATCH", "提案所属项目与当前项目不一致"));
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    await useChatStore.getState().rejectProposal("prop-1");
    expect(useChatStore.getState().proposals).toEqual([]);
  });

  it("其他错误（500 INTERNAL_ERROR 执行失败）→ 保持 pending 可重试 + toast 错误提示（U6 全局反馈）", async () => {
    // INTERNAL_ERROR 不在 shared ErrorCode 枚举（proposal.ts 注释：契约未定义该错误码，前端按通用错误呈现）——
    // 运行时错误码是普通字符串，store default 分支按字符串匹配，测试构造仅需类型断言
    mocked.confirmProposal.mockRejectedValue(new ApiError("INTERNAL_ERROR" as ErrorCode, "提案执行失败"));
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    await useChatStore.getState().confirmProposal("prop-1");
    expect(useChatStore.getState().proposals[0]).toMatchObject({ status: "pending", processing: false });
    expect(useUiStore.getState().toast).toMatchObject({
      kind: "error",
      text: "提案执行失败，请让 AI 重新生成提案",
    });
  });

  it("网络失败（CLIENT_NETWORK_ERROR）→ 保持 pending + toast 网络重试文案", async () => {
    mocked.confirmProposal.mockRejectedValue(new ApiError("CLIENT_NETWORK_ERROR", "fetch failed"));
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1" })] });
    await useChatStore.getState().confirmProposal("prop-1");
    expect(useChatStore.getState().proposals[0]).toMatchObject({ status: "pending", processing: false });
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
    useChatStore.setState({ proposals: [makeProposal({ proposalId: "prop-1", status: "confirmed" })] });
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
});
