// 画布筛选判定单测：卷 / 状态 / 标签三维的 OR / AND / 空筛 / 缺省状态口径 + 标签与卷选项派生
// + 连线端点过滤 + 「淡化不重排」（筛选不参与摆位）。判定错了会在画布上静默隐藏章节（观察面丢信息），
// 故把矩阵钉在纯函数上。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CanvasPlotEdge } from "./outline-canvas-edges";
import {
  CANVAS_CARD_GAP,
  CANVAS_CARD_WIDTH,
  layoutCanvasChapters,
  type CanvasChapterCard,
} from "./outline-canvas-layout";
import {
  applyCanvasFilter,
  canvasTagOptions,
  canvasVolumeOptions,
  EMPTY_CANVAS_FILTER,
  isCanvasFilterActive,
  matchCanvasChapterFilter,
  type CanvasFilter,
} from "./outline-canvas-filter";

function card(over: Partial<CanvasChapterCard> = {}): CanvasChapterCard {
  return {
    id: "ch-1",
    title: "开端",
    volumeId: "vol-1",
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
/** 第二卷的章（卷维度用例） */
const secondVolume = card({ id: "vol-2-ch", volumeId: "vol-2", volumeLabel: "第2卷" });

function filter(over: Partial<CanvasFilter> = {}): CanvasFilter {
  return { statuses: [], tags: [], volumeIds: [], ...over };
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

describe("matchCanvasChapterFilter · 卷维度", () => {
  it("按卷命中：本卷的卡命中，他卷 / 直挂 root 的卡不命中", () => {
    const byVolume = filter({ volumeIds: ["vol-1"] });
    expect(matchCanvasChapterFilter(draft, byVolume)).toBe(true);
    expect(matchCanvasChapterFilter(secondVolume, byVolume)).toBe(false);
    expect(matchCanvasChapterFilter(card({ volumeId: "", volumeLabel: "" }), byVolume)).toBe(
      false,
    );
  });

  it("多卷为 OR（选两卷就命中两卷的卡）", () => {
    const both = filter({ volumeIds: ["vol-1", "vol-2"] });
    expect(matchCanvasChapterFilter(draft, both)).toBe(true);
    expect(matchCanvasChapterFilter(secondVolume, both)).toBe(true);
    expect(matchCanvasChapterFilter(card({ volumeId: "vol-3", volumeLabel: "第3卷" }), both)).toBe(
      false,
    );
  });

  it("卷 + 状态 + 标签 = AND（三维都要命中）", () => {
    const stacked = filter({ volumeIds: ["vol-1"], statuses: ["final"], tags: ["复仇"] });
    expect(matchCanvasChapterFilter(final, stacked)).toBe(true);
    // 卷对、状态对、标签不对
    expect(matchCanvasChapterFilter(card({ status: "final", tags: ["过渡"] }), stacked)).toBe(false);
    // 其它维度都对、只在另一卷
    expect(
      matchCanvasChapterFilter(card({ volumeId: "vol-2", status: "final", tags: ["复仇"] }), stacked),
    ).toBe(false);
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

describe("canvasVolumeOptions", () => {
  it("按阅读序去重：同一卷只出一项，直挂 root 的章不出项", () => {
    const cards = [
      card({ id: "a", volumeId: "vol-1", volumeLabel: "第1卷" }),
      card({ id: "b", volumeId: "vol-1", volumeLabel: "第1卷" }),
      card({ id: "c", volumeId: "", volumeLabel: "" }),
      card({ id: "d", volumeId: "vol-2", volumeLabel: "第2卷" }),
    ];
    expect(canvasVolumeOptions(cards)).toEqual([
      { id: "vol-1", label: "第1卷" },
      { id: "vol-2", label: "第2卷" },
    ]);
  });

  it("全是直挂 root 的章 → 空选项（面板不渲染卷段）", () => {
    expect(canvasVolumeOptions([card({ volumeId: "", volumeLabel: "" })])).toEqual([]);
  });
});

describe("isCanvasFilterActive", () => {
  it("任一维度有条件即激活", () => {
    expect(isCanvasFilterActive(EMPTY_CANVAS_FILTER)).toBe(false);
    expect(isCanvasFilterActive(filter({ statuses: ["draft"] }))).toBe(true);
    expect(isCanvasFilterActive(filter({ tags: ["伏笔"] }))).toBe(true);
    expect(isCanvasFilterActive(filter({ volumeIds: ["vol-1"] }))).toBe(true);
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

  it("按卷筛选：命中集只含本卷的卡（阅读序不变），跨卷连线不画", () => {
    const volumeEdges = [...edges, edge("e4", "draft", "vol-2-ch")];
    const result = applyCanvasFilter(
      [...cards, secondVolume],
      volumeEdges,
      filter({ volumeIds: ["vol-1"] }),
    );
    expect([...result.matchedIds]).toEqual(["draft", "revision", "final"]);
    expect(result.edges.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("不重排：未命中卡仍占原网格位（筛选不参与摆位，只改透明度）", () => {
    const volumeCards = [draft, secondVolume, final];
    const { matchedIds } = applyCanvasFilter(
      volumeCards,
      [],
      filter({ volumeIds: ["vol-1"] }),
    );
    expect(matchedIds.has("vol-2-ch")).toBe(false);
    // 摆位只输全量卡：未命中的第二卷章仍在第 2 列，没被命中集前移成第 1 列
    expect(layoutCanvasChapters(volumeCards, {})["vol-2-ch"]).toEqual({
      x: CANVAS_CARD_WIDTH + CANVAS_CARD_GAP,
      y: 0,
    });
  });
});

// 筛选是**展示层组件态**（DESIGN.md `outline-canvas`「筛选」）：不写 localStorage、不进 URL，
// 且只改透明度 / 可见连线——摆位与卡片集必须仍用全量 `cards`（改成就地过滤会让卡片重排、连线错位）。
// 纯函数测不到「页面怎么接线」，故对页面源码钉接线段。
describe("画布筛选接线（不持久化 / 不重排）", () => {
  const page = readFileSync(new URL("../pages/OutlineCanvas.tsx", import.meta.url), "utf8");

  it("摆位 / 节点集只吃全量 cards，筛选只决定 filtered 与可见连线", () => {
    expect(page).toContain("layoutCanvasChapters(cards, saved.nodes)");
    expect(page).toContain("filtered: !matchedIds.has(card.id)");
    // 页面不得把卡片集先按筛选收窄再摆位（那会把未命中卡抽走 ⇒ 重排）
    expect(page).not.toMatch(/cards\.filter\(/);
  });

  it("筛选条件不落盘、不入 URL：页面里 setFilter 只接组件态", () => {
    // 唯一写盘调用点 = 坐标 / 视口（拖拽与平移）
    const writes = [...page.matchAll(/writeCanvasState\(/g)];
    expect(writes).toHaveLength(2);
    const filterLines = page
      .split("\n")
      .filter((line) => /filter|Filter/.test(line) && /localStorage|location|history\.|navigate/.test(line));
    expect(filterLines).toEqual([]);
  });

  it("筛选判定模块与控件本身不碰存储 / URL / 路由", () => {
    for (const file of ["outline-canvas-filter.ts", "../components/outline-canvas/CanvasFilterControl.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      // 只钉「真的用了」的形态（注释里提到这几个词不算）
      expect(source).not.toMatch(/localStorage\.|sessionStorage\.|window\.location|history\.\w|navigate\(/);
    }
  });
});
