// 保存态文案（唯一实现 = components/ui/save-status.tsx）SSR 走查：仓内无 jsdom/@testing-library
// （既有纪律：不引新依赖），用 `react-dom/server` 直渲染。
// 契约依据 = `docs/ui/DESIGN.md` §Components「save-status」：四态（idle 不渲染 / 编辑中… / 保存中… /
// 已保存 · HH:MM，时刻 = 最近一次保存完成的本地时间），字号 / 字色沿用 `text-xs text-muted-foreground`。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SaveStatus, type SaveState } from "./save-status";

/** SSR 在相邻文本节点之间插 `<!-- -->`（模板插值的两段文本）——断言前归一掉 */
function render(state: SaveState, savedAt: Date | null = null): string {
  return renderToString(<SaveStatus state={state} savedAt={savedAt} />).replace(
    /<!--[^>]*-->/g,
    "",
  );
}

describe("SaveStatus（保存态四态）", () => {
  it("idle → 不渲染（页面无保存动作时不留空占位）", () => {
    expect(render("idle")).toBe("");
  });

  it("pending → 「编辑中…」（输入即 pending，不谎报已保存）", () => {
    const html = render("pending");
    expect(html).toContain("编辑中…");
    expect(html).not.toContain("已保存");
  });

  it("saving → 「保存中…」", () => {
    expect(render("saving")).toContain("保存中…");
  });

  it("saved + 时刻 → 「已保存 · HH:MM」（本地时刻，`formatSavedAt` 同源）", () => {
    const html = render("saved", new Date(2026, 9, 1, 9, 5));
    expect(html).toContain("已保存 · 09:05");
  });

  it("saved 但无时刻 → 不渲染（不画「已保存 ·」半个文案）", () => {
    expect(render("saved", null)).toBe("");
  });

  it("字号 / 字色沿用 `text-xs text-muted-foreground`（不新增视觉语言）", () => {
    for (const html of [render("pending"), render("saving"), render("saved", new Date())]) {
      expect(html).toContain("text-xs");
      expect(html).toContain("text-muted-foreground");
    }
  });
});
