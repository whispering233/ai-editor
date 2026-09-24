// 小说文档导出（markdown 卷/章目录树）纯函数：命名、编号与正文口径见
// `docs/api/10-api-project.md` §`GET /api/v1/project/export-novel`。
//
// **不 import zod / 不 import Node 内置**：纯函数，服务端（zip 组装）与客户端皆可经 shared 根入口消费。
// **编号不得在本模块重算**：卷号 / 章号 / 章 → 卷归属一律取 `numberVisibleOutline`（`outline-numbering.ts`）
// 的结果——软删节点、直挂 root 的章都在那里处理过。

import { sanitizeDocumentFileName } from "./file-name.js";
import type { VisibleOutlineNumbering } from "./outline-numbering.js";

/**
 * zip 条目：`dir` = 目录（**只有无可见章的卷**才显式产出，`path` 以 `/` 结尾）；
 * `chapter` = 章文件（`path` 以 `.md` 结尾，其余字段供调用点取正文投影）。
 */
export type NovelExportEntry =
  | { kind: "dir"; path: string }
  | {
      kind: "chapter";
      path: string;
      chapterId: string;
      chapterLabel: string;
      chapterTitle: string;
    };

/** `第N卷 卷名` / `第M章 章名`：名字 trim 后为空 → **只留标签**（不写「未命名」）；名字经 sanitize */
function labeledSegment(label: string, name: string): string {
  const trimmed = name.trim();
  return trimmed === "" ? label : `${label} ${sanitizeDocumentFileName(trimmed)}`;
}

/**
 * 书名 + 展示编号 → zip 条目序列（**顺序 = 卷序 → 卷内章序 → 直挂 root 的章**）：
 *
 * - 章文件 `path` = `{书名}/{第N卷 卷名}/{第M章 章名}.md`；存量**直挂 root 的章** = `{书名}/{第M章 章名}.md`
 * - 卷目录 = `第N卷 卷名`；**无可见章的卷**产出一条 `{书名}/{第N卷 卷名}/` 空目录条目，有章的卷不产目录条目
 * - 场景不产出文件（正文只能挂章）；软删卷 / 软删章不进条目（编号侧已过滤）
 */
export function buildNovelExportEntries(
  bookName: string,
  numbering: VisibleOutlineNumbering,
): NovelExportEntry[] {
  const bookDir = sanitizeDocumentFileName(bookName);
  const chaptersOf = (volumeId: string) =>
    numbering.chapters.filter((chapter) => chapter.volumeId === volumeId);
  const entries: NovelExportEntry[] = [];
  for (const volume of numbering.volumes) {
    const volumeDir = labeledSegment(volume.volumeLabel, volume.volumeTitle);
    const chapters = chaptersOf(volume.volumeId);
    if (chapters.length === 0) {
      entries.push({ kind: "dir", path: `${bookDir}/${volumeDir}/` });
      continue;
    }
    for (const chapter of chapters) {
      entries.push({
        kind: "chapter",
        path: `${bookDir}/${volumeDir}/${labeledSegment(chapter.chapterLabel, chapter.chapterTitle)}.md`,
        chapterId: chapter.chapterId,
        chapterLabel: chapter.chapterLabel,
        chapterTitle: chapter.chapterTitle,
      });
    }
  }
  for (const chapter of chaptersOf("")) {
    entries.push({
      kind: "chapter",
      path: `${bookDir}/${labeledSegment(chapter.chapterLabel, chapter.chapterTitle)}.md`,
      chapterId: chapter.chapterId,
      chapterLabel: chapter.chapterLabel,
      chapterTitle: chapter.chapterTitle,
    });
  }
  return entries;
}

/**
 * 章文件正文：`# 第M章 章名` + **一个空行** + 正文原样；正文为空（含纯空白）→ 只留标题行（无尾随换行）。
 * 标题用**原始章名**（trim 后，不走 sanitize——md 标题不是文件名）；章名空 → `# 第M章`。
 */
export function buildNovelChapterMarkdown(
  chapterLabel: string,
  chapterTitle: string,
  text: string,
): string {
  const title = chapterTitle.trim();
  const heading = title === "" ? `# ${chapterLabel}` : `# ${chapterLabel} ${title}`;
  return text.trim() === "" ? heading : `${heading}\n\n${text}`;
}

/** 下载文件名：`{sanitize(书名)}-小说文档.zip` */
export function novelExportZipFileName(bookName: string): string {
  return `${sanitizeDocumentFileName(bookName)}-小说文档.zip`;
}
