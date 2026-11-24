// 大纲画布筛选的纯判定（契约：docs/ui/DESIGN.md `outline-canvas`「筛选」）。
//
// 口径 = **同维度 OR、跨维度 AND**；空数组 = 不限制；卡片缺省状态按草稿算（`draft` 是默认值，
// 与卡面「草稿不占位」同一条口径）。筛选只改展示：未命中卡片保留坐标与交互（页面给透明度），
// 端点被筛掉的连线不画——**不改结构、不重排、不写 localStorage / URL**。
// 标签池 / 卷选项从当前卡片派生（数据已随大纲到手，不新增标签接口）：标签去重 + 使用次数降序 +
// 同频字典序；卷按阅读序首现去重（直挂 root 的章无卷号，不产出选项）。
import type { CanvasChapterCard } from "./outline-canvas-layout";
import type { CanvasPlotEdge } from "./outline-canvas-edges";

/** 画布筛选条件（组件态：刷新即清；三个维度同在这一个对象里，同维度 OR、跨维度 AND） */
export interface CanvasFilter {
  statuses: string[];
  tags: string[];
  /** 卷维度：卷节点 id（不是卷号文案） */
  volumeIds: string[];
}

/** 无条件（= 全部命中） */
export const EMPTY_CANVAS_FILTER: CanvasFilter = { statuses: [], tags: [], volumeIds: [] };

/** 是否有任何筛选条件（决定按钮徽标与空结果提示） */
export function isCanvasFilterActive(filter: CanvasFilter): boolean {
  return filter.statuses.length > 0 || filter.tags.length > 0 || filter.volumeIds.length > 0;
}

/** 单卡是否命中（同维度 OR、跨维度 AND） */
export function matchCanvasChapterFilter(card: CanvasChapterCard, filter: CanvasFilter): boolean {
  if (filter.volumeIds.length > 0 && !filter.volumeIds.includes(card.volumeId)) {
    return false;
  }
  if (filter.statuses.length > 0 && !filter.statuses.includes(card.status ?? "draft")) {
    return false;
  }
  if (filter.tags.length > 0 && !card.tags.some((tag) => filter.tags.includes(tag))) {
    return false;
  }
  return true;
}

/** 标签池：当前树中出现过的标签（一张卡内重复只计一次），次数降序、同频字典序 */
export function canvasTagOptions(cards: readonly CanvasChapterCard[]): string[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    for (const tag of new Set(card.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

/** 卷筛选选项：`id` = 卷节点 id，`label` = 卷号文案（`第N卷`） */
export interface CanvasVolumeOption {
  id: string;
  label: string;
}

/** 卷选项：卡片所属卷按阅读序去重（直挂 root 的章无卷号，不产出选项） */
export function canvasVolumeOptions(
  cards: readonly CanvasChapterCard[],
): CanvasVolumeOption[] {
  const volumes = new Map<string, string>();
  for (const card of cards) {
    if (card.volumeId !== "" && !volumes.has(card.volumeId)) {
      volumes.set(card.volumeId, card.volumeLabel);
    }
  }
  return [...volumes].map(([id, label]) => ({ id, label }));
}

/** 命中章 id 集 + 两端都在命中集内的连线（未筛时 = 全部章 / 全部连线，行为与不筛选一致） */
export function applyCanvasFilter(
  cards: readonly CanvasChapterCard[],
  edges: readonly CanvasPlotEdge[],
  filter: CanvasFilter,
): { matchedIds: ReadonlySet<string>; edges: CanvasPlotEdge[] } {
  const matchedIds = new Set(
    cards.filter((card) => matchCanvasChapterFilter(card, filter)).map((card) => card.id),
  );
  return {
    matchedIds,
    edges: edges.filter((edge) => matchedIds.has(edge.source) && matchedIds.has(edge.target)),
  };
}
