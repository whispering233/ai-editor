// 后退守卫真值表（C2）：哨兵挂 / 撤、popstate 的确认 / 取消 / 回声抑制、卸载后在途确认。
// 不碰真 window.history——守卫只经 BackGuardHistory 动历史，假实现在 calls 里记流水。
import { describe, expect, it, vi } from "vitest";
import { createBackGuard, type BackGuardHistory } from "./back-guard";

/** 假历史：记录 push / back 流水，onSentinel 可手动摆（模拟「已离开哨兵」） */
function fakeHistory(onSentinel = false) {
  const calls: string[] = [];
  let sentinel = onSentinel;
  const history: BackGuardHistory = {
    pushSentinel: () => {
      calls.push("push");
      sentinel = true;
    },
    onSentinel: () => sentinel,
    back: () => {
      calls.push("back");
      sentinel = false;
    },
  };
  return { calls, history, leaveSentinel: () => (sentinel = false) };
}

/** 可手动落地的确认框（模拟用户点在弹框上） */
function pendingConfirm() {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  return { confirm: vi.fn(() => promise), answer: resolve };
}

/** 让 .then 链跑完（confirm 落地后的历史操作在微任务里） */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("哨兵挂载", () => {
  it("不脏不挂；变脏挂一条；重复变脏不重复挂", () => {
    const { calls, history } = fakeHistory();
    const guard = createBackGuard(history, vi.fn(async () => true));

    guard.setDirty(false);
    expect(calls).toEqual([]);

    guard.setDirty(true);
    guard.setDirty(true);
    expect(calls).toEqual(["push"]);
  });
});

describe("popstate", () => {
  it("没有哨兵：不弹框、不动历史（守卫未覆盖的历史操作）", async () => {
    const { calls, history } = fakeHistory();
    const { confirm } = pendingConfirm();
    const guard = createBackGuard(history, confirm);

    guard.handlePopState();
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("有哨兵 + 取消：重新 push 一条复位，不真正后退", async () => {
    const { calls, history } = fakeHistory();
    const { confirm, answer } = pendingConfirm();
    const guard = createBackGuard(history, confirm);
    guard.setDirty(true);
    calls.length = 0;

    guard.handlePopState(); // 用户后退，落到同 URL 的哨兵条目
    expect(confirm).toHaveBeenCalledTimes(1);
    answer(false);
    await settle();

    expect(calls).toEqual(["push"]); // 复位，没有 back
  });

  it("有哨兵 + 确认：真正 back 一次；紧接着的回声 popstate 不再弹框", async () => {
    const { calls, history } = fakeHistory();
    const { confirm, answer } = pendingConfirm();
    const guard = createBackGuard(history, confirm);
    guard.setDirty(true);
    calls.length = 0;

    guard.handlePopState();
    answer(true);
    await settle();
    expect(calls).toEqual(["back"]);

    guard.handlePopState(); // 自己那次 back 的回声
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["back"]); // 不再退一条
  });

  it("在途期间再按后退：不叠第二个确认框", async () => {
    const { history } = fakeHistory();
    const { confirm, answer } = pendingConfirm();
    const guard = createBackGuard(history, confirm);
    guard.setDirty(true);

    guard.handlePopState();
    guard.handlePopState();
    expect(confirm).toHaveBeenCalledTimes(1);
    answer(false);
    await settle();
  });
});

describe("撤离哨兵", () => {
  it("变干净且仍站在哨兵上：退一条撤掉它，回声被吞", async () => {
    const { calls, history } = fakeHistory();
    const { confirm } = pendingConfirm();
    const guard = createBackGuard(history, confirm);
    guard.setDirty(true);
    guard.setDirty(false);

    expect(calls).toEqual(["push", "back"]);
    guard.handlePopState(); // 撤哨兵那次 back 的回声
    await settle();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("变干净但已离开哨兵（期间有新导航压栈）：不动历史", () => {
    const { calls, history, leaveSentinel } = fakeHistory();
    const guard = createBackGuard(history, vi.fn(async () => true));
    guard.setDirty(true);
    leaveSentinel();

    guard.setDirty(false);
    expect(calls).toEqual(["push"]);
  });

  it("重新挂哨兵时清掉残留的抑制标志（上一条哨兵没等到回声）", async () => {
    const { calls, history } = fakeHistory();
    const { confirm, answer } = pendingConfirm();
    const guard = createBackGuard(history, confirm);
    guard.setDirty(true);
    guard.handlePopState();
    answer(true); // 确认 → back，回声始终没来（无可退条目）
    await settle();
    expect(calls).toEqual(["push", "back"]);

    guard.setDirty(false); // 已不在哨兵上：不动历史
    guard.setDirty(true); // 再次变脏：重新挂，抑制标志清零
    expect(calls).toEqual(["push", "back", "push"]);

    guard.handlePopState(); // 这次后退是真的，要问
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});

describe("卸载", () => {
  it("reset 后 popstate 不再弹框、不再动历史；在途确认落地后也不动", async () => {
    const { calls, history } = fakeHistory();
    const { confirm, answer } = pendingConfirm();
    const guard = createBackGuard(history, confirm);
    guard.setDirty(true);
    guard.handlePopState(); // 确认框在途

    guard.reset();
    answer(true);
    await settle();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["push"]); // 没有 back
  });

  it("reset 时仍站在哨兵上：退一条撤掉（事件监听已移除，URL 不变）", () => {
    const { calls, history } = fakeHistory();
    const guard = createBackGuard(history, vi.fn(async () => true));
    guard.setDirty(true);

    guard.reset();
    expect(calls).toEqual(["push", "back"]);
  });
});