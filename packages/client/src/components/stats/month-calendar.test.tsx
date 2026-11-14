// 码字日历 SSR 走查（仓内无 jsdom/@testing-library，用 `react-dom/server` 直渲染）。
// 契约依据 = DESIGN.md「码字统计页」→「码字日历（月历）」：7 列星期头、日号 + 仅正字数时显示字数、
// 选中日详情三格（选中日字数 / 当月累计 / 当月活跃天数）、翻月 + 今天按钮。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MonthCalendar } from "./month-calendar";

const days = new Map([
  ["2026-11-05", 1234],
  ["2026-11-06", 100],
  ["2026-11-15", 500],
]);

function renderCalendar(selectedDate: string): string {
  return renderToString(
    <MonthCalendar
      year={2026}
      monthIndex={10}
      charsByDate={days}
      today="2026-11-15"
      selectedDate={selectedDate}
      onMonthChange={() => undefined}
      onSelectDate={() => undefined}
    />,
  ).replace(/<!--[^>]*-->/g, "");
}

describe("码字日历（月历）", () => {
  it("星期头周一起始 + 当前月份 + 翻月/今天入口", () => {
    const html = renderCalendar("2026-11-05");
    for (const weekday of ["一", "二", "三", "四", "五", "六", "日"]) {
      expect(html).toContain(`>${weekday}<`);
    }
    expect(html).toContain("2026年11月");
    expect(html).toContain('aria-label="上个月"');
    expect(html).toContain('aria-label="下个月"');
    expect(html).toContain("今 天"); // antd Button 的两个汉字间插入空格（自动加空格规则）
  });

  it("正字数才渲染当日字数（千分位），0 字日只有日号", () => {
    const html = renderCalendar("2026-11-05");
    expect(html).toContain("1,234");
    expect(html).toContain("500");
    // 2026-11-07 无记录：其按钮 title 为 0 字，但不出现数字文本
    expect(html).toContain('title="2026-11-07 · 0 字"');
    expect(html).not.toContain(">0<"); // 日号 1..30 里没有 0；字数 0 也不占文本
  });

  it("选中日详情三格：选中日字数 / 当月累计 / 当月活跃天数", () => {
    const html = renderCalendar("2026-11-05");
    expect(html).toContain("选中日字数");
    expect(html).toContain("当月累计");
    expect(html).toContain("当月活跃天数");
    expect(html).toContain(">1,234<"); // 选中日
    expect(html).toContain(">1,834<"); // 当月累计 1234 + 100 + 500
    expect(html).toContain(">3<"); // 活跃 3 天
  });

  it("切换选中日 → 选中格标记与选中日字数同步", () => {
    const html = renderCalendar("2026-11-06");
    expect(html).toContain('aria-label="11月6日 · 100 字" aria-pressed="true"');
    expect(html).toContain(">100<");
  });
});