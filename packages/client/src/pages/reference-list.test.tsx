// 参考资料列表页形态守卫（卡 12.8）：文件机制退役 + 新建入口收敛后的**入口形状**。
// 为什么用 SSR 断言：判据是「界面上还有没有这个入口」，渲染文本就是最直接的证据
// （同 pages/settings-tabs.test.tsx 惯例；仓内无 jsdom，交互走浏览器走查）。
// 只断言「不该有的东西不在了 + 该有的入口在」——行的来源列取值等取值逻辑由 lib/reference.test.ts 覆盖。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReferenceList from "./ReferenceList";

const html = renderToString(<ReferenceList />);

describe("参考资料列表页页头（卡 12.8）", () => {
  it("不再有文件扫描入口（「扫描」按钮 / 「未同步的本地文档」提示条）", () => {
    expect(html).not.toContain("扫描");
    expect(html).not.toContain("未同步");
  });

  it("新建入口 = 「导入 md 新建」+「新建」（旧的 md / link 双分流已删）", () => {
    expect(html).toContain("导入 md 新建");
    expect(html).toContain("新建");
    expect(html).not.toContain("新建 md 文档");
    expect(html).not.toContain("新建外源链接");
  });

  it("导入入口的隐藏文件框只收 markdown（md 新建；块 JSON 的导入在详情页）", () => {
    expect(html).toContain('accept=".md,.markdown,text/markdown"');
  });
});
