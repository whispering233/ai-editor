// 写作页（`#/writing` / `#/writing/:chapterId`）SSR 走查（仓内无 jsdom，同 pages/practice.test.tsx 惯例）。
// 契约 = docs/ui/DESIGN.md `writing-page` + §Layout「写作页的中栏内分栏」「页头常驻」。
//
// writing-2 起本页 = rail（固定 240px）+ 正文列；窄屏两级互斥、专注模式隐藏 rail / 返回条。
// `useMediaQuery` 的 useState 初始化器读 `window.matchMedia`，SSR 下直接跑会崩 ⇒ 用 `vi.hoisted`
// 变量 mock（浏览器行为不变；测试只切 desktop / narrow 两态）。
// 有 id 的用例在 SSR 下不跑 effect ⇒ 只有编辑面板的加载骨架（不发请求）。
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OutlineChapter,
  OutlineTree,
  OutlineVolume,
  ProjectConfig,
} from "@whispering233/ai-editor-shared";
import Writing from "./Writing";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock("../hooks/use-media-query", () => ({
  useMediaQuery: () => media.desktop,
}));

const chapter = (
  id: string,
  title: string,
  metadata?: { textLength?: number; documentUpdatedAt?: string },
): OutlineChapter => ({
  id,
  type: "chapter",
  title,
  updatedAt: "t",
  ...(metadata === undefined ? {} : { metadata }),
});
const volume = (id: string, title: string, children: OutlineChapter[]): OutlineVolume => ({
  id,
  type: "volume",
  title,
  updatedAt: "t",
  children,
});

/** 卷1（ch-1、ch-2）+ 卷2（ch-3） */
const OUTLINE: OutlineTree = {
  id: "root",
  type: "root",
  schemaVersion: 1,
  children: [
    volume("vol-1", "第一卷", [
      chapter("ch-1", "雪夜出走", { textLength: 1200 }),
      chapter("ch-2", "旧盟友"),
    ]),
    volume("vol-2", "第二卷", [chapter("ch-3", "入城")]),
  ],
};

const EMPTY_OUTLINE: OutlineTree = {
  id: "root",
  type: "root",
  schemaVersion: 1,
  children: [],
};

const CONFIG: ProjectConfig = {
  id: "p-1",
  name: "测试书",
  language: "zh",
  kind: "novel",
  authorId: null,
  schemaVersion: 1,
  currentPosition: null,
  deductionNodes: [],
  backupFrequencyMinutes: null,
  createdAt: "t",
  updatedAt: "t",
};

interface RenderOptions {
  chapterId?: string;
  outline?: OutlineTree | null;
  outlineLoading?: boolean;
  outlineError?: string | null;
  focusMode?: boolean;
  desktop?: boolean;
}

/**
 * SSR 预置 store：zustand 的服务端快照取 `getInitialState()`（不是 `getState()`）——`setState` 对
 * `renderToString` 无效，故本用例直接往初始 state 对象（`getInitialState()` 返回的就是它）上写。
 */
function render({
  chapterId,
  outline = OUTLINE,
  outlineLoading = false,
  outlineError = null,
  focusMode = false,
  desktop = true,
}: RenderOptions = {}): string {
  media.desktop = desktop;
  Object.assign(useProjectStore.getInitialState(), {
    config: CONFIG,
    outline,
    outlineError,
    configLoading: false,
    outlineLoading,
    outlineWithMetadata: outline !== null,
  });
  Object.assign(useUiStore.getInitialState(), { focusMode });
  return renderToString(<Writing chapterId={chapterId} />).replace(/<!--[^>]*-->/g, "");
}

beforeEach(() => {
  media.desktop = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
  media.desktop = true;
  Object.assign(useProjectStore.getInitialState(), {
    config: null,
    outline: null,
    outlineError: null,
    outlineLoading: false,
    outlineWithMetadata: false,
  });
  Object.assign(useUiStore.getInitialState(), { focusMode: false });
});

describe("写作页 · 桌面（rail + 正文列）", () => {
  it("全高分栏外壳（抵消中栏 p-6）+ rail 240px + 右边界手柄与收起按钮 + 正文列吸收剩余宽度", () => {
    const html = render();
    expect(html).toContain("-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden");
    // 桌面端正文列 pt-0：页头 `-mx-6` 穿透后分割线全幅（DESIGN.md §Layout「工作台子栏页头」）
    expect(html).toContain("flex min-h-0 min-w-0 flex-1 flex-col p-6 pt-0");
    expect(html).toContain("width:240px");
    // 分栏线归 rail 自己的 border-r（手柄不再画线，DESIGN.md §Layout「分栏边线单所有权」）
    expect(html).toContain("border-r border-border");
    expect(html).toContain(">卷章<");
    expect(html).toContain("第1卷");
    expect(html).toContain("第1章");
    expect(html).toContain("2章");
    // 展开态 = 右边界 6px 手柄 + rail 页头标题行最左的收起按钮（外端锚定：两枚钮各在最外端）
    expect(html).toContain('aria-label="调整卷章导航栏宽度"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="收起卷章导航栏"');
    expect(html).not.toContain('aria-label="展开卷章导航栏"');
    // 普通 `icon-button` 表皮 + 静态面板图形（左栏 ⇒ 竖线靠左），不是圆钮、也不是整栏双箭头
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('d="M9 4 V20"');
    expect(html).not.toContain("ant-btn-circle");
    expect(html).not.toContain("anticon-double-left");
    // 两栏都开：左钮 = 最左可见列（rail）页头标题行最左，在「卷章」标题之前
    expect(html.indexOf('aria-label="收起卷章导航栏"')).toBeLessThan(
      html.indexOf(">卷章<"),
    );
  });

  it("无 id：子栏页头「写作」（16px / 400+24+分割线）+「从左侧选择一章开始写作」（不落空态）", () => {
    const html = render();
    expect(html).toContain(">写作<");
    expect(html).toContain("truncate text-base font-semibold");
    expect(html).toContain("flex h-10 min-w-0 items-center gap-2");
    expect(html).toContain("flex h-6 min-w-0 items-center gap-2");
    // 正文列页头：内距在包装上、header 只负边距 ⇒ 分割线全幅（不经 px-6 内缩）
    expect(html).toContain('<div class="flex flex-col px-6">');
    expect(html).toContain('<header class="flex shrink-0 flex-col mb-4 -mx-6">');
    expect(html).toContain("从左侧选择一章开始写作");
    expect(html).not.toContain("还没有章节");
    expect(html).not.toContain("章节目录");
  });

  it("无章（rows 为空）：空态「还没有章节」+「去大纲新建第一卷」导航链接", () => {
    const html = render({ outline: EMPTY_OUTLINE });
    expect(html).toContain(">写作<");
    expect(html).toContain("还没有章节");
    expect(html).toContain("去大纲新建第一卷");
    expect(html).toContain('href="#/outline"');
    expect(html).not.toContain("从左侧选择一章开始写作");
  });

  it("只有 0 章卷：卷行存在但没有章行，仍走无章空态（不误判为「有章待选」）", () => {
    const html = render({
      outline: {
        id: "root",
        type: "root",
        schemaVersion: 1,
        children: [volume("vol-empty", "空卷", [])],
      },
    });
    expect(html).toContain("还没有章节");
    expect(html).toContain("去大纲新建第一卷");
    expect(html).not.toContain("从左侧选择一章开始写作");
  });

  it("有 id：rail 选中行 aria-current + 章正文编辑面板（章标题 / 加载骨架 / 上下一章）", () => {
    const html = render({ chapterId: "ch-2" });
    expect(html).toContain('href="#/writing/ch-2"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("1.2 千字"); // rail 字数取 metadata.textLength
    expect(html).toContain(">旧盟友</");
    expect(html).toContain('aria-label="上一章"');
    expect(html).toContain('aria-label="下一章"');
    expect(html).toContain('aria-label="导入"');
    expect(html).toContain('aria-label="导出"');
    expect(html).not.toContain("anticon-down"); // 导出改为纯图标触发（去掉下拉箭头）
    expect(html).toContain("h-5"); // 正文加载骨架（SSR 不跑 effect，拿不到正文）
    expect(html).not.toContain("从左侧选择一章开始写作");
  });
});

describe("写作页 · 最近导航（`#/writing` 无 id）", () => {
  it("有保存过的正文（documentUpdatedAt）：解析出目标 → 正文列骨架，不闪空态", () => {
    const html = render({
      outline: {
        id: "root",
        type: "root",
        schemaVersion: 1,
        children: [
          volume("vol-1", "第一卷", [
            chapter("ch-1", "雪夜出走", { documentUpdatedAt: "2026-11-01T10:00:00Z" }),
            chapter("ch-2", "旧盟友", { documentUpdatedAt: "2026-11-02T10:00:00Z" }),
          ]),
        ],
      },
    });
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("从左侧选择一章开始写作");
    expect(html).not.toContain("还没有章节");
  });

  it("无最近打开且无已保存正文 → 空态不跳第一章", () => {
    const html = render();
    expect(html).toContain("从左侧选择一章开始写作");
    expect(html).toContain(">写作<");
    expect(html).not.toContain("animate-pulse");
  });

  it("最近打开（localStorage per-book 命中）同样进待 replace 骨架（不是空态）", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "ai-editor:writing-last-opened" ? JSON.stringify({ "p-1": "ch-2" }) : null,
      setItem: () => {},
    });
    const html = render();
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("从左侧选择一章开始写作");
  });
});

describe("写作页 · 窄屏两级互斥（<1024px）", () => {
  it("无 id：只渲染 rail 全宽（无正文、无「写作」页头；窄屏无手柄 / 收起）", () => {
    const html = render({ desktop: false });
    expect(html).toContain("w-full");
    // 窄屏全宽无邻居：页面传 `border-r-0` 抹掉 rail 自带的右边线（DESIGN.md §Layout「分栏边线单所有权」）
    expect(html).toContain("border-r-0");
    expect(html).not.toContain("border-r border-border");
    expect(html).toContain(">卷章<");
    expect(html).not.toContain(">写作<");
    expect(html).not.toContain("从左侧选择一章开始写作");
    expect(html).not.toContain("章节目录");
    expect(html).not.toContain('aria-label="调整卷章导航栏宽度"');
    expect(html).not.toContain('aria-label="收起卷章导航栏"');
  });

  it("有 id：正文全宽 + 顶部「章节目录」返回条（无 rail / 窄条 / 手柄）", () => {
    const html = render({ desktop: false, chapterId: "ch-1" });
    expect(html).not.toContain(">卷章<");
    expect(html).not.toContain("width:240px");
    expect(html).not.toContain('aria-label="调整卷章导航栏宽度"');
    expect(html).not.toContain('aria-label="展开卷章导航栏"');
    expect(html).toContain("章节目录");
    expect(html).toContain('href="#/writing"');
    expect(html).toContain(">雪夜出走</");
    // 窄屏保留列内边距（只有桌面端 pt-0）
    expect(html).toContain("flex min-h-0 min-w-0 flex-1 flex-col p-6");
    expect(html).not.toContain("pt-0");
  });
});

describe("写作页 · 卷章导航栏宽度与收起（2b）", () => {
  /** hook 初始 state 在 SSR 读一次 localStorage（`typeof window` 守卫）⇒ 用 window stub 预置 */
  function stubRailStorage(layout: {
    width: number;
    collapsed: boolean;
    detailCollapsed?: boolean;
  }) {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) =>
          key === "ai-editor:writing-rail" ? JSON.stringify(layout) : null,
        setItem: () => {},
      },
    });
  }

  it("持久化宽度生效（内联 width；越界收敛到 [200, 480]）", () => {
    stubRailStorage({ width: 333, collapsed: false });
    const html = render();
    expect(html).toContain("width:333px");
    expect(html).not.toContain("width:240px");

    stubRailStorage({ width: 9999, collapsed: false });
    expect(render()).toContain("width:480px");

    stubRailStorage({ width: 120, collapsed: false });
    expect(render()).toContain("width:200px");
  });

  it("桌面收起态：rail = 0px（不渲染 rail / 窄条 / 手柄），页头 toggle 转为「展开」，正文列吸收宽度", () => {
    stubRailStorage({ width: 333, collapsed: true });
    const html = render({ chapterId: "ch-1" });
    expect(html).toContain('aria-label="展开卷章导航栏"');
    expect(html).toContain('aria-expanded="false"');
    // 图标静态不换向（仍是左栏面板图形）
    expect(html).toContain('d="M9 4 V20"');
    expect(html).not.toContain("ant-btn-circle");
    // 收起 = 0px：rail 完全不渲染（无 header 标题 / 无内联宽度）+ 无窄条占位 + 无手柄
    expect(html).not.toContain(">卷章<");
    expect(html).not.toContain('aria-label="卷章导航栏"');
    expect(html).not.toContain("width:333px");
    expect(html).not.toContain("w-8");
    expect(html).not.toContain('aria-label="调整卷章导航栏宽度"');
    expect(html).not.toContain('aria-label="收起卷章导航栏"');
    // 正文列照常渲染（宽度保留在存储里，展开恢复原宽）
    expect(html).toContain('aria-label="上一章"');
  });

  it("收起且无章：提示从页头展开导航栏，不再指向已消失的左栏", () => {
    stubRailStorage({ width: 240, collapsed: true });
    const html = render();
    expect(html).toContain('aria-label="展开卷章导航栏"');
    expect(html).toContain("从页头左侧展开卷章导航栏，选择一章开始写作");
    expect(html).not.toContain("从左侧选择一章开始写作");
  });

  it("窄屏无收起：存储的 collapsed 不生效，rail 全宽无窄条 / 手柄 / 页头 toggle", () => {
    stubRailStorage({ width: 240, collapsed: true });
    const html = render({ desktop: false });
    expect(html).toContain("w-full");
    expect(html).not.toContain('aria-label="展开卷章导航栏"');
    expect(html).not.toContain('aria-label="收起卷章导航栏"');
    expect(html).not.toContain('aria-label="调整卷章导航栏宽度"');
  });
});

describe("写作页 · 右侧详情收起（设计：`writing-page`「宽度与收起」）", () => {
  /** 同上方：SSR 下 hook 的初始 state 从 localStorage 预置 */
  function stubRailStorage(layout: {
    width: number;
    collapsed: boolean;
    detailCollapsed?: boolean;
  }) {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) =>
          key === "ai-editor:writing-rail" ? JSON.stringify(layout) : null,
        setItem: () => {},
      },
    });
  }

  it("两栏都开：右钮在正文页头动作组末尾（左钮在 rail 页头、右钮在正文页头，各在最外端）", () => {
    stubRailStorage({ width: 333, collapsed: false, detailCollapsed: false });
    const html = render({ chapterId: "ch-1" });
    expect(html).toContain('aria-label="收起右侧详情"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('aria-label="展开右侧详情"');
    // 图标 = 静态面板图形（右侧详情栏 ⇒ 竖线靠右；不是圆钮 / 双箭头）
    expect(html).toContain('d="M15 4 V20"');
    expect(html).not.toContain("ant-btn-circle");
    // 位置 = 正文页头动作组末尾（上一章 / 下一章 / 导入 / 导出之后），不在 rail 页头
    expect(html.indexOf('aria-label="收起右侧详情"')).toBeGreaterThan(
      html.indexOf('aria-label="导出"'),
    );
    expect(html.indexOf('aria-label="收起右侧详情"')).toBeGreaterThan(
      html.indexOf("flex min-h-0 min-w-0 flex-1 flex-col p-6"),
    );
    // 正常两栏：rail 像素宽 + 手柄 + 正文列
    expect(html).toContain("width:333px");
    expect(html).toContain("border-r border-border");
    expect(html).toContain('aria-label="调整卷章导航栏宽度"');
    expect(html).toContain('aria-label="上一章"');
  });

  it("收起态：正文列整列不渲染、rail 全宽（无内联宽 / 无右边线 / 无手柄）、按钮转为展开", () => {
    stubRailStorage({ width: 333, collapsed: false, detailCollapsed: true });
    const html = render({ chapterId: "ch-1" });
    // 按钮：静态面板图形（不随收起态换向）+ 「展开右侧详情」
    expect(html).toContain('aria-label="展开右侧详情"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('d="M15 4 V20"');
    expect(html).not.toContain('aria-label="收起右侧详情"');
    // rail 吸收全宽：不传 width（无内联宽）+ `w-full border-r-0`（邻栏不在，不画分栏线）
    expect(html).not.toContain("width:333px");
    expect(html).toContain("w-full border-r-0");
    expect(html).not.toContain("border-r border-border");
    // 不渲染手柄（拖拽只在两栏展开态有意义）
    expect(html).not.toContain('aria-label="调整卷章导航栏宽度"');
    // 正文列（含页头 / 编辑器）整列卸载；rail 本身照常（选中行保留）
    expect(html).not.toContain(">写作<");
    expect(html).not.toContain('aria-label="上一章"');
    expect(html).toContain('aria-current="page"');
    // 右钮回到 rail 页头右端组（详情收起 = rail 是最右可见列）：标题之后、行区之前
    expect(html.indexOf('aria-label="展开右侧详情"')).toBeGreaterThan(
      html.indexOf(">卷章<"),
    );
    expect(html.indexOf('aria-label="展开右侧详情"')).toBeLessThan(
      html.indexOf('data-chapter-id="ch-1"'),
    );
  });

  it("无 id 时收起：不渲染正文列空态提示（只留 rail 全宽）", () => {
    stubRailStorage({ width: 333, collapsed: false, detailCollapsed: true });
    const html = render();
    expect(html).not.toContain(">写作<");
    expect(html).not.toContain("从左侧选择一章开始写作");
    expect(html).not.toContain("还没有章节");
    expect(html).toContain(">卷章<");
    expect(html).toContain("w-full border-r-0");
  });

  it("rail 自身收起时详情列保留（两栏不会同时收起）：左钮移到正文页头 leading、右钮隐藏", () => {
    stubRailStorage({ width: 333, collapsed: true, detailCollapsed: true });
    const html = render({ chapterId: "ch-1" });
    expect(html).toContain('aria-label="展开卷章导航栏"');
    expect(html).not.toContain('aria-label="展开右侧详情"');
    expect(html).not.toContain('aria-label="收起右侧详情"');
    expect(html).toContain('aria-label="上一章"');
    // 左钮在正文页头标题行最左（在「雪夜出走」标题之前）
    expect(html.indexOf('aria-label="展开卷章导航栏"')).toBeLessThan(
      html.indexOf(">雪夜出走<"),
    );
  });

  it("专注模式：存储的 detailCollapsed 不生效，正文独占", () => {
    stubRailStorage({ width: 333, collapsed: false, detailCollapsed: true });
    const html = render({ chapterId: "ch-1", focusMode: true });
    expect(html).toContain("h-5");
    expect(html).not.toContain(">卷章<");
  });

  it("窄屏：不渲染右侧详情钮，存储的 detailCollapsed 不生效（正文列照常）", () => {
    stubRailStorage({ width: 333, collapsed: false, detailCollapsed: true });
    const html = render({ desktop: false, chapterId: "ch-1" });
    expect(html).not.toContain('aria-label="展开右侧详情"');
    expect(html).not.toContain('aria-label="收起右侧详情"');
    expect(html).toContain("章节目录");
    expect(html).toContain('aria-label="上一章"');
  });
});

describe("写作页 · 专注模式", () => {
  it("桌面：rail / 窄条 / 手柄都不渲染，正文独占（无「章节目录」返回条）", () => {
    const html = render({ focusMode: true, chapterId: "ch-1" });
    expect(html).not.toContain(">卷章<");
    expect(html).not.toContain('aria-label="卷章导航栏"');
    expect(html).not.toContain('aria-label="调整卷章导航栏宽度"');
    expect(html).not.toContain('aria-label="展开卷章导航栏"');
    expect(html).not.toContain('aria-label="收起卷章导航栏"');
    expect(html).not.toContain("章节目录");
    expect(html).toContain("h-5");
  });

  it("窄屏：rail 与「章节目录」返回条都不渲染，正文独占", () => {
    const html = render({ focusMode: true, desktop: false, chapterId: "ch-1" });
    expect(html).not.toContain(">卷章<");
    expect(html).not.toContain("章节目录");
    expect(html).toContain("h-5");
  });
});

describe("写作页 · 错误态", () => {
  it("大纲已加载但 chapterId 不在可见大纲：错误条 + 返回章节目录，不渲染编辑器、不自动回退；页头 toggle 仍在", () => {
    const html = render({ chapterId: "ch-missing" });
    expect(html).toContain("章节不存在或已删除");
    expect(html).toContain('aria-label="收起卷章导航栏"');
    expect(html).toContain('href="#/writing"');
    expect(html).toContain("返回章节目录");
    expect(html).not.toContain('aria-label="上一章"');
    expect(html).not.toContain('aria-label="下一章"');
  });

  it("有 id 但大纲未就绪：正文只给骨架，不先挂编辑器（坏 chapterId 不先发 404）；页头 toggle 仍在", () => {
    const html = render({ chapterId: "no-such-chapter", outline: null, outlineLoading: true });
    expect(html).toContain("animate-pulse");
    expect(html).toContain('aria-label="收起卷章导航栏"');
    expect(html).not.toContain("章节不存在或已删除");
    expect(html).not.toContain('aria-label="上一章"');
    expect(html).not.toContain('aria-label="下一章"');
  });

  it("大纲失败且有 id：正文只给错误条 + 重试，不挂编辑器", () => {
    const html = render({
      chapterId: "ch-1",
      outline: null,
      outlineError: "CLIENT_NETWORK_ERROR",
    });
    expect(html).toContain("大纲加载失败");
    expect(html).toMatch(/重\s*试/);
    expect(html).not.toContain('aria-label="上一章"');
    expect(html).not.toContain('aria-label="下一章"');
  });

  it("大纲加载中：rail 骨架、正文列不出错误；首帧（error 为 null）同样不误报", () => {
    const loading = render({ outline: null, outlineLoading: true });
    expect(loading).toContain("animate-pulse");
    expect(loading).not.toContain("大纲加载失败");

    const firstFrame = render({ outline: null, outlineLoading: false });
    expect(firstFrame).toContain("animate-pulse");
    expect(firstFrame).not.toContain("大纲加载失败");

    const failed = render({
      outline: null,
      outlineLoading: false,
      outlineError: "CLIENT_NETWORK_ERROR",
    });
    expect(failed).toContain("animate-pulse");
    expect(failed).toContain("大纲加载失败");
    expect(failed).toMatch(/重\s*试/);
    expect(failed).not.toContain("还没有章节");
  });

  it("窄屏目录页：大纲失败在 rail 内给错误 + 重试（没有正文列可挂错误条）", () => {
    const html = render({
      desktop: false,
      outline: null,
      outlineLoading: false,
      outlineError: "CLIENT_NETWORK_ERROR",
    });
    expect(html).toContain("大纲加载失败");
    expect(html).toMatch(/重\s*试/);
    expect(html).not.toContain("animate-pulse");
  });
});
