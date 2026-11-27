// 离开守卫接线：纯逻辑在 `lib/leave-guard.ts`，这里只做 React 接线，三件事：
// 1. `useLeaveGuard`：设置页把「任一草稿脏」映射成模块级注册（dirty 时注册、变干净 / 卸载注销），
//    每次渲染刷新确认闭包（同 `use-back-guard` 的 ref 写法：effect 不因闭包身份重挂）；
// 2. `LeaveGuardContext`：设置页内的草稿源报到通道（值 = 报到函数）；
// 3. `useRegisterDirty`：七处草稿源各自把已有的 dirty 判定报到上一级，不 prop 打洞穿过
//    `PiConfigSection` / `BackupSection` 两层壳。
// 三件事同一个文件：都在描述「谁登记 dirty、离开时问谁」，拆开只会让上下文与 hook 分居两处。
import { createContext, useContext, useEffect, useRef } from "react";
import { setLeaveGuard } from "../lib/leave-guard";

/** 草稿源报到：`token` 区分来源（同一源重复报到按最后一次为准），`dirty = false` 即取消 */
export type DirtyReporter = (token: symbol, dirty: boolean) => void;

/** 设置页提供的报到通道；null = 不在设置页内（SSR 走查 / 单独渲染面板）——静默不注册 */
export const LeaveGuardContext = createContext<DirtyReporter | null>(null);

/** 当前页有未保存草稿：注册离开守卫（`confirm` = 真正去问用户的那一句） */
export function useLeaveGuard(dirty: boolean, confirm: () => Promise<boolean>): void {
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;

  useEffect(() => {
    if (!dirty) return;
    setLeaveGuard(() => confirmRef.current());
    return () => setLeaveGuard(null);
  }, [dirty]);
}

/** 草稿源报到自己的 dirty（各组件用它已有的 dirty 判定，不另写一套） */
export function useRegisterDirty(dirty: boolean): void {
  const report = useContext(LeaveGuardContext);
  const tokenRef = useRef<symbol>(Symbol("settings-dirty-source"));

  // 报到（含 dirty 变化）；不在设置页内则什么也不做
  useEffect(() => {
    if (report !== null) report(tokenRef.current, dirty);
  }, [report, dirty]);

  // 卸载（= 草稿随面板一起消失）必须撤回报到，否则那一位会永久拦住离开
  // 与上一条分开：合并成一条会在 dirty 变化时先报 false 再报 true，白抖一次聚合态
  useEffect(() => {
    const token = tokenRef.current;
    return () => {
      if (report !== null) report(token, false);
    };
  }, [report]);
}
