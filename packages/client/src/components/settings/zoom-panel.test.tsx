// 设置页「通用 → 界面缩放」展示层的 SSR 走查（仓内无 jsdom，用 react-dom/server 直渲染；同 `search-key-panel.test.tsx`）。
// 契约 = `docs/ui/DESIGN.md` `zoom-panel`：百分比 + 步进 + 端点置灰 +「恢复 100%」，且客户端不持档位表
// （端点判定全部读主进程下发的 atMin / atMax / atDefault）。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ZoomState } from "../../lib/desktop";
import { ZoomControl } from "./zoom-panel";

/** SSR 在相邻文本节点之间插 `<!-- -->`（文案 + 插值拼起来的行）——断言前归一掉 */
function render(state: ZoomState | null): string {
  return renderToString(<ZoomControl state={state} onStep={() => {}} />).replace(/<!--[^>]*-->/g, "");
}

/** 取带某个 aria-label 的 `<button` 起始标签（`disabled` / `aria-live` 都落在标签上） */
function buttonTag(html: string, label: string): string {
  const match = new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html);
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

const MID: ZoomState = { percent: 125, atMin: false, atMax: false, atDefault: false };

describe("ZoomControl · 读取态", () => {
  it("未读到状态时三个按钮全禁用，文案是「读取中…」", () => {
    const html = render(null);
    expect(html).toContain("读取中…");
    for (const label of ["缩小界面", "放大界面", "恢复 100%"]) expect(buttonTag(html, label)).toContain("disabled");
  });
});

describe("ZoomControl · 中间档", () => {
  it("显示当前百分比，三个按钮都可用", () => {
    const html = render(MID);
    expect(html).toContain("125%");
    expect(html).toContain('aria-live="polite"');
    for (const label of ["缩小界面", "放大界面", "恢复 100%"]) expect(buttonTag(html, label)).not.toContain("disabled");
  });
});

describe("ZoomControl · 端点", () => {
  it("最小档只禁用「缩小」", () => {
    const html = render({ ...MID, percent: 80, atMin: true });
    expect(buttonTag(html, "缩小界面")).toContain("disabled");
    expect(buttonTag(html, "放大界面")).not.toContain("disabled");
  });

  it("最大档只禁用「放大」", () => {
    const html = render({ ...MID, percent: 200, atMax: true });
    expect(buttonTag(html, "放大界面")).toContain("disabled");
    expect(buttonTag(html, "缩小界面")).not.toContain("disabled");
  });

  it("已在 100% 时「恢复 100%」禁用（atDefault 由主进程给，不在前端比对 100）", () => {
    const html = render({ percent: 100, atMin: false, atMax: false, atDefault: true });
    expect(html).toContain("100%");
    expect(buttonTag(html, "恢复 100%")).toContain("disabled");
  });
});
