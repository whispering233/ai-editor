// 预置作家清单（封闭集合）——「新增作家 = 新增一个素材文件 + 清单一行」，无迁移。
//
// 这是**唯一**的作家 / 作品事实源：客户端页面与作品下拉、服务端解析守卫、AI 工具
// 都读它（`docs/design/60-practice.md` §2 / §3）。
import type { AuthorEntry, AuthorId, PracticeWork } from "./types.js";
import { JIANGNAN } from "./jiangnan.js";

/** 「其他」兜底文案：作品 id 未选 / 未知（预置被移除）时用；唯一定义处，客户端与服务端都取它 */
export const PRACTICE_OTHER_WORK_LABEL = "其他";

/** `satisfies` 而非类型标注：保住字面量键 ⇒ `AuthorId` 是 id 联合而非 `string` */
export const AUTHOR_CATALOG = {
  jiangnan: JIANGNAN,
} satisfies Record<string, AuthorEntry>;

/** 全部预置作家 id（顺序 = 清单声明顺序；根首页练习分区按它排） */
export const AUTHOR_IDS = Object.keys(AUTHOR_CATALOG) as AuthorId[];

/** 按 id 解析预置作家：未知值 / 非字符串 / 原型键 → null（不做名字认领） */
export function resolveAuthor(value: unknown): AuthorEntry | null {
  if (typeof value !== "string" || !Object.hasOwn(AUTHOR_CATALOG, value)) return null;
  return (AUTHOR_CATALOG as Record<string, AuthorEntry>)[value] ?? null;
}

/** 按作家 id + 作品 id 解析作品：跨作者、未知 id 一律 null（列表按「其他」渲染） */
export function resolveWork(authorId: string, workId: string): PracticeWork | null {
  const author = resolveAuthor(authorId);
  if (author === null) return null;
  return author.works.find((work) => work.id === workId) ?? null;
}