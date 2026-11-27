import { describe, expect, it } from "vitest";
import { canCloseConfirm } from "./confirm-dialog";

describe("canCloseConfirm（确认框在途不可关）", () => {
  it("空闲时请求关闭 → 可以关", () => {
    expect(canCloseConfirm(false, false)).toBe(true);
  });

  it("在途时请求关闭 → 拦住（Esc / 遮罩 / 关闭钮一律不生效）", () => {
    expect(canCloseConfirm(true, false)).toBe(false);
  });

  it("请求打开（next = true）→ 不关，也不触发关闭动作", () => {
    expect(canCloseConfirm(false, true)).toBe(false);
    expect(canCloseConfirm(true, true)).toBe(false);
  });
});