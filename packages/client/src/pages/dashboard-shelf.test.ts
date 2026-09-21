// 书架分组渲染守卫（卡 23.2）：组小标题 + 「当前书按 id 判定」两处收窄。
//
// 为什么扫源码不 SSR：同 dashboard-decompose.test.ts——Dashboard 的书架数据来自 zustand store，
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

  it("当前书判定按项目 id，不再按书名（同名不同 id 的书并存时按 name 会高亮错书）", () => {
    expect(dashboard).toContain("book.id === config.id");
    expect(dashboard).not.toMatch(/book\.name\s*===\s*config\??\.name/);
  });

  it("行尾徽标 / 打开语义仍挂在 isCurrent 上（分组只服务识别，不改变打开行为）", () => {
    expect(dashboard).toMatch(/isCurrent && decomposeJob !== null/);
    expect(dashboard).toMatch(/if \(isCurrent\) navigate\("\/overview"\)/);
  });
});
