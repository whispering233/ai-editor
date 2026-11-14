// 年度热力 SSR 走查（`react-dom/server`，仓内无 jsdom）：53 列 × 7 行、周一起始、365 个可点格子、
// 每格原生 title「日期 · N 字」、0 档与正档类、图例「少 → 多」+ 活跃天数。
// 契约依据 = DESIGN.md「码字统计页」→「年度热力」；档位阈值单源 = lib/writing-stats.ts。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { YearHeatmap } from "./year-heatmap";

const days = new Map([
  ["2025-11-16", 50], // 1 档
  ["2025-12-01", 200], // 2 档
  ["2026-06-01", 500], // 3 档
  ["2026-11-15", 1000], // 4 档（today）
]);

function renderHeatmap(selectedDate = "2026-11-15"): string {
  return renderToString(
    <YearHeatmap
      charsByDate={days}
      today="2026-11-15"
      selectedDate={selectedDate}
      onSelectDate={() => undefined}
    />,
  ).replace(/<!--[^>]*-->/g, "");
}

describe("年度热力", () => {
  it("标题 + 图例（少 → 多）+ 活跃天数", () => {
    const html = renderHeatmap();
    expect(html).toContain("码字热力 · 近 365 天");
    expect(html).toContain(">少<");
    expect(html).toContain(">多<");
    expect(html).toContain("活跃 4 天");
  });

  it("近 365 天 = 365 个可点格子（53 列 × 7 行），首日 = today-364、末日 = today", () => {
    const html = renderHeatmap();
    expect(html.match(/<button/g) ?? []).toHaveLength(365);
    expect(html).toContain('title="2025-11-16 · 50 字"');
    expect(html).toContain('title="2026-11-15 · 1,000 字"');
    // 窄栏横向滚动（不压缩格子）
    expect(html).toContain("overflow-x-auto");
  });

  it("0 档 = surface-muted（bg-accent）；正档用 GitHub 绿阶 heat-1..4；选中格有描边", () => {
    const html = renderHeatmap("2026-11-15");
    expect(html).toContain("bg-accent");
    expect(html).toContain("bg-heat-1");
    expect(html).toContain("bg-heat-2");
    expect(html).toContain("bg-heat-3");
    expect(html).toContain("bg-heat-4");
    expect(html).toMatch(/bg-heat-4[^"]*ring-1 ring-primary/);
  });
});