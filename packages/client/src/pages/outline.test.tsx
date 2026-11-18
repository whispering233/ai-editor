// 大纲页（`#/outline` / `#/outline/:nodeId`）SSR 走查：仓内无 jsdom，用 react-dom/server 直渲染页面
// （同 pages/writing.test.tsx 惯例）。契约 = docs/ui/DESIGN.md `outline-page` + §Layout「分栏边线单所有权」。
//
// 覆盖：分栏壳（rail + 详情列）/ rail header 图标组 / 推演徽标（rail 图标态）/ 详情列各空态 /
// 窄屏两级互斥 / 宽度与收起持久化 / 选中唯一来源 = URL（aria-current + bg-accent）/ 删除收敛纯函数。
// `useMediaQuery` 的 useState 初始化器读 `window.matchMedia`，SSR 下直接跑会崩 ⇒
// 用 `vi.hoisted` 变量 mock（浏览器行为不变；测试只切 desktop / narrow 两态）。
// 右键菜单项活在 portal 里、关闭态不渲染 ⇒ 菜单文案由 lib/deduction.test.ts 的纯函数覆盖，
// 「点菜单项 → 徽标即时刷新」走浏览器人工核对（无 jsdom 无法派发右键事件）。
// `clearDeductionMarks` 碰 store action + 请求，同 `submitDeductionMarks` 不进单测。
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OutlineChapter,
  OutlineScene,
  OutlineTree,
  OutlineVolume,
  ProjectConfig,
} from "@whispering233/ai-editor-shared";
import Outline from "./Outline";
import OutlineDetail, { isOutlineDetailDirty } from "./OutlineDetail";
import { deleteInvalidatesSelection, findNode } from "../lib/outline-tree";
import { useProjectStore } from "../stores/project";

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock("../hooks/use-media-query", () => ({
  useMediaQuery: () => media.desktop,
}));

// 大纲 loader 只记调用：SSR 不跑 effect，但「谁挂了这个 hook」可在渲染期观察到——
// 壳是**唯一**调用者（rail / 详情都由壳传 reload），详情不再自拉。
const loader = vi.hoisted(() => ({ calls: [] as { withMetadata: boolean }[] }));
vi.mock("../hooks/use-outline-loader", () => ({
  useOutlineLoader: (opts: { withMetadata: boolean }) => {
    loader.calls.push(opts);
    return { reload: async () => {}, retry: () => {} };
  },
}));

/** 节点更新时间（真实 ISO：元信息行只显示 `MM-DD`，完整时间进 `title`，两者都可断言） */
const UPDATED_AT = "2026-01-05T08:05:00";
const chapter = (id: string, title: string, children?: OutlineScene[]): OutlineChapter => ({
  id,
  type: "chapter",
  title,
  updatedAt: UPDATED_AT,
  children,
});
const volume = (id: string, title: string, children: OutlineChapter[]): OutlineVolume => ({
  id,
  type: "volume",
  title,
  updatedAt: UPDATED_AT,
  children,
});

/** 卷1（ch-1（含场景 sc-1）、ch-2）+ 卷2（ch-3） */
const OUTLINE: OutlineTree = {
  id: "root",
  type: "root",
  schemaVersion: 1,
  children: [
    volume("vol-1", "第一卷", [
      chapter("ch-1", "雪夜出走", [{ id: "sc-1", type: "scene", title: "城外", updatedAt: UPDATED_AT }]),
      chapter("ch-2", "旧盟友"),
    ]),
    volume("vol-2", "第二卷", [chapter("ch-3", "入城")]),
  ],
};

const EMPTY_OUTLINE: OutlineTree = { id: "root", type: "root", schemaVersion: 1, children: [] };

const CONFIG: ProjectConfig = {
  id: "p-1",
  name: "测试书",
  language: "zh",
  kind: "novel", // 工作区类型（恒下发字段，API 形态必填）
  authorId: null, // 预置作家 id（仅练习工作区有值）
  schemaVersion: 1,
  currentPosition: null,
  deductionNodes: [],
  backupFrequencyMinutes: null,
  createdAt: "t",
  updatedAt: "t",
};

interface RenderOptions {
  /** 与路由一致：undefined = `#/outline`，有值 = `#/outline/:nodeId` */
  nodeId?: string;
  outline?: OutlineTree | null;
  outlineLoading?: boolean;
  outlineError?: string | null;
  /** null = 未打开项目；对象 = 在 CONFIG 上覆盖 */
  config?: Partial<ProjectConfig> | null;
  desktop?: boolean;
  /** 便捷：等同 `config: { deductionNodes }` */
  deductionNodes?: string[];
}

/**
 * SSR 预置 store：zustand 的服务端快照取 `getInitialState()`（不是 `getState()`）——`setState` 对
 * `renderToString` 无效，故本用例直接往初始 state 对象（`getInitialState()` 返回的就是它）上写。
 */
function render({
  nodeId,
  outline = OUTLINE,
  outlineLoading = false,
  outlineError = null,
  config = CONFIG,
  desktop = true,
  deductionNodes,
}: RenderOptions = {}): string {
  media.desktop = desktop;
  Object.assign(useProjectStore.getInitialState(), {
    config:
      config === null ? null : { ...CONFIG, ...config, ...(deductionNodes ? { deductionNodes } : {}) },
    outline,
    outlineError,
    configLoading: false,
    outlineLoading,
    outlineWithMetadata: outline !== null,
  });
  return renderToString(<Outline nodeId={nodeId} />).replace(/<!--[^>]*-->/g, "");
}

/** hook 初始 state 在 SSR 读一次 localStorage（`typeof window` 守卫）⇒ 用 window stub 预置 */
function stubRailStorage(layout: {
  width: number | null;
  collapsed: boolean;
  detailCollapsed?: boolean;
}) {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) =>
        key === "ai-editor:outline-rail" ? JSON.stringify(layout) : null,
      setItem: () => {},
    },
  });
}

/** 取某行自身的 HTML（到下一个 data-node-id 为止——子节点渲染在父行之后） */
function rowHtml(html: string, nodeId: string): string {
  const start = html.indexOf(`data-node-id="${nodeId}"`);
  const end = html.indexOf("data-node-id=", start + 1);
  return html.slice(start, end === -1 ? undefined : end);
}

beforeEach(() => {
  media.desktop = true;
});

afterEach(() => {
  media.desktop = true;
  vi.unstubAllGlobals();
  loader.calls.length = 0;
  Object.assign(useProjectStore.getInitialState(), {
    config: null,
    outline: null,
    outlineError: null,
    outlineLoading: false,
    outlineWithMetadata: false,
  });
});

describe("大纲页树视图：推演节点徽标", () => {
  it("多标记：首位「推演起点」/ 末位「推演终点」，title = 文案（第N章）· 第 k / 共 N 个推演节点", () => {
    const html = render({ deductionNodes: ["ch-1", "ch-3"] });
    expect(rowHtml(html, "ch-1")).toContain('title="推演起点（第1章） · 第 1 / 共 2 个推演节点"');
    expect(rowHtml(html, "ch-3")).toContain('title="推演终点（第3章） · 第 2 / 共 2 个推演节点"');
    expect(rowHtml(html, "ch-1")).toContain('aria-label="推演起点"');
    expect(rowHtml(html, "ch-3")).toContain('aria-label="推演终点"');
    expect(rowHtml(html, "ch-1")).toContain("anticon-branches");
  });

  it("单标记：文案 = 推演节点，不附 k / N；未标记的章行不渲染徽标", () => {
    const html = render({ deductionNodes: ["ch-2"] });
    expect(rowHtml(html, "ch-2")).toContain('title="推演节点（第2章）"');
    expect(rowHtml(html, "ch-2")).toContain('aria-label="推演节点"');
    expect(rowHtml(html, "ch-2")).not.toContain(">推演节点<"); // 图标态，不渲染文字 chip
    expect(html).not.toContain("推演起点");
    expect(rowHtml(html, "ch-1")).not.toContain("推演");
  });

  it("rail 徽标为图标态：只出图标 + title / aria-label，不渲染文字 chip", () => {
    const row = rowHtml(
      render({ deductionNodes: ["ch-1"], config: { currentPosition: "ch-1" } }),
      "ch-1",
    );
    // 推演 = BranchesOutlined、阅读进度 = AimOutlined（完整语义进 title / aria-label）
    expect(row).toContain("anticon-branches");
    expect(row).toContain("anticon-aim");
    expect(row).toContain('title="阅读进度"');
    expect(row).toContain('aria-label="阅读进度"');
    expect(row).not.toContain(">推演起点<");
    expect(row).not.toContain(">阅读进度<");
  });

  it("无标记：整页不出现推演徽标", () => {
    expect(render({ deductionNodes: [] })).not.toContain("推演");
  });

  // rail header 一键清空入口（DESIGN.md「`推演节点` 徽标」）：可见性判据与徽标同源
  // （`deduction.marks.length > 0` ⇒ 无可见标记时按钮不渲染，不给「点了没反应」的入口）。
  it("有可见标记：rail header 渲染「清除推演标记」按钮", () => {
    expect(render({ deductionNodes: ["ch-1"] })).toContain("清除推演标记");
  });

  it("无可见标记：rail header 不渲染「清除推演标记」按钮", () => {
    expect(render({ deductionNodes: [] })).not.toContain("清除推演标记");
    // 盘上有 id 但全部失效（章被软删）⇒ 无可见标记，按钮同样不渲染
    expect(render({ deductionNodes: ["ghost"] })).not.toContain("清除推演标记");
  });

  it("卷行 / 场景行不给徽标（仅章行）", () => {
    const html = render({ deductionNodes: ["ch-1", "ch-3"] });
    expect(rowHtml(html, "vol-1")).not.toContain("推演");
    expect(rowHtml(html, "sc-1")).not.toContain("推演");
  });

  it("位置：徽标排在「阅读进度」左侧（阅读进度是单值固定标记、恒贴右）", () => {
    const row = rowHtml(
      render({ deductionNodes: ["ch-1"], config: { currentPosition: "ch-1" } }),
      "ch-1",
    );
    const deduction = row.indexOf("推演");
    const current = row.indexOf("阅读进度");
    expect(deduction).toBeGreaterThan(-1);
    expect(current).toBeGreaterThan(-1);
    expect(deduction).toBeLessThan(current);
  });
});

// 选中唯一来源 = URL（DESIGN.md `outline-page`）：不存组件选中态——`#/outline/:id` 的 id 即选中，
// `#/outline` / 坏 id 无选中。（行单击导航 / 同 id 幂等是浏览器手势，无 jsdom，走人工核对。）
describe("大纲页 · 选中唯一来源 = URL", () => {
  it("有 id：该行 bg-accent + aria-current=page，其他行不命中选中", () => {
    const html = render({ nodeId: "ch-1" });
    const row = rowHtml(html, "ch-1");
    expect(row).toContain('aria-current="page"');
    expect(row).toContain("active:cursor-grabbing bg-accent");
    expect(rowHtml(html, "ch-2")).not.toContain("aria-current");
    expect(rowHtml(html, "vol-1")).not.toContain("aria-current");
  });

  it("无 id / 坏 id：没有行被标为选中（坏 id 空态仍存在）", () => {
    for (const html of [render(), render({ nodeId: "ghost" })]) {
      expect(html).not.toContain('aria-current="page"');
      expect(html).not.toContain("active:cursor-grabbing bg-accent");
    }
    expect(render({ nodeId: "ghost" })).toContain("该节点不存在或已被删除");
  });
});

// 删除后 URL 收敛判定（纯函数——点击路径无 jsdom，判据本身可直测）：
// 删的是 URL 节点自身或其祖先 ⇒ 删除成功后 `location.replace("#/outline")`；坏 id 不收敛（保留引导）。
describe("删除当前 / 祖先节点 → URL 收敛判定", () => {
  const nodes = OUTLINE.children;

  it("删除 URL 节点自身或其祖先 → true", () => {
    expect(deleteInvalidatesSelection(nodes, "ch-1", "ch-1")).toBe(true);
    expect(deleteInvalidatesSelection(nodes, "vol-1", "sc-1")).toBe(true);
    expect(deleteInvalidatesSelection(nodes, "ch-1", "sc-1")).toBe(true);
  });

  it("删除其他分支 / 坏 id → false（不把坏 id 引导收敛成无选中）", () => {
    expect(deleteInvalidatesSelection(nodes, "ch-2", "ch-1")).toBe(false);
    expect(deleteInvalidatesSelection(nodes, "vol-2", "ch-1")).toBe(false);
    expect(deleteInvalidatesSelection(nodes, "ghost", "ghost")).toBe(false);
  });
});

// 写作入口迁到一级页（writing-4 收口）：大纲页只有树视图，页头不再有视图切换
// （旧双视图与视图持久化 key 已删）——此处只钉「切换文案不出现 + 右端组按钮在」。
describe("大纲页：rail header 图标组", () => {
  it("无视图切换按钮；右端组 =「全部折叠」+「新建卷」（icon-button + title / aria-label）", () => {
    const html = render();
    expect(html).not.toContain("章视图");
    expect(html).toContain('aria-label="全部折叠"');
    expect(html).toContain('aria-label="新建卷"');
    // header = PanelHeader（标题行 40 + 预留元信息行 24 + 分割线），不放收起钮（收起入口在详情列页头）
    expect(html).toContain("flex h-10 min-w-0 items-center gap-2");
    expect(html).toContain('aria-label="大纲树"');
    expect(html).not.toContain('aria-label="收起大纲树"></button>');
  });
});

describe("大纲页 · 桌面分栏壳", () => {
  it("全高分栏外壳（抵消中栏 p-6）+ rail 默认宽度与右边线 + 详情列吸收剩余宽度", () => {
    const html = render();
    expect(html).toContain("-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden");
    expect(html).toContain("flex min-h-0 min-w-0 flex-1 flex-col p-6");
    expect(html).toContain("pt-0"); // 桌面端详情列顶内边距归零（页头 `-mx-6` 穿透、分割线全幅）
    // 默认宽度 = max(320px, 中栏 1/3)：未拖拽过时由 CSS 算，不写死像素
    expect(html).toContain("width:max(320px, calc(100% / 3))");
    // 分栏线归 rail 自己的 border-r（手柄不画线，DESIGN.md §Layout「分栏边线单所有权」）
    expect(html).toContain("border-r border-border");
    expect(html).toContain('aria-label="调整大纲树宽度"');
    expect(html).toContain('role="separator"');
    // rail header 与树在左列
    expect(html).toContain(">大纲<");
    expect(html).toContain("第1卷");
  });

  it("rail 行保留结构编辑能力（拖拽 / 折叠箭头 / 行内新建子级 / 行尾删除）", () => {
    // 分栏改造只搬外层：树的编辑能力必须随树一起进左列，不能退化成只读列表
    const row = rowHtml(render(), "vol-1");
    expect(row).toContain('draggable="true"');
    expect(row).toContain('aria-label="折叠"');
    expect(row).toContain('aria-label="在《第一卷》下新建章"');
    expect(row).toContain('aria-label="移入回收站"');
  });

  it("无 id（#/outline）：详情列页头「详情」+ 引导文案 + 页头最左的收起按钮", () => {
    const html = render();
    expect(html).toContain(">详情<");
    expect(html).toContain("从左侧选择一个卷、章或场查看详情");
    expect(html).toContain('aria-label="收起大纲树"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('aria-label="展开大纲树"');
    // 位置 = 详情页头标题行最左（在「详情」标题之前）
    expect(html.indexOf('aria-label="收起大纲树"')).toBeLessThan(html.indexOf(">详情<"));
  });

  it("有 id（#/outline/:id）：同一壳里渲染节点详情（标题 / 保存 / 写正文），rail 照旧", () => {
    const html = render({ nodeId: "ch-1" });
    expect(html).toContain('aria-label="大纲树"');
    expect(html).toContain(">雪夜出走<");
    expect(html).toContain('href="#/writing/ch-1"');
    expect(html).toContain("ant-btn-primary"); // 保存 = 唯一主操作（图标按钮）
    expect(html).not.toContain("从左侧选择一个卷、章或场查看详情");
    // 详情页头也带收起按钮（四种详情形态同款）
    expect(html).toContain('aria-label="收起大纲树"');
  });

  it("无项目 / 加载中 / 加载失败 / 空树 / 坏 id：详情列都有页头与引导（不先挂表单）", () => {
    expect(render({ config: null })).toContain("未打开项目，无法查看大纲详情");
    expect(render({ outline: null, outlineLoading: true })).toContain("animate-pulse");
    const failed = render({ outline: null, outlineError: "CLIENT_NETWORK_ERROR" });
    expect(failed).toContain("大纲加载失败，详情暂不可用");
    expect(render({ outline: EMPTY_OUTLINE })).toContain("还没有大纲，先在左侧新建第一卷");
    const missing = render({ nodeId: "ghost" });
    expect(missing).toContain("该节点不存在或已被删除");
    expect(missing).toContain('href="#/outline"');
    // 坏 id 空态两个出口（DESIGN.md `outline-page`）：去回收站 / 返回大纲
    expect(missing).toContain('href="#/trash"');
    expect(missing).toContain("去回收站");
    // 390px 窄屏：容器换行 + 两个出口不竖排（DESIGN.md `outline-page` 坏 id 空态）
    expect(missing).toContain("flex flex-wrap justify-center");
    expect(missing).toContain("whitespace-nowrap");
    // 每种形态都保留页头与收起钮
    for (const html of [
      render({ config: null }),
      render({ outline: EMPTY_OUTLINE }),
      render({ nodeId: "ghost" }),
    ]) {
      expect(html).toContain(">详情<");
      expect(html).toContain('aria-label="收起大纲树"');
    }
  });
});

describe("大纲页 · 窄屏两级互斥（<1024px）", () => {
  it("无 id：只渲染 rail 全宽（无右边线 / 手柄 / 收起钮 / 详情列）", () => {
    const html = render({ desktop: false });
    expect(html).toContain("w-full");
    expect(html).toContain("border-r-0");
    expect(html).not.toContain("border-r border-border");
    expect(html).not.toContain("width:max(320px");
    expect(html).toContain(">大纲<");
    expect(html).not.toContain(">详情<");
    expect(html).not.toContain('aria-label="调整大纲树宽度"');
    expect(html).not.toContain('aria-label="收起大纲树"');
    expect(html).not.toContain('aria-label="展开大纲树"');
  });

  it("有 id：详情全宽 + 顶部「大纲树」返回条（无 rail）", () => {
    const html = render({ desktop: false, nodeId: "ch-1" });
    expect(html).not.toContain('aria-label="大纲树"');
    expect(html).not.toContain('aria-label="调整大纲树宽度"');
    expect(html).toContain('href="#/outline"');
    expect(html).toContain(">大纲树<");
    expect(html).toContain(">雪夜出走<");
  });
});

describe("大纲页 · 壳自身加载树（rail 不渲染的路径）", () => {
  // 阻塞回归：壳只读 store 的 outline 时，这两条路径没有 rail / 详情 loader ⇒ 树永远不加载。
  // 表达式：渲染时 `useOutlineLoader` 的调用次数——rail 不在场，唯一可能调用者就是壳。
  it("桌面收起 + 深链：rail 不渲染，壳自己挂 loader（树未就绪时不会永远停骨架）", () => {
    stubRailStorage({ width: 333, collapsed: true });
    const html = render({ nodeId: "ch-1", outline: null, outlineLoading: true });
    expect(html).not.toContain('aria-label="大纲树"');
    expect(loader.calls).toEqual([{ withMetadata: true }]);
  });

  it("窄屏深链：rail 不渲染，壳自己挂 loader", () => {
    const html = render({ desktop: false, nodeId: "ch-1", outline: null, outlineLoading: true });
    expect(html).not.toContain('aria-label="大纲树"');
    expect(loader.calls).toEqual([{ withMetadata: true }]);
  });

  it("rail + 详情都渲染时 loader 仍只有壳一份（详情不自拉、不重拉整树）", () => {
    render({ nodeId: "ch-1" });
    expect(loader.calls).toEqual([{ withMetadata: true }]);
  });
});

describe("大纲页 · rail 宽度与收起（持久化）", () => {
  it("持久化像素宽度生效（越界收敛到 [280, 600]）", () => {
    stubRailStorage({ width: 333, collapsed: false });
    const html = render();
    expect(html).toContain("width:333px");
    expect(html).not.toContain("max(320px");

    stubRailStorage({ width: 9999, collapsed: false });
    expect(render()).toContain("width:600px");

    stubRailStorage({ width: 120, collapsed: false });
    expect(render()).toContain("width:280px");
  });

  it("桌面收起态：rail 完全不渲染（无 header / 窄条 / 手柄），页头按钮转「展开」，详情列吸收宽度", () => {
    stubRailStorage({ width: 333, collapsed: true });
    const html = render({ nodeId: "ch-1" });
    expect(html).toContain('aria-label="展开大纲树"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-label="大纲树"');
    expect(html).not.toContain('aria-label="调整大纲树宽度"');
    expect(html).not.toContain("width:333px");
    // 详情列照常渲染（宽度保留在存储里，展开恢复原宽）
    expect(html).toContain(">雪夜出走<");
  });

  it("桌面收起态：空态文案改指页头左侧的展开钮（不留「从左侧选择」）", () => {
    stubRailStorage({ width: 333, collapsed: true });
    const collapsed = render();
    expect(collapsed).toContain("从页头左侧展开大纲树");
    expect(collapsed).not.toContain("从左侧选择一个卷、章或场查看详情");

    stubRailStorage({ width: 333, collapsed: false });
    const expanded = render();
    expect(expanded).toContain("从左侧选择一个卷、章或场查看详情");
    expect(expanded).not.toContain("从页头左侧展开大纲树");
  });

  it("窄屏无收起：存储的 collapsed 不生效，rail 仍全宽", () => {    stubRailStorage({ width: 333, collapsed: true });
    const html = render({ desktop: false });
    expect(html).toContain("w-full");
    expect(html).toContain(">大纲<");
    expect(html).not.toContain('aria-label="展开大纲树"');
  });
});

// 右侧详情收起（DESIGN.md `outline-page`「宽度与收起」）：详情钮只在桌面且 rail 未收起时传给 rail。
// SSR 不派发点击事件：收起态 / 展开态由 localStorage 预置走查（同 setting / writing 惯例），
// dirty 守卫（`toggleDetailWithGuard`）走浏览器核对。
describe("大纲页 · 右侧详情收起", () => {
  it("展开态：rail header 右端组最右端 = 「收起右侧详情」（右箭头 + aria-expanded），详情列照常", () => {
    stubRailStorage({ width: 333, collapsed: false, detailCollapsed: false });
    const html = render({ nodeId: "ch-1" });
    expect(html).toContain('aria-label="收起右侧详情"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('aria-label="展开右侧详情"');
    // 图标 = 静态面板图形（右侧详情栏 ⇒ 竖线靠右）
    expect(html).toContain('d="M15 4 V20"');
    // 位置 = [全部折叠][+ 新建卷] 之后、详情列页头之前
    expect(html.indexOf('aria-label="收起右侧详情"')).toBeGreaterThan(
      html.indexOf('aria-label="新建卷"'),
    );
    expect(html.indexOf('aria-label="收起右侧详情"')).toBeLessThan(
      html.indexOf("flex min-h-0 min-w-0 flex-1 flex-col p-6"),
    );
    // 正常两栏：rail 像素宽 + 手柄 + 详情列
    expect(html).toContain("width:333px");
    expect(html).toContain("border-r border-border");
    expect(html).toContain('aria-label="调整大纲树宽度"');
    expect(html).toContain(">雪夜出走<");
  });

  it("收起态：详情列整列不渲染、rail 全宽（无内联宽 / 无右边线 / 无手柄）、不改存宽度", () => {
    stubRailStorage({ width: 333, collapsed: false, detailCollapsed: true });
    const html = render({ nodeId: "ch-1" });
    // 按钮：静态面板图形（不随收起态换向）+ 「展开右侧详情」
    expect(html).toContain('aria-label="展开右侧详情"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('d="M15 4 V20"');
    expect(html).not.toContain('aria-label="收起右侧详情"');
    // rail 吸收全宽：不传 width（无内联宽）+ `w-full border-r-0`
    expect(html).not.toContain("width:333px");
    expect(html).toContain("w-full border-r-0");
    expect(html).not.toContain("border-r border-border");
    expect(html).not.toContain('aria-label="调整大纲树宽度"');
    // 详情列（含页头 / 选中节点详情）整列卸载；rail 与选中行保留（URL 选中不变）
    expect(html).not.toContain("min-w-0 flex-1 flex-col p-6");
    expect(html).not.toContain('href="#/writing/ch-1"');
    expect(html).not.toContain('aria-label="保存"');
    expect(html).toContain('aria-current="page"');
  });

  it("无 id 空态：详情列不渲染，rail 保留且可展开详情", () => {
    stubRailStorage({ width: 333, collapsed: false, detailCollapsed: true });
    const html = render();
    expect(html).not.toContain(">详情<");
    expect(html).not.toContain("从左侧选择一个卷、章或场查看详情");
    expect(html).toContain(">大纲<");
    expect(html).toContain('aria-label="展开右侧详情"');
  });

  it("空树：收起后不渲染「还没有大纲」空态（详情列随列卸载）", () => {
    stubRailStorage({ width: 333, collapsed: false, detailCollapsed: true });
    const html = render({ outline: EMPTY_OUTLINE });
    expect(html).not.toContain("还没有大纲");
    expect(html).toContain('aria-label="大纲树"');
    expect(html).toContain('aria-label="展开右侧详情"');
  });

  it("rail 自身收起时详情列保留（两栏不会同时收起）：无详情钮", () => {
    stubRailStorage({ width: 333, collapsed: true, detailCollapsed: true });
    const html = render({ nodeId: "ch-1" });
    expect(html).toContain('aria-label="展开大纲树"');
    expect(html).not.toContain('aria-label="展开右侧详情"');
    expect(html).not.toContain('aria-label="收起右侧详情"');
    expect(html).toContain("min-w-0 flex-1 flex-col p-6");
  });

  it("窄屏：不渲染右侧详情钮，存储的 detailCollapsed 不生效", () => {
    stubRailStorage({ width: 333, collapsed: false, detailCollapsed: true });
    const html = render({ desktop: false, nodeId: "ch-1" });
    expect(html).not.toContain('aria-label="展开右侧详情"');
    expect(html).not.toContain('aria-label="收起右侧详情"');
    expect(html).toContain("min-w-0 flex-1 flex-col p-6");
    expect(html).toContain(">雪夜出走<");
  });
});

// 写正文入口迁移（writing-1）：详情页是章正文的另一个入口，写作页为一级页后目标改指 `#/writing/:id`。
// 写法 = `Button href`（antd 渲染成 `<a>`）⇒ SSR 可直接断言目标；卷节点仍不给入口（正文只挂章）。
describe("大纲节点详情页：写正文入口指向写作页", () => {
  function renderDetailFor(
    nodeId: string,
    onNavigate?: (path: string) => void | Promise<void>,
  ): string {
    const node = findNode(OUTLINE.children, nodeId);
    if (node === null) throw new Error(`测试数据里没有节点 ${nodeId}`);
    Object.assign(useProjectStore.getInitialState(), {
      config: CONFIG,
      outline: OUTLINE,
      configLoading: false,
      outlineLoading: false,
      outlineWithMetadata: true,
    });
    return renderToString(
      <OutlineDetail
        node={node}
        nodeId={nodeId}
        onReload={async () => {}}
        onNavigate={onNavigate}
      />,
    ).replace(/<!--[^>]*-->/g, "");
  }

  it("章节点：「写正文」= 导航链接，目标 #/writing/:id（不再指旧 #/manuscript/:id）", () => {
    const html = renderDetailFor("ch-1");
    expect(html).toContain("写正文");
    expect(html).toContain('href="#/writing/ch-1"');
    expect(html).toContain("anticon-edit");
    expect(html).not.toContain("#/manuscript/");
  });

  // 壳注入 onNavigate 时守卫挂在 onClick 上（SSR 不输出事件处理器）；这里只钉住「href 不被移除」——
  // 无回调的独立渲染（含无 JS 的首帧）仍要靠它导航。确认 / 取消 / 干净三条交互由 ui-verifier 真浏览器验证。
  it("带 onNavigate 时仍渲染 href（链接语义与无回调 fallback 都在）", () => {
    const html = renderDetailFor("ch-1", async () => {});
    expect(html).toContain('href="#/writing/ch-1"');
    expect(html).toContain("写正文");
  });

  it("元信息行单行：类型徽标 + `更新于 MM-DD`（完整时间进 title）+ 字数 / 状态徽标", () => {
    const html = renderDetailFor("ch-1");
    expect(html).toContain("overflow-hidden text-xs text-muted-foreground");
    expect(html).toContain("更新于 01-05<");
    expect(html).toContain('title="2026-01-05 08:05"');
    expect(html).toContain("章"); // 类型徽标
  });

  it("卷节点：不渲染「写正文」（正文只挂章，不留必定 400 的入口）", () => {
    expect(renderDetailFor("vol-1")).not.toContain("写正文");
  });

  it("页头动作压缩为 icon-button：写正文 / 阅读进度 / 推演标记带 title 与 aria-label", () => {
    const html = renderDetailFor("ch-1");
    expect(html).toContain('aria-label="写正文"');
    expect(html).toContain('aria-label="设为阅读进度"');
    expect(html).toContain('aria-label="标记为推演节点"');
    expect(html).toContain("anticon-aim");
    expect(html).toContain("anticon-branches");
    // 保存 = 主操作图标按钮（`title` / `aria-label` 给文字语义，不再渲染文字）
    expect(html).toContain("anticon-save");
    expect(html).toContain('aria-label="保存"');
    expect(html).not.toContain("保 存");
  });
});

// dirty 纯函数（壳的未保存守卫与详情表单同源）：标题 / 摘要 / data 任一未提交变化 → true。
describe("大纲详情表单 dirty 判定", () => {
  const node = OUTLINE.children[0].children![0]; // ch-1：title「雪夜出走」、无 summary / data

  it("无变化 → false", () => {
    expect(isOutlineDetailDirty(node, node.title, "", {})).toBe(false);
  });

  it("标题变化 → true", () => {
    expect(isOutlineDetailDirty(node, "新标题", "", {})).toBe(true);
  });

  // 清空标题不是可提交变化（保存被标题非空校验拦下），dirty 也不成立
  it("清空标题 → false", () => {
    expect(isOutlineDetailDirty(node, "", "", {})).toBe(false);
  });

  it("摘要纯空白 → false", () => {
    expect(isOutlineDetailDirty(node, node.title, "   ", {})).toBe(false);
  });

  it("摘要变化 → true", () => {
    expect(isOutlineDetailDirty(node, node.title, "新摘要", {})).toBe(true);
  });

  it("data 变化 → true", () => {
    expect(isOutlineDetailDirty(node, node.title, "", { reversal: "新反转" })).toBe(true);
  });

  // 基准 = 上次同步 / 保存的基线，不是当前 node：rail 改名后 node 先变，旧表单不能算 dirty
  it("比较基准是基线而非当前 node", () => {
    const base = { ...node, title: "旧标题" };
    expect(isOutlineDetailDirty(base, "旧标题", "", {})).toBe(false);
    expect(isOutlineDetailDirty(base, node.title, "", {})).toBe(true);
  });
});
