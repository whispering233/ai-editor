// 离开闸门（唯一入口）：把「注册模块槽」与「拦浏览器后退」合成一个调用点。
//
// 为什么必须合并：两个 hook 并存时，后退那一路要在调用点决定第二个参数传**哪个** confirm——
// 传页面本地的 `confirmDiscard` 会绕过 `lib/leave-guard.ts` 的在途单槽（同一时刻弹两个框），
// 传模块级的 `confirmLeave` 才对。两个参数名看不出差别，实测三个调用点里两个传错。
// 合并后后退恒走 `confirmLeave()`，调用点没有选择的余地。
//
// 职责分层（纯逻辑不搬进来）：
// - `lib/leave-guard.ts`：模块级单槽 + 同一时刻只允许一个在途确认；
// - `lib/back-guard.ts`：哨兵历史条目 + popstate；
// - `hooks/use-leave-guard.ts` / `hooks/use-back-guard.ts`：两个薄接线层，本文件是它们唯一的调用点。
//   其余代码一律用本 hook（`design-discipline.test.ts` 的 `unsaved-guard-shell` 守住）。
import { useBackGuard } from "./use-back-guard";
import { useLeaveGuard } from "./use-leave-guard";
import { confirmLeave } from "../lib/leave-guard";

/**
 * 当前页有脏表单：注册离开闸门。
 *
 * @param dirty 未保存判定（由持有表单的**叶子组件**提供，不另算一套）
 * @param confirm 真正去问用户的那一句（返回 true = 可以离开）
 *
 * 注册者恒为 1：谁持有脏表单谁调用，页面壳不得代注册（模块槽是单槽、后来者静默覆盖）。
 */
export function useUnsavedGuard(dirty: boolean, confirm: () => Promise<boolean>): void {
  useLeaveGuard(dirty, confirm);
  // 后退不传 `confirm`：必须走模块级 `confirmLeave`，与左栏点击共享同一个在途确认
  useBackGuard(dirty, confirmLeave);
}