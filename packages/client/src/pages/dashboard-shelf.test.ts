// 书架分组渲染守卫（卡 23.2）：组小标题 + 「当前书按 id 判定」两处收窄。
//
// 为什么扫源码不 SSR：Dashboard 的书架数据来自 zustand store，
// SSR 走 getServerSnapshot（初始 state），预置的书架在 renderToString 里不可见。
// 组序 / 组文案的取值断言在 lib/shelf.test.ts（单一定义就在那里）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");

describe("书架两类分组（卡 23.2）", () => {
  it("书架行按 groupShelfBooks 分组渲染，组小标题带条数", () => {
    expect(dashboard).toContain("groupShelfBooks(bookshelf!.books)");
    expect(dashboard).toMatch(/\{group\.label\} · \{group\.books\.length\}/);
  });

  it("当前书判定走纯函数 isCurrentBook（按项目 id，不再按书名）", () => {
    expect(dashboard).toContain("isCurrentBook(book, config)");
    expect(dashboard).not.toMatch(/book\.name\s*===\s*config\??\.name/);
  });

  it("打开语义仍挂在 isCurrent 上（分组只服务识别，不改变打开行为）", () => {
    expect(dashboard).toMatch(/if \(isCurrent\) navigate\("\/overview"\)/);
  });
});

// 行结构（卡 23.5）：整行 `<button>` → `div` 行容器 + 内层「打开」按钮 + 行尾垃圾桶。
// 为什么必须拆：HTML 不允许按钮嵌按钮——整行按钮 + 行尾图标按钮是无效结构（点击冒泡成「打开」）。
describe("书架行结构（卡 23.5）", () => {
  it("行容器是 div（不再是整行 button），内层「打开」按钮与行尾垃圾桶并列", () => {
    expect(dashboard).toMatch(/<li key=\{book\.path\}>\s*<div/);
    expect(dashboard).toMatch(/title=\{[\s\S]{0,120}?打开《\$\{book\.name\}》/);
    expect(dashboard).toContain('aria-label="删除书籍"');
    expect(dashboard).toContain('title="删除书籍"');
    expect(dashboard).toContain("<DeleteOutlined");
  });

  it("旧形态不得回归：整行 button（`flex w-full … py-2.5` 行类）不再出现在 <button 上", () => {
    expect(dashboard).not.toMatch(/<button\b[\s\S]{0,240}?"flex w-full items-center gap-3 px-3 py-2\.5/);
  });

  it("删书确认框挂在书架页（受控：book = deleteTarget；两者共用同一实例）", () => {
    expect(dashboard).toContain("<BookDeleteDialog");
    expect(dashboard).toMatch(/<BookDeleteDialog[\s\S]{0,120}?book=\{deleteTarget\}/);
  });

  it("当前书条并列「删除」入口（导出 / 重命名那一行）", () => {
    expect(dashboard).toMatch(/重命名\s*<\/Button>[\s\S]{0,600}?删除/);
  });
});
