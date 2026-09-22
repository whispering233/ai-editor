// ChatPanel「新会话」路径渲染走查（问题 3）：
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
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import type { ChatSessionSummary, ProjectConfig } from "@whispering233/ai-editor-shared";
import { ErrorBoundary } from "../feedback/ErrorBoundary";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listSessions: vi.fn(),
    getSessionMessages: vi.fn(),
    confirmProposal: vi.fn(),
    rejectProposal: vi.fn(),
    resolveNames: vi.fn(),
  };
});

vi.mock("../../hooks/use-sse", () => ({
  fetchSSE: vi.fn(() => () => {}),
}));

// x-markdown 的 CJS lib 包内 require css，vitest node 直跑会 SyntaxError——
// mock 为纯文本渲染（真实渲染路径由 vite build 管线验证，见 antd-smoke.test 注记）
vi.mock("@ant-design/x-markdown", () => ({
  default: ({ children }: { children?: string }) => children ?? null,
}));

import {
  getSessionMessages as apiGetSessionMessages,
  listSessions as apiListSessions,
} from "../../lib/api";
import { useChatStore } from "../../stores/chat";
import { useProjectStore } from "../../stores/project";
import {
  asToolCall,
  ChatPanel,
  ComposerArea,
  DecomposeReadonlyBar,
  focusLabel,
  MessageItem,
  ProposalCardView,
  ThinkingBlock,
  ToolCallRow,
  MENU_KEY_DELETE_SESSION,
  sessionItemMenu,
  sessionItems,
} from "./ChatPanel";
import { SessionStatusBar, SessionStatusBarView } from "./session-status-bar";
import { sessionStatusView } from "../../lib/session-status";
import type { ChatMessageView } from "../../stores/chat";

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
  schemaVersion: 1,
  currentPosition: null,
  backupFrequencyMinutes: 10, // （B2.1 新增字段）
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
  mocked.getSessionMessages.mockResolvedValue({
    sessionId: "sess-1",
    messages: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, subscription: false },
  });
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

describe("会话状态栏（session-status-bar 契约：只读观测层 / 段无数据即隐藏 / 窄栏容器查询）", () => {
  const html = (node: ReactNode) => renderToString(<div>{node}</div>).replace(/<!--[^>]*-->/g, "");

  // 富数据视图：占用 42% · 1M + 账目 + 速度（无数据的段/明细行由 lib 层单测覆盖）
  const fullInput = {
    contextUsage: { percent: 42, tokens: 420_000, contextWindow: 1_000_000 },
    usage: {
      input: 1000,
      output: 2000,
      cacheRead: 500,
      cacheWrite: 0,
      total: 3500,
      cost: 0.42,
      cacheHitRate: 0.25,
      subscription: false,
    },
    speed: { outputTokens: 2000, ms: 30_000, tps: 66.6 },
  };
  const fullView = sessionStatusView(fullInput)!;

  it("有数据：占用段 + 费用 / 速度 / 缓存 / 累计 五段 compact 值齐渲染，hover 给精确账目（多行）", () => {
    const out = html(<SessionStatusBarView view={fullView} />);
    for (const text of ["42% · 1M", "$0.420", "67 tok/s", "缓存 25%", "累计 3.5k"]) {
      expect(out).toContain(`>${text}</span>`);
    }
    expect(out).toContain("上下文占用：420000 / 1000000 tokens");
    expect(out).toContain("输入 1000 · 输出 2000 · 缓存读 500 · 缓存写 0 · 合计 3500");
  });

  it("视觉契约：一行 caption 字号 + tabular-nums，容器查询挂在行上；两级阈值**逐段**对应（累计 → 第一级、缓存 → 第二级）", () => {
    const out = html(<SessionStatusBarView view={fullView} />);
    expect(out).toContain("@container");
    expect(out).toContain("text-xs");
    expect(out).toContain("tabular-nums");
    // 段 ↔ 阈值映射（互换两个字面量即红；常量值本身的断言在 lib 层）
    expect(out).toMatch(/class="@max-\[420px\]:hidden">累计 3\.5k<\/span>/);
    expect(out).toMatch(/class="@max-\[340px\]:hidden">缓存 25%<\/span>/);
  });

  it("占用未知（压缩后 tokens / percent 为 null）→ `? · 1M` 且不画条（三态中的第二态走真组件 SSR）", () => {
    const view = sessionStatusView({
      ...fullInput,
      contextUsage: { percent: null, tokens: null, contextWindow: 1_000_000 },
    })!;
    const out = html(<SessionStatusBarView view={view} />);
    expect(out).toContain("? · 1M");
    expect(out).not.toContain("w-16"); // 无条（轨道元素不渲染）
    expect(out).not.toContain("style="); // 也没有条填充
  });

  it("无 speed（历史会话）：速度段与速度明细行都不渲染", () => {
    const noSpeed = sessionStatusView({ ...fullInput, speed: null })!;
    const out = html(<SessionStatusBarView view={noSpeed} />);
    expect(out).not.toContain("tok/s");
    expect(out).toContain("42% · 1M");
  });

  it("整行无数据（SSR 初始态 = store 全 null）→ 整行不渲染", () => {
    const out = html(<SessionStatusBar />);
    expect(out).not.toContain("@container");
    expect(out).not.toContain("上下文占用");
  });

  it("拆解只读会话：输入区整体不渲染（状态栏随之不渲染）", () => {
    const out = html(<ComposerArea readonly />);
    expect(out).not.toContain("@container");
    expect(out).not.toContain("累计");
  });
});

describe("thinking-block 契约（默认折叠摘要 / 展开正文 / 流式自动展开-结束自动折叠 / 按需拉全文）", () => {
  // SSR 会在相邻文本节点间插 `<!-- -->`（计数与「 字」是两个节点）——归一后再断言
  const html = (node: ReactNode) => renderToString(<div>{node}</div>).replace(/<!--[^>]*-->/g, "");

  it("默认折叠：只渲染一行摘要「思考过程 · N 字」，不渲染正文", () => {
    const out = html(<ThinkingBlock text="先看大纲再回答" length={7} />);
    expect(out).toContain("思考过程 · 7 字");
    expect(out).not.toContain("先看大纲再回答");
  });

  it("live（流式进行中）→ 初始展开渲染全文（SSR 初始态即 useState(live)）", () => {
    const out = html(<ThinkingBlock text="流式中的思维链全文" length={9} live />);
    expect(out).toContain("流式中的思维链全文");
    expect(out).toContain('aria-expanded="true"');
  });

  it("历史预览未展开 → 摘要行用原文字数（length），不暴露截断后的预览文本", () => {
    const out = html(<ThinkingBlock text="前 240 字预览…" length={5000} deferred />);
    expect(out).toContain("思考过程 · 5000 字");
    expect(out).not.toContain("前 240 字预览");
  });

  it("视觉契约：折叠态无底色/无描边；展开态 = surface-soft 底 + 左侧 2px 竖线 + 限高", () => {
    const collapsed = html(<ThinkingBlock text="推理" length={2} />);
    expect(collapsed).not.toContain("bg-muted");
    const expanded = html(<ThinkingBlock text="推理" length={2} live />);
    expect(expanded).toContain("bg-muted");
    expect(expanded).toContain("border-l-2");
    expect(expanded).toContain("border-input");
    expect(expanded).toContain("max-h-48");
  });

  it("MessageItem（历史 assistant）：思维链摘要行在正文之前渲染，正文不含思维链文本", () => {
    const message = {
      id: "m1",
      sessionId: "sess-1",
      role: "assistant" as const,
      content: "正式回答",
      thinking: [{ preview: "内部推理预览", deferred: true as const, blockIndex: 0, length: 6 }],
      createdAt: "2026-08-01T10:00:00Z",
    };
    const out = html(<MessageItem message={message} toolResults={new Map()} />);
    expect(out).toContain("思考过程 · 6 字");
    expect(out).toContain("正式回答");
    expect(out.indexOf("思考过程")).toBeLessThan(out.indexOf("正式回答"));
  });

  it("MessageItem（流式 assistant）：thinkingText 累积渲染 + 流式标记（已展开）", () => {
    const message = {
      id: "local-1",
      sessionId: "",
      role: "assistant" as const,
      content: "回复中",
      thinkingText: "流式思维链",
      thinkingStreaming: true,
      createdAt: "2026-08-01T10:00:00Z",
    };
    const out = html(<MessageItem message={message} toolResults={new Map()} />);
    expect(out).toContain("流式思维链");
    expect(out).toContain("思考过程 · 5 字");
  });

  it("message_end 后（thinkingText 与 thinking 并存）只渲染一个思维链块（K6 oracle D1 回归）", () => {
    const message = {
      id: "local-2",
      sessionId: "sess-1",
      role: "assistant" as const,
      content: "正式回答",
      thinkingText: "本轮累积的全量思维链",
      thinkingStreaming: false,
      thinking: [{ preview: "本轮累积的全量思维链", deferred: true as const, blockIndex: 0, length: 10 }],
      createdAt: "2026-08-01T10:00:00Z",
    };
    const out = html(<MessageItem message={message} toolResults={new Map()} />);
    expect(out.match(/思考过程/g) ?? []).toHaveLength(1);
    expect(out).toContain("思考过程 · 10 字");
    // 折叠态不渲染正文（全量文本仍保留在 message.thinkingText，展开后才可见）
    expect(out).not.toContain("本轮累积的全量思维链");
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

  // 会话列表项（用户反馈 #3#4）：结构层纯函数走查——弹层内容在 Dropdown 弹层里，SSR 渲染不到
  // （rc-trigger 不开就不渲染浮层），故把项构造抽成 sessionItems 直测。
  it("sessionItems：无历史/null → 单条禁用提示项", () => {
    for (const input of [null, []]) {
      const items = sessionItems(input);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ key: "__empty__", disabled: true, label: "暂无历史会话" });
    }
  });

  it("sessionItems：每会话一项（key = 会话 id），label 两行（标题 + 条数 · 相对时间）", () => {
    // SSR 会在相邻文本节点间插 `<!-- -->`（messageCount 与「 条 · 」是两个节点）——归一后再断言
    const textOf = (node: ReactNode) =>
      renderToString(<div>{node}</div>).replace(/<!--[^>]*-->/g, "");
    const items = sessionItems([sampleSession]);
    expect(items.map((i) => i.key)).toEqual(["sess-1"]);
    const html = textOf((items[0] as { label: ReactNode }).label);
    expect(html).toContain("帮我梳理第三章的冲突"); // 摘要行（截断靠 CSS）
    expect(html).toContain("3 条"); // 元信息行
    // 空摘要会话不得渲染出空白项（退「（空会话）」）
    const blank = sessionItems([{ ...sampleSession, lastMessage: "" }]);
    expect(textOf((blank[0] as { label: ReactNode }).label)).toContain("（空会话）");
  });

  // chat-session-decompose（拆解会话只读态）：列表项标题优先级 + 「拆解」徽标
  it("sessionItems：有 name 时显示会话名（不回退被截断的原文）；无 name 仍显示摘要", () => {
    const textOf = (node: ReactNode) =>
      renderToString(<div>{node}</div>).replace(/<!--[^>]*-->/g, "");
    const named = sessionItems([{ ...sampleSession, name: "《测试书》拆解" }]);
    const namedHtml = textOf((named[0] as { label: ReactNode }).label);
    expect(namedHtml).toContain("《测试书》拆解");
    expect(namedHtml).not.toContain("帮我梳理第三章的冲突");
    // 空 name 不得渲染成空标题（退 lastMessage，再退「（空会话）」）
    const emptyName = sessionItems([{ ...sampleSession, name: "", lastMessage: "" }]);
    expect(textOf((emptyName[0] as { label: ReactNode }).label)).toContain("（空会话）");
  });

  it("sessionItems：拆解会话（decompose- 前缀）带中性 type-badge「拆解」；普通会话没有", () => {
    const textOf = (node: ReactNode) =>
      renderToString(<div>{node}</div>).replace(/<!--[^>]*-->/g, "");
    const decompose = sessionItems([{ ...sampleSession, id: "decompose-job-abc" }]);
    const decomposeHtml = textOf((decompose[0] as { label: ReactNode }).label);
    expect(decomposeHtml).toContain("拆解");
    expect(decomposeHtml).toContain("border-type-badge-border"); // TypeChip（描边式类型徽标）

    const normalHtml = textOf((sessionItems([sampleSession])[0] as { label: ReactNode }).label);
    expect(normalHtml).not.toContain("border-type-badge-border");
    // 只是「名字里含 decompose」不算拆解会话（前缀判定）
    const lookalike = textOf(
      (sessionItems([{ ...sampleSession, id: "my-decompose-1" }])[0] as { label: ReactNode }).label,
    );
    expect(lookalike).not.toContain("border-type-badge-border");
  });
});

describe("会话项操作菜单（chat-session-item-menu 契约：唯一项「删除会话」+ streaming / 在跑 job 禁用）", () => {
  it("菜单唯一项 = 删除会话（danger），点击回调带该项会话 id 且阻止冒泡", () => {
    const onDelete = vi.fn();
    const menu = sessionItemMenu(false, false, onDelete)({ key: "sess-7" });
    expect(menu.items).toHaveLength(1);
    // items 为联合类型（含 MenuDividerType），按 toMatchObject 断言而非属性访问
    expect(menu.items?.[0]).toMatchObject({ key: MENU_KEY_DELETE_SESSION, danger: true });
    expect(menu.items?.[0]).not.toMatchObject({ disabled: true });

    const stopPropagation = vi.fn();
    menu.onClick?.({ key: MENU_KEY_DELETE_SESSION, domEvent: { stopPropagation } } as never);
    expect(stopPropagation).toHaveBeenCalledTimes(1); // 不得触发会话项选中
    expect(onDelete).toHaveBeenCalledWith("sess-7");
  });

  it("streaming 中禁用该项（在途生成不得删；服务端 409 兜底）；其它 key 不触发删除", () => {
    const onDelete = vi.fn();
    const menu = sessionItemMenu(true, false, onDelete)({ key: "sess-7" });
    expect(menu.items?.[0]).toMatchObject({ key: MENU_KEY_DELETE_SESSION, disabled: true });

    menu.onClick?.({ key: "other", domEvent: { stopPropagation: vi.fn() } } as never);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("拆解 job 在跑：拆解会话的删除项禁用（服务端 409 DECOMPOSE_JOB_RUNNING 兜底）", () => {
    const decompose = sessionItemMenu(false, true, vi.fn())({ key: "decompose-job-abc" });
    expect(decompose.items?.[0]).toMatchObject({ disabled: true });
    // 普通 chat 会话不受 job 状态影响（「普通会话行为逐字不变」）
    const normal = sessionItemMenu(false, true, vi.fn())({ key: "sess-7" });
    expect(normal.items?.[0]).not.toMatchObject({ disabled: true });
    // job 已停：拆解会话照常可删
    const settled = sessionItemMenu(false, false, vi.fn())({ key: "decompose-job-abc" });
    expect(settled.items?.[0]).not.toMatchObject({ disabled: true });
  });
});

describe("chat-session-decompose 只读态（只读说明条 + 输入区整体不渲染）", () => {
  const html = (node: ReactNode) => renderToString(<div>{node}</div>);

  it("只读说明条：一行 caption 文案 + 类型徽标「拆解」（不引入新色/字号/圆角）", () => {
    const out = html(<DecomposeReadonlyBar />);
    expect(out).toContain("拆解过程记录 · 只读");
    expect(out).toContain("拆解");
    expect(out).toContain("border-type-badge-border");
    expect(out).toContain("text-xs");
  });

  it("拆解会话（readonly）不渲染输入框——不是禁用；普通会话照常渲染输入区", () => {
    const readonly = html(<ComposerArea readonly />);
    expect(readonly).toBe("<div></div>");
    expect(readonly).not.toContain("输入消息…");

    // 反证：非只读时同一断言命中输入框（否则上一条是空跑）
    const normal = html(<ComposerArea readonly={false} />);
    expect(normal).toContain("输入消息…");
  });
});

describe("新会话路径叶子组件富数据渲染走查（问题 3：任务侦察标注的 ToolCallRow/MessageItem 未读路径）", () => {
  it("MessageItem：user 气泡 / assistant 正文 + 历史工具调用行（含 tool result 成对挂载）不抛异常", () => {
    const userMsg: ChatMessageView = {
      id: "m1",
      sessionId: "sess-1",
      role: "user",
      content: "帮我看看这个设定有没有漏洞",
      createdAt: "t0",
    };
    const assistantMsg: ChatMessageView = {
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
    const toolResults = new Map<string, ChatMessageView>([
      [
        "call-1",
        {
          id: "t1",
          sessionId: "sess-1",
          role: "tool",
          toolCallId: "call-1",
          content: '{"name":"张三"}',
          createdAt: "t1",
        },
      ],
    ]);
    const userHtml = renderToString(<MessageItem message={userMsg} toolResults={toolResults} />);
    expect(userHtml).toContain("帮我看看这个设定有没有漏洞");
    const assistantHtml = renderToString(
      <MessageItem message={assistantMsg} toolResults={toolResults} />,
    );
    expect(assistantHtml).toContain("好的，我来分析一下");
    // 成对渲染：有 tool result 的调用行 ✓、无 result 的孤儿调用行（tool 消息不单独渲染）；
    // 注意 SSR 会在文本与表达式间插入 <!-- --> 注释节点，断言用关键词而非整句
    expect(assistantHtml).toContain("get_entity");
    expect(assistantHtml).toContain("list_entities");
  });

  it("MessageItem：历史 wire 形态 tool_calls（{function:{name,arguments}}）渲染层归一不抛异常，args 摘要可见（2-1 `{}` 修复）", () => {
    const wireMsg: ChatMessageView = {
      id: "m3",
      sessionId: "sess-1",
      role: "assistant",
      content: null,
      // 续聊重建/落库形态（server 直存 agent 输出；渲染层归一为内部形状）
      toolCalls: [
        {
          id: "call-w1",
          type: "function",
          function: { name: "get_entity", arguments: '{"id":"char-1"}' },
        },
      ],
      createdAt: "t2",
    };
    const html = renderToString(<MessageItem message={wireMsg} toolResults={new Map()} />);
    expect(html).toContain("调用了"); // 名称自 function.name（不再回退「工具」；SSR 词间含注释节点，分开断言）
    expect(html).toContain("get_entity");
    // args 解析由 asToolCall 单测覆盖（ToolCallRow 展开态为 client state，SSR 不可达）
    const call = asToolCall(wireMsg.toolCalls![0]);
    expect(call).toEqual({
      id: "call-w1",
      tool: "get_entity",
      name: "get_entity",
      args: { id: "char-1" },
    });
  });

  it("asToolCall 双形态归一：wire（function.name/arguments JSON 串）与内部形态（tool/args）", () => {
    expect(
      asToolCall({ id: "a", type: "function", function: { name: "x", arguments: '{"k":1}' } }),
    ).toEqual({ id: "a", tool: "x", name: "x", args: { k: 1 } });
    expect(asToolCall({ id: "b", tool: "y", args: { v: 2 } })).toEqual({
      id: "b",
      tool: "y",
      args: { v: 2 },
    });
    expect(asToolCall("bad")).toEqual({});
    // arguments 非法 JSON：保留原串（渲染兜底展示原文）
    expect(
      asToolCall({ id: "c", type: "function", function: { name: "z", arguments: "not-json{" } }),
    ).toEqual({ id: "c", tool: "z", name: "z", args: "not-json{" });
  });

  it("MessageItem：tool 消息本身返回 null（成对渲染，不单独出现）", () => {
    const toolMsg: ChatMessageView = {
      id: "t1",
      sessionId: "sess-1",
      role: "tool",
      toolCallId: "call-1",
      content: '{"name":"张三"}',
      createdAt: "t1",
    };
    expect(renderToString(<MessageItem message={toolMsg} toolResults={new Map()} />)).toBe("");
  });

  it("ToolCallRow：running / ok / error 三态渲染不抛异常（含 args 字符串与对象两种形状）", () => {
    const running = renderToString(
      <ToolCallRow toolName="get_entity" args={{ id: "char-1" }} status="running" />,
    );
    expect(running).toContain("get_entity");
    const ok = renderToString(
      <ToolCallRow
        toolName="get_entity"
        args={JSON.stringify({ id: "char-1" })}
        result={'{"name":"张三"}'}
        status="ok"
      />,
    );
    expect(ok).toContain("get_entity");
    expect(ok).toContain("ant-badge-status-success"); // 成功标记（antd Badge dot，替代旧 ✓ 字符）
    const error = renderToString(
      <ToolCallRow
        toolName="update_entity"
        args={undefined}
        result="错误：实体不存在"
        status="error"
      />,
    );
    expect(error).toContain("update_entity");
    expect(error).toContain("ant-badge-status-error"); // 失败标记（替代旧 ✗ 字符）
    const running2 = renderToString(
      <ToolCallRow toolName="get_entity" args={{ id: "char-1" }} status="running" />,
    );
    expect(running2).toContain("ant-badge-status-processing"); // 进行中
  });

  it("ProposalCardView：pending / confirmed / stale 三态 + preview 存在/缺失渲染不抛异常", () => {
    const pending = renderToString(
      <ProposalCardView
        proposal={{
          proposalId: "prop-1",
          type: "propose_create_entity",
          status: "pending",
          preview: { summary: "创建角色张三" },
        }}
      />,
    );
    expect(pending).toContain("提案");
    expect(pending).toContain("新建实体"); // PROPOSAL_TYPE_LABELS 映射
    const confirmed = renderToString(
      <ProposalCardView
        proposal={{ proposalId: "prop-1", type: "propose_create_entity", status: "confirmed" }}
      />,
    );
    expect(confirmed).toContain("已确认");
    const stale = renderToString(
      <ProposalCardView
        proposal={{ proposalId: "prop-1", type: "propose_update_entity", status: "stale" }}
      />,
    );
    expect(stale).toContain("此提案已失效");
  });

  it("ProposalCardView：propose_reorder_timepoints（F9 + G2 修订）标题映射「重排时间轴时间点」+ preview 摘要渲染（不再 JSON dump）", () => {
    const html = renderToString(
      <ProposalCardView
        proposal={{
          proposalId: "prop-9",
          type: "propose_reorder_timepoints",
          status: "pending",
          preview: { changes: [{ id: "tp-1", order: 2 }] },
        }}
      />,
    );
    expect(html).toContain("提案");
    expect(html).toContain("重排时间轴时间点"); // PROPOSAL_TYPE_LABELS 映射（G2 修订：propose_reorder_timepoints）
    // preview 摘要渲染——changes 对象项 id 未解析（SSR 不跑 useEffect）→ 兜底「调整位置」；
    // 不再 JSON dump（changes 字面量不出现）
    expect(html).toContain("调整位置");
    expect(html).not.toContain("changes");
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

// ============ Base UI Menu 护栏（问题 3 实机根因：error #31） ============
// 根因（已确证）：SessionTitleBar 曾把 DropdownMenuLabel（= Menu.GroupLabel）**裸**放在
// DropdownMenuContent（Popup）内——点击 trigger 打开菜单 → Popup 挂载 → GroupLabel 读
// MenuGroupContext 缺失 → 抛「Base UI error #31; visit https://base-ui.com/production-error?code=31」
// （dev 消息：MenuGroupContext is missing. Menu group parts must be used within <Menu.Group> or
// <Menu.RadioGroup>.）。此前无 ErrorBoundary 时 = 整页白屏（原始问题 3 现象），ErrorBoundary 落地后
// = 错误卡（用户实测确认）。修复：Label 用 DropdownMenuGroup（= Menu.Group）包裹（ChatPanel.tsx）。

describe("focus 小条文案（C2：不再直显裸 entity id）", () => {
  it("解析命中 → 类型 + 名称；解析中只显类型；失败退 id", () => {
    const ctx = { focus_entity_type: "character", focus_entity_id: "char-1" };
    expect(focusLabel(ctx, "张三")).toBe("角色 张三"); // 命中
    expect(focusLabel(ctx, undefined)).toBe("角色"); // 解析中：不闪裸 id
    expect(focusLabel(ctx, null)).toBe("角色 char-1"); // 解析失败：退 id（信息不丢）
  });

  it("未知类型显原文；无类型时仅名称；全空退「当前内容」", () => {
    expect(focusLabel({ focus_entity_type: "timeline_span", focus_entity_id: "x" }, "序章")).toBe(
      "timeline_span 序章",
    );
    expect(focusLabel({ focus_node_id: "ch-1" }, "第一章")).toBe("大纲节点 第一章"); // 节点默认标签
    expect(focusLabel({}, "孤立名称")).toBe("孤立名称");
    expect(focusLabel({})).toBe("当前内容");
  });
});
