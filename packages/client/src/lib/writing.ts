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
import type { ExpectedHookItem } from "./api";
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

// ============ 最近导航（`#/writing` 无 id 时的目标解析）============

/** 最近打开章的 localStorage key（per-book 映射；唯一 key，勿手抄字面量） */
export const LAST_OPENED_CHAPTERS_KEY = "ai-editor:writing-last-opened";

/** 解析 per-book 映射：坏 JSON / null / 数组 / 非对象 → {}；只保留 value 为非空 string 的条目（不抛错） */
export function parseLastOpenedChapters(raw: string | null): Record<string, string> {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" && value !== "") result[key] = value;
  }
  return result;
}

/** 读某本书的最近打开章 id（无项目 / 无记录 / 存储不可用 → null；读写尝试都静默失败） */
export function readLastOpenedChapter(projectId: string | null): string | null {
  if (projectId === null || typeof localStorage === "undefined") return null;
  try {
    const map = parseLastOpenedChapters(localStorage.getItem(LAST_OPENED_CHAPTERS_KEY));
    return map[projectId] ?? null;
  } catch {
    return null;
  }
}

/** 写某本书的最近打开章 id（合并进 per-book 映射；只存 id，不存正文） */
export function writeLastOpenedChapter(projectId: string | null, chapterId: string): void {
  if (projectId === null || typeof localStorage === "undefined") return;
  try {
    const map = parseLastOpenedChapters(localStorage.getItem(LAST_OPENED_CHAPTERS_KEY));
    map[projectId] = chapterId;
    localStorage.setItem(LAST_OPENED_CHAPTERS_KEY, JSON.stringify(map));
  } catch {
    // 隐私模式 / 配额满：导航记录是便利功能，不打断写作
  }
}

/**
 * 服务端回退：按 **outline.children 文件序**收集可见章（跳软删；存量根级章原位；卷内只章），
 * 取 `metadata.documentUpdatedAt` 字符串最大者；平局取先序第一个；无时间戳 → null。
 * **不是** `current_position`（那是阅读进度）。
 */
export function pickRecentChapter(outline: OutlineTree | null): string | null {
  if (outline === null) return null;
  const chapters: OutlineChapter[] = [];
  const collect = (nodes: OutlineTree["children"]): void => {
    for (const node of nodes) {
      if (node.deleted === true) continue;
      if (node.type === "chapter") {
        chapters.push(node);
        continue;
      }
      for (const child of node.children ?? []) {
        if (child.deleted !== true && child.type === "chapter") chapters.push(child);
      }
    }
  };
  collect(outline.children);
  let bestId: string | null = null;
  let bestUpdatedAt: string | null = null;
  for (const chapter of chapters) {
    const updatedAt = chapter.metadata?.documentUpdatedAt;
    if (updatedAt === undefined || updatedAt === "") continue;
    // 严格大于 ⇒ 平局保留先序第一个
    if (bestUpdatedAt === null || updatedAt > bestUpdatedAt) {
      bestId = chapter.id;
      bestUpdatedAt = updatedAt;
    }
  }
  return bestId;
}

/** 已加载的「本章待回收」条目 + 来源章 id（来源与 items 绑在一起，见下） */
export interface LoadedExpectedHooks {
  chapterId: string;
  items: ExpectedHookItem[];
}

/**
 * rail 显示的「本章待回收」条目：**只认来源章 = 当前章**。切到另一张存在的章时 state 还是旧章的
 * （等新响应才更新），此处直接派生为空，避免旧章伏笔挂到新章行下（seq 守卫只挡旧响应覆盖新章）。
 */
export function expectedHooksForChapter(
  loaded: LoadedExpectedHooks | null,
  chapterId: string | undefined,
): ExpectedHookItem[] {
  return loaded !== null && loaded.chapterId === chapterId ? loaded.items : [];
}

/** 最近打开仍在该书可见大纲 → 用它；否则回退 `pickRecentChapter`；大纲未加载 → null */
export function resolveWritingTarget(outline: OutlineTree | null, lastOpenedId: string | null): string | null {
  if (outline === null) return null;
  if (lastOpenedId !== null) {
    const visible = buildWritingRailRows(outline).some(
      (row) => row.kind === "chapter" && row.id === lastOpenedId,
    );
    if (visible) return lastOpenedId;
  }
  return pickRecentChapter(outline);
}
