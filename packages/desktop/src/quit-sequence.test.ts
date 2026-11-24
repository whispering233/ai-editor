// `before-quit` 的关服务端时机：只在**没有窗口**时关（菜单「退出」路径下那时 flush 已经跑完）。
import { describe, expect, it } from "vitest";
import { shouldCloseServerOnBeforeQuit } from "./quit-sequence.js";

describe("shouldCloseServerOnBeforeQuit", () => {
  it("无窗口 → 关服务端（X 按钮 / 二次 before-quit）", () => {
    expect(shouldCloseServerOnBeforeQuit(0)).toBe(true);
  });

  it("还有窗口 → 不关（菜单「退出」的首个 before-quit，flush 还没跑）", () => {
    expect(shouldCloseServerOnBeforeQuit(1)).toBe(false);
    expect(shouldCloseServerOnBeforeQuit(2)).toBe(false);
  });
});