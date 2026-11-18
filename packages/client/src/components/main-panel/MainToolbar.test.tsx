// MainToolbar 是**纯工具栏**（DESIGN.md §Components `main-toolbar`）：只承载全局操作、不承载项目信息——
// 品牌标记 / 项目名 / 阅读进度 / 语言与 `#/overview` / `#/outline` 链接一律不在（项目名见左栏书名按钮，
// 阅读进度与语言见概览页 / 大纲页）。因此它**不读项目配置、不按工作区类型（`kind`）分叉**：
// 本文件不预置 zustand store（`novel` / `practice` 的渲染差别本就不存在，无需两条用例去比对）。
// 整栏开关已迁到视口顶带两角（`ShellPanelToggles`，见 shell-panel-toggles.test）：本工具栏桌面只剩刷新，
// 左 / 右栏收起时只让出 48px 槽位（`pl-12` / `pr-12`）；窄屏 = 刷新 + 聊天开关，永不渲染面板图形。
// 渲染手法同 chat-panel.test / cloud-backup-panel.test（仓内无 jsdom/@testing-library 纪律，用 react-dom/server）；
// `isDesktop` 由调用方传入（不再是组件内部媒体查询），测试无需 stub `matchMedia`。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MainToolbar } from "./MainToolbar";

function render({
  isDesktop = true,
  chatOpen = false,
  sidebarCollapsed = false,
  chatCollapsed = false,
}: {
  isDesktop?: boolean;
  chatOpen?: boolean;
  sidebarCollapsed?: boolean;
  chatCollapsed?: boolean;
} = {}): string {
  return renderToString(
    <MainToolbar
      chatOpen={chatOpen}
      onToggleChat={() => {}}
      isDesktop={isDesktop}
      sidebarCollapsed={sidebarCollapsed}
      chatCollapsed={chatCollapsed}
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

  it("只剩一枚按钮 = 刷新（整栏开关已迁到视口顶带两角）", () => {
    const out = html();
    expect(out.match(/<button/g)).toHaveLength(1);
    expect(out).toContain('aria-label="刷新数据"');
    expect(out).toContain('title="刷新数据"');
  });

  it("无任何面板图形与 `aria-expanded`（整栏开关不在这里）", () => {
    const out = html();
    expect(out).not.toContain('viewBox="0 0 24 24"');
    expect(out).not.toContain("<rect");
    expect(out).not.toContain("aria-expanded");
    expect(out).not.toContain("收起左栏");
    expect(out).not.toContain("展开左栏");
    expect(out).not.toContain("收起右栏");
    expect(out).not.toContain("展开右栏");
  });

  it("桌面态不渲染小屏聊天开关（右栏是静态列，不是抽屉）", () => {
    const out = render();
    expect(out).not.toContain("打开聊天面板");
    expect(out).not.toContain("关闭聊天面板");
  });

  it("展开态：内距 `pl-4` / `pr-4`（`px-*` 不并存，避免同属性覆盖顺序问题）", () => {
    const out = html();
    expect(out).toContain("pl-4");
    expect(out).toContain("pr-4");
    expect(out).not.toContain("pl-12");
    expect(out).not.toContain("pr-12");
    expect(out).not.toContain("px-4");
  });

  it("收起态：左栏收起 → `pl-12`，右栏收起 → `pr-12`（各让出顶带开关的 48px 槽位）", () => {
    const left = render({ sidebarCollapsed: true });
    expect(left).toContain("pl-12");
    expect(left).not.toContain("pl-4");
    expect(left).toContain("pr-4");

    const right = render({ chatCollapsed: true });
    expect(right).toContain("pr-12");
    expect(right).not.toContain("pr-4");
    expect(right).toContain("pl-4");

    const both = render({ sidebarCollapsed: true, chatCollapsed: true });
    expect(both).toContain("pl-12");
    expect(both).toContain("pr-12");
  });
});

describe("MainToolbar · 窄屏（isDesktop = false）", () => {
  const html = () => render({ isDesktop: false });

  it("两枚按钮：刷新 + 聊天开关（右栏仍是抽屉，无整栏 toggle）", () => {
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

  it("窄屏没有顶带开关：收起标记即使为真也不让槽位（恒 `pl-4` / `pr-4`）", () => {
    const out = render({ isDesktop: false, sidebarCollapsed: true, chatCollapsed: true });
    expect(out).toContain("pl-4");
    expect(out).toContain("pr-4");
    expect(out).not.toContain("pl-12");
    expect(out).not.toContain("pr-12");
  });

  it("聊天开关的开关注入照旧（开 = 关聊天面板）", () => {
    expect(html()).toContain('aria-label="打开聊天面板"');
    expect(render({ isDesktop: false, chatOpen: true })).toContain('aria-label="关闭聊天面板"');
  });
});
