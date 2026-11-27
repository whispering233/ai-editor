// `SkeletonBlock` SSR 走查（仓内无 jsdom / @testing-library，用 react-dom/server）。
// 契约 = docs/ui/DESIGN.md §Components `skeleton-block`：只有 `rows` 一个参数、行样式走
// `lib/styles.ts` 的 `skeletonClass`、圆角与它模拟的真实卡同值（当前 6px）。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkeletonBlock } from "./skeleton-block";

/** 每行都是 `skeletonClass`（`animate-pulse` 只出现在行上，壳串没有）⇒ 用它数行数 */
function rowCount(html: string): number {
  return (html.match(/animate-pulse/g) ?? []).length;
}

describe("SkeletonBlock · 行数与壳串", () => {
  it("缺省 3 行", () => {
    expect(rowCount(renderToString(<SkeletonBlock />))).toBe(3);
  });

  it("`rows` 决定行数（现网只有 3 与 5）", () => {
    expect(rowCount(renderToString(<SkeletonBlock rows={5} />))).toBe(5);
    expect(rowCount(renderToString(<SkeletonBlock rows={1} />))).toBe(1);
  });

  it("壳串 = 描边卡 + 16px 内边距 + 行距 12px，圆角 8px（与 `card` 同值）", () => {
    const html = renderToString(<SkeletonBlock />);
    // 逐字比对：这串与被替换掉的 4 处手写壳除圆角外完全相同 ⇒ 迁移零像素漂移
    expect(html).toContain("space-y-3 rounded-lg border border-border p-4");
    for (const cls of ["space-y-3", "rounded-lg", "border-border", "p-4"]) {
      expect(html).toContain(cls);
    }
    // 6px（`rounded-md`）是迁前的旧值：骨架与它模拟的卡必须同档，回到 6px 就是跳档
    expect(html).not.toContain("rounded-md");
  });

  it("行样式单源 = `skeletonClass`（不复制 animate-pulse / rounded / bg-muted 的实现细节）", () => {
    const html = renderToString(<SkeletonBlock rows={2} />);
    expect(html).toContain("animate-pulse");
    expect(html).toContain("h-9");
  });

  it("调用点附加类与壳串合并（网格 / 外边距由调用点给）", () => {
    const html = renderToString(<SkeletonBlock className="mt-2 md:col-span-2" />);
    expect(html).toContain("mt-2");
    expect(html).toContain("md:col-span-2");
  });
});
