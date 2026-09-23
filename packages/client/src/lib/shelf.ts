// 书架行判定（纯函数）。
//
// 为什么落在 lib/ 的纯函数里而不是页面组件里：client 无 jsdom，zustand 的 SSR 快照读不到
// 预置的书架 state（预置值只能在纯函数层测），判定逻辑必须可单测。
import type { ProjectListBook } from "@whispering233/ai-editor-shared";

/**
 * 当前打开的书是不是这一行（高亮 / 「已打开」徽标 / 打开语义的唯一判据）。
 *
 * 判据 = **项目 id**（`project.json` 的 id），**不得**改用书名或目录名：同名不同 id 的两本书并存时
 *（「保持原样导入」会去重命名，但同 id 覆盖恢复也会换到另一个目录），按 name 会把高亮发到错的
 * 那一行（卡 23.2 oracle 登记的防御用例）。未打开项目（`config === null`）→ 恒不高亮。
 */
export function isCurrentBook(
  book: Pick<ProjectListBook, "id">,
  config: { id: string } | null,
): boolean {
  return config !== null && book.id === config.id;
}
