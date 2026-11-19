// 画布筛选判定单测（卡 K3）：OR / AND / 空筛 / 缺省状态四条口径 + 标签池排序 + 连线端点过滤。
// 判定错了会在画布上静默隐藏章节（观察面丢信息），故把矩阵钉在纯函数上。
import { describe, expect, it } from "vitest";
import type { CanvasPlotEdge } from "./outline-canvas-edges";
import type { CanvasChapterCard } from "./outline-canvas-layout";
import {
  applyCanvasFilter,
  canvasTagOptions,
  EMPTY_CANVAS_FILTER,
  isCanvasFilterActive,
  matchCanvasChapterFilter,
  type CanvasFilter,
} from "./outline-canvas-filter";

function card(over: Partial<CanvasChapterCard> = {}): CanvasChapterCard {
  return {
    id: "ch-1",
    title: "开端",
    volumeLabel: "第1卷",
    chapterNumber: 1,
    chapterLabel: "第1章",
    sceneCount: 0,
    written: false,
    tags: [],
    ...over,
  };
}

const draft = card({ id: "draft", status: "draft", tags: ["伏笔"] });
const revision = card({ id: "revision", status: "revision", tags: ["复仇"] });
const final = card({ id: "final", status: "final", tags: ["伏笔", "复仇"] });
const noStatus = card({ id: "no-status", tags: [] });

function filter(over: Partial<CanvasFilter> = {}): CanvasFilter {
  return { statuses: [], tags: [], ...over };
}

describe("matchCanvasChapterFilter", () => {
  it("空筛不限制任何卡（缺省状态也不受约束）", () => {
    for (const candidate of [draft, revision, final, noStatus]) {
      expect(matchCanvasChapterFilter(candidate, EMPTY_CANVAS_FILTER)).toBe(true);
    }
  });

  it("单状态只命中该状态；缺省状态按草稿算", () => {
    expect(matchCanvasChapterFilter(final, filter({ statuses: ["final"] }))).toBe(true);
    expect(matchCanvasChapterFilter(revision, filter({ statuses: ["final"] }))).toBe(false);
    expect(matchCanvasChapterFilter(noStatus, filter({ statuses: ["draft"] }))).toBe(true);
    expect(matchCanvasChapterFilter(noStatus, filter({ statuses: ["final"] }))).toBe(false);
  });

  it("双状态为 OR（草稿 + 定稿都命中，修正中不命中）", () => {
    const both = filter({ statuses: ["draft", "final"] });
    expect(matchCanvasChapterFilter(draft, both)).toBe(true);
    expect(matchCanvasChapterFilter(final, both)).toBe(true);
    expect(matchCanvasChapterFilter(revision, both)).toBe(false);
  });

  it("单标签命中含该标签的卡", () => {
    const tagFilter = filter({ tags: ["伏笔"] });
    expect(matchCanvasChapterFilter(draft, tagFilter)).toBe(true);
    expect(matchCanvasChapterFilter(final, tagFilter)).toBe(true);
    expect(matchCanvasChapterFilter(revision, tagFilter)).toBe(false);
    expect(matchCanvasChapterFilter(noStatus, tagFilter)).toBe(false);
  });

  it("双标签为 OR（任一命中即可）", () => {
    const tags = filter({ tags: ["伏笔", "复仇"] });
    expect(matchCanvasChapterFilter(draft, tags)).toBe(true);
    expect(matchCanvasChapterFilter(revision, tags)).toBe(true);
    expect(matchCanvasChapterFilter(final, tags)).toBe(true);
    expect(matchCanvasChapterFilter(noStatus, tags)).toBe(false);
  });

  it("状态 + 标签为 AND（两个维度都要命中）", () => {
    const both = filter({ statuses: ["final"], tags: ["复仇"] });
    expect(matchCanvasChapterFilter(final, both)).toBe(true);
    // 标签命中但状态不命中
    expect(matchCanvasChapterFilter(revision, both)).toBe(false);
    // 状态命中但标签不命中
    expect(matchCanvasChapterFilter(card({ status: "final", tags: ["过渡"] }), both)).toBe(false);
  });
});

describe("canvasTagOptions", () => {
  it("去重 + 使用次数降序 + 同频字典序", () => {
    const cards = [
      card({ id: "a", tags: ["alpha", "beta"] }),
      card({ id: "b", tags: ["beta", "beta"] }),
      card({ id: "c", tags: ["beta", "gamma"] }),
    ];
    // beta 3 次；alpha / gamma 各 1 次 → 同频按字典序
    expect(canvasTagOptions(cards)).toEqual(["beta", "alpha", "gamma"]);
  });

  it("无标签 → 空池", () => {
    expect(canvasTagOptions([card(), card({ id: "b" })])).toEqual([]);
  });
});

describe("isCanvasFilterActive", () => {
  it("任一维度有条件即激活", () => {
    expect(isCanvasFilterActive(EMPTY_CANVAS_FILTER)).toBe(false);
    expect(isCanvasFilterActive(filter({ statuses: ["draft"] }))).toBe(true);
    expect(isCanvasFilterActive(filter({ tags: ["伏笔"] }))).toBe(true);
  });
});

describe("applyCanvasFilter", () => {
  const edge = (id: string, source: string, target: string): CanvasPlotEdge => ({
    id,
    source,
    target,
    label: "",
  });
  const cards = [draft, revision, final];
  const edges = [
    edge("e1", "draft", "final"),
    edge("e2", "revision", "final"),
    edge("e3", "draft", "revision"),
  ];

  it("不筛时命中全部卡、保留全部连线", () => {
    const result = applyCanvasFilter(cards, edges, EMPTY_CANVAS_FILTER);
    expect([...result.matchedIds]).toEqual(["draft", "revision", "final"]);
    expect(result.edges).toEqual(edges);
  });

  it("端点被筛掉的连线不画，命中卡之间的连线保留", () => {
    const result = applyCanvasFilter(cards, edges, filter({ statuses: ["draft", "final"] }));
    expect([...result.matchedIds]).toEqual(["draft", "final"]);
    expect(result.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("命中 0 张卡时连线全空", () => {
    const result = applyCanvasFilter(cards, edges, filter({ tags: ["不存在"] }));
    expect(result.matchedIds.size).toBe(0);
    expect(result.edges).toEqual([]);
  });
});
