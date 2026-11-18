// 设定页（`#/setting` / `#/setting/:id`）SSR 走查：仓内无 jsdom，用 react-dom/server 直渲染页面
// （同 pages/outline.test.tsx 惯例）。契约 = docs/ui/DESIGN.md `setting-page` + §Layout「分栏边线单所有权」。
//
// 覆盖：master-detail 分栏（rail + 详情列）/ rail header 图标组与按钮顺序 / 无选中空态 / 深链只渲详情 /
// 详情紧凑页头（compact：图标操作）/ 窄屏两级互斥（`#/setting` 树全宽、`#/setting/:id` 详情 + 「设定树」返回条）/
// 右侧详情收起（卡 4）。
// 只跑首帧（SSR 不执行 effect）：rail 的树数据 / 详情表单一律停在骨架，不断言网络结果。
// `useMediaQuery` 的 useState 初始化器读 `window.matchMedia`，SSR 下直接跑会崩 ⇒ 用 `vi.hoisted`
// 变量 mock（浏览器行为不变；测试只切 desktop / narrow 两态）。
// `window` 也要 stub：`useSettingDescVisible` / `useSettingRail` 的 useState 初始化器读 localStorage。
// `useSettingRail` 用 `vi.hoisted` 可变标志 mock（`detailCollapsed` 两态走查；真实常量 re-export 保留）：
// SSR 下 hook 只读 localStorage、无法切收起态，壳的「右侧详情收起」分支只能靠 mock 进。
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingWorkbench from "./SettingWorkbench";
import EntityDetail from "./EntityDetail";

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock("../hooks/use-media-query", () => ({
  useMediaQuery: () => media.desktop,
}));

/** 设定树 rail 的 mock 状态（测试可改 `detailCollapsed` 再渲染） */
const railHook = vi.hoisted(() => ({ detailCollapsed: false }));
vi.mock("../hooks/use-setting-rail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/use-setting-rail")>();
  return {
    ...actual,
    useSettingRail: () => ({
      layout: { width: null, collapsed: false, detailCollapsed: railHook.detailCollapsed },
      resizing: false,
      railRef: null,
      startResize: () => {},
      moveResize: () => {},
      endResize: () => {},
      toggleCollapse: () => {},
      toggleDetail: () => {},
    }),
  };
});

/** 与路由一致：undefined = `#/setting`（无选中），有值 = `#/setting/:id` */
function render(id?: string): string {
  return renderToString(<SettingWorkbench id={id} />).replace(/<!--[^>]*-->/g, "");
}

beforeEach(() => {
  media.desktop = true;
  railHook.detailCollapsed = false;
  vi.stubGlobal("window", {
    localStorage: { getItem: () => null, setItem: () => {} },
  });
});

afterEach(() => {
  media.desktop = true;
  railHook.detailCollapsed = false;
  vi.unstubAllGlobals();
});

describe("设定页：桌面分栏", () => {
  it("`#/setting`：rail header 图标组在、详情列空态、不渲染详情内容", () => {
    const html = render();
    // rail：左列存在 + header 两枚图标按钮（全部折叠 / 新建）
    expect(html).toContain('aria-label="设定树"');
    expect(html).toContain('aria-label="全部折叠"');
    expect(html).toContain("anticon-node-collapse");
    expect(html).toContain('aria-label="新建设定"');
    // 右端组顺序 = [全部折叠/展开][+ 新建][收起右侧详情]（详情钮最右端，紧邻被收起的详情列）
    const collapseIdx = html.indexOf('aria-label="全部折叠"');
    const createIdx = html.indexOf('aria-label="新建设定"');
    const detailIdx = html.indexOf('aria-label="收起右侧详情"');
    expect(collapseIdx).toBeGreaterThan(-1);
    expect(collapseIdx).toBeLessThan(createIdx);
    expect(createIdx).toBeLessThan(detailIdx);
    // 详情列页头有「收起设定树」leading，窄屏返回条不渲染
    expect(html).toContain('aria-label="收起设定树"');
    expect(html).not.toContain('href="#/setting"');
    // 详情列空态 = PanelHeader（标题「详情」，-mx-6 穿透列内边距）
    expect(html).toContain(">详情<");
    expect(html).toContain("-mx-6");
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

describe("设定页：详情紧凑页头（compact）", () => {
  it("页头 = PanelHeader：保存 / 移入回收站均为图标按钮（aria-label + 图标）", () => {
    const html = render("s-1");
    expect(html).toContain('aria-label="保存"');
    expect(html).toContain("anticon-save");
    expect(html).toContain('aria-label="移入回收站"');
    expect(html).toContain("anticon-delete");
    // 文字按钮不进 panel header（窄列会折行）
    expect(html).not.toContain("保 存");
    expect(html).not.toContain(">移入回收站<");
    // 标题 16px / 600（PanelHeader 档，不是 PageHeader 的 20px）
    expect(html).toContain("truncate text-base font-semibold");
  });

  it("非 compact（地点等普通中栏页）保持 PageHeader 文字按钮", () => {
    const html = renderToString(<EntityDetail type="location" id="loc-1" />).replace(
      /<!--[^>]*-->/g,
      "",
    );
    expect(html).toContain("保 存"); // antd 给两字中文按钮插空格
    expect(html).toContain(">移入回收站<");
    expect(html).not.toContain('aria-label="保存"');
  });
});

describe("设定页：右侧详情收起（卡 4）", () => {
  it("桌面收起态：不渲染详情列（无「移入回收站」）、rail 全宽、「展开右侧详情」按钮在", () => {
    railHook.detailCollapsed = true;
    const html = render("s-1");
    // 详情列整列不渲染（不留空容器；rail 骨架自己也有 animate-pulse，故认容器的 p-6 外壳）——
    // 深链 id 只留在 URL 上（SSR 只读 hash，不断言导航）
    expect(html).not.toContain("移入回收站");
    expect(html).not.toContain("min-w-0 flex-1 flex-col p-6");
    // 详情收起 = rail 吸收全宽，不渲染拖拽手柄
    expect(html).not.toContain('aria-label="调整设定树宽度"');
    // rail 仍在并吸收全宽（不写存宽度）
    expect(html).toContain('aria-label="设定树"');
    expect(html).toContain("w-full border-r-0");
    // header 右端组最左 = 详情展开按钮（收起态 aria-expanded=false）
    expect(html).toContain('aria-label="展开右侧详情"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("收起右侧详情");
  });

  it("同一 URL 切回展开态：详情重新出现（URL 选中保留）", () => {
    railHook.detailCollapsed = false;
    const html = render("s-1");
    expect(html).toContain("移入回收站");
    expect(html).toContain('aria-label="收起右侧详情"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain("展开右侧详情");
  });

  it("窄屏：不渲染详情收起 / 展开按钮（忽略持久化的收起态）", () => {
    media.desktop = false;
    railHook.detailCollapsed = true;
    const html = render("s-1");
    expect(html).not.toContain("收起右侧详情");
    expect(html).not.toContain("展开右侧详情");
    // 窄屏两级互斥不受影响：详情全宽 + 返回条
    expect(html).toContain("移入回收站");
    expect(html).toContain('href="#/setting"');
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
