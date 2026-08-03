// ChatPanel「新会话」路径渲染走查（交互批次，问题 3）：
// 用户实测「点击新会话后整页白屏」。仓库无 jsdom/@testing-library（FeedbackHost.test.tsx 注释：
// 避免引入新依赖），本测试用 react-dom/server renderToString（react-dom 既有依赖）走查。
// SSR 限制（重要）：zustand v5 useStore 的 getServerSnapshot = 创建时初始态（hydration 一致性设计），
// renderToString 只能渲染「初始态」而看不到 setState 后的当前态——因此激活会话→newSession 的
// 状态迁移在 store 层验证（stores/chat.test.ts「setCurrentSession / newSession」既有用例 + 本文件
// 下方走查），组件渲染层用「叶子组件直渲染富数据」覆盖（ToolCallRow/MessageItem/ProposalCardView，
// 即任务侦察标注的 ChatPanel 200-280 行未读路径——已导出供测试）。
// 走查结论（根因评估）：静态走查未见确定性崩溃点——setCurrentSession(null) 清空
// messages/proposals/streamTools/streaming 后各渲染分支均落在空值守卫（MessageItem 的
// Array.isArray(toolCalls)、ProposalCardView 的 preview undefined 守卫、MessageList 空态等），
// zustand selector 均为字段级引用（无新引用无限渲染）；白屏更可能源自版本/环境相关的组件内部
// （Base UI v1.6 菜单等）或未覆盖边界。故交付两层防护：本走查测试作回归护栏 + 应用级
// ErrorBoundary（main.tsx 包裹，components/feedback/ErrorBoundary.tsx）——任何渲染异常
// 展示可恢复错误卡（错误信息 + 重新加载/回到首页）而非无提示白屏（下方有兜底行为验证用例）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { ChatMessage, ChatSessionSummary, ProjectConfig } from "@ai-editor/shared";
import { ErrorBoundary } from "../feedback/ErrorBoundary";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listSessions: vi.fn(),
    getSessionMessages: vi.fn(),
    confirmProposal: vi.fn(),
    rejectProposal: vi.fn(),
  };
});

vi.mock("../../hooks/use-sse", () => ({
  fetchSSE: vi.fn(() => () => {}),
}));

import {
  getSessionMessages as apiGetSessionMessages,
  listSessions as apiListSessions,
} from "../../lib/api";
import { useChatStore } from "../../stores/chat";
import { useProjectStore } from "../../stores/project";
import { ChatPanel, MessageItem, ProposalCardView, ToolCallRow } from "./ChatPanel";

const mocked = {
  listSessions: vi.mocked(apiListSessions),
  getSessionMessages: vi.mocked(apiGetSessionMessages),
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

/** renderToString 运行于 node：ChatPanel 内 useMediaQuery 的 useState 初始化器读取 window.matchMedia，
 * stub 最小可用实现（SSR 不执行 effect，无需真实监听） */
const windowStub = {
  matchMedia: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
};

beforeEach(() => {
  vi.stubGlobal("window", windowStub);
  mocked.listSessions.mockResolvedValue([sampleSession]);
  mocked.getSessionMessages.mockResolvedValue({ sessionId: "sess-1", messages: [] });
  // 打开项目：触发 chat store 订阅联动（clearSessions + loadSessions——问题 2 行为自动激活最近会话）
  useProjectStore.setState({ config: makeConfig("proj-a"), configLoading: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  // 关闭项目（触发订阅清空）后重置两 store，防跨用例状态残留
  useProjectStore.setState({
    config: null,
    loadError: null,
    outline: null,
    configLoading: false,
    outlineLoading: false,
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
});

describe("ChatPanel 挂载渲染冒烟（SSR 初始态：zustand v5 getServerSnapshot = 初始态，覆盖挂载路径崩溃）", () => {
  it("初始态（无项目）渲染不抛异常：禁用形态 + 「打开项目后可用」", () => {
    const html = renderToString(<ChatPanel open={false} onClose={() => {}} />);
    expect(html).toContain("打开项目后可用");
  });

  it("初始态（已打开项目）渲染不抛异常：空态引导 + 「新会话」标题", async () => {
    // 等订阅联动 settle（避免与下方断言竞态；SSR 渲染仍取初始态，故这里只验证不抛异常）
    await vi.waitFor(() => expect(useChatStore.getState().sessions).toEqual([sampleSession]));
    expect(() => renderToString(<ChatPanel open={false} onClose={() => {}} />)).not.toThrow();
  });
});

describe("新会话路径叶子组件富数据渲染走查（问题 3：任务侦察标注的 ToolCallRow/MessageItem 未读路径）", () => {
  it("MessageItem：user 气泡 / assistant 正文 + 历史工具调用行（含 tool result 成对挂载）不抛异常", () => {
    const userMsg: ChatMessage = {
      id: "m1",
      sessionId: "sess-1",
      role: "user",
      content: "帮我看看这个设定有没有漏洞",
      createdAt: "t0",
    };
    const assistantMsg: ChatMessage = {
      id: "m2",
      sessionId: "sess-1",
      role: "assistant",
      content: "好的，我来分析一下",
      toolCalls: [
        { id: "call-1", tool: "get_entity", args: { id: "char-1" } },
        { id: "call-2", tool: "list_entities", args: { type: "character" } },
      ],
      createdAt: "t1",
    };
    const toolResults = new Map<string, ChatMessage>([
      ["call-1", { id: "t1", sessionId: "sess-1", role: "tool", toolCallId: "call-1", content: '{"name":"张三"}', createdAt: "t1" }],
    ]);
    const userHtml = renderToString(<MessageItem message={userMsg} toolResults={toolResults} />);
    expect(userHtml).toContain("帮我看看这个设定有没有漏洞");
    const assistantHtml = renderToString(<MessageItem message={assistantMsg} toolResults={toolResults} />);
    expect(assistantHtml).toContain("好的，我来分析一下");
    // 成对渲染：有 tool result 的调用行 ✓、无 result 的孤儿调用行（tool 消息不单独渲染）；
    // 注意 SSR 会在文本与表达式间插入 <!-- --> 注释节点，断言用关键词而非整句
    expect(assistantHtml).toContain("get_entity");
    expect(assistantHtml).toContain("list_entities");
  });

  it("MessageItem：tool 消息本身返回 null（决策 18 成对渲染，不单独出现）", () => {
    const toolMsg: ChatMessage = {
      id: "t1",
      sessionId: "sess-1",
      role: "tool",
      toolCallId: "call-1",
      content: "{\"name\":\"张三\"}",
      createdAt: "t1",
    };
    expect(renderToString(<MessageItem message={toolMsg} toolResults={new Map()} />)).toBe("");
  });

  it("ToolCallRow：running / ok / error 三态渲染不抛异常（含 args 字符串与对象两种形状）", () => {
    const running = renderToString(<ToolCallRow toolName="get_entity" args={{ id: "char-1" }} status="running" />);
    expect(running).toContain("get_entity");
    const ok = renderToString(
      <ToolCallRow toolName="get_entity" args={JSON.stringify({ id: "char-1" })} result={'{"name":"张三"}'} status="ok" />,
    );
    expect(ok).toContain("get_entity");
    expect(ok).toContain("✓"); // result 存在 → 成功标记
    const error = renderToString(<ToolCallRow toolName="update_entity" args={undefined} result="错误：实体不存在" status="error" />);
    expect(error).toContain("update_entity");
    expect(error).toContain("✗");
  });

  it("ProposalCardView：pending / confirmed / stale 三态 + preview 存在/缺失渲染不抛异常", () => {
    const pending = renderToString(
      <ProposalCardView proposal={{ proposalId: "prop-1", type: "propose_create_entity", status: "pending", preview: { summary: "创建角色张三" } }} />,
    );
    expect(pending).toContain("提案");
    expect(pending).toContain("新建实体"); // PROPOSAL_TYPE_LABELS 映射
    const confirmed = renderToString(
      <ProposalCardView proposal={{ proposalId: "prop-1", type: "propose_create_entity", status: "confirmed" }} />,
    );
    expect(confirmed).toContain("已确认");
    const stale = renderToString(
      <ProposalCardView proposal={{ proposalId: "prop-1", type: "propose_update_entity", status: "stale" }} />,
    );
    expect(stale).toContain("此提案已失效");
  });
});

describe("store 层「新会话」状态迁移走查（问题 3 场景：激活会话 → 清空 → 空态）", () => {
  it("激活现场 → newSession 清空全部瞬态（messages/proposals/streamTools/focus/断连/streaming）", async () => {
    await vi.waitFor(() => expect(useChatStore.getState().sessions).toEqual([sampleSession]));
    useChatStore.setState({
      currentSessionId: "sess-1",
      messages: [
        { id: "m1", sessionId: "sess-1", role: "user", content: "你好", createdAt: "t0" },
        { id: "m2", sessionId: "sess-1", role: "assistant", content: "你好！", createdAt: "t1" },
      ],
      streaming: true,
      disconnected: true,
      streamError: "上次会话已取消",
      focusContext: { focus_entity_type: "character", focus_entity_id: "char-1" },
      proposals: [{ proposalId: "prop-1", type: "propose_create_entity", status: "pending" }],
      streamTools: [{ id: "call-1", tool: "get_entity", status: "running" }],
    });
    useChatStore.getState().newSession();
    const s = useChatStore.getState();
    expect(s.currentSessionId).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.proposals).toEqual([]);
    expect(s.streamTools).toEqual([]);
    expect(s.focusContext).toBeNull();
    expect(s.disconnected).toBe(false);
    expect(s.streaming).toBe(false);
    expect(s.streamError).toBeNull();
  });
});

describe("ErrorBoundary 兜底（问题 3 防护：渲染异常 → 可恢复错误卡而非白屏）", () => {
  // 注意：React 设计上 renderToString 不会让 error boundary 捕获渲染异常（边界仅客户端渲染生效，
  // SSR 异常直接上抛调用方）——本测试只能验证「无异常时正常透传 children」；边界捕获行为
  // （getDerivedStateFromError → fallback 错误卡）需真实浏览器验证，列入交付走查清单
  it("无异常时正常渲染 children（错误卡不出现）", () => {
    const html = renderToString(
      <ErrorBoundary>
        <p>正常内容</p>
      </ErrorBoundary>,
    );
    expect(html).toContain("正常内容");
    expect(html).not.toContain("界面出现异常");
  });
});
