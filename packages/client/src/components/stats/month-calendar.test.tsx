// 码字日历 SSR 走查（仓内无 jsdom/@testing-library，用 `react-dom/server` 直渲染）。
// 契约依据 = DESIGN.md「码字统计页」→「码字日历（月历）」：7 列星期头、日号 + 仅正字数时显示字数、
// 选中日详情三格（选中日字数 / 当月累计 / 当月活跃天数）、两行头部（标题 + 今天 / 翻月导航 + 月份）。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MonthCalendar } from "./month-calendar";

const days = new Map([
  ["2026-11-05", 1234],
  ["2026-11-06", 100],
  ["2026-11-15", 500],
]);

function renderCalendar(
  selectedDate: string,
  { year = 2026, monthIndex = 10 }: { year?: number; monthIndex?: number } = {},
): string {
  return renderToString(
    <MonthCalendar
      year={year}
      monthIndex={monthIndex}
      charsByDate={days}
      today="2026-11-15"
      selectedDate={selectedDate}
      onMonthChange={() => undefined}
      onSelectDate={() => undefined}
    />,
  ).replace(/<!--[^>]*-->/g, "");
}

function countOccurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("码字日历（月历）", () => {
  it("星期头周一起始 + 当前月份 + 翻月/今天入口", () => {
    const html = renderCalendar("2026-11-05");
    for (const weekday of ["一", "二", "三", "四", "五", "六", "日"]) {
      expect(html).toContain(`>${weekday}<`);
    }
    expect(html).toContain("码字日历");
    expect(html).toContain("2026年11月");
    expect(html).toContain('aria-label="上个月"');
    expect(html).toContain('aria-label="下个月"');
    expect(html).toContain("今 天"); // antd Button 的两个汉字间插入空格（自动加空格规则）
    // 两行头部：标题行（标题 + 今天）在前，翻月导航行（上/下个月 + 月份）在后
    const titleAt = html.indexOf("码字日历");
    const todayAt = html.indexOf("今 天");
    const prevAt = html.indexOf('aria-label="上个月"');
    expect(titleAt).toBeGreaterThanOrEqual(0);
    expect(todayAt).toBeGreaterThan(titleAt);
    expect(prevAt).toBeGreaterThan(todayAt);
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

  it("固定 6 周栅格：4 周月份（2027-02）尾部补足 14 个空位", () => {
    const html = renderCalendar("2027-02-01", { year: 2027, monthIndex: 1 });
    const placeholders = countOccurrences(html, 'class="h-10" aria-hidden="true"');
    const dayCells = countOccurrences(html, "aria-pressed=");
    expect(dayCells).toBe(28); // 2027-02 = 28 天、恰好 4 整行（周一起始）
    expect(placeholders).toBe(14); // 42 − 28：尾部补足
    expect(dayCells + placeholders).toBe(42);
    // 空位必须在最后一个日格之后，而不是前插
    expect(html.lastIndexOf('class="h-10" aria-hidden="true"')).toBeGreaterThan(
      html.lastIndexOf('aria-label="2月28日'),
    );
  });

  it("固定 6 周栅格：6 周月份（2026-11）前导 6 + 尾部 6 共 12 个空位", () => {
    const html = renderCalendar("2026-11-01");
    const placeholders = countOccurrences(html, 'class="h-10" aria-hidden="true"');
    const dayCells = countOccurrences(html, "aria-pressed=");
    expect(dayCells).toBe(30);
    expect(placeholders).toBe(12);
    expect(dayCells + placeholders).toBe(42);
  });
});