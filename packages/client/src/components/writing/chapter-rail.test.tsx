// 写作页卷章导航栏 SSR 走查（2026-11）：仓内无 jsdom/@testing-library（既有纪律：不引新依赖），
// 用 react-dom/server renderToString 直渲染富数据（组件是纯展示的，无 api/store 依赖）。
// 契约 = docs/ui/DESIGN.md `writing-page`：卷行 N章 / 章行字数（0 不显示）/ 根级章顶层 /
// 0 章卷 / 选中 aria-current / 折叠箭头；以及否定契约（无结构编辑、无宽度手柄 / 收起按钮）。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import type {
  OutlineChapter,
  OutlineTree,
  OutlineVolume,
} from "@whispering233/ai-editor-shared";
import { buildWritingRailRows } from "../../lib/writing";
import { ChapterRail, type ChapterRailProps } from "./chapter-rail";

const chapter = (id: string, title: string, textLength?: number): OutlineChapter => ({
  id,
  type: "chapter",
  title,
  updatedAt: "t",
  ...(textLength === undefined ? {} : { metadata: { textLength } }),
});

const volume = (id: string, title: string, children: OutlineChapter[]): OutlineVolume => ({
  id,
  type: "volume",
  title,
  updatedAt: "t",
  children,
});

function tree(children: OutlineTree["children"]): OutlineTree {
  return { id: "root", type: "root", schemaVersion: 1, children };
}

/** 卷1（ch-1 有字数、ch-2 无字数）+ 存量根级章 ch-3 + 卷2（ch-4） */
const ROWS = buildWritingRailRows(
  tree([
    volume("vol-1", "第一卷", [
      chapter("ch-1", "雪夜出走", 1200),
      chapter("ch-2", "旧盟友", 0),
    ]),
    chapter("ch-3", "根级旧章"),
    volume("vol-2", "第二卷", [chapter("ch-4", "入城", 500)]),
  ]),
);

function render(overrides: Partial<ChapterRailProps> = {}): string {
  return renderToString(
    <ChapterRail
      rows={ROWS}
      selectedId={null}
      collapsed={new Set()}
      onToggleVolume={() => {}}
      {...overrides}
    />,
  ).replace(/<!--[^>]*-->/g, "");
}

/** 取某章行 <a> 开标签（属性顺序：data-chapter-id 在 href / aria-current 之前） */
function chapterTag(html: string, id: string): string {
  return (
    new RegExp(`<a[^>]*data-chapter-id="${id}"[^>]*>`).exec(html)?.[0] ?? ""
  );
}

describe("ChapterRail · 几何与行内容", () => {
  it("宽度由 width prop 决定（仅传入时内联）+ 不自带右边线 + header「卷章」；行区独立滚动", () => {
    const html = render({ width: 240 });
    expect(html).toContain("width:240px");
    // 分栏线由右侧手柄的 1px 中线承担（DESIGN.md `writing-page`「宽度与收起」）；rail 自带 border 会成双线
    expect(html).not.toContain("border-r border-border");
    expect(html).toContain(">卷章<");
    expect(html).toContain("h-10");
    expect(html).toContain("overflow-y-auto");
    // 不传 width：不写内联宽（窄屏全宽走 className，同属性后者胜）
    expect(render()).not.toContain("width:240px");
  });

  it("卷行：编号徽标 + 卷名 + N章（0 章也计数）", () => {
    const html = render();
    expect(html).toContain("第1卷");
    expect(html).toContain("第一卷");
    expect(html).toContain("2章");
    expect(html).toContain("第2卷");
    expect(html).toContain("1章");
  });

  it("章行：编号徽标 + 章名 + 字数（textLength > 0 才渲染）", () => {
    const html = render();
    expect(html).toContain("第1章");
    expect(html).toContain("雪夜出走");
    expect(html).toContain("1.2 千字");
    expect(html).toContain("500 字");
    expect(chapterTag(html, "ch-2")).not.toContain("字");
  });

  it("存量根级章在顶层就地显示（卷1 章之后、卷2 之前）", () => {
    const html = render();
    expect(html.indexOf("根级旧章")).toBeGreaterThan(html.indexOf("旧盟友"));
    expect(html.indexOf("根级旧章")).toBeLessThan(html.indexOf("第二卷"));
    // 章号跨卷连续（展示口径）
    expect(html).toContain("第3章");
  });

  it("0 章卷保留卷行（0章）、同几何空占位、不画可点折叠箭头", () => {
    const rows = buildWritingRailRows(tree([volume("vol-empty", "空卷", [])]));
    const html = render({ rows });
    expect(html).toContain("空卷");
    expect(html).toContain("0章");
    expect(html).not.toContain("<button");
    expect(html).not.toContain('aria-label="折叠"');
  });
});

describe("ChapterRail · 选中与折叠", () => {
  it("选中章 = bg-accent + aria-current=page；其他行不带 aria-current", () => {
    const html = render({ selectedId: "ch-2" });
    expect(chapterTag(html, "ch-2")).toContain("bg-accent");
    expect(chapterTag(html, "ch-2")).toContain('aria-current="page"');
    expect(chapterTag(html, "ch-1")).not.toContain("aria-current");
    expect(chapterTag(html, "ch-1")).toContain("hover:bg-muted");
  });

  it("展开 = RightOutlined + rotate-90；折叠 = 去掉旋转并隐藏该卷章行", () => {
    const rows = buildWritingRailRows(
      tree([volume("vol-1", "第一卷", [chapter("ch-1", "雪夜出走"), chapter("ch-2", "旧盟友")])]),
    );
    const expanded = render({ rows });
    expect(expanded).toContain('aria-label="折叠「第一卷」"');
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain("rotate-90");

    const collapsed = render({ rows, collapsed: new Set(["vol-1"]) });
    expect(collapsed).toContain('aria-label="展开「第一卷」"');
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).not.toContain("rotate-90");
    expect(collapsed).not.toContain("雪夜出走");
    expect(collapsed).not.toContain("旧盟友");
  });

  it("空树 = 居中一句「还没有章节」（不给新建入口）；加载中 = 骨架", () => {
    const empty = render({ rows: [] });
    expect(empty).toContain("还没有章节");
    expect(empty).not.toContain("去大纲");

    const loading = render({ rows: [], loading: true });
    expect(loading).toContain("animate-pulse");
    expect(loading).not.toContain("还没有章节");
  });

  it("错误态：错误文案 + 重试按钮（窄屏目录页的挂载点）", () => {
    const html = render({ rows: [], error: "大纲加载失败，章节目录暂不可用", onRetry: () => {} });
    expect(html).toContain("大纲加载失败");
    expect(html).toMatch(/重\s*试/);
    expect(html).not.toContain("还没有章节");
  });
});

describe("ChapterRail · 否定契约（rail 不是第二个大纲页）", () => {
  it("无新建 / 改名 / 删除 / 写正文入口、无结构拖拽；手柄由页面作兄弟渲染，rail 自身不含手柄", () => {
    const html = render();
    expect(html).not.toContain("新建");
    expect(html).not.toContain("改名");
    expect(html).not.toContain("删除");
    expect(html).not.toContain("写正文");
    expect(html).not.toContain('aria-label="调整卷章导航栏宽度"');
    expect(html).not.toContain('role="separator"');
    expect(html).not.toContain("draggable");
  });

  it("收起按钮只在传入 onCollapse 时渲染（窄屏无收起）", () => {
    expect(render({ onCollapse: () => {} })).toContain('aria-label="收起卷章导航栏"');
    expect(render()).not.toContain('aria-label="收起卷章导航栏"');
  });
});
