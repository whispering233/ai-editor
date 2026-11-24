// `before-quit` 的关服务端时机：只在**没有窗口**时关（菜单「退出」路径下那时 flush 已经跑完）。
// `close` 的跳过 flush 判定同理：看不见的时序只能靠纯函数 + 真值表钉住。
import { describe, expect, it } from "vitest";
import { shouldCloseServerOnBeforeQuit, shouldSkipFlushOnClose } from "./quit-sequence.js";

describe("shouldCloseServerOnBeforeQuit", () => {
  it("无窗口 → 关服务端（X 按钮 / 二次 before-quit）", () => {
    expect(shouldCloseServerOnBeforeQuit(0)).toBe(true);
  });

  it("还有窗口 → 不关（菜单「退出」的首个 before-quit，flush 还没跑）", () => {
    expect(shouldCloseServerOnBeforeQuit(1)).toBe(false);
    expect(shouldCloseServerOnBeforeQuit(2)).toBe(false);
  });
});

describe("shouldSkipFlushOnClose", () => {
  it("未放行且服务端还活着 → 不跳过（正常走 flush）", () => {
    expect(shouldSkipFlushOnClose({ flushed: false, serverClosing: false })).toBe(false);
  });

  it("已放行的重入 close → 跳过（上次 `win.close()` 的重入）", () => {
    expect(shouldSkipFlushOnClose({ flushed: true, serverClosing: false })).toBe(true);
    expect(shouldSkipFlushOnClose({ flushed: true, serverClosing: true })).toBe(true);
  });

  it("服务端已被主动关掉 → 跳过（更新安装 / 切换书库：flush 必然失败，弹框是假警报）", () => {
    expect(shouldSkipFlushOnClose({ flushed: false, serverClosing: true })).toBe(true);
  });
});