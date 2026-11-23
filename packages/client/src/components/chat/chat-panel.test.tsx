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
import type { ChatSessionSummary, OutlineTree, ProjectConfig } from "@whispering233/ai-editor-shared";
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
// mock 为纯文本渲染（真实渲染路径由 vite build 管线验证，见 antd-smoke.test 注记）；
// 收到的 props 记一份，供正文流式口径用例断言（组件内部不可从 HTML 观测）
const markdownCalls = vi.hoisted(() => [] as Array<{ streaming?: Record<string, unknown> }>);
vi.mock("@ant-design/x-markdown", () => ({
  default: (props: { children?: string; streaming?: Record<string, unknown> }) => {
    markdownCalls.push(props);
    return props.children ?? null;
  },
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
  focusLabel,
  HistoricalProposalCard,
  HistoricalProposalRow,
  isNearBottom,
  MessageItem,
  PROPOSAL_TYPE_LABELS,
  ProposalCardView,
  ProposalRow,
  STICK_BOTTOM_THRESHOLD_PX,
  ThinkingBlock,
  MENU_KEY_DELETE_SESSION,
  sessionItemMenu,
  sessionItems,
} from "./ChatPanel";
import type { StreamToolRecord } from "../../stores/chat";
import { SessionStatusBar, SessionStatusBarView } from "./session-status-bar";
import { sessionStatusView } from "../../lib/session-status";
import type { ChatMessageView, ProposalCard } from "../../stores/chat";

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
  kind: "novel", // 工作区类型（恒下发字段，API 形态必填）
  authorId: null, // 预置作家 id（仅练习工作区有值）
  schemaVersion: 1,
  currentPosition: null,
  deductionNodes: [], // （推演标记字段）
  backupFrequencyMinutes: 10, // （B2.1 新增字段）
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z",
});

/** renderToString 运行于 node：ChatPanel 内 useMediaQuery 的 useState 初始化器读取 window.matchMedia，
 * stub 最小可用实现（SSR 不执行 effect，无需真实监听） */
const windowStub = {
  matchMedia: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
};

/** 取「目标文案最近的前一个 <button> 起始标签」：antd SSR 的 disabled 落在该标签上（组卡头部按钮态断言） */
const buttonTagBefore = (html: string, label: string): string => {
  const idx = html.indexOf(label);
  expect(idx).toBeGreaterThan(-1);
  return html.slice(0, idx).split("<button").pop() ?? "";
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

  it("正文 markdown 的流式口径：尾条 hasNextChunk 随流式开关，且不用 `streaming={true}` 预设（会附带 typewriter）", () => {
    const message = {
      id: "local-3",
      sessionId: "",
      role: "assistant" as const,
      content: "正文",
      createdAt: "2026-08-01T10:00:00Z",
    };
    markdownCalls.length = 0;
    html(<MessageItem message={message} toolResults={new Map()} streaming />);
    expect(markdownCalls.at(-1)?.streaming).toEqual({
      hasNextChunk: true,
      incompleteMarkdown: "complete",
    });
    // 历史 / 已结束的消息：关掉 hasNextChunk（一次性定稿），其余口径同一份
    html(<MessageItem message={message} toolResults={new Map()} />);
    expect(markdownCalls.at(-1)?.streaming).toEqual({
      hasNextChunk: false,
      incompleteMarkdown: "complete",
    });
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

  // 列表项标题优先级（chat-session-item-menu）：会话名 / 摘要 / 空态兜底
  it("sessionItems：有 name 时显示会话名（不回退被截断的原文）；无 name 仍显示摘要", () => {
    const textOf = (node: ReactNode) =>
      renderToString(<div>{node}</div>).replace(/<!--[^>]*-->/g, "");
    const named = sessionItems([{ ...sampleSession, name: "《测试书》讨论" }]);
    const namedHtml = textOf((named[0] as { label: ReactNode }).label);
    expect(namedHtml).toContain("《测试书》讨论");
    expect(namedHtml).not.toContain("帮我梳理第三章的冲突");
    // 空 name 不得渲染成空标题（退 lastMessage，再退「（空会话）」）
    const emptyName = sessionItems([{ ...sampleSession, name: "", lastMessage: "" }]);
    expect(textOf((emptyName[0] as { label: ReactNode }).label)).toContain("（空会话）");
  });

  it("sessionItems：每项只有标题 + 元信息两行（不挂类型徽标）", () => {
    const textOf = (node: ReactNode) =>
      renderToString(<div>{node}</div>).replace(/<!--[^>]*-->/g, "");
    const out = textOf((sessionItems([sampleSession])[0] as { label: ReactNode }).label);
    expect(out).not.toContain("border-type-badge-border"); // 无 TypeChip（描边式类型徽标）
  });
});

describe("会话项操作菜单（chat-session-item-menu 契约：唯一项「删除会话」+ streaming 禁用）", () => {
  it("菜单唯一项 = 删除会话（danger），点击回调带该项会话 id 且阻止冒泡", () => {
    const onDelete = vi.fn();
    const menu = sessionItemMenu(false, onDelete)({ key: "sess-7" });
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
    const menu = sessionItemMenu(true, onDelete)({ key: "sess-7" });
    expect(menu.items?.[0]).toMatchObject({ key: MENU_KEY_DELETE_SESSION, disabled: true });

    menu.onClick?.({ key: "other", domEvent: { stopPropagation: vi.fn() } } as never);
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe("ComposerArea（底部区：focus 小条 + 输入区）", () => {
  const html = (node: ReactNode) => renderToString(<div>{node}</div>);

  it("渲染输入框（无 focus 上下文 → focus 小条不渲染）", () => {
    const out = html(<ComposerArea />);
    expect(out).toContain("输入消息…");
  });

  // SSR 预置 store：zustand 的服务端快照取 getInitialState()（setState 对 renderToString 无效）
  /** 卷1[ch-1, ch-2] + 卷2[ch-3]（推演标记数测试用） */
  const DEDUCTION_OUTLINE: OutlineTree = {
    id: "root",
    type: "root",
    schemaVersion: 1,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updatedAt: "t",
        children: [
          { id: "ch-1", type: "chapter", title: "雪夜出走", updatedAt: "t" },
          { id: "ch-2", type: "chapter", title: "旧盟友", updatedAt: "t" },
        ],
      },
      {
        id: "vol-2",
        type: "volume",
        title: "第二卷",
        updatedAt: "t",
        children: [{ id: "ch-3", type: "chapter", title: "入城", updatedAt: "t" }],
      },
    ],
  };

  it("推演形态：小条显「推演节点 · N 个」，N = 项目**可见**标记数（失效 id 不计）", () => {
    Object.assign(useChatStore.getInitialState(), { focusContext: { focus_deduction: true } });
    Object.assign(useProjectStore.getInitialState(), {
      config: { ...makeConfig("p-1"), deductionNodes: ["ch-1", "ch-404"] },
      outline: DEDUCTION_OUTLINE,
    });
    const out = html(<ComposerArea />);
    // SSR 在静态文本与插值之间插 `<!-- -->` 注释 → 只断言插值段自身
    expect(out).toContain("正在讨论：");
    expect(out).toContain("推演节点 · 1 个");
  });

  it("推演形态：大纲/配置未加载（N 缺失）→ 省略数字，不显「0 个」假值", () => {
    Object.assign(useChatStore.getInitialState(), { focusContext: { focus_deduction: true } });
    Object.assign(useProjectStore.getInitialState(), { config: null, outline: null });
    const out = html(<ComposerArea />);
    expect(out).toContain("推演节点");
    expect(out).not.toContain("推演节点 ·");
  });
});

describe("消息流顺序与滚动跟随（DESIGN.md `chat-message-stream`）", () => {
  it("isNearBottom：贴底 / 差一像素 / 超出阈值 / 内容未溢出恒为贴底", () => {
    // 内容未溢出（scrollHeight = clientHeight = scrollTop 0）
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 })).toBe(true);
    // 正好在阈值边界上（含等号）
    expect(
      isNearBottom({
        scrollTop: 700 - STICK_BOTTOM_THRESHOLD_PX,
        scrollHeight: 1000,
        clientHeight: 300,
      }),
    ).toBe(true);
    // 差一像素即视为已脱离
    expect(
      isNearBottom({
        scrollTop: 700 - STICK_BOTTOM_THRESHOLD_PX - 1,
        scrollHeight: 1000,
        clientHeight: 300,
      }),
    ).toBe(false);
    // 已在底部
    expect(isNearBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 300 })).toBe(true);
  });

  it("MessageItem：运行态工具行落在消息内——顺序 = 思考 → 工具行 → 正文（与重载后同序）", () => {
    const streaming: ChatMessageView = {
      id: "m4",
      sessionId: "sess-1",
      role: "assistant",
      content: "最终答案",
      thinkingText: "先看大纲再回答",
      thinkingStreaming: true,
      toolCalls: [{ id: "call-9", tool: "get_entity", args: { id: "char-1" } }],
      createdAt: "t3",
    };
    const liveTools = new Map<string, StreamToolRecord>([
      ["call-9", { id: "call-9", tool: "get_entity", args: { id: "char-1" }, status: "running" }],
    ]);
    // 同 id 的历史结果也存在（不该发生的组合）：运行态优先 ⇒ 仍为「调用中」，而不是被历史结果盖成 ✓
    const toolResults = new Map<string, ChatMessageView>([
      [
        "call-9",
        {
          id: "t9",
          sessionId: "sess-1",
          role: "tool",
          toolCallId: "call-9",
          content: '{"name":"张三"}',
          createdAt: "t3",
        },
      ],
    ]);
    const html = renderToString(
      <MessageItem message={streaming} toolResults={toolResults} liveTools={liveTools} />,
    );
    const iThinking = html.indexOf("思考过程");
    const iTool = html.indexOf("调用了");
    const iText = html.indexOf("最终答案");
    expect(iThinking).toBeGreaterThanOrEqual(0);
    expect(iThinking).toBeLessThan(iTool);
    expect(iTool).toBeLessThan(iText);
    // 运行态优先于历史结果（状态轴按状态类名断言：进行中 = loading）
    expect(html).toContain("ant-thought-chain-status-loading");
    expect(html).not.toContain("ant-thought-chain-status-error");
  });

  it("MessageItem：liveTools 的完成态不染色、失败态走 error 状态轴（与历史 toolResults 同口径）", () => {
    const calls: unknown[] = [
      { id: "call-ok", tool: "get_entity", args: {} },
      { id: "call-err", tool: "get_outline", args: {} },
    ];
    const message: ChatMessageView = {
      id: "m5",
      sessionId: "sess-1",
      role: "assistant",
      content: "答",
      toolCalls: calls,
      createdAt: "t4",
    };
    const liveTools = new Map<string, StreamToolRecord>([
      ["call-ok", { id: "call-ok", tool: "get_entity", result: "{}", status: "ok" }],
      ["call-err", { id: "call-err", tool: "get_outline", isError: true, status: "error" }],
    ]);
    const html = renderToString(
      <MessageItem message={message} toolResults={new Map()} liveTools={liveTools} />,
    );
    // 成功不染绿（成功 = 常态，gutter 回落序号），失败才走 error 状态轴
    expect(html).not.toContain("ant-thought-chain-status-success");
    expect(html.split("ant-thought-chain-status-error").length - 1).toBe(1);
  });
});

describe("新会话路径叶子组件富数据渲染走查（问题 3）+ 提案组卡契约（proposal-card）", () => {
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

  it("asToolCall 多形态归一：服务端投影（name/arguments）、wire（function.name/arguments JSON 串）、内部形态（tool/args）", () => {
    // 服务端投影形状（SSE message_end 帧与历史接口共用；真实数据见 test-project 会话文件）
    expect(asToolCall({ id: "a0", name: "get_entity", arguments: { id: "char-1" } })).toEqual({
      id: "a0",
      tool: "get_entity",
      name: "get_entity",
      args: { id: "char-1" },
    });
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

  it("asToolCall：投影形状（{id,name,arguments}）args 不丢——展开态摘要能拿到 id 字段（oracle F1 回归护栏）", () => {
    const message: ChatMessageView = {
      id: "m6",
      sessionId: "sess-1",
      role: "assistant",
      content: "答",
      // 真实帧序（pi：message_end 先、tool_execution_start 后）下保留的就是这条投影形状
      toolCalls: [{ id: "call-p1", name: "get_entity", arguments: { id: "char-1" } }],
      createdAt: "t5",
    };
    const call = asToolCall(message.toolCalls![0]);
    expect(call.args).toEqual({ id: "char-1" }); // 非 undefined：展开态摘要能渲染「查询实体：实体「…」」
    expect(call.tool).toBe("get_entity");
    // 展开态渲染由 summarizeToolCall 单测覆盖（ToolCallRow 展开为 client state，SSR 不可达）
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

  it("工具行：running / ok / error 三态（ThoughtChain 状态轴：进行中 = loading、失败 = error、成功不染色）", () => {
    const assistant = (calls: unknown[]): ChatMessageView => ({
      id: "m-tool",
      sessionId: "sess-1",
      role: "assistant",
      content: "",
      toolCalls: calls,
      createdAt: "t0",
    });
    const live = (record: StreamToolRecord): Map<string, StreamToolRecord> =>
      new Map([[record.id, record]]);

    const running = renderToString(
      <MessageItem
        message={assistant([{ id: "c1", tool: "get_entity", args: { id: "char-1" } }])}
        toolResults={new Map()}
        liveTools={live({ id: "c1", tool: "get_entity", status: "running" })}
      />,
    );
    expect(running).toContain("get_entity");
    expect(running).toContain("ant-thought-chain-status-loading"); // 进行中

    const error = renderToString(
      <MessageItem
        message={assistant([{ id: "c2", tool: "update_entity" }])}
        toolResults={new Map()}
        liveTools={live({
          id: "c2",
          tool: "update_entity",
          status: "error",
          result: "错误：实体不存在",
        })}
      />,
    );
    expect(error).toContain("update_entity");
    expect(error).toContain("ant-thought-chain-status-error"); // 失败

    // 成功：不传 status（成功 = 常态）⇒ gutter 回落序号，行文字不被染绿
    const ok = renderToString(
      <MessageItem
        message={assistant([{ id: "c3", name: "get_entity", arguments: { id: "char-1" } }])}
        toolResults={
          new Map([
            [
              "c3",
              {
                id: "t3",
                sessionId: "sess-1",
                role: "tool",
                toolCallId: "c3",
                content: '{"name":"张三"}',
                createdAt: "t1",
              },
            ],
          ])
        }
      />,
    );
    expect(ok).not.toContain("ant-thought-chain-status-");
    // 折叠头仍是我们自己的 button（x 的 collapsible 是 div onClick，键盘不可操作）
    expect(ok.split('aria-expanded="false"').length - 1).toBe(1);
  });

  it("工具行：联网来源卡片在折叠头之后、无需展开即可见（非来源工具零影响）", () => {
    // 数据源 = 工具结果文本（`stringifyToolResult` 产物）
    const result = JSON.stringify([
      { title: "第一条命中", url: "https://www.example.com/a", summary: "摘要" },
      { title: "第二条命中", url: "https://example.org/b" },
    ]);
    const html = renderToString(
      <MessageItem
        message={{
          id: "m-src",
          sessionId: "sess-1",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "web_search", arguments: { query: "测试" } }],
          createdAt: "t0",
        }}
        toolResults={
          new Map([
            [
              "c1",
              {
                id: "t1",
                sessionId: "sess-1",
                role: "tool",
                toolCallId: "c1",
                content: result,
                createdAt: "t1",
              },
            ],
          ])
        }
      />,
    );
    const header = html.indexOf("调用了"); // SSR 在文本与表达式间插 <!-- -->，断言分片
    const card = html.indexOf("第一条命中");
    expect(header).toBeGreaterThan(-1);
    expect(html).toContain("web_search");
    expect(card).toBeGreaterThan(header); // 折叠头之下
    // 折叠态内容（原始 JSON 区）不渲染 ⇒ 卡片出现即“无需展开”
    expect(html).not.toContain("max-h-40");
    expect(html).toContain(">example.com</span>"); // 域名（本条无 date → meta 只有域名）

    const other = renderToString(
      <MessageItem
        message={{
          id: "m-other",
          sessionId: "sess-1",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c9", name: "get_entity", arguments: { id: "char-1" } }],
          createdAt: "t0",
        }}
        toolResults={
          new Map([
            [
              "c9",
              {
                id: "t9",
                sessionId: "sess-1",
                role: "tool",
                toolCallId: "c9",
                content: result,
                createdAt: "t1",
              },
            ],
          ])
        }
      />,
    );
    expect(other).not.toContain("第一条命中");
  });

  it("ProposalCardView：单条提案也渲染组卡形态（头部计数 + 全部确认/全部拒绝 + 行内类型与摘要）", () => {
    const html = renderToString(
      <ProposalCardView
        proposals={[
          {
            proposalId: "prop-1",
            type: "propose_create_entity",
            status: "pending",
            preview: { summary: "创建角色张三" },
          },
        ]}
      />,
    );
    // 头部文案整串在 JS 拼接（SSR 相邻表达式之间会插注释节点）
    expect(html).toContain("本轮提案 · 1 条（1 待处理）");
    expect(html).toContain("全部确认");
    expect(html).toContain("全部拒绝");
    expect(buttonTagBefore(html, "全部确认")).not.toContain("disabled");
    expect(buttonTagBefore(html, "全部拒绝")).not.toContain("disabled");
    expect(html).toContain("新建实体"); // PROPOSAL_TYPE_LABELS 映射
    expect(html).toContain("创建角色张三"); // 摘要首行
    expect(html).toContain("待处理");
    // 行尾逐条按钮（antd 对两字中文按钮插空格：确 认 / 拒 绝）
    expect(html).toMatch(/<span>确\s*认<\/span>/);
    expect(html).toMatch(/<span>拒\s*绝<\/span>/);
  });

  it("ProposalCardView：一轮多条提案合并为一张组卡（计数/类型/状态齐全，容器唯一）", () => {
    const html = renderToString(
      <ProposalCardView
        proposals={[
          {
            proposalId: "prop-1",
            type: "propose_create_entity",
            status: "pending",
            preview: { summary: "创建角色张三" },
          },
          {
            proposalId: "prop-2",
            type: "propose_update_entity",
            status: "confirmed",
            preview: { summary: "更新角色张三" },
          },
          {
            proposalId: "prop-3",
            type: "propose_create_hook",
            status: "stale",
            preview: { summary: "新建伏笔「黑潮」" },
          },
        ]}
      />,
    );
    expect(html).toContain("本轮提案 · 3 条（1 待处理）");
    expect(html.split("本轮提案").length - 1).toBe(1); // 一轮一张卡（不再是逐条 ProposalCardView）
    for (const label of ["新建实体", "更新实体", "新建伏笔"]) expect(html).toContain(label);
    expect(html).toContain("创建角色张三");
    expect(html).toContain("更新角色张三");
    expect(html).toContain("✓ 已确认");
    expect(html).toContain("⚠ 已失效");
    expect(html).toContain("待处理");
  });

  it("ProposalCardView：无 pending → 全部确认/全部拒绝禁用；空列表不渲染", () => {
    const html = renderToString(
      <ProposalCardView
        proposals={[{ proposalId: "prop-1", type: "propose_create_entity", status: "confirmed" }]}
      />,
    );
    expect(html).toContain("本轮提案 · 1 条（0 待处理）");
    expect(buttonTagBefore(html, "全部确认")).toContain("disabled");
    expect(buttonTagBefore(html, "全部拒绝")).toContain("disabled");
    expect(renderToString(<ProposalCardView proposals={[]} />)).toBe("");
  });

  it("ProposalCardView：processing 条目不计数为待处理（与批量目标同一谓词）", () => {
    const html = renderToString(
      <ProposalCardView
        proposals={[
          {
            proposalId: "prop-1",
            type: "propose_create_entity",
            status: "pending",
            processing: true,
          },
        ]}
      />,
    );
    expect(html).toContain("本轮提案 · 1 条（0 待处理）");
    expect(buttonTagBefore(html, "全部确认")).toContain("disabled");
    expect(buttonTagBefore(html, "全部拒绝")).toContain("disabled");
  });

  it("ProposalRow：折叠只给摘要首行（truncate），展开给完整预览；行尾逐条按钮常在", () => {
    const proposal: ProposalCard = {
      proposalId: "prop-1",
      type: "propose_add_delta",
      status: "pending",
      preview: { changes: ["第一条改动", "第二条改动"] },
    };
    const collapsed = renderToString(
      <ProposalRow proposal={proposal} expanded={false} onToggle={() => {}} />,
    );
    expect(collapsed).toContain("追加变更");
    expect(collapsed).toContain("第一条改动"); // 摘要首行
    expect(collapsed).not.toContain("第二条改动");
    expect(collapsed).toContain("truncate"); // 首行独占一行（truncate）
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toMatch(/<span>确\s*认<\/span>/); // 逐条按钮不受折叠影响
    expect(collapsed).toMatch(/<span>拒\s*绝<\/span>/);
    const expanded = renderToString(
      <ProposalRow proposal={proposal} expanded onToggle={() => {}} />,
    );
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain("第一条改动");
    expect(expanded).toContain("第二条改动"); // 展开 = 完整预览
  });

  it("ProposalRow：stale 行尾「⚠ 已失效」+ title 全句；展开再给正文全句", () => {
    const proposal: ProposalCard = {
      proposalId: "prop-1",
      type: "propose_update_entity",
      status: "stale",
    };
    const collapsed = renderToString(
      <ProposalRow proposal={proposal} expanded={false} onToggle={() => {}} />,
    );
    expect(collapsed).toContain("⚠ 已失效");
    expect(collapsed).toContain('title="数据已变化，此提案已失效"');
    const expanded = renderToString(
      <ProposalRow proposal={proposal} expanded onToggle={() => {}} />,
    );
    expect(expanded).toContain("数据已变化，此提案已失效");
  });

  it("PROPOSAL_TYPE_LABELS 覆盖服务端注册的全部 propose_*（16 个，无多余/无遗漏）", () => {
    // 清单来源 = packages/tools/src/index.ts 实际注册的提案工具（新增提案工具必须补中文名）
    const registered = [
      "propose_create_entity",
      "propose_update_entity",
      "propose_delete_entity",
      "propose_add_relation",
      "propose_remove_relation",
      "propose_add_delta",
      "propose_outline_node",
      "propose_move_node",
      "propose_delete_node",
      "propose_create_hook",
      "propose_update_hook",
      "propose_advance_hook",
      "propose_resolve_hook",
      "propose_abandon_hook",
      "propose_reorder_timepoints",
      "propose_create_reference",
    ];
    for (const type of registered) expect(PROPOSAL_TYPE_LABELS[type], type).toBeTruthy();
    expect(Object.keys(PROPOSAL_TYPE_LABELS).sort()).toEqual([...registered].sort());
    // 未知 type 回退裸工具名（行内仍能显示类型）
    const html = renderToString(
      <ProposalRow
        proposal={{ proposalId: "prop-x", type: "propose_future_tool", status: "pending" }}
        expanded={false}
        onToggle={() => {}}
      />,
    );
    expect(html).toContain("propose_future_tool");
  });

  it("ProposalRow：propose_reorder_timepoints 标题映射「重排时间轴时间点」+ preview 摘要渲染（不再 JSON dump）", () => {
    const html = renderToString(
      <ProposalRow
        proposal={{
          proposalId: "prop-9",
          type: "propose_reorder_timepoints",
          status: "pending",
          preview: { changes: [{ id: "tp-1", order: 2 }] },
        }}
        expanded={false}
        onToggle={() => {}}
      />,
    );
    expect(html).toContain("重排时间轴时间点"); // PROPOSAL_TYPE_LABELS 映射（G2 修订：propose_reorder_timepoints）
    // preview 摘要渲染——changes 对象项 id 未解析（SSR 不跑 useEffect）→ 兜底「调整位置」；
    // 不再 JSON dump（changes 字面量不出现）
    expect(html).toContain("调整位置");
    expect(html).not.toContain("changes");
  });
});

describe("历史提案卡（DESIGN.md `proposal-card` 历史形态：会话消息重建的只读卡）", () => {
  const proposalCalls = [
    {
      id: "call-1",
      tool: "propose_create_entity",
      args: { name: "张三", type: "character" },
    },
    {
      id: "call-2",
      tool: "propose_update_entity",
      args: { entity_id: "char-1", patches: { name: "张三丰" } },
    },
  ];
  const assistantMsg = (toolCalls: unknown[]): ChatMessageView => ({
    id: "m1",
    sessionId: "sess-1",
    role: "assistant",
    content: "好的，已给出提案",
    toolCalls,
    createdAt: "t0",
  });

  it("2 条提案调用 → 一张卡、2 行；无按钮、无状态文案（只读）", () => {
    const html = renderToString(<HistoricalProposalCard calls={proposalCalls} />);
    expect(html.split("历史提案 · 2 条（只读）").length - 1).toBe(1); // 一张卡
    expect(html).toContain("新建实体"); // PROPOSAL_TYPE_LABELS 映射
    expect(html).toContain("更新实体");
    expect(html.split('aria-expanded="false"').length - 1).toBe(2); // 每条调用一行（均折叠）
    expect(html).not.toContain("类型：character"); // 折叠态只给首行，不给完整摘要
    // 只读：无确认/拒绝按钮、无状态文案
    expect(html).not.toContain("确认");
    expect(html).not.toContain("拒绝");
    expect(html).not.toContain("待处理");
    expect(html).not.toContain("已确认");
    expect(html).not.toContain("已拒绝");
    expect(html).not.toContain("已失效");
    expect(html).not.toContain("全部确认");
  });

  it("折叠只给摘要首行（truncate）；展开给完整参数摘要（不调用 resolveNames，id 不解析）", () => {
    const [first] = proposalCalls;
    const collapsed = renderToString(<HistoricalProposalRow call={first} expanded={false} onToggle={() => {}} />);
    expect(collapsed).toContain("新建实体");
    expect(collapsed).toContain("truncate"); // 首行独占一行
    expect(collapsed).not.toContain("类型：character"); // 后续摘要行不泄露到折叠态
    expect(collapsed).toContain('aria-expanded="false"');
    const expanded = renderToString(<HistoricalProposalRow call={first} expanded onToggle={() => {}} />);
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain("新建实体：名称：张三"); // summarizePreview 首行（动词短语：主参）
    expect(expanded).toContain("类型：character"); // 完整摘要行
    expect(expanded).not.toContain("确认");
    // 摘要中 id 不做名称解析（names 恒 null，无法解析的 id 字段按 summarizePreview 口径省略）
    const withId = renderToString(
      <HistoricalProposalRow call={proposalCalls[1]} expanded onToggle={() => {}} />,
    );
    expect(withId).toContain("更新实体：变更字段：name");
    expect(withId).not.toContain("char-1"); // 不泄露裸 id、不发解析请求
  });

  it("未知类型回退裸名；无摘要时展开显示原始 JSON", () => {
    const call = { id: "call-x", tool: "propose_future_tool", args: { name: "张三" } };
    const collapsed = renderToString(<HistoricalProposalRow call={call} expanded={false} onToggle={() => {}} />);
    expect(collapsed).toContain("propose_future_tool"); // 未知回退裸工具名
    expect(collapsed).not.toContain("张三"); // 无摘要 → 折叠态只有占位
    const expanded = renderToString(<HistoricalProposalRow call={call} expanded onToggle={() => {}} />);
    expect(expanded).toContain("张三"); // 原始 JSON 兜底（未知工具 summarizePreview = null）
  });

  it("id-only 提案：折叠不重复 label，展开原始 JSON 原样显示 id", () => {
    const call = {
      id: "call-del",
      tool: "propose_delete_entity",
      args: { entity_id: "char-1" },
    };
    const collapsed = renderToString(
      <HistoricalProposalRow call={call} expanded={false} onToggle={() => {}} />,
    );
    expect(collapsed).toContain("删除实体");
    expect(collapsed).toContain("（无摘要）");
    expect(collapsed).not.toContain("char-1");
    const expanded = renderToString(
      <HistoricalProposalRow call={call} expanded onToggle={() => {}} />,
    );
    expect(expanded).toContain("char-1");
    expect(expanded).toContain("entity_id");

    const reorder = {
      id: "call-reorder",
      tool: "propose_reorder_timepoints",
      args: { timepoint_ids: ["tp-1", "tp-2"] },
    };
    const reorderCollapsed = renderToString(
      <HistoricalProposalRow call={reorder} expanded={false} onToggle={() => {}} />,
    );
    expect(reorderCollapsed).toContain("（无摘要）");
    const reorderExpanded = renderToString(
      <HistoricalProposalRow call={reorder} expanded onToggle={() => {}} />,
    );
    expect(reorderExpanded).toContain("tp-1");
  });

  it("生产形状 { id, name, arguments }：对象与 JSON 字符串均能归一出摘要", () => {
    const objectCall = {
      id: "call-prod-1",
      name: "propose_create_entity",
      arguments: { name: "张三", type: "character" },
    };
    const objectHtml = renderToString(
      <MessageItem message={assistantMsg([objectCall])} toolResults={new Map()} />,
    );
    expect(objectHtml).toContain("新建实体");
    expect(objectHtml).toContain("名称：张三");

    const stringCall = {
      id: "call-prod-2",
      name: "propose_create_entity",
      arguments: JSON.stringify({ name: "李四", type: "character" }),
    };
    const stringHtml = renderToString(
      <MessageItem message={assistantMsg([stringCall])} toolResults={new Map()} />,
    );
    expect(stringHtml).toContain("新建实体");
    expect(stringHtml).toContain("名称：李四");
  });

  it("MessageItem：非提案工具不产生历史卡；提案工具在正文之后渲染", () => {
    const plain = renderToString(
      <MessageItem
        message={assistantMsg([{ id: "call-0", tool: "get_entity", args: { id: "char-1" } }])}
        toolResults={new Map()}
      />,
    );
    expect(plain).not.toContain("历史提案");
    const proposed = renderToString(
      <MessageItem message={assistantMsg(proposalCalls)} toolResults={new Map()} />,
    );
    expect(proposed).toContain("历史提案 · 2 条（只读）");
    expect(proposed.indexOf("历史提案")).toBeGreaterThan(proposed.indexOf("好的，已给出提案"));
  });

  it("MessageItem：liveProposalToolCallIds 命中的调用不渲染（按 toolCallId 去重，不靠位置猜测）", () => {
    const partial = renderToString(
      <MessageItem
        message={assistantMsg(proposalCalls)}
        toolResults={new Map()}
        liveProposalToolCallIds={new Set(["call-1"])}
      />,
    );
    expect(partial).toContain("历史提案 · 1 条（只读）");
    expect(partial).toContain("更新实体");
    expect(partial).not.toContain("新建实体"); // 被 live 组卡承载
    const empty = renderToString(
      <MessageItem
        message={assistantMsg(proposalCalls)}
        toolResults={new Map()}
        liveProposalToolCallIds={new Set()}
      />,
    );
    expect(empty).toContain("历史提案 · 2 条（只读）"); // 集合为空 → 全量
    const allLive = renderToString(
      <MessageItem
        message={assistantMsg(proposalCalls)}
        toolResults={new Map()}
        liveProposalToolCallIds={new Set(["call-1", "call-2"])}
      />,
    );
    expect(allLive).not.toContain("历史提案"); // 全部由 live 组卡承载 → 不渲染历史卡
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

  it("推演形态：文案 = 「推演节点 · N 个」；集合无名称位；N 缺失 → 省略数字", () => {
    expect(focusLabel({ focus_deduction: true }, undefined, 2)).toBe("推演节点 · 2 个");
    // 无名称可解析（名称参数不参与）；N 缺失（大纲/配置未加载）→ 不显「0 个」假值
    expect(focusLabel({ focus_deduction: true }, "不该出现", 2)).toBe("推演节点 · 2 个");
    expect(focusLabel({ focus_deduction: true })).toBe("推演节点");
  });
});
