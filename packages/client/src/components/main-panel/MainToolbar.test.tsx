// MainToolbar 是**纯工具栏**（DESIGN.md §Components `main-toolbar`）：只承载全局操作、不承载项目信息——
// 品牌标记 / 项目名 / 阅读进度 / 语言与 `#/overview` / `#/outline` 链接一律不在（项目名见左栏书名按钮，
// 阅读进度与语言见概览页 / 大纲页）。因此它**不读项目配置、不按工作区类型（`kind`）分叉**：
// 本文件不预置 zustand store（`novel` / `practice` 的渲染差别本就不存在，无需两条用例去比对）。
// 桌面态按钮顺序 = 左栏 toggle → 刷新 → 右栏 toggle；窄屏 = 刷新 + 聊天开关，不渲染面板图形。
// 整栏 toggle：图标静态、状态只由 `aria-label` / `title` / `aria-expanded` 表达，不加选中面。
// 渲染手法同 chat-panel.test / cloud-backup-panel.test（仓内无 jsdom/@testing-library 纪律，用 react-dom/server）；
// `isDesktop` 由调用方传入（不再是组件内部媒体查询），测试无需 stub `matchMedia`。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MainToolbar, type PanelToggles } from "./MainToolbar";

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

function render({
  isDesktop = true,
  chatOpen = false,
  panelToggles = makePanelToggles(),
}: {
  isDesktop?: boolean;
  chatOpen?: boolean;
  panelToggles?: PanelToggles;
} = {}): string {
  return renderToString(
    <MainToolbar
      chatOpen={chatOpen}
      onToggleChat={() => {}}
      isDesktop={isDesktop}
      panelToggles={panelToggles}
    />,
  );
}

describe("MainToolbar · 不承载项目信息", () => {
  const html = () => render();

  it("无项目名 / 阅读进度 / 语言（信息已归左栏书名按钮、概览页与大纲页）", () => {
    const out = html();
    expect(out).not.toContain("阅读进度");
    expect(out).not.toContain("未设置");
    expect(out).not.toContain("语言:");
    expect(out).not.toContain("书架");
    expect(out).not.toContain("加载中");
  });

  it("无任何链接与品牌标记（`#/overview` / `#/outline` / AppMark 的 64 视图网格都不在）", () => {
    const out = html();
    expect(out).not.toContain("<a");
    expect(out).not.toContain("#/overview");
    expect(out).not.toContain("#/outline");
    expect(out).not.toContain('viewBox="0 0 64 64"'); // app-mark 品牌标记
  });
});

describe("MainToolbar · 桌面态（isDesktop = true）", () => {
  const html = () => render();

  it("三枚按钮：左栏 toggle → 刷新 → 右栏 toggle（刷新是右端组的起点）", () => {
    const out = html();
    expect(out.match(/<button/g)).toHaveLength(3);
    const left = out.indexOf('aria-label="收起左栏"');
    const refresh = out.indexOf('aria-label="刷新数据"');
    const right = out.indexOf('aria-label="收起右栏"');
    expect(left).toBeGreaterThanOrEqual(0);
    expect(refresh).toBeGreaterThan(left);
    expect(right).toBeGreaterThan(refresh);
  });

  it("刷新按钮由 `ml-auto` 起右对齐（左端只有左栏 toggle）", () => {
    const out = render();
    expect(out.match(/ml-auto/g)).toHaveLength(1);
    expect(out.indexOf("ml-auto")).toBeGreaterThan(out.indexOf('aria-label="收起左栏"'));
    expect(out.indexOf("ml-auto")).toBeLessThan(out.indexOf('aria-label="收起右栏"'));
  });

  it("左 toggle 竖线靠左、右 toggle 竖线靠右（同一枚自绘面板图形，24 viewBox）", () => {
    const out = render();
    expect(out).toContain('title="收起左栏"');
    expect(out).toContain('title="收起右栏"');
    expect(out).toContain('d="M9 4 V20"');
    expect(out).toContain('d="M15 4 V20"');
    expect(out.match(/viewBox="0 0 24 24"/g)).toHaveLength(2);
    expect(out.match(/<rect /g)).toHaveLength(2);
  });

  it("两枚 toggle 都带 `aria-expanded`（展开态 = true；图标静态，状态只走 aria/title）", () => {
    const out = render();
    expect(out.match(/aria-expanded="true"/g)).toHaveLength(2);
    expect(out).not.toContain('aria-expanded="false"');
  });

  it("收起态：文案与 `aria-expanded` 翻转（图标不换向）", () => {
    const out = render({
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
    const out = render();
    expect(out).not.toContain("打开聊天面板");
    expect(out).not.toContain("关闭聊天面板");
  });
});

describe("MainToolbar · 窄屏（isDesktop = false）", () => {
  const html = () => render({ isDesktop: false });

  it("两枚按钮：刷新 + 聊天开关（不渲染整栏 toggle，右栏仍是抽屉）", () => {
    const out = html();
    expect(out.match(/<button/g)).toHaveLength(2);
    expect(out).not.toContain("收起左栏");
    expect(out).not.toContain("展开左栏");
    expect(out).not.toContain("收起右栏");
    expect(out).not.toContain("展开右栏");
    expect(out).not.toContain("aria-expanded");
    expect(out).toContain('aria-label="刷新数据"');
    expect(out.indexOf('aria-label="刷新数据"')).toBeLessThan(
      out.indexOf('aria-label="打开聊天面板"'),
    );
  });

  it("面板图形（24 viewBox 的圆角矩形 + 竖线）一枚都不在", () => {
    const out = html();
    expect(out).not.toContain('viewBox="0 0 24 24"');
    expect(out).not.toContain("<rect");
  });

  it("聊天开关的开关注入照旧（开 = 关聊天面板）", () => {
    expect(html()).toContain('aria-label="打开聊天面板"');
    expect(render({ isDesktop: false, chatOpen: true })).toContain('aria-label="关闭聊天面板"');
  });
});
