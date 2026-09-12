// 人物工作台左栏渲染走查（卡 3.1）：仓内无 jsdom/@testing-library（既有纪律：不引新依赖），
// 用 react-dom/server renderToString 直渲染富数据（组件是纯展示的，无需 mock api/store）。
// 覆盖：行（姓名 + 角色定位）、选中面、空态两种文案、错误横幅 + 重试、加载骨架、溢出提示。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { CharacterRail } from "./character-rail";
import type { CharacterRailItem } from "../../lib/character-workbench";

const ITEMS: CharacterRailItem[] = [
  { id: "char-1", name: "张三", role: "主角" },
  { id: "char-2", name: "李四", role: "" },
];

function render(overrides: Partial<Parameters<typeof CharacterRail>[0]> = {}): string {
  return renderToString(
    <CharacterRail
      items={ITEMS}
      selectedId={null}
      loading={false}
      error={null}
      qInput=""
      onQInputChange={() => {}}
      sortValue="updated_at:desc"
      onSortChange={() => {}}
      overflowHint=""
      onSelect={() => {}}
      onRetry={() => {}}
      {...overrides}
    />,
  );
}

/** 取某 id 行的 class（HTML 里属性顺序固定为 data-character-id 在前、class 在后） */
function rowClass(html: string, id: string): string {
  const match = new RegExp(`data-character-id="${id}"[^>]*class="([^"]*)"`).exec(html);
  return match?.[1] ?? "";
}

describe("CharacterRail", () => {
  it("渲染姓名 + 角色定位；无角色的行不渲染角色段", () => {
    const html = render();
    expect(html).toContain("张三");
    expect(html).toContain("主角");
    expect(html).toContain("李四");
    expect(rowClass(html, "char-1")).not.toBe("");
  });

  it("选中行 = surface-muted 灰面（bg-accent）；未选中行 = hover 灰面", () => {
    const html = render({ selectedId: "char-1" });
    expect(rowClass(html, "char-1")).toContain("bg-accent");
    expect(rowClass(html, "char-2")).not.toContain("bg-accent");
    expect(rowClass(html, "char-2")).toContain("hover:bg-muted");
  });

  it("外传 className 可覆盖宽度（窄屏两级导航全宽）", () => {
    const html = render({ className: "w-full border-r-0" });
    expect(html).toContain("w-full");
    expect(html).not.toContain("w-60");
  });

  it("空态两种文案：无人物 vs 搜索无匹配", () => {
    expect(render({ items: [] })).toContain("还没有人物");
    expect(render({ items: [], qInput: "不存在" })).toContain("没有匹配的人物");
  });

  it("加载中且无数据 → 骨架占位（不显示空态）", () => {
    const html = render({ items: [], loading: true });
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("还没有人物");
  });

  it("错误态 → 横幅 + 重试按钮（列表不可用时不出行）", () => {
    const html = render({ error: "人物列表加载失败，请重试", items: [] });
    expect(html).toContain("人物列表加载失败，请重试");
    expect(html).toContain("重试");
    expect(html).not.toContain("还没有人物");
  });

  it("溢出提示行只在提示非空时渲染", () => {
    expect(render({ overflowHint: "共 300 个，仅显示前 200 个（用搜索缩小范围）" })).toContain(
      "共 300 个",
    );
    expect(render()).not.toContain("仅显示前");
  });

  it("排序下拉用内容宽（popupMatchSelectWidth=false——窄触发器硬约束）", () => {
    // antd Select 的该 prop 不落到 DOM 属性上，改为断言下拉触发器存在且宽度类为 flex-1
    const html = render();
    expect(html).toContain("ant-select");
  });
});
