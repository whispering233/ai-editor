// 工作区类型（`kind`）的客户端常量与纯函数（卡 8：根首页分区 + 打开落点）。
//
// 为什么落在 lib/ 的纯函数里：client 无 jsdom，zustand 的 SSR 快照读不到预置的书架 state，
// 分区与落点判定必须在纯函数层才测得到（同 lib/shelf.ts 的理由）。
// 左栏项集（含 JSX 图标）不在这里：见 `components/nav/nav-items.tsx`；路由守卫见
// `lib/workspace-route-guard.ts`。
import { WORKSPACE_KIND_LABELS, type ProjectListBook, type WorkspaceKind } from "@whispering233/ai-editor-shared";

/**
 * 打开工作区后的默认落点（根首页行点击 / 开机直达共用）。
 *
 * 练习工作区没有「项目概览」（概览的四个区块全是小说语义，服务端会以 `KIND_MISMATCH` 拒绝），
 * 它的落点是自己唯一的页面 `#/practice`。
 */
export const WORKSPACE_ENTRY_PATH: Record<WorkspaceKind, string> = {
  novel: "/overview",
  practice: "/practice",
};

/** 根首页分区标题（取 shared `WORKSPACE_KIND_LABELS`——与服务端 `KIND_MISMATCH` 文案同一份中文名，
 * 禁止在此手抄字面量） */
export const WORKSPACE_SECTION_TITLE: Record<WorkspaceKind, string> = WORKSPACE_KIND_LABELS;

/** 练习分区空的引导文案（DESIGN.md §根首页：空分区给一行 caption-text，不渲染空卡片） */
export const PRACTICE_EMPTY_HINT = "还没有练习区，先新建一个";

/**
 * 根首页分区：按 `kind` 切分 `GET /project/list` 的 `books`。
 *
 * 只做分组、**不重排**（服务端已按 `updatedAt` 倒序跨目录统一排序）；`kind` 是服务端
 * `resolveWorkspaceKind` 兜底后的**恒下发字段**，客户端不二次兜底（见 `types/api.ts` 的
 * `projectListResSchema`）。
 */
export function partitionWorkspaces(
  books: readonly ProjectListBook[] | null,
): Record<WorkspaceKind, ProjectListBook[]> {
  const partitions: Record<WorkspaceKind, ProjectListBook[]> = { novel: [], practice: [] };
  for (const book of books ?? []) partitions[book.kind].push(book);
  return partitions;
}
