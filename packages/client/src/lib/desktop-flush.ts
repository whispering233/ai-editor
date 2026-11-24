// 桌面关窗前落盘（`docs/design/50-desktop.md` §1.1）：`triggerSaveShortcut()` 的结果 → 是否落盘成功。
// 口径：`null` = 本页没有注册保存动作（无内容要落盘，视为成功）；`undefined` / `true` = 成功；
// `false`（页面失败分支的契约义务，见 `save-shortcut.ts` 的 SaveHandler）或 reject = 失败。
export async function flushSucceeded(save: Promise<void | boolean> | null): Promise<boolean> {
  if (save === null) return true;
  try {
    return (await save) !== false;
  } catch {
    return false;
  }
}