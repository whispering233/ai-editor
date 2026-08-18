// 会话状态（doc/ui/layout.md §4.1 chat store：会话归属项目——currentSessionId + 会话列表，决策 22）
// U3 雏形：列表加载 + 当前会话选择；U5 扩展（pages/chat.md 契约）：
//   - 消息流：messages（当前会话历史）/ messagesLoading / loadMessages（切会话清空重载）
//   - SSE 运行态：streaming / streamError；sendMessage（fetchSSE 发送，事件映射见 chat.md「SSE 事件 → UI 映射」表）
//   - focus context（layout.md §4.2）：跨页「问 AI」注入；请求体 context 字段
//   - 断连横幅：disconnected（60s 无事件，决策 20 客户端兜底）+ resendLast（[重新发送]）
//   - 瞬态渲染数据：proposals（提案卡）/ streamTools（运行时工具折叠行）——S7 服务端数据接入后填充
// 项目切换联动（布局 §2.4「切项目重置会话」）：订阅 project store 的 config.id——
//   从任何入口打开/关闭/切换项目都清空会话 + 消息 + SSE 运行态（并中止在途流），
//   打开时自动重载新项目会话列表，避免跨项目残留
import { create } from "zustand";
import type { ChatMessage, ChatSessionSummary } from "@whispering233/ai-editor-shared";
import {
  ApiError,
  confirmProposal as confirmProposalApi,
  getSessionMessages,
  listSessions,
  rejectProposal as rejectProposalApi,
  type SendChatMessageBody,
} from "../lib/api";
import { fetchSSE } from "../hooks/use-sse";
import { useProjectStore } from "./project";
import { useUiStore } from "./ui";

/** focus context（layout.md §4.2：跨页注入「问 AI」；POST /chat 请求体 context 字段） */
export interface FocusContext {
  focus_entity_type?: string;
  focus_entity_id?: string;
  focus_node_id?: string;
}

/** 运行时工具调用记录（SSE tool_call / tool_result 事件，瞬态；历史消息走 messages 的 toolCalls/toolCallId 成对渲染） */
export interface StreamToolRecord {
  id: string; // call_ 前缀（决策 18 成对重组依据）
  tool: string; // 工具名（get_entity 等）
  args?: unknown;
  result?: unknown;
  /** running = 已调用未返回；ok = 成功返回；error = 返回错误 */
  status: "running" | "ok" | "error";
}

/** 运行时提案卡片（SSE proposal 事件，决策 14：瞬态对象——历史消息中不保留，恢复会话不展开为卡片） */
export interface ProposalCard {
  proposalId: string; // prop_ 前缀
  type: string; // 提案工具名（propose_create_entity 等）
  preview?: unknown;
  /**
   * 处理态：pending 未处理 / confirmed / rejected / stale（409 PROPOSAL_STALE 快照失效）/
   * notFound（404——S8.2 起由 store 直接移除卡片、不再落此态，保留仅为类型防御）
   */
  status: "pending" | "confirmed" | "rejected" | "stale" | "notFound";
  /** 处理中（S8.2：confirm/reject 请求在途，防重复点击；UI 层 pending + 非处理中才可点） */
  processing?: boolean;
}

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
  /** 选择当前会话并恢复历史（null = 新会话，清空消息区）；Dashboard/Sidebar/右栏下拉共用此入口 */
  setCurrentSession: (id: string | null) => void;
  /** 新建会话 = 切到空会话（清空消息区显示「新会话」） */
  newSession: () => void;
  /** 清空会话状态（关闭项目/切项目；订阅已自动调用，保留为显式入口） */
  clearSessions: () => void;

  // ---- U5：消息流 ----
  /** 当前会话消息历史（本地临时 id 的流式消息在 S7 落库后由历史重载替换为真实 id） */
  messages: ChatMessage[];
  messagesLoading: boolean;
  /** 加载会话历史（GET /chat/sessions/:id/messages → messages；调用前清空重载，含竞态保护） */
  loadMessages: (sessionId: string) => Promise<void>;

  // ---- U5：SSE 运行态 ----
  /** 是否正在流式生成（发送中；输入框禁用 + 「AI 思考中…」） */
  streaming: boolean;
  /** 流错误文案（error 事件 / 服务未就绪 / 网络失败；null = 无） */
  streamError: string | null;
  setStreamError: (err: string | null) => void;

  // ---- U5：focus context（跨页注入） ----
  focusContext: FocusContext | null;
  setFocusContext: (ctx: FocusContext | null) => void;
  clearFocusContext: () => void;

  // ---- U5：断连横幅 ----
  /** 流中断（60s 无事件，决策 20）：顶部横幅「上次会话已取消」+ [重新发送] */
  disconnected: boolean;
  setDisconnected: (v: boolean) => void;

  // ---- U5：瞬态渲染数据（S7 服务端实现后由 SSE 事件填充） ----
  proposals: ProposalCard[];
  streamTools: StreamToolRecord[];

  /** 发送消息（POST /chat + SSE 流式）：乐观追加 user 消息 + AI 占位；带 focus context 时携带 context */
  sendMessage: (text: string) => void;
  /** 断连横幅 [重新发送]：移除断连残留的重复消息后重发上一条用户消息 */
  resendLast: () => void;

  // ---- S8.2：提案确认/拒绝（S7.5 confirm/reject 真实调用） ----
  /**
   * 确认提案：成功 → status=confirmed（按钮禁用由 status 驱动）；
   * 409 PROPOSAL_STALE → stale（卡标「数据已变化」）；404 NOT_FOUND / 409 MISMATCH → 移除卡片；
   * 其他错误（500 执行失败/网络失败）→ 保持 pending 可重试 + toast 提示
   */
  confirmProposal: (proposalId: string) => Promise<void>;
  /** 拒绝提案：语义同 confirm，成功 → status=rejected */
  rejectProposal: (proposalId: string) => Promise<void>;
}

/**
 * 流错误文案映射（chat.md「错误态」）
 * - HTTP 404 → 通用防御文案「聊天服务暂不可用」（S8.1 更新：S7 已实现 POST /chat，
 *   该分支仅作防御——旧构建/服务未起时 fetchSSE 透传 code=CLIENT_NETWORK_ERROR + "SSE 请求失败（HTTP 404）"）
 * - 网络层失败（服务未启动/断网）→ 「连接失败，请确认服务已启动」
 * - 服务端/中间层错误（非 2xx 且无 REST 包裹，如 proxy 500，message 含 "HTTP "）→ 透传 message，
 *   不落入「连接失败」误判（S8.1 oracle S2：CLIENT_NETWORK_ERROR 仅纯网络错误才映射连接失败文案）
 * - 服务端 error 事件（模型失败/超限，决策 15）→ 透传服务端 message（真实链路错误一律走此分支）
 */
export function describeStreamError(code: string, message: string): string {
  if (message.includes("HTTP 404")) return "聊天服务暂不可用";
  if (code === "CLIENT_NETWORK_ERROR" && !message.includes("HTTP "))
    return "连接失败，请确认服务已启动";
  return message;
}

/**
 * 提案动作非契约错误的 toast 文案映射（S8.2；S7.5 契约三错误码 STALE/NOT_FOUND/MISMATCH
 * 由 store 分支处理、不经此函数）：
 * - INTERNAL_ERROR（500 执行失败，proposal.ts「执行失败按 500 呈现」）→ 引导重新生成提案
 *   （重试仍会失败，不保留重试价值）
 * - CLIENT_NETWORK_ERROR（网络层）→ 重试引导（不透传原始 fetch 错误文本）
 * - 其他（未知码防御兜底）→ 透传服务端 message
 */
export function describeProposalActionError(code: string, message: string): string {
  switch (code) {
    case "INTERNAL_ERROR":
      return "提案执行失败，请让 AI 重新生成提案";
    case "CLIENT_NETWORK_ERROR":
      return "网络请求失败，请重试";
    default:
      return message;
  }
}

/** 会话列表请求序号：项目切换时递增使在途列表请求作废（旧响应不得覆盖新项目状态） */
let loadSeq = 0;
/** 消息历史请求序号：切会话/切项目时递增作废在途请求（同 loadSeq 竞态保护） */
let msgSeq = 0;
/** 本地临时消息 id 序号（user 乐观追加 / AI 流式占位） */
let clientMsgSeq = 0;

/** 在途 SSE 流的 abort 函数（切会话/切项目/重发前终止旧流，防止旧流事件污染新状态） */
let abortCurrentStream: (() => void) | null = null;
/** 当前流式 AI 消息的临时 id（text 事件按此追加 delta；流作废/结束时置 null） */
let currentStreamMsgId: string | null = null;
/** 上一条发送的用户文本（断连横幅 [重新发送] 用；切会话/项目时清空） */
let lastSentText: string | null = null;

export const useChatStore = create<ChatState>((set, get) => {
  /**
   * 提案动作统一处理（confirm/reject 共用，S8.2）：
   * 1. 防重复：卡片不存在（已移除）/ 非 pending（已确认/拒绝/失效）/ 处理中（processing）→ 忽略
   *    （按钮层同时禁用，此处为状态层防御）
   * 2. 在途：置 processing=true（按钮禁用防连点）→ 调 S7.5 API
   * 3. 成功 → status 终态（confirmed/rejected）；错误分支见 switch——
   *    - 409 PROPOSAL_STALE：快照重校验失败（引用已变化/删除）→ stale（卡标「数据已变化，此提案已失效」+ 按钮禁用）
   *    - 404 PROPOSAL_NOT_FOUND：proposal_id 不存在（已过期清除/SSE 断开作废）→ 移除卡片
   *    - 409 PROPOSAL_PROJECT_MISMATCH：提案属他项目（防御——切换项目已清空提案，理论不可达）→ 移除卡片
   *    - 其他（500 INTERNAL_ERROR 执行失败 / 网络失败）：保持 pending 可重试 + 全局 toast 提示
   * 注意：请求在途时切会话/切项目会清空 proposals——响应后按 proposalId 在**当前**列表内
   *   map/filter 是空操作，天然无跨会话污染
   */
  const runProposalAction = async (
    proposalId: string,
    apiCall: (id: string) => Promise<unknown>,
    successStatus: "confirmed" | "rejected",
  ): Promise<void> => {
    const proposal = get().proposals.find((p) => p.proposalId === proposalId);
    if (!proposal || proposal.status !== "pending" || proposal.processing === true) return;
    set((s) => ({
      proposals: s.proposals.map((p) =>
        p.proposalId === proposalId ? { ...p, processing: true } : p,
      ),
    }));
    try {
      await apiCall(proposalId);
      // 成功（200 { confirmed:true } / { rejected:true }，shared proposal*ResSchema）：终态，按钮随之禁用
      set((s) => ({
        proposals: s.proposals.map((p) =>
          p.proposalId === proposalId ? { ...p, status: successStatus, processing: false } : p,
        ),
      }));
      // 数据变更信号（交互批次，问题 1）：确认 = executeProposal 写库成功，通知中栏页面重拉；
      // 拒绝不改数据不触发；hook-panel 复合写是页面本地操作（S9.1 自带 reloadTick），不走全局信号
      if (successStatus === "confirmed") useUiStore.getState().notifyDataChanged();
    } catch (err) {
      // apiFetch 只抛 ApiError（code 透传服务端 ErrorCode）；非 ApiError 属理论不可达，按网络错误兜底
      const code = err instanceof ApiError ? err.code : "CLIENT_NETWORK_ERROR";
      const message = err instanceof Error ? err.message : "网络请求失败";
      switch (code) {
        case "PROPOSAL_STALE":
          set((s) => ({
            proposals: s.proposals.map((p) =>
              p.proposalId === proposalId ? { ...p, status: "stale", processing: false } : p,
            ),
          }));
          return;
        case "PROPOSAL_NOT_FOUND":
        case "PROPOSAL_PROJECT_MISMATCH":
          set((s) => ({ proposals: s.proposals.filter((p) => p.proposalId !== proposalId) }));
          return;
        default:
          // 保持 pending（可重试）+ 全局反馈 toast（U6，FeedbackHost 桥接 sonner）
          useUiStore.getState().showToast(describeProposalActionError(code, message), "error");
          set((s) => ({
            proposals: s.proposals.map((p) =>
              p.proposalId === proposalId ? { ...p, processing: false } : p,
            ),
          }));
          return;
      }
    }
  };

  return {
    sessions: null,
    sessionsLoading: false,
    sessionsError: null,
    currentSessionId: null,
    messages: [],
    messagesLoading: false,

    loadSessions: async () => {
      // 并发防抖：已在加载中则跳过（订阅切换项目时先复位 loading 再调用，不受此限）
      if (get().sessionsLoading) return;
      const seq = ++loadSeq;
      set({ sessionsLoading: true });
      try {
        const sessions = await listSessions();
        if (seq !== loadSeq) return; // 请求期间项目已切换，旧列表作废
        set({ sessions, sessionsError: null });
        // 自动激活最近会话（交互批次，问题 2）：刷新页面/切项目后 currentSessionId 为 null，
        // 若列表非空则激活 sessions[0]——服务端按最后活动倒序返回，[0] 即最近会话，
        // 符合「一项目一会话」心智（决策 22：刷新后右栏应恢复最近对话而非空会话）。
        // 守卫：空列表不激活（保持新会话空态）；已有 currentSessionId 不覆盖
        // （done 事件刷新列表、用户已手动选会话等场景）。不用 localStorage 记忆上次会话：
        // 服务端列表已倒序，最近会话即用户预期，持久化映射是 YAGNI
        if (get().currentSessionId === null && sessions.length > 0) {
          get().setCurrentSession(sessions[0].id);
        }
      } catch (err) {
        if (seq !== loadSeq) return;
        const code = err instanceof ApiError ? err.code : "CLIENT_NETWORK_ERROR";
        set({ sessions: null, sessionsError: code });
      } finally {
        if (seq === loadSeq) set({ sessionsLoading: false });
      }
    },

    setCurrentSession: (id) => {
      // 同 id 重复点击（下拉点当前会话项）：直接返回，不重载历史、不清 focusContext（避免闪屏）
      if (id === get().currentSessionId) return;
      // 切换会话：作废在途消息请求 + 中止在途流 + 清空消息与瞬态（旧会话的流事件不得污染新视图）
      msgSeq++;
      abortCurrentStream?.();
      abortCurrentStream = null;
      currentStreamMsgId = null;
      lastSentText = null;
      set({
        currentSessionId: id,
        messages: [],
        messagesLoading: false,
        streaming: false,
        streamError: null,
        disconnected: false,
        focusContext: null,
        proposals: [],
        streamTools: [],
      });
      if (id !== null) void get().loadMessages(id); // 恢复历史（fire-and-forget，失败静默 → 空态）
    },

    newSession: () => {
      // 作废在途会话列表请求（ora S1）：点「新会话」时若 loadSessions 在途，其响应不得
      // 触发自动激活最近会话把用户的开新会话意图拉回（与 clearSessions 的 loadSeq++ 同款）
      loadSeq++;
      get().setCurrentSession(null);
    },

    clearSessions: () => {
      loadSeq++; // 作废在途列表请求
      msgSeq++; // 作废在途消息请求
      abortCurrentStream?.(); // 中止在途 SSE 流（切项目后旧流事件不得污染新状态）
      abortCurrentStream = null;
      currentStreamMsgId = null;
      lastSentText = null;
      set({
        sessions: null,
        sessionsLoading: false,
        sessionsError: null,
        currentSessionId: null,
        messages: [],
        messagesLoading: false,
        streaming: false,
        streamError: null,
        disconnected: false,
        focusContext: null,
        proposals: [],
        streamTools: [],
      });
    },

    loadMessages: async (sessionId) => {
      const seq = ++msgSeq;
      set({ messagesLoading: true });
      try {
        const res = await getSessionMessages(sessionId);
        if (seq !== msgSeq) return; // 请求期间已切会话/项目，旧响应作废
        // 响应条目不含 sessionId：补全为 shared ChatMessage（组件渲染与续聊重组用）
        const messages: ChatMessage[] = res.messages.map((m) => ({
          ...m,
          sessionId: res.sessionId,
        }));
        set({ messages });
      } catch {
        if (seq !== msgSeq) return;
        set({ messages: [] }); // 加载失败静默 → 空态引导语
      } finally {
        if (seq === msgSeq) set({ messagesLoading: false });
      }
    },

    streaming: false,
    streamError: null,
    setStreamError: (err) => set({ streamError: err }),

    focusContext: null,
    setFocusContext: (ctx) => set({ focusContext: ctx }),
    clearFocusContext: () => set({ focusContext: null }),

    disconnected: false,
    setDisconnected: (v) => set({ disconnected: v }),

    proposals: [],
    streamTools: [],

    sendMessage: (text) => {
      const { streaming, messagesLoading, currentSessionId, focusContext } = get();
      const trimmed = text.trim();
      // 空文本 / 已在生成中 / 历史加载中：忽略（输入区与按钮在 UI 层已禁用，此处为状态层防御；
      // 加载中拒绝：乐观消息会被 loadMessages 的 set({ messages }) 整体覆盖、流式 delta 静默丢弃）
      if (!trimmed || streaming || messagesLoading) return;
      // 防御性终止旧流（正常流程中 sendMessage 前不会有在途流）
      abortCurrentStream?.();
      abortCurrentStream = null;

      // 乐观追加 user 消息 + AI 流式占位（临时 id；S7 落库后切会话重载历史得到真实 id）
      const now = new Date().toISOString();
      const sessionId = currentSessionId ?? "";
      const streamMsgId = `local-${++clientMsgSeq}`;
      currentStreamMsgId = streamMsgId;
      lastSentText = trimmed;
      set((s) => ({
        messages: [
          ...s.messages,
          {
            id: `local-${++clientMsgSeq}`,
            sessionId,
            role: "user",
            content: trimmed,
            createdAt: now,
          },
          { id: streamMsgId, sessionId, role: "assistant", content: "", createdAt: now },
        ],
        streaming: true,
        streamError: null,
        disconnected: false,
        proposals: [], // 新一轮生成：清空上一轮遗留提案（决策 14 瞬态）
        streamTools: [],
      }));

      // 请求体（endpoints.md POST /chat）：新会话不带 session_id；focus 小条存在时携带 context
      const body: SendChatMessageBody = { message: trimmed };
      if (currentSessionId) body.session_id = currentSessionId;
      if (focusContext) body.context = focusContext;

      // SSE 事件映射（pages/chat.md「SSE 事件 → UI 映射」表）：事件处理内联于此，
      // 便于测试捕获 fetchSSE options 后手动驱动 onEvent/onTimeout/onEnd
      abortCurrentStream = fetchSSE("/api/v1/chat", {
        body,
        onEvent: (event, data) => {
          switch (event) {
            case "ping":
              break; // 心跳：忽略（维持超时重置由 fetchSSE 内部处理）
            case "text": {
              // 追加 delta 到当前流式 AI 消息（流式打字效果不做，直接追加，chat.md）
              const delta = (data as { delta?: string })?.delta ?? "";
              if (currentStreamMsgId) {
                set((s) => ({
                  messages: s.messages.map((m) =>
                    m.id === currentStreamMsgId ? { ...m, content: (m.content ?? "") + delta } : m,
                  ),
                }));
              }
              break;
            }
            case "tool_call": {
              // 运行时工具记录行（S7 后出现；折叠态「调用了 {tool}」）
              const { tool, args, id } = data as { tool?: string; args?: unknown; id?: string };
              if (!id || !tool) break;
              set((s) => ({
                streamTools: [...s.streamTools, { id, tool, args, status: "running" }],
              }));
              break;
            }
            case "tool_result": {
              // 契约确认（S8.1）：AgentEvent tool_result 仅 { tool, result, id }，无 ok/isError 字段——
              // 工具失败编码进 result 字符串内容（如「错误：实体 char-9 不存在」，决策 15 结构化喂回自纠），
              // SSE 帧与 AgentEvent 同构（chat.ts onEvent 直通 writeEvent）。故无条件置 ok，
              // status: "error" 为历史预留（UI 渲染已支持），当前契约下不可达；result 按字符串原文挂载。
              // S8.2 评估（ora S8.1 建议 isError 透传）：不做——失败已编码进 result 字符串（决策 15 消费方
              // 是 LLM 自纠而非展示层），isError 透传需改 agent run.ts + server 帧 + shared schema + client
              // 四层契约，YAGNI；未来需要时改动点已明确（run.ts emit 透传 DispatchResult.isError）
              const { id } = data as { id?: string };
              if (!id) break;
              set((s) => ({
                streamTools: s.streamTools.map((t) =>
                  t.id === id
                    ? { ...t, result: (data as { result?: unknown }).result, status: "ok" }
                    : t,
                ),
              }));
              break;
            }
            case "proposal": {
              // 提案卡片（决策 14 瞬态；S7 数据接入后渲染）
              const {
                proposal_id: proposalId,
                type,
                preview,
              } = data as {
                proposal_id?: string;
                type?: string;
                preview?: unknown;
              };
              if (!proposalId || !type) break;
              set((s) => ({
                proposals: [
                  ...s.proposals,
                  { proposalId, type, preview, status: "pending" as const },
                ],
              }));
              break;
            }
            case "done": {
              // 本轮结束：记录 session_id 供续聊（新会话场景下拉列表随之刷新）
              if (currentStreamMsgId === null) break; // 流已被切会话/项目作废，忽略
              const sid = (data as { session_id?: string })?.session_id;
              set({ streaming: false, currentSessionId: sid ?? get().currentSessionId });
              if (sid) void get().loadSessions(); // 新会话已落库：刷新列表（下拉可切回）
              break;
            }
            case "error": {
              // error 事件后流立即关闭（fetchSSE 已终止解析）：错误条 + 输入恢复
              const { code, message } = data as { code?: string; message?: string };
              set({
                streaming: false,
                streamError: describeStreamError(code ?? "", message ?? ""),
              });
              break;
            }
          }
        },
        onTimeout: () => {
          // 60s 无任何事件（决策 20 半开连接兜底）：横幅「上次会话已取消」+ 清空未确认提案（决策 16）
          // 身份守卫：done 后微窗口内新发一轮时旧流已过期，其超时回调不得污染新流
          if (currentStreamMsgId !== streamMsgId) return;
          currentStreamMsgId = null;
          set({ streaming: false, disconnected: true, proposals: [], streamTools: [] });
        },
        onEnd: () => {
          // 流正常关闭（done 哨兵 / 服务端 EOF / error 事件终止）：幂等收尾（done/error 已复位 streaming）
          // 身份守卫：同上——旧流的 onEnd 不得复位新流的 streaming / 清空新流身份
          if (currentStreamMsgId !== streamMsgId) return;
          currentStreamMsgId = null;
          set((s) => (s.streaming ? { streaming: false } : {}));
        },
      });
    },

    resendLast: () => {
      const { messages, streaming } = get();
      if (streaming || !lastSentText) return;
      // 断连残留清理：无条件移除尾部 assistant（断连语义 = 整轮取消，半截回答一并丢弃——
      // 部分产出后断连的常见场景：带内容的半截 assistant 若不移除，重发后残留 + user 重复），
      // 再移除与重发文本相同的最后一条 user 消息（避免重复气泡）
      let next = messages;
      const last = next[next.length - 1];
      if (last?.role === "assistant") next = next.slice(0, -1);
      const lastUser = next[next.length - 1];
      if (lastUser?.role === "user" && lastUser.content === lastSentText) next = next.slice(0, -1);
      set({ messages: next });
      get().sendMessage(lastSentText);
    },

    confirmProposal: (proposalId) => runProposalAction(proposalId, confirmProposalApi, "confirmed"),
    rejectProposal: (proposalId) => runProposalAction(proposalId, rejectProposalApi, "rejected"),
  };
});

// 项目切换联动：仅在 config.id 真正变化时动作——null → id（打开）清空并加载新列表；
// id → null（关闭）/ id → id'（直接切项目）清空（关闭不请求）。
// 模块加载即订阅；订阅回调不抛错（loadSessions 内部已 catch），不影响 project store 使用者
let prevProjectId: string | null = useProjectStore.getState().config?.id ?? null;
useProjectStore.subscribe((state) => {
  const projectId = state.config?.id ?? null;
  if (projectId === prevProjectId) return;
  prevProjectId = projectId;
  // 清空会话 + 消息 + SSE 运行态（clearSessions 内部中止在途流并作废在途请求）
  useChatStore.getState().clearSessions();
  if (projectId !== null) {
    void useChatStore.getState().loadSessions();
  }
});
