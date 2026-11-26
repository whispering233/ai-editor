// 今日目标卡 SSR 走查（`react-dom/server`，仓内无 jsdom）：开启态 = 进度文案 + 两个控件；
// 关闭态 = 只剩标题 + 一行说明且开关仍在（唯一重开入口）；达标态 = 主色 + 尾部 `✓`。
// 契约依据 = DESIGN.md「码字统计页」→「今日目标」；口径 = docs/api/130-api-writing-stats.md。
//
// 偏好来源是本机 localStorage，SSR 下没有 `window` ⇒ 用桩对象注入（先例 = pi-dir-panel.test.tsx）。
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { GoalCard } from "./goal-card";

type Globals = { window?: unknown };

const DAYS = [{ date: "2026-11-16", chars: 600 }];

/** 注入本机偏好（`null` = 未存过任何偏好 ⇒ 走缺省值） */
function storeGoal(preference: unknown): void {
  (globalThis as unknown as Globals).window = {
    localStorage: {
      getItem: () => (preference === null ? null : JSON.stringify(preference)),
      setItem: () => undefined,
    },
  };
}

afterEach(() => {
  delete (globalThis as unknown as Globals).window;
});

/** SSR 会在相邻文本节点之间插 `<!-- -->`——断言前归一掉 */
function renderCard(days: { date: string; chars: number }[] = DAYS): string {
  return renderToString(
    <GoalCard days={days} today="2026-11-16" projectId="novel-1" />,
  ).replace(/<!--[^>]*-->/g, "");
}

describe("今日目标卡 · 开启态", () => {
  it("标题 + 进度文案（今日 / 目标 / 连续天数）+ 开关", () => {
    storeGoal({ goal: 500, enabled: true, writingDays: [0, 1, 2, 3, 4, 5, 6] });
    const html = renderCard();
    expect(html).toContain("今日目标");
    expect(html).toContain("600 / 500 字");
    expect(html).toContain("连续 1 天");
    expect(html).toContain('aria-label="每日目标"');
  });

  it("两个控件：档位 Segmented（档位常量取值）+ 写作日 Checkbox.Group", () => {
    storeGoal({ goal: 500, enabled: true, writingDays: [0, 1, 2, 3, 4, 5, 6] });
    const html = renderCard();
    expect(html).toContain("500 字"); // 档位选项标签
    expect(html).toContain("1000 字");
    expect(html).toContain("周一");
    expect(html).toContain("周日");
    expect(html).toContain("未勾的日子不计入连续天数");
    expect(html).not.toContain("ant-progress"); // 自绘进度条，不引 antd Progress
  });

  it("今日 0 字照常渲染 0 进度，不打 EmptyState", () => {
    storeGoal({ goal: 500, enabled: true, writingDays: [0, 1, 2, 3, 4, 5, 6] });
    const html = renderCard([]);
    expect(html).toContain("0 / 500 字");
    expect(html).not.toContain("ant-empty");
    expect(html).not.toContain("✓");
  });
});

describe("今日目标卡 · 关闭态", () => {
  it("只剩标题 + 「每日目标已关闭」，开关仍在；不渲染进度与控件", () => {
    storeGoal({ goal: 500, enabled: false, writingDays: [] });
    const html = renderCard();
    expect(html).toContain("今日目标");
    expect(html).toContain("每日目标已关闭");
    expect(html).toContain('aria-label="每日目标"');
    expect(html).not.toContain("连续");
    expect(html).not.toContain("未勾的日子不计入连续天数");
    expect(html).not.toContain("600 / 500 字");
  });
});

describe("今日目标卡 · 达标态", () => {
  it("数字改主色 + 尾部 `✓`，进度条封顶 100%", () => {
    storeGoal({ goal: 500, enabled: true, writingDays: [0, 1, 2, 3, 4, 5, 6] });
    const html = renderCard();
    expect(html).toContain("text-primary");
    expect(html).toContain("✓");
    expect(html).toContain("width:100%");
  });

  it("未达标时不出现 `✓`", () => {
    storeGoal({ goal: 1000, enabled: true, writingDays: [0, 1, 2, 3, 4, 5, 6] });
    const html = renderCard();
    expect(html).not.toContain("✓");
  });
});
