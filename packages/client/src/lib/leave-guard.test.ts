// 离开守卫真值表（A4）：无守卫放行 / 有守卫转发答案 / 在途确认不重入 / 注销后放行。
// 守卫是模块级单槽 ⇒ 每例后必须注销，否则会污染后续用例（含其它文件的同进程运行）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmLeave, setLeaveGuard } from "./leave-guard";

/** 可手动落地的确认框（模拟用户点在弹框上） */
function pendingConfirm() {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  const guard = vi.fn(() => promise);
  return { guard, answer: resolve };
}

afterEach(() => {
  setLeaveGuard(null);
});

describe("confirmLeave", () => {
  it("无守卫：直接放行（书架 / 大纲等没注册守卫的页面）", async () => {
    await expect(confirmLeave()).resolves.toBe(true);
  });

  it("有守卫：转发守卫的答案（确认离开 → true / 取消 → false）", async () => {
    setLeaveGuard(async () => true);
    await expect(confirmLeave()).resolves.toBe(true);

    setLeaveGuard(async () => false);
    await expect(confirmLeave()).resolves.toBe(false);
  });

  it("在途确认不重入：并发两次只问一次，两个 promise 同值", async () => {
    const { guard, answer } = pendingConfirm();
    setLeaveGuard(guard);

    const first = confirmLeave();
    const second = confirmLeave();
    expect(guard).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    answer(false);
    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
  });

  it("在途确认落地后解锁：下一次再问会重新弹框", async () => {
    const { guard, answer } = pendingConfirm();
    setLeaveGuard(guard);

    const first = confirmLeave();
    answer(true);
    await expect(first).resolves.toBe(true);

    // 上一轮已落地 ⇒ 不再是同一个 promise（守卫会被再问一次）
    const second = confirmLeave();
    expect(guard).toHaveBeenCalledTimes(2);
    answer(true);
    await expect(second).resolves.toBe(true);
  });

  it("注销后放行（变干净 / 页面卸载不再拦离开）", async () => {
    const { guard } = pendingConfirm();
    setLeaveGuard(guard);
    setLeaveGuard(null);

    await expect(confirmLeave()).resolves.toBe(true);
    expect(guard).not.toHaveBeenCalled();
  });
});
