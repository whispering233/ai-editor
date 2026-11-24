// 退出次序（`docs/design/50-desktop.md` §1.1）：菜单「退出」走 `app.quit()`，而 `before-quit` **先于**
// 窗口的 `close` 事件触发 ⇒ 那时关掉服务端就是抢在「关窗前 flush」之前（落盘还要打 HTTP）。
// 次序本身是看不见的（typecheck / 单测都不会红），所以判定抽成纯函数并单测钉住。
export function shouldCloseServerOnBeforeQuit(windowCount: number): boolean {
  return windowCount === 0;
}

// 关窗时是否跳过 flush：服务端**已被主动关掉**时，渲染侧那次保存 PUT 必然失败 ⇒ 弹「保存未完成」是
// 假警报，而且选「留在这里」会取消整个 quit（安装器其实已经拉起，安装就停在半路）。两条先关后退的路径：
// `updater.ts` 的 `quitAndInstall`、切换书库的 `app.relaunch` + `app.quit`——次序不能改（`50-desktop.md` §1.1）。
export function shouldSkipFlushOnClose({ flushed, serverClosing }: {
  flushed: boolean;
  serverClosing: boolean;
}): boolean {
  return flushed || serverClosing;
}