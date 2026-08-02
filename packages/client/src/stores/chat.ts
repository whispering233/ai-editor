// 会话状态（doc/ui/layout.md §4.1 chat store：会话归属项目——currentSessionId + 会话列表，决策 22）
// U3 雏形：列表加载 + 当前会话选择；SSE 运行态 / 提案卡片队列 / focus context 由后续卡实现
// 项目切换联动（布局 §2.4「切项目重置会话」）：订阅 project store 的 config.id——
//   从任何入口（Sidebar 书架行 / Dashboard 卡片）打开或关闭项目都会清空会话状态，
//   打开时自动重载新项目会话列表，避免 currentSessionId / sessions 跨项目残留
import { create } from "zustand";
import type { ChatSessionSummary } from "@ai-editor/shared";
import { ApiError, listSessions } from "../lib/api";
import { useProjectStore } from "./project";

interface ChatState {
  /** 当前项目会话列表（null = 未加载/加载失败） */
  sessions: ChatSessionSummary[] | null;
  sessionsLoading: boolean;
  /** 会话列表加载失败的错误码（CLIENT_NETWORK_ERROR 等；null = 无错误/未加载） */
  sessionsError: string | null;
  /** 当前会话 id（null = 新会话）；随项目切换重置 */
  currentSessionId: string | null;
  /** 加载当前项目会话列表（GET /chat/sessions）；失败记 sessionsError */
  loadSessions: () => Promise<void>;
  /** 选择当前会话（null = 新会话） */
  setCurrentSession: (id: string | null) => void;
  /** 新建会话 = 切到空会话（右栏显示「新会话」） */
  newSession: () => void;
  /** 清空会话状态（关闭项目/切项目；订阅已自动调用，保留为显式入口） */
  clearSessions: () => void;
}

/**
 * 请求序号：项目切换时递增使在途列表请求作废（旧响应不得覆盖新项目状态）。
 * 触发条件：加载 A 项目列表的请求未返回时切到 B 项目——旧响应若直接 set 会把 A 的
 * 会话写进 B；序号比对在 then/catch/finally 三处把关。
 */
let loadSeq = 0;

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: null,
  sessionsLoading: false,
  sessionsError: null,
  currentSessionId: null,

  loadSessions: async () => {
    // 并发防抖：已在加载中则跳过（订阅切换项目时先复位 loading 再调用，不受此限）
    if (get().sessionsLoading) return;
    const seq = ++loadSeq;
    set({ sessionsLoading: true });
    try {
      const sessions = await listSessions();
      if (seq !== loadSeq) return; // 请求期间项目已切换，旧列表作废
      set({ sessions, sessionsError: null });
    } catch (err) {
      if (seq !== loadSeq) return;
      const code = err instanceof ApiError ? err.code : "CLIENT_NETWORK_ERROR";
      set({ sessions: null, sessionsError: code });
    } finally {
      if (seq === loadSeq) set({ sessionsLoading: false });
    }
  },

  setCurrentSession: (id) => set({ currentSessionId: id }),

  newSession: () => set({ currentSessionId: null }),

  clearSessions: () => {
    loadSeq++; // 作废在途请求
    set({ sessions: null, sessionsLoading: false, sessionsError: null, currentSessionId: null });
  },
}));

// 项目切换联动：仅在 config.id 真正变化时动作——null → id（打开）清空并加载新列表；
// id → null（关闭）/ id → id'（直接切项目）清空（关闭不请求）。
// 模块加载即订阅；订阅回调不抛错（loadSessions 内部已 catch），不影响 project store 使用者
let prevProjectId: string | null = useProjectStore.getState().config?.id ?? null;
useProjectStore.subscribe((state) => {
  const projectId = state.config?.id ?? null;
  if (projectId === prevProjectId) return;
  prevProjectId = projectId;
  loadSeq++; // 作废在途列表请求
  useChatStore.setState({
    currentSessionId: null,
    sessions: null,
    sessionsError: null,
    sessionsLoading: false,
  });
  if (projectId !== null) {
    void useChatStore.getState().loadSessions();
  }
});
