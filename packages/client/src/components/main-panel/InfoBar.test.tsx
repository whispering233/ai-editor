// InfoBar 按工作区类型（`kind`）渲染（卡 8）：
//   小说工作区 = 项目名链接 `#/overview` + 阅读进度链接 `#/outline`（与改动前逐字一致）；
//   练习工作区 = 项目名**纯文本（无 href）** + **不渲染阅读进度**——`#/overview` / `#/outline` 都被路由守卫
//   挡回 `#/practice`，留着就是「点了没反应」的死链；品牌标记、语言、小屏聊天开关两种 kind 都保留。
// 整栏 toggle（2026-11）：桌面态左端 = 左栏（项目名之前）/ 右端 = 右栏（语言之后）；窄屏不渲染这两枚；
// 图标静态、状态只由 `aria-label` / `title` / `aria-expanded` 表达，不加选中面（DESIGN.md `info-bar`）。
// 渲染手法同 chat-panel.test / character-detail.test（仓内无 jsdom/@testing-library 纪律，用 react-dom/server）。
// SSR 预置 store：zustand 的服务端快照取 getInitialState()（setState 对 renderToString 无效），故用
// Object.assign 改初值；`isDesktop` 由调用方传入（不再是组件内部媒体查询），测试无需 stub `matchMedia`。
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectConfig, WorkspaceKind } from "@whispering233/ai-editor-shared";
import { InfoBar, type PanelToggles } from "./InfoBar";
import { useProjectStore } from "../../stores/project";

function makeConfig(kind: WorkspaceKind): ProjectConfig {
  return {
    id: `${kind}-1`,
    name: kind === "practice" ? "仿写练习区" : "青云记",
    language: "zh",
    kind,
    authorId: kind === "practice" ? "jiangnan" : null, // 仅练习工作区有值
    schemaVersion: 1,
    currentPosition: kind === "practice" ? null : "ch-1",
    deductionNodes: [],
    backupFrequencyMinutes: 10,
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T10:00:00Z",
  };
}

/** 整栏 toggle 的注入值：默认两栏都展开（`onToggle*` 在 SSR 下不可点击，只验证渲染面） */
function makePanelToggles(overrides: Partial<PanelToggles> = {}): PanelToggles {
  return {
    sidebarCollapsed: false,
    chatCollapsed: false,
    onToggleSidebar: () => {},
    onToggleChat: () => {},
    ...overrides,
  };
}

/** SSR 预置：只改本文件内每个用例自己用到的键（config）；其余键保持 store 初值 */
function render(
  kind: WorkspaceKind,
  { isDesktop = true, panelToggles = makePanelToggles() }: {
    isDesktop?: boolean;
    panelToggles?: PanelToggles;
  } = {},
): string {
  Object.assign(useProjectStore.getInitialState(), { config: makeConfig(kind) });
  return renderToString(
    <InfoBar
      chatOpen={false}
      onToggleChat={() => {}}
      isDesktop={isDesktop}
      panelToggles={panelToggles}
    />,
  );
}

afterEach(() => {
  Object.assign(useProjectStore.getInitialState(), { config: null });
});

describe("InfoBar · 小说工作区（kind = novel）", () => {
  const html = () => render("novel");

  it("项目名是 `#/overview` 链接（书名与品牌标记都在里面）", () => {
    const out = html();
    expect(out).toContain('href="#/overview"');
    expect(out).toContain("青云记");
    expect(out).toContain("<svg"); // app-mark 品牌标记
  });

  it("渲染阅读进度（`#/outline` 链接 + 标题）", () => {
    const out = html();
    expect(out).toContain('href="#/outline"');
    expect(out).toContain("阅读进度:");
    // currentPosition = ch-1：outline 未加载 → 标题回落 id 占位（不是「未设置」）
    expect(out).toContain("ch-1");
    expect(out).not.toContain("未设置");
  });

  it("语言与小屏聊天开关的开关注入照旧（聊天开关由 useMediaQuery 决定，SSR 桩 = 桌面态不渲染）", () => {
    expect(html()).toContain("语言:");
  });
});

describe("InfoBar · 整栏收起/展开（桌面态）", () => {
  it("左端渲染左栏 toggle（面板图形，竖线靠左）且位于项目名之前", () => {
    const out = render("novel");
    expect(out).toContain('aria-label="收起左栏"');
    expect(out).toContain('title="收起左栏"');
    expect(out).toContain('d="M9 4 V20"'); // 竖线靠左 = 左栏
    expect(out.indexOf('aria-label="收起左栏"')).toBeLessThan(out.indexOf("青云记"));
  });

  it("右端渲染右栏 toggle（面板图形，竖线靠右）且位于语言之后", () => {
    const out = render("novel");
    expect(out).toContain('aria-label="收起右栏"');
    expect(out).toContain('title="收起右栏"');
    expect(out).toContain('d="M15 4 V20"'); // 竖线靠右 = 右栏（镜像）
    expect(out.indexOf("语言:")).toBeLessThan(out.indexOf('aria-label="收起右栏"'));
  });

  it("两枚 toggle 都带 `aria-expanded`（展开态 = true；图标静态，状态只走 aria/title）", () => {
    const out = render("novel");
    expect(out.match(/aria-expanded="true"/g)).toHaveLength(2);
    expect(out).not.toContain('aria-expanded="false"');
  });

  it("两枚 toggle 用同一枚自绘面板图形（24 viewBox，不是 antd 图标）", () => {
    const out = render("novel");
    expect(out.match(/viewBox="0 0 24 24"/g)).toHaveLength(2);
    expect(out.match(/<rect /g)).toHaveLength(2);
  });

  it("收起态：文案与 `aria-expanded` 翻转（图标不换向）", () => {
    const out = render("novel", {
      panelToggles: makePanelToggles({ sidebarCollapsed: true, chatCollapsed: true }),
    });
    expect(out).toContain('aria-label="展开左栏"');
    expect(out).toContain('title="展开左栏"');
    expect(out).toContain('aria-label="展开右栏"');
    expect(out).toContain('title="展开右栏"');
    expect(out).not.toContain('aria-label="收起左栏"');
    expect(out).not.toContain('aria-label="收起右栏"');
    expect(out.match(/aria-expanded="false"/g)).toHaveLength(2);
  });

  it("桌面态不渲染小屏聊天开关（右栏是静态列，不是抽屉）", () => {
    const out = render("novel");
    expect(out).not.toContain("打开聊天面板");
    expect(out).not.toContain("关闭聊天面板");
  });
});

describe("InfoBar · 窄屏（isDesktop = false）", () => {
  const html = () => render("novel", { isDesktop: false });

  it("不渲染两枚整栏 toggle（右栏仍是抽屉，开关是 MessageOutlined）", () => {
    const out = html();
    expect(out).not.toContain("收起左栏");
    expect(out).not.toContain("展开左栏");
    expect(out).not.toContain("收起右栏");
    expect(out).not.toContain("展开右栏");
    expect(out).not.toContain("aria-expanded");
  });

  it("仍渲染小屏聊天开关（开 = 打开聊天面板）", () => {
    expect(html()).toContain('aria-label="打开聊天面板"');
  });

  it("面板图形（24 viewBox 的圆角矩形 + 竖线）一枚都不在", () => {
    const out = html();
    expect(out).not.toContain('viewBox="0 0 24 24"');
    expect(out).not.toContain("<rect");
  });
});

describe("InfoBar · 练习工作区（kind = practice）", () => {
  const html = () => render("practice");

  it("整条信息条无任何链接：项目名是纯文本（点它无 href 可跳 ⇒ 无 hash 变化、无小说端点请求）", () => {
    const out = html();
    expect(out).not.toContain("<a");
    expect(out).not.toContain('href="#/overview"');
    expect(out).not.toContain('href="#/outline"');
  });

  it("项目名仍是「标记 + 书名」纯文本壳（内容不因去链接而丢失）", () => {
    const out = html();
    expect(out).toContain("仿写练习区");
    expect(out).toContain("<svg"); // app-mark 品牌标记
    expect(out).toContain(
      'class="flex min-w-0 items-center gap-1.5 text-base font-medium text-foreground"',
    );
  });

  it("不渲染阅读进度（练习工作区没有 `current_position`，那一行是纯死链）", () => {
    const out = html();
    expect(out).not.toContain("阅读进度");
    expect(out).not.toContain("未设置");
  });

  it("语言保留（与 kind 无关的展示项）", () => {
    expect(html()).toContain("语言:");
  });

  it("两枚整栏 toggle 照旧渲染（与 kind 无关）", () => {
    const out = html();
    expect(out).toContain('aria-label="收起左栏"');
    expect(out).toContain('aria-label="收起右栏"');
  });
});
