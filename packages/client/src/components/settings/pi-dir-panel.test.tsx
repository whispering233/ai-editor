// 「浏览…」的形态守卫（docs/ui/DESIGN.md `tab-advanced` → `pi-dir`）：仅桌面形态（preload 桥非空）
// 才渲染该按钮。SSR 不跑 effect ⇒ 只出加载态，不会真的请求。
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { PiDirPanel } from "./pi-dir-panel";

function setWindow(value: unknown): void {
  (globalThis as unknown as { window?: unknown }).window = value;
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("PiDirPanel · 浏览按钮", () => {
  it("浏览器形态（无桥）→ 整钮不渲染", () => {
    expect(renderToString(<PiDirPanel />)).not.toContain("浏览…");
  });

  it("桌面形态（有桥）→ 渲染「浏览…」", () => {
    setWindow({
      aiEditorDesktop: {
        pickDirectory: async () => null,
        getLibraryRoot: async () => null,
        changeLibraryRoot: async () => null,
        onFlushRequest: () => () => {},
      },
    });
    expect(renderToString(<PiDirPanel />)).toContain("浏览…");
  });
});