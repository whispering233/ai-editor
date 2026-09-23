// 查询类工具：推演节点标记只读
// get_deduction_marks——作者在大纲树上标定的「推演边界」（project.json `deduction_nodes`）。
//
// 口径（docs/api/tool-calling.md「推演节点」、docs/design/10-data-model.md §15）：
// - 标记的**角色 / 文案 / 章号 / 顺序一律来自 shared `buildDeductionMarks`**（唯一编号口径
//   `orderVisibleChapters` 的下游），本文件不重算章号、不手抄徽标文案；软删与已 purge 的 id
//   在读侧过滤（不变式 6：读侧过滤，不自动清理）
// - `path` = 根 → 章的标题链**去掉虚拟 root**（卷标题 + 章标题；存量直挂 root 的章只有章标题）
// - `spans[]` = 相邻标记之间的区间骨架：`middle` = 可见章先序中**严格位于两端之间**的章
//   （不含两端标记），`chapter_count` = `middle.length`，`written_chapters` = `middle` 中
//   正文投影（`document_records.content_text`）非空的章数
// - **只读**：工具面没有任何增删推演节点的提案 / 执行工具——推演边界是作者的判断

import {
  findOutlineNode,
  getDocumentTextLengths,
  getOutlinePathIds,
  readOutlineFile,
  readProjectFile,
} from "@whispering233/ai-editor-db";
import { buildDeductionMarks, orderVisibleChapters } from "@whispering233/ai-editor-shared";
import type { DeductionMarkRole, OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";

/** 一个推演标记（get_deduction_marks `marks[]` 项；字段与工具目录逐字对齐） */
export interface DeductionMarkEntry {
  /** 标记在本次标记集合中的位置（1-based；树序） */
  index: number;
  role: DeductionMarkRole;
  node_id: string;
  /** 可见章先序编号（跨卷连续；只计未软删章——与 UI 徽标同口径） */
  chapter_number: number;
  /** 卷 → 章 的标题链（不含虚拟 root；存量直挂 root 的章只有自身标题） */
  path: string[];
  title: string;
  /** 章摘要（outline.json 节点 `summary`）；缺失则不写该键 */
  summary?: string;
}

/** 区间内的中间章（`spans[].middle` 项） */
export interface DeductionSpanChapter {
  node_id: string;
  chapter_number: number;
  title: string;
}

/** 相邻标记之间的区间骨架（get_deduction_marks `spans[]` 项） */
export interface DeductionSpan {
  from_index: number;
  to_index: number;
  /** = `middle.length`（区间内章数，**不含两端标记**） */
  chapter_count: number;
  /** `middle` 中正文投影非空的章数（**不含两端标记**） */
  written_chapters: number;
  middle: DeductionSpanChapter[];
}

/** get_deduction_marks 结果 */
export interface DeductionMarksResult {
  marks: DeductionMarkEntry[];
  spans: DeductionSpan[];
}

/** 根 → 节点的标题链（去掉虚拟 root；`getOutlinePathIds` 契约 = path[0] 是 root） */
function outlinePathTitles(tree: OutlineFileTree, nodeId: string): string[] {
  return getOutlinePathIds(tree, nodeId)
    .slice(1)
    .map((id) => findOutlineNode(tree, id)?.title ?? id);
}

/**
 * 推演标记与相邻区间骨架（get_deduction_marks()，无参）。
 * 无标记 / 标记全部失效（不存在、软删、非章）→ `{ marks: [], spans: [] }`（不报错）；
 * 单标记 → `spans` 为空（开放式发散没有区间）。
 */
export function runGetDeductionMarks(ctx: ToolContext): DeductionMarksResult {
  const tree = readOutlineFile(ctx.outlineDir);
  const markedIds = readProjectFile(ctx.outlineDir)?.deduction_nodes ?? [];
  const marks = buildDeductionMarks(tree, markedIds); // 失效 id 已过滤、已按树序排序、章号来自可见章先序
  if (marks.length === 0) return { marks: [], spans: [] };

  const entries: DeductionMarkEntry[] = marks.map((mark) => {
    const entry: DeductionMarkEntry = {
      index: mark.index,
      role: mark.role,
      node_id: mark.nodeId,
      chapter_number: mark.chapterNumber,
      path: outlinePathTitles(tree, mark.nodeId),
      title: mark.title,
    };
    const summary = findOutlineNode(tree, mark.nodeId)?.summary;
    if (summary !== undefined) entry.summary = summary;
    return entry;
  });

 // 区间 = 相邻标记之间：可见章先序切片（左开右开 ⇒ 两端标记天然不在 middle 里）
  const visibleChapters = orderVisibleChapters(tree);
  const spans: DeductionSpan[] = [];
  for (let i = 1; i < entries.length; i++) {
    const start = visibleChapters.indexOf(entries[i - 1].node_id) + 1;
    const end = visibleChapters.indexOf(entries[i].node_id);
    const middle: DeductionSpanChapter[] = visibleChapters.slice(start, end).map((id, offset) => ({
      node_id: id,
      chapter_number: start + offset + 1, // 章号 = 可见章先序下标 + 1（唯一编号口径）
      title: findOutlineNode(tree, id)?.title ?? id,
    }));
    const textLengths = getDocumentTextLengths(ctx.db, "chapter", middle.map((chapter) => chapter.node_id));
    spans.push({
      from_index: entries[i - 1].index,
      to_index: entries[i].index,
      chapter_count: middle.length,
      written_chapters: middle.filter((chapter) => (textLengths.get(chapter.node_id) ?? 0) > 0).length,
      middle,
    });
  }

  return { marks: entries, spans };
}
