// 写作页卷章导航栏的行派生（2026-11）。契约：docs/ui/DESIGN.md `writing-page`。
//
// **顺序 = 阅读序 = outline.children 文件序**：卷行 → 该卷可见章行；存量根级章（2026-09 前
// 直挂 root 的读容忍数据）在顶层原位置就地显示，**不造「未分卷」伪卷、不按 chapterRows 重组**
// （chapterRows 只含「有卷归属」的章，根级章会被丢掉或错序）。
//
// 徽标文案一律查 `numberOutline(outline).labels`（展示口径，只计未软删节点 ⇒ 删后重排；
// 编号单源 = shared `outline-numbering.ts`），本模块不另写编号规则。
import type {
  OutlineChapter,
  OutlineTree,
} from "@whispering233/ai-editor-shared";
import { numberOutline } from "./outline-tree";

/** 卷行：只做折叠分组与「N章」计数（rail 不是大纲页，无结构编辑能力） */
export interface WritingRailVolumeRow {
  kind: "volume";
  id: string;
  /** 展示编号徽标（`第N卷`） */
  label: string;
  title: string;
  /** 非软删章子节点数（0 章卷保留卷行） */
  chapterCount: number;
}

/** 章行：点击进正文（`#/writing/:id`） */
export interface WritingRailChapterRow {
  kind: "chapter";
  id: string;
  /** 展示编号徽标（`第N章`） */
  label: string;
  title: string;
  /** 正文字数（`metadata.textLength`；无统计 = 0，rail 仅在 > 0 时渲染） */
  textLength: number;
  /** 所属卷 id；存量根级章 = null（顶层就地显示） */
  volumeId: string | null;
}

export type WritingRailRow = WritingRailVolumeRow | WritingRailChapterRow;

function chapterRow(
  chapter: OutlineChapter,
  volumeId: string | null,
  labels: Map<string, string>,
): WritingRailChapterRow {
  return {
    kind: "chapter",
    id: chapter.id,
    label: labels.get(chapter.id) ?? "",
    title: chapter.title,
    textLength: chapter.metadata?.textLength ?? 0,
    volumeId,
  };
}

/**
 * 按文件序展开 rail 行。
 *
 * - 软删章 / 软删卷及其整棵子树跳过；卷下只认同类型为 chapter 的子节点（畸形树不出口行）。
 * - 0 个可见章的卷保留卷行（`chapterCount = 0`），否则删除章后卷会从导航栏消失。
 * - 根级章夹在卷组之间原位显示（volumeId = null），章号仍按全书先序连续。
 */
export function buildWritingRailRows(outline: OutlineTree | null): WritingRailRow[] {
  if (outline === null) return [];
  const { labels } = numberOutline(outline);
  const rows: WritingRailRow[] = [];
  for (const node of outline.children) {
    if (node.deleted === true) continue;
    if (node.type === "chapter") {
      rows.push(chapterRow(node, null, labels));
      continue;
    }
    const chapters = (node.children ?? []).filter(
      (child) => child.deleted !== true && child.type === "chapter",
    );
    rows.push({
      kind: "volume",
      id: node.id,
      label: labels.get(node.id) ?? "",
      title: node.title,
      chapterCount: chapters.length,
    });
    for (const chapter of chapters) rows.push(chapterRow(chapter, node.id, labels));
  }
  return rows;
}
