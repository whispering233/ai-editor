// 桌面版能力检测单测（`lib/desktop.ts`）：浏览器形态必须拿到 null（按钮因此不渲染），
// SSR（无 window）同样 null；只有 preload 桥形状合法时才返回桥。
import { afterEach, describe, expect, it } from "vitest";
import { desktopBridge } from "./desktop";

/** 受控替换全局 window（node 环境下默认没有 window；每例后恢复） */
function setWindow(value: unknown): void {
  (globalThis as unknown as { window?: unknown }).window = value;
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("desktopBridge", () => {
  it("SSR / 无 window → null", () => {
    expect(desktopBridge()).toBeNull();
  });

  it("浏览器形态（无 preload 桥）→ null", () => {
    setWindow({});
    expect(desktopBridge()).toBeNull();
  });

  it("桥形状非法（pickDirectory 缺失或非函数）→ null", () => {
    setWindow({ aiEditorDesktop: { ready: true } });
    expect(desktopBridge()).toBeNull();
    setWindow({ aiEditorDesktop: { ready: true, pickDirectory: "nope" } });
    expect(desktopBridge()).toBeNull();
  });

  it("桌面版（合法桥）→ 返回该桥", () => {
    const bridge = { ready: true, pickDirectory: async () => "/books/mine" };
    setWindow({ aiEditorDesktop: bridge });
    expect(desktopBridge()).toBe(bridge);
  });
});
