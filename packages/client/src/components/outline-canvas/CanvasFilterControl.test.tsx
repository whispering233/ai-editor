// 画布筛选面板 SSR 走查（仓内无 jsdom，同 panel-header.test.tsx 惯例）。
// 守的是**窄屏不换行破版**：面板固定宽（`w-56`）+ 单列（`flex-col`，全程无 `flex-wrap`），
// 卷 / 标签两个长列表各自竖向滚动——窄屏只会让列表滚，不会把面板横向撑破或折行。
// 面板内容是三个维度（卷 / 状态 / 标签）+「清除」；卷段只在有卷时渲染。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { EMPTY_CANVAS_FILTER, type CanvasFilter } from "../../lib/outline-canvas-filter";
import { CanvasFilterPanel } from "./CanvasFilterControl";

function render(filter: CanvasFilter = EMPTY_CANVAS_FILTER): string {
  return renderToString(
    <CanvasFilterPanel
      filter={filter}
      volumeOptions={[
        { id: "vol-1", label: "第1卷" },
        { id: "vol-2", label: "第2卷" },
      ]}
      tagOptions={["伏笔", "复仇"]}
      onChange={() => {}}
    />,
  );
}

describe("CanvasFilterPanel · 窄屏不换行", () => {
  it("面板 = 固定宽单列（w-56 + flex-col），整体不出现 flex-wrap / flex-row", () => {
    const html = render();
    expect(html).toContain('<div class="flex w-56 flex-col gap-2">');
    expect(html).not.toContain("flex-wrap");
    expect(html).not.toContain("flex-row");
  });

  it("卷 / 标签两个长列表各自竖向滚动（高度有界 ⇒ 多了只滚、不折行撑破）", () => {
    const html = render();
    expect(html).toContain("max-h-40 flex-col gap-1 overflow-y-auto");
    expect(html).toContain("max-h-56 flex-col gap-1 overflow-y-auto");
    expect(html).not.toContain("whitespace-nowrap");
  });

  it("三维同处一个面板：卷在状态之上、状态在标签之上，「清除」在末", () => {
    const html = render();
    const order = ["卷", "状态", "剧情线标签", "清除"].map((label) => html.indexOf(`>${label}<`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("勾中的卷在复选框上显示为已选（面板只读 filter，改动经 onChange）", () => {
    const html = render({ statuses: [], tags: [], volumeIds: ["vol-2"] });
    const checked = [...html.matchAll(/ant-checkbox-checked/g)];
    expect(checked).toHaveLength(1);
    expect(html).toContain("第2卷");
  });

  it("无卷（全是直挂 root 的章）→ 不渲染卷段", () => {
    const html = renderToString(
      <CanvasFilterPanel
        filter={EMPTY_CANVAS_FILTER}
        volumeOptions={[]}
        tagOptions={[]}
        onChange={() => {}}
      />,
    );
    expect(html).not.toContain(">卷<");
  });
});