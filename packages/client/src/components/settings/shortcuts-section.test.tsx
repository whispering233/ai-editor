// 设置页「快捷键」区 SSR 走查：说明页渲染出清单行（组合键徽标 + 说明）——不是空 tab。
// 平台化：node 环境（无浏览器 navigator）按非 Apple 渲染 ⇒ 期望 `Ctrl + S` / `Ctrl + B` /
// `Ctrl + Shift + B`（带 Shift 的条目由 ShortcutEntry.shift 表达）。
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

  it("列出整栏快捷键两行（左栏 Ctrl + B、右栏 Ctrl + Shift + B）", () => {
    const html = renderToString(<ShortcutsSection />);
    expect(html).toContain("Ctrl + B");
    expect(html).toContain("Ctrl + Shift + B");
    expect(html).toContain("收起 / 展开左栏（桌面态）");
    expect(html).toContain("收起 / 展开右栏（桌面态）");
  });
});
