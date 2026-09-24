// 大纲展示编号（卷号 + 章号）派生纯函数。语义见 `docs/design/10-data-model.md` §4（UI 展示编号 ≠
// 服务端 `deriveChapterOrder`）、§15；渲染形态见 `docs/ui/DESIGN.md` §`type-badge`。
//
// **章序唯一来源 = `deduction.ts` 的 `orderVisibleChapters`**（可见章先序：只计未软删章、含存量直挂
// root 的章、软删节点的整棵子树跳过）——本模块只补「卷号」与「章 → 所属卷」归属，不得另写一套章号遍历。
// **卷号规则只在本模块出现一处**（大纲页徽标、小说文档导出的卷目录名都消费本函数）。
//
// **不 import zod / 不 import Node 内置**：纯函数，客户端可安全经 shared 根入口打包。

import { orderVisibleChapters } from "./deduction.js";
import type { DeductionTreeLike } from "./deduction.js";

/** 卷编号：顶层可见卷的树序 1-based，`volumeLabel` = `第N卷` */
export interface OutlineVolumeNumber {
  volumeId: string;
  volumeTitle: string;
  volumeLabel: string;
}

/** 章编号：`chapterLabel` = `第M章`（M = 可见章先序位置，跨卷连续） */
export interface OutlineChapterNumber {
  chapterId: string;
  chapterTitle: string;
  /** 章编号徽标文案（`第M章`） */
  chapterLabel: string;
  /** 所属卷 id；**存量直挂 root 的章** = `""` */
  volumeId: string;
  /** 所属卷的编号徽标文案；直挂 root 的章 = `""` */
  volumeLabel: string;
  /** 所属卷标题；直挂 root 的章 = `""` */
  volumeTitle: string;
}

/** 展示编号结果（调用方按 id 查卷号 / 按阅读序读章节） */
export interface VisibleOutlineNumbering {
  volumes: OutlineVolumeNumber[];
  chapters: OutlineChapterNumber[];
}

/** 章 → 归属卷（含章标题）；直挂 root 的章 = 卷三项皆空串 */
type ChapterOwner = Pick<
  OutlineChapterNumber,
  "chapterTitle" | "volumeId" | "volumeLabel" | "volumeTitle"
>;

/**
 * 推导大纲**展示编号**（卷序 + 章序）：
 *
 * - `volumes` = 顶层**可见**卷按树序 1-based；**无可见章的卷照样占号**（树视图徽标不能丢）
 * - `chapters` = `orderVisibleChapters` 顺序（跨卷连续，含存量直挂 root 的章；下标即章号）
 * - 直挂 root 的章：`volumeId` / `volumeLabel` / `volumeTitle` = `""`
 * - 软删节点及其整棵子树跳过；`null` / 空树 → 两数组皆空
 */
export function numberVisibleOutline(tree: DeductionTreeLike | null): VisibleOutlineNumbering {
  const volumes: OutlineVolumeNumber[] = [];
  // 归属只认「顶层卷的直接章子节点」与「顶层直挂章」（严格三层的数据契约下即全部章）；
  // 畸形树（卷下套卷、root 直挂场景）无合法归属 ⇒ 不入编号——宁可不出行，也不给错归属
  const owners = new Map<string, ChapterOwner>();
  for (const node of tree?.children ?? []) {
    if (node.deleted === true) continue;
    if (node.type === "chapter") {
      // 存量直挂 root 的章（读容忍）：参与章序，无卷号
      owners.set(node.id, {
        chapterTitle: node.title,
        volumeId: "",
        volumeLabel: "",
        volumeTitle: "",
      });
      continue;
    }
    if (node.type !== "volume") continue;
    const volumeLabel = `第${volumes.length + 1}卷`;
    volumes.push({ volumeId: node.id, volumeTitle: node.title, volumeLabel });
    for (const child of node.children ?? []) {
      if (child.deleted === true || child.type !== "chapter") continue;
      owners.set(child.id, {
        chapterTitle: child.title,
        volumeId: node.id,
        volumeLabel,
        volumeTitle: node.title,
      });
    }
  }
  const chapters: OutlineChapterNumber[] = [];
  orderVisibleChapters(tree).forEach((chapterId, i) => {
    const owner = owners.get(chapterId);
    if (owner === undefined) return; // 无归属的章：不成行（章号仍按其先序下标，不因跳过而重排）
    chapters.push({
      chapterId,
      chapterLabel: `第${i + 1}章`,
      chapterTitle: owner.chapterTitle,
      volumeId: owner.volumeId,
      volumeLabel: owner.volumeLabel,
      volumeTitle: owner.volumeTitle,
    });
  });
  return { volumes, chapters };
}
