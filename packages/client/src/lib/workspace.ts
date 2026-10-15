// 工作区类型（`kind`）的客户端常量与纯函数（根首页分区 + 打开落点 + 预置作家卡）。
//
// 为什么落在 lib/ 的纯函数里：client 无 jsdom，zustand 的 SSR 快照读不到预置的书架 state，
// 分区、卡片合并与落点判定必须在纯函数层才测得到（同 lib/shelf.ts 的理由）。
// 左栏项集（含 JSX 图标）不在这里：见 `components/nav/nav-items.tsx`；路由守卫见
// `lib/workspace-route-guard.ts`。
import {
  AUTHOR_CATALOG,
  AUTHOR_IDS,
  formatRelativeTime,
  resolveAuthor,
  WORKSPACE_KIND_LABELS,
  type AuthorEntry,
  type ProjectListBook,
  type WorkspaceKind,
} from "@whispering233/ai-editor-shared";

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

/**
 * 根首页分区：按 `kind` 切分 `GET /project/list` 的 `books`。
 *
 * 只做分组、**不重排**（服务端已按 `updatedAt` 倒序跨目录统一排序）；`kind` 是服务端
 * `resolveWorkspaceKind` 兜底后的**恒下发字段**，客户端不二次兜底（见 `types/api.ts` 的
 * `projectListResSchema`）。练习分区**不直接渲染本结果**——它的卡片由 `practiceAuthorCards`
 * 合并预置作家清单后给出（存量未识别工作区的过滤也在那里）。
 */
export function partitionWorkspaces(
  books: readonly ProjectListBook[] | null,
): Record<WorkspaceKind, ProjectListBook[]> {
  const partitions: Record<WorkspaceKind, ProjectListBook[]> = { novel: [], practice: [] };
  for (const book of books ?? []) partitions[book.kind].push(book);
  return partitions;
}

/** 一张根首页练习分区的卡片：`workspace === null` = 未开始（这位作家还没有工作区） */
export interface PracticeAuthorCard {
  author: AuthorEntry;
  workspace: ProjectListBook | null;
}

/**
 * 根首页练习分区的卡列表 = 全部预置作家 ∪ 已有练习工作区（`60-practice.md` §2）：
 *
 * - **未识别 `authorId` 的练习工作区不列出**（缺失 / 未知 = 存量目录；服务端照列、客户端过滤，
 *   目录留盘、备份与云端份不受影响）——判据只有 `resolveAuthor` 一处，不做名字认领。
 * - 顺序：已有数据的在前（`updatedAt` 倒序；`GET /project/list` 已按它排，这里只保持遍历顺序），
 *   未开始的按预置清单顺序（`AUTHOR_IDS`）垫后。
 * - 同一作家只出一张卡（同名重名工作区取列表里最新的那个，不在 UI 里产生第二张同名卡）。
 */
export function practiceAuthorCards(
  books: readonly ProjectListBook[] | null,
): PracticeAuthorCard[] {
  const started: PracticeAuthorCard[] = [];
  const seen = new Set<string>();
  for (const workspace of books ?? []) {
    if (workspace.kind !== "practice") continue;
    const author = resolveAuthor(workspace.authorId);
    if (author === null || seen.has(author.id)) continue;
    seen.add(author.id);
    started.push({ author, workspace });
  }
  const unstarted: PracticeAuthorCard[] = AUTHOR_IDS.filter((id) => !seen.has(id)).map((id) => ({
    author: AUTHOR_CATALOG[id],
    workspace: null,
  }));
  return [...started, ...unstarted];
}

/**
 * 卡片状态行：未开始 / `N 篇范文 · 最近更新 …`。
 *
 * `sampleCount` 只在**当前打开的那个练习工作区**上拿得到（样本列表端点读的是当前工作区，
 * `GET /project/list` 不带样本数）——未知时省略该段，不猜数字。
 */
export function practiceCardStatus(card: PracticeAuthorCard, sampleCount: number | null): string {
  if (card.workspace === null) return "未开始";
  const parts = sampleCount === null ? [] : [`${sampleCount} 篇范文`];
  parts.push(`最近更新 ${formatRelativeTime(card.workspace.updatedAt)}`);
  return parts.join(" · ");
}

/** 作家未解析（`author_id` 缺失 / 未知）时，三个素材页共用的空态文案（不崩、不空白） */
export const AUTHOR_MISSING_HINT = "这个工作区没有关联到预置作家，素材不可用";
