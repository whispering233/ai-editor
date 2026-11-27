// 确认框的关闭判定（纯函数，可单测；接线在 `components/outline/dialogs.tsx` 的 `ConfirmDialog`）。
//
// 为什么要有这一行：确认框在途（`submitting`）时被 `Esc` / 点遮罩 / 关闭钮关掉，会让
// 「请求还在跑、框已经没了、失败文案无处落」——用户既不知道删没删掉，也看不到错误。
// 导出框（`components/shelf/export-book-dialog.tsx`）早就是这个口径（`if (exporting) return`），
// 本函数把同一条约定变成可断言的一条，免得下一个确认框再漏一遍。
//
// 只看「请求关闭」这一个方向：打开方向由调用点自己处理（`next === true` 一律不关，也不做事）。

export function canCloseConfirm(submitting: boolean, next: boolean): boolean {
  if (next) return false;
  return !submitting;
}