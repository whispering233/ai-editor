// chat store 测试（U3：会话列表加载、当前会话选择、项目切换联动——订阅 project store config.id）
// 订阅在 chat.ts 模块加载时激活：测试通过操作 useProjectStore.setState({config}) 驱动联动
// mock lib/api 模块（保留 ApiError 类真实实现）
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatSessionSummary, ProjectConfig } from "@ai-editor/shared";
import { ApiError } from "../lib/api";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    listSessions: vi.fn(),
  };
});

import { listSessions as apiListSessions } from "../lib/api";
import { useChatStore } from "./chat";
import { useProjectStore } from "./project";

const mocked = { listSessions: vi.mocked(apiListSessions) };

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
  useChatStore.setState({ sessions: null, sessionsLoading: false, sessionsError: null, currentSessionId: null });
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
});

describe("setCurrentSession / newSession / clearSessions", () => {
  it("setCurrentSession 设置当前会话；newSession 重置为 null", () => {
    useChatStore.getState().setCurrentSession("sess-1");
    expect(useChatStore.getState().currentSessionId).toBe("sess-1");
    useChatStore.getState().newSession();
    expect(useChatStore.getState().currentSessionId).toBeNull();
  });

  it("clearSessions 清空列表与当前会话", () => {
    useChatStore.setState({ sessions: [sampleSession], currentSessionId: "sess-1" });
    useChatStore.getState().clearSessions();
    const s = useChatStore.getState();
    expect(s.sessions).toBeNull();
    expect(s.currentSessionId).toBeNull();
    expect(s.sessionsError).toBeNull();
  });
});

describe("项目切换联动（订阅 project store config.id，决策 22 切项目重置会话）", () => {
  it("打开项目（config null → id）→ 清空并自动加载会话列表", async () => {
    mocked.listSessions.mockResolvedValue([sampleSession]);
    useChatStore.setState({ currentSessionId: "sess-old", sessions: [sampleSession] });
    useProjectStore.setState({ config: makeConfig("proj-a") });
    await vi.waitFor(() => expect(useChatStore.getState().sessions).toEqual([sampleSession]));
    expect(mocked.listSessions).toHaveBeenCalledTimes(1);
    // 切项目时当前会话重置为新会话（旧项目会话不残留）
    expect(useChatStore.getState().currentSessionId).toBeNull();
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
