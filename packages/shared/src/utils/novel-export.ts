// 小说导出纯函数：markdown 卷/章目录树（zip）与整本 / 单章纯文本（TXT）两套产物。
// 命名、编号与正文口径见 `docs/api/10-api-project.md` §`GET /api/v1/project/export-novel` /
// §`GET /api/v1/project/export-novel-txt`。
//
// **不 import zod / 不 import Node 内置**：纯函数，服务端（zip 组装）与客户端皆可经 shared 根入口消费。
// **编号不得在本模块重算**：卷号 / 章号 / 章 → 卷归属一律取 `numberVisibleOutline`（`outline-numbering.ts`）
// 的结果——软删节点、直挂 root 的章都在那里处理过。

import { sanitizeDocumentFileName } from "./file-name.js";
import type { VisibleOutlineNumbering } from "./outline-numbering.js";

/** 纯文本导出排版（`layout` 查询参数取值；唯一来源——schema / 服务端 / 客户端都派生自此） */
export const NOVEL_TXT_LAYOUTS = ["preserve", "webnovel"] as const;

/** 纯文本排版：`preserve` = 正文原样；`webnovel` = 段首两个全角空格、段间不空行 */
export type NovelTxtLayout = (typeof NOVEL_TXT_LAYOUTS)[number];

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

/**
 * 纯文本块（**顺序 = 阅读序**，由调用方排好）：`label` = 完整标题行（`第N卷 卷名` / `第M章 章名`，
 * 名字已由调用方按「trim 后为空只留标签」拼好、**不经 sanitize**——标题不是文件名）。
 *
 * 只有这两种块：卷标题独占一行，章 = 标题行 + 正文；书名 / 目录 / 页眉都不进文件。
 */
export type NovelTxtBlock =
  | { kind: "volume"; label: string }
  | { kind: "chapter"; label: string; text: string };

/** 代码围栏起始行（围栏内行原样保留、不缩进） */
const FENCE_LINE = /^\s*(```|~~~)/;

/**
 * 非段落块的段首标记（v1 启发式，误判边界见 `docs/design/backlog.md`）：标题 `#` / 列表 `- ` `1. ` /
 * 引用 `> ` / 表格 `|` / 图片 `![` / 分隔线 `---`；代码围栏由 `FENCE_LINE` 单独处理。
 */
const NON_PARAGRAPH_LINE = /^(#|-\s|\d+[.)]\s|>\s?|\||!\[|---)/;

/**
 * 网文排版：普通段落去行首空白 + 两个全角空格，连续段落之间不空行；非段落块原样保留（不缩进）
 * 且与前后内容空一行；空行本身不输出（由段落 / 块分组决定）。
 */
function formatWebnovel(text: string): string {
  const out: string[] = [];
  /** 上一个输出单元的类别：`null` = 尚无输出（块首不插空行） */
  let previous: "paragraph" | "block" | null = null;
  /** 上一行之后是否见过空行（`content_text` 的块间分隔 = 不同块的边界） */
  let gap = false;
  let inFence = false;
  const blankLine = () => {
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
  };
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (inFence) {
      out.push(raw); // 代码围栏内原样（含空行、不缩进）
      if (FENCE_LINE.test(raw)) {
        inFence = false;
        previous = "block";
        gap = false;
      }
      continue;
    }
    const line = raw.trimEnd();
    const head = line.trimStart();
    if (head === "") {
      gap = true; // 空行只是分隔符（网文排版自管空行）
      continue;
    }
    if (FENCE_LINE.test(line)) {
      if (previous === "paragraph" || (previous === "block" && gap)) blankLine();
      out.push(line);
      inFence = true;
      previous = "block";
      gap = false;
      continue;
    }
    if (NON_PARAGRAPH_LINE.test(head)) {
      // 段落 → 块：必空一行；块 → 块：只有原文有空行（= 不同块）才空一行（列表 / 表格内部行不拆）
      if (previous === "paragraph" || (previous === "block" && gap)) blankLine();
      out.push(line);
      previous = "block";
      gap = false;
      continue;
    }
    if (previous === "block") blankLine();
    out.push(`　　${head}`);
    previous = "paragraph";
    gap = false;
  }
  return out.join("\n");
}

/** 所有换行归一为 CRLF（TXT 出口契约：CRLF，不看输入是 `\n` / `\r\n` / `\r`） */
function toCrlf(text: string): string {
  return text.replace(/\r\n|\r|\n/g, "\r\n");
}

/**
 * 阅读序块 → 整本 TXT 文本：UTF-8 无 BOM、CRLF、**末尾一个换行**。
 *
 * - 块之间一个空行；章 = 标题行 + 一个空行 + 正文（空章只有标题行，不产出空文件）
 * - `preserve`：正文原样（段间空行保留），只去掉正文末尾空白（避免与下一块的空行叠加）
 * - `webnovel`：正文交给 `formatWebnovel`（段首缩进 / 段间不空行 / 非段落块前后空行）
 * - 不做额外包装：不写书名、不写目录、标题行不带 `#`
 */
export function buildNovelTxt(
  blocks: readonly NovelTxtBlock[],
  layout: NovelTxtLayout,
): string {
  const units: string[] = [];
  for (const block of blocks) {
    if (block.kind === "volume") {
      units.push(block.label.trim());
      continue;
    }
    const body =
      block.text.trim() === ""
        ? ""
        : layout === "webnovel"
          ? formatWebnovel(block.text)
          : block.text.trimEnd();
    units.push(body === "" ? block.label.trim() : `${block.label.trim()}\n\n${body}`);
  }
  if (units.length === 0) return "";
  return `${toCrlf(units.join("\n\n")).replace(/(?:\r\n)+$/, "")}\r\n`;
}

/** 纯文本下载文件名：`{sanitize(书名)}.txt` / `{sanitize(书名)}-网文.txt`（空书名 → 未命名） */
export function novelTxtFileName(bookName: string, layout: NovelTxtLayout): string {
  const base = sanitizeDocumentFileName(bookName);
  return layout === "webnovel" ? `${base}-网文.txt` : `${base}.txt`;
}
