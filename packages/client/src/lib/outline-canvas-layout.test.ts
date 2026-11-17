// 大纲画布摆位纯函数单测（卡 C6）：摆位规则与 localStorage 读侧兼容是「结构不得被展示层改写」的
// 边界，坏了会让手工摆位被网格覆盖或旧坐标读不回来。
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutlineChapter, OutlineTree, OutlineVolume } from "@whispering233/ai-editor-shared";
import {
  CANVAS_CARD_GAP,
  CANVAS_CARD_HEIGHT,
  CANVAS_CARD_WIDTH,
  CANVAS_CHAPTERS_PER_ROW,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  canvasChapterCards,
  canvasStorageKey,
  layoutCanvasChapters,
  parseCanvasState,
  pruneCanvasPositions,
  readCanvasState,
  writeCanvasState,
} from "./outline-canvas-layout";

function chapter(id: string, title: string, scenes: string[] = [], deleted = false): OutlineChapter {
  return {
    id,
    type: "chapter",
    title,
    deleted,
    updatedAt: "2026-01-01T00:00:00Z",
    children: scenes.map((sceneId) => ({
      id: sceneId,
      type: "scene" as const,
      title: sceneId,
      updatedAt: "2026-01-01T00:00:00Z",
    })),
  };
}

function volume(id: string, title: string, chapters: OutlineChapter[] = []): OutlineVolume {
  return { id, type: "volume", title, updatedAt: "2026-01-01T00:00:00Z", children: chapters };
}

function tree(children: OutlineTree["children"]): OutlineTree {
  return { id: "root", type: "root", schemaVersion: 2, children };
}

/** 第 index 个缺坐标章应落的网格位（与实现同一套常量，断言「每行 N 张」而不是手抄像素） */
const gridPosition = (index: number) => ({
  x: (index % CANVAS_CHAPTERS_PER_ROW) * (CANVAS_CARD_WIDTH + CANVAS_CARD_GAP),
  y: Math.floor(index / CANVAS_CHAPTERS_PER_ROW) * (CANVAS_CARD_HEIGHT + CANVAS_CARD_GAP),
});

describe("canvasChapterCards（大纲树 → 画布卡片）", () => {
  it("空树 / 只有卷：没有章就没有卡片", () => {
    expect(canvasChapterCards(null)).toEqual([]);
    expect(canvasChapterCards(tree([]))).toEqual([]);
    expect(canvasChapterCards(tree([volume("vol-1", "第一卷")]))).toEqual([]);
  });

  it("卷章混合：按可见章先序出卡，卷号 / 章号来自 numberVisibleOutline，场景数写卡上", () => {
    const cards = canvasChapterCards(
      tree([
        volume("vol-1", "第一卷", [chapter("ch-1", "开端", ["sc-1", "sc-2"]), chapter("ch-2", "转折")]),
        volume("vol-2", "第二卷", [chapter("ch-3", "收束", ["sc-3"])]),
      ]),
    );
    expect(cards).toEqual([
      { id: "ch-1", title: "开端", volumeLabel: "第1卷", chapterLabel: "第1章", sceneCount: 2 },
      { id: "ch-2", title: "转折", volumeLabel: "第1卷", chapterLabel: "第2章", sceneCount: 0 },
      { id: "ch-3", title: "收束", volumeLabel: "第2卷", chapterLabel: "第3章", sceneCount: 1 },
    ]);
  });

  it("存量直挂 root 的章没有卷号（volumeLabel 空串 ⇒ 卡上不渲染卷徽标）", () => {
    const cards = canvasChapterCards(tree([chapter("ch-1", "无卷章"), volume("vol-1", "第一卷")]));
    expect(cards).toEqual([
      { id: "ch-1", title: "无卷章", volumeLabel: "", chapterLabel: "第1章", sceneCount: 0 },
    ]);
  });
});

describe("layoutCanvasChapters（确定性网格 + 手工坐标优先）", () => {
  it("缺坐标按可见章序每行 N 张补位（新章自然落在网格末尾）", () => {
    const chapters = Array.from({ length: CANVAS_CHAPTERS_PER_ROW + 1 }, (_, i) => ({
      id: `ch-${i}`,
    }));
    const positions = layoutCanvasChapters(chapters, {});
    expect(positions["ch-0"]).toEqual(gridPosition(0));
    expect(positions[`ch-${CANVAS_CHAPTERS_PER_ROW - 1}`]).toEqual(
      gridPosition(CANVAS_CHAPTERS_PER_ROW - 1),
    );
    // 第 N+1 张换行（x 回到行首，y 增加一行）
    expect(positions[`ch-${CANVAS_CHAPTERS_PER_ROW}`]).toEqual(gridPosition(CANVAS_CHAPTERS_PER_ROW));
    expect(Object.keys(positions)).toHaveLength(CANVAS_CHAPTERS_PER_ROW + 1);
  });

  it("已有坐标不动，其余章仍按自己的可见序补位（互不挤压）", () => {
    const chapters = [{ id: "ch-0" }, { id: "ch-1" }, { id: "ch-2" }];
    const positions = layoutCanvasChapters(chapters, { "ch-1": { x: 999, y: -40 } });
    expect(positions["ch-0"]).toEqual(gridPosition(0));
    expect(positions["ch-1"]).toEqual({ x: 999, y: -40 });
    expect(positions["ch-2"]).toEqual(gridPosition(2));
  });

  it("已删章（不在可见列表）的坐标不出现在结果里", () => {
    const positions = layoutCanvasChapters([{ id: "ch-0" }], {
      "ch-0": { x: 10, y: 10 },
      "ch-gone": { x: 500, y: 500 },
    });
    expect(positions).toEqual({ "ch-0": { x: 10, y: 10 } });
  });
});

describe("pruneCanvasPositions（写侧清理已删 id）", () => {
  it("只留仍在可见大纲里的章", () => {
    expect(
      pruneCanvasPositions([{ id: "ch-0" }], {
        "ch-0": { x: 1, y: 2 },
        "ch-gone": { x: 3, y: 4 },
      }),
    ).toEqual({ "ch-0": { x: 1, y: 2 } });
  });
});

describe("parseCanvasState（读侧兜底与旧格式兼容）", () => {
  it("没存过 → 空状态（首次进入 fitView）", () => {
    expect(parseCanvasState(null)).toEqual({ nodes: {} });
  });

  it("坏 JSON / 非对象 → 空状态，不抛错", () => {
    expect(parseCanvasState("{not json")).toEqual({ nodes: {} });
    expect(parseCanvasState("null")).toEqual({ nodes: {} });
    expect(parseCanvasState('"canvas"')).toEqual({ nodes: {} });
  });

  it("坐标坏条目丢弃（NaN / 字符串 / 缺字段），好条目保留", () => {
    const raw = JSON.stringify({
      nodes: {
        "ch-0": { x: 1, y: 2 },
        "ch-1": { x: "3", y: 4 },
        "ch-2": { x: 5 },
        "ch-3": "nope",
      },
    });
    expect(parseCanvasState(raw)).toEqual({ nodes: { "ch-0": { x: 1, y: 2 } } });
  });

  it("旧格式 { nodes, zoom }：视口还原为 (0, 0, zoom)", () => {
    const raw = JSON.stringify({ nodes: { "ch-0": { x: 1, y: 2 } }, zoom: 1.4 });
    expect(parseCanvasState(raw)).toEqual({
      nodes: { "ch-0": { x: 1, y: 2 } },
      viewport: { x: 0, y: 0, zoom: 1.4 },
    });
  });

  it("视口缩放夹到画布区间（越界旧值读得回来）", () => {
    const tooBig = JSON.stringify({ nodes: {}, viewport: { x: 2, y: 3, zoom: 9 } });
    const tooSmall = JSON.stringify({ nodes: {}, viewport: { x: 2, y: 3, zoom: 0.01 } });
    expect(parseCanvasState(tooBig).viewport).toEqual({ x: 2, y: 3, zoom: CANVAS_MAX_ZOOM });
    expect(parseCanvasState(tooSmall).viewport).toEqual({ x: 2, y: 3, zoom: CANVAS_MIN_ZOOM });
  });
});

describe("readCanvasState / writeCanvasState（localStorage 按书隔离）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeStorage() {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    return store;
  }

  it("项目 id 为 null 时不读不写（坐标只活在内存里）", () => {
    const store = fakeStorage();
    writeCanvasState(null, { nodes: { "ch-0": { x: 1, y: 2 } } });
    expect(store.size).toBe(0);
    expect(readCanvasState(null)).toEqual({ nodes: {} });
  });

  it("项目 id 为 null 时读侧也不碰存储（不是靠空存储兜底）", () => {
    const getItem = vi.fn(() => '{"nodes":{"ch-0":{"x":9,"y":9}}}');
    vi.stubGlobal("localStorage", { getItem, setItem: () => {} });
    expect(readCanvasState(null)).toEqual({ nodes: {} });
    expect(getItem).not.toHaveBeenCalled();
  });

  it("按书写读同一个 key", () => {
    fakeStorage();
    const saved = { nodes: { "ch-0": { x: 1, y: 2 } }, viewport: { x: 0, y: 0, zoom: 1 } };
    writeCanvasState("book-1", saved);
    expect(readCanvasState("book-1")).toEqual(saved);
    expect(readCanvasState("book-2")).toEqual({ nodes: {} });
    expect(canvasStorageKey("book-1")).toBe("ai-editor:canvas:book-1");
  });

  it("存储不可用（写抛错）时降级为不记住坐标，不打断画布", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(() => writeCanvasState("book-1", { nodes: {} })).not.toThrow();
    expect(readCanvasState("book-1")).toEqual({ nodes: {} });
  });
});
