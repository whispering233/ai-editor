// 退出次序（`docs/design/50-desktop.md` §1.1）：菜单「退出」走 `app.quit()`，而 `before-quit` **先于**
// 窗口的 `close` 事件触发 ⇒ 那时关掉服务端就是抢在「关窗前 flush」之前（落盘还要打 HTTP）。
// 次序本身是看不见的（typecheck / 单测都不会红），所以判定抽成纯函数并单测钉住。
export function shouldCloseServerOnBeforeQuit(windowCount: number): boolean {
  return windowCount === 0;
}