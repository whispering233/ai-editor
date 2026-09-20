// 设置页「快捷键」区 SSR 走查：说明页渲染出清单行（组合键徽标 + 说明）——不是空 tab。
// 平台化：node 环境（无浏览器 navigator）按非 Apple 渲染 ⇒ 期望 `Ctrl + S`。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShortcutsSection } from "./shortcuts-section";

describe("ShortcutsSection", () => {
  it("渲染区块标题、说明行与 Ctrl + S 行（含说明文案）", () => {
    const html = renderToString(<ShortcutsSection />);
    expect(html).toContain("快捷键");
    expect(html).toContain("以下快捷键在应用内任意页面生效");
    expect(html).toContain("Ctrl + S");
    expect(html).toContain("保存当前内容并生成本地存档");
  });
});
