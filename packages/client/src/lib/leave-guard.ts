// 离开守卫（A4）：设置页有七处手写保存的草稿，离开页面（左栏导航 / 浏览器后退）前先问一句。
// 纯逻辑 + 注入式（同 `lib/back-guard.ts` 的风格）：本模块不知道谁在问、也不知道怎么问，
// 只保管「当前页注册的那一个守卫」并串行化确认：
// - 全站只有一个「当前页」——守卫是**模块级单槽**（`setLeaveGuard` 注册 / 注销）；
// - **同一时刻只允许一个在途确认**：后退（popstate）与左栏点击各是一路，靠同一个 promise 收敛
//   ⇒ 只弹一个框，且两路拿到同一个答案（否则会连弹两次）。
// 不依赖 React / window ⇒ 真值表可单测（`leave-guard.test.ts`）；接线见 `hooks/use-leave-guard.ts`。

/** 当前页的离开守卫（null = 没有页面需要拦，离开直接放行） */
let guard: (() => Promise<boolean>) | null = null;
/** 在途确认（并发调用共享它；落地后清空，下次重新问） */
let inflight: Promise<boolean> | null = null;

/** 注册 / 注销当前页的离开守卫（注销不打断在途确认：那个框已经代表用户正在看了） */
export function setLeaveGuard(next: (() => Promise<boolean>) | null): void {
  guard = next;
}

/** 问一句「可以离开吗」：无守卫 → 放行；有守卫 → 转发它的答案；确认在途 → 复用同一个 promise */
export function confirmLeave(): Promise<boolean> {
  if (inflight !== null) return inflight;
  const current = guard;
  if (current === null) return Promise.resolve(true);
  // finally 的回调先于 pending 落地执行 ⇒ 解锁不需要比对身份（同一时刻只有一个在途）
  const pending = current().finally(() => {
    inflight = null;
  });
  inflight = pending;
  return pending;
}
