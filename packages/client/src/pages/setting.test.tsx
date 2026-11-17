// 设定页（`#/setting` / `#/setting/:id`）SSR 走查：仓内无 jsdom，用 react-dom/server 直渲染页面
// （同 pages/outline.test.tsx 惯例）。契约 = docs/ui/DESIGN.md `setting-page` + §Layout「分栏边线单所有权」。
//
// 覆盖：master-detail 分栏（rail + 详情列）/ rail header 图标组 / 无选中空态 / 深链只渲详情 /
// 窄屏两级互斥（`#/setting` 树全宽、`#/setting/:id` 详情 + 「设定树」返回条）。
// 只跑首帧（SSR 不执行 effect）：rail 的树数据 / 详情表单一律停在骨架，不断言网络结果。
// `useMediaQuery` 的 useState 初始化器读 `window.matchMedia`，SSR 下直接跑会崩 ⇒ 用 `vi.hoisted`
// 变量 mock（浏览器行为不变；测试只切 desktop / narrow 两态）。
// `window` 也要 stub：`useSettingDescVisible` / `useSettingRail` 的 useState 初始化器读 localStorage。
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingWorkbench from "./SettingWorkbench";

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock("../hooks/use-media-query", () => ({
  useMediaQuery: () => media.desktop,
}));

/** 与路由一致：undefined = `#/setting`（无选中），有值 = `#/setting/:id` */
function render(id?: string): string {
  return renderToString(<SettingWorkbench id={id} />).replace(/<!--[^>]*-->/g, "");
}

beforeEach(() => {
  media.desktop = true;
  vi.stubGlobal("window", {
    localStorage: { getItem: () => null, setItem: () => {} },
  });
});

afterEach(() => {
  media.desktop = true;
  vi.unstubAllGlobals();
});

describe("设定页：桌面分栏", () => {
  it("`#/setting`：rail header 图标组在、详情列空态、不渲染详情内容", () => {
    const html = render();
    // rail：左列存在 + header 两枚图标按钮（全部折叠 / 新建）
    expect(html).toContain('aria-label="设定树"');
    expect(html).toContain('aria-label="全部折叠"');
    expect(html).toContain("anticon-menu-fold");
    expect(html).toContain('aria-label="新建设定"');
    // 桌面展开态：详情列页头有「收起设定树」leading，窄屏返回条不渲染
    expect(html).toContain('aria-label="收起设定树"');
    expect(html).not.toContain('href="#/setting"');
    // 详情列空态
    expect(html).toContain("从左侧选择一个设定查看详情");
    // 没有详情表单（EntityDetail 未挂载）
    expect(html).not.toContain("移入回收站");
    expect(html).not.toContain(">保存<");
  });

  it("`#/setting/:id`：右列挂详情（初态骨架），rail 不出现空态", () => {
    const html = render("s-1");
    expect(html).not.toContain("从左侧选择一个设定查看详情");
    // 详情初态：页头（标题占位「…」+ 保存 / 移入回收站）+ 骨架
    expect(html).toContain("animate-pulse");
    expect(html).toContain("移入回收站");
    // rail 仍在，且没有因选中变化重挂（header 图标组照常）
    expect(html).toContain('aria-label="设定树"');
    expect(html).toContain('aria-label="新建设定"');
    expect(html).toContain('aria-label="收起设定树"');
  });
});

describe("设定页：窄屏两级互斥", () => {
  it("`#/setting/:id`：无 rail，顶部「设定树」返回条 + 详情全宽", () => {
    media.desktop = false;
    const html = render("s-1");
    expect(html).not.toContain('aria-label="设定树"'); // rail 整栏不渲染
    expect(html).not.toContain('aria-label="新建设定"');
    expect(html).toContain('href="#/setting"');
    expect(html).toContain("设定树");
    expect(html).toContain("移入回收站");
    // 窄屏不渲染 rail 收起 / 展开入口
    expect(html).not.toContain("收起设定树");
  });

  it("`#/setting`：rail 全宽、无返回条、无详情列", () => {
    media.desktop = false;
    const html = render();
    expect(html).toContain('aria-label="设定树"');
    expect(html).toContain("w-full border-r-0");
    expect(html).not.toContain('href="#/setting"');
    expect(html).not.toContain("从左侧选择一个设定查看详情");
    expect(html).not.toContain("移入回收站");
  });
});
