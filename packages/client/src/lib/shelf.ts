// 书架分组（卡 23.2）：书架行按项目 `origin` 分两组——「小说项目」（手建 / 导入）与
// 「小说拆解」（拆解建档）。口径出处：docs/ui/DESIGN.md §书架主页（两组小标题、空组不渲染）。
//
// 为什么落在 lib/ 的纯函数里而不是页面组件里：client 无 jsdom，zustand 的 SSR 快照读不到
// 预置的书架 state（pages/dashboard-decompose.test.ts 已踩过），分组逻辑必须可单测。
import type { ProjectListBook, ProjectOrigin } from "@whispering233/ai-editor-shared";

/** 分组展示顺序 + 组标题（**单一定义**：组序与文案只在此处；空组由 groupShelfBooks 丢弃） */
const SHELF_GROUPS = [
  { origin: "book", label: "小说项目" },
  { origin: "decompose", label: "小说拆解" },
] as const satisfies readonly { origin: ProjectOrigin; label: string }[];

/** 书架的一组（组标题 + 组内书） */
export interface ShelfGroup {
  origin: ProjectOrigin;
  /** 组小标题（「小说项目」/「小说拆解」） */
  label: string;
  /** 组内书（**保持传入顺序**——排序由服务端保证，前端不再排） */
  books: ProjectListBook[];
}

/** 按 `origin` 分组：固定顺序 [小说项目, 小说拆解]，**空组不渲染**（返回时丢弃），组内保持传入顺序 */
export function groupShelfBooks(books: readonly ProjectListBook[]): ShelfGroup[] {
  return SHELF_GROUPS.map((group) => ({
    origin: group.origin,
    label: group.label,
    books: books.filter((book) => book.origin === group.origin),
  })).filter((group) => group.books.length > 0);
}
