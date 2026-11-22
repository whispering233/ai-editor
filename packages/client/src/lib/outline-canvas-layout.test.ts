// 大纲画布摆位纯函数单测：摆位规则与 localStorage 读侧兼容是「结构不得被展示层改写」的
// 边界，坏了会让手工摆位被网格覆盖或旧坐标读不回来；另守首屏落点（居中 / 钳到 0.85 左上）、
// 卡片高度两档、行距按行算、缩放分级边界与存储版本（v3 之前整体丢弃）。
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  OutlineChapter,
  OutlineNodeMetadata,
  OutlineTree,
  OutlineVolume,
} from "@whispering233/ai-editor-shared";
import {
  CANVAS_CARD_GAP,
  CANVAS_CARD_HEIGHT,
  CANVAS_CARD_HEIGHT_BASE,
  CANVAS_CARD_WIDTH,
  CANVAS_CHAPTERS_PER_ROW,
  CANVAS_INITIAL_MIN_ZOOM,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  CANVAS_VIEW_PADDING,
  canvasCardHeight,
  canvasChapterCards,
  canvasContentBounds,
  canvasLodLevel,
  canvasStorageKey,
  layoutCanvasChapters,
  parseCanvasState,
  pruneCanvasPositions,
  readCanvasState,
  resolveInitialViewport,
  writeCanvasState,
} from "./outline-canvas-layout";

function chapter(
  id: string,
  title: string,
  scenes: string[] = [],
  deleted = false,
  metadata?: OutlineNodeMetadata,
): OutlineChapter {
  return {
    id,
    type: "chapter",
    title,
    deleted,
    updatedAt: "2026-01-01T00:00:00Z",
    ...(metadata === undefined ? {} : { metadata }),
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

/** 第 index 个缺坐标章应落的网格位（全短卡行：行距 = `CANVAS_CARD_HEIGHT_BASE` + 间距；
 *  与实现同一套常量，断言「每行 N 张」而不是手抄像素） */
const gridPosition = (index: number) => ({
  x: (index % CANVAS_CHAPTERS_PER_ROW) * (CANVAS_CARD_WIDTH + CANVAS_CARD_GAP),
  y: Math.floor(index / CANVAS_CHAPTERS_PER_ROW) * (CANVAS_CARD_HEIGHT_BASE + CANVAS_CARD_GAP),
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
      { id: "ch-1", title: "开端", volumeLabel: "第1卷", chapterNumber: 1, chapterLabel: "第1章", sceneCount: 2, written: false, tags: [] },
      { id: "ch-2", title: "转折", volumeLabel: "第1卷", chapterNumber: 2, chapterLabel: "第2章", sceneCount: 0, written: false, tags: [] },
      { id: "ch-3", title: "收束", volumeLabel: "第2卷", chapterNumber: 3, chapterLabel: "第3章", sceneCount: 1, written: false, tags: [] },
    ]);
  });

  it("已写 = metadata.textLength > 0（字数本身不上卡面）；无 metadata ⇒ 未写，不新增请求", () => {
    const cards = canvasChapterCards(
      tree([
        volume("vol-1", "第一卷", [
          chapter("ch-1", "有正文", ["sc-1"], false, {
            textLength: 1200,
            documentUpdatedAt: "2026-03-05T10:00:00",
          }),
          chapter("ch-2", "空章"),
        ]),
      ]),
    );
    expect(cards).toEqual([
      {
        id: "ch-1",
        title: "有正文",
        volumeLabel: "第1卷",
        chapterNumber: 1,
        chapterLabel: "第1章",
        sceneCount: 1,
        written: true,
        tags: [],
      },
      {
        id: "ch-2",
        title: "空章",
        volumeLabel: "第1卷",
        chapterNumber: 2,
        chapterLabel: "第2章",
        sceneCount: 0,
        written: false,
        tags: [],
      },
    ]);
  });

  it("存量直挂 root 的章没有卷号（volumeLabel 空串 ⇒ title 省略卷号段）", () => {
    const cards = canvasChapterCards(tree([chapter("ch-1", "无卷章"), volume("vol-1", "第一卷")]));
    expect(cards).toEqual([
      { id: "ch-1", title: "无卷章", volumeLabel: "", chapterNumber: 1, chapterLabel: "第1章", sceneCount: 0, written: false, tags: [] },
    ]);
  });

  it("data 窄化：合法枚举 / 标签数组进卡（缺 status ⇔ 草稿）", () => {
    const [card] = canvasChapterCards(
      tree([
        volume("vol-1", "第一卷", [
          {
            ...chapter("ch-1", "开端"),
            data: { status: "final", tags: ["伏笔", "转折"] },
          },
        ]),
      ]),
    );
    expect(card).toEqual({
      id: "ch-1",
      title: "开端",
      volumeLabel: "第1卷",
      chapterNumber: 1,
      chapterLabel: "第1章",
      sceneCount: 0,
      written: false,
      tags: ["伏笔", "转折"],
      status: "final",
    });
  });

  it("data 窄化：非法枚举 / 非字符串标签按未设置处理（坏字段不污染卡面）", () => {
    const cards = canvasChapterCards(
      tree([
        volume("vol-1", "第一卷", [
          {
            ...chapter("ch-1", "开端"),
            data: { status: "unknown", tags: "伏笔" },
          },
          {
            ...chapter("ch-2", "转折"),
            data: { tags: ["伏笔", 42, ""] },
          },
        ]),
      ]),
    );
    expect(cards[0]).toEqual({
      id: "ch-1",
      title: "开端",
      volumeLabel: "第1卷",
      chapterNumber: 1,
      chapterLabel: "第1章",
      sceneCount: 0,
      written: false,
      tags: [],
    });
    expect(cards[1]?.tags).toEqual(["伏笔"]);
  });
});

describe("canvasCardHeight（卡片按内容定高）", () => {
  it("草稿 / 无状态且无标签 → 68（第三行不渲染、不预留空行）", () => {
    expect(canvasCardHeight({})).toBe(CANVAS_CARD_HEIGHT_BASE);
    expect(canvasCardHeight({ status: "draft", tags: [] })).toBe(CANVAS_CARD_HEIGHT_BASE);
  });

  it("草稿 + 有标签 / final / revision → 92（三种都占第三行）", () => {
    expect(canvasCardHeight({ status: "draft", tags: ["伏笔"] })).toBe(CANVAS_CARD_HEIGHT);
    expect(canvasCardHeight({ status: "final" })).toBe(CANVAS_CARD_HEIGHT);
    expect(canvasCardHeight({ status: "revision" })).toBe(CANVAS_CARD_HEIGHT);
  });
});

describe("layoutCanvasChapters（确定性网格 + 手工坐标优先）", () => {
  it("网格每行 5 张（换行档位是布局决定，别静默改）", () => {
    expect(CANVAS_CHAPTERS_PER_ROW).toBe(5);
  });

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

  it("行距按行算：含高卡的行 116，全短行 92（行距 = 该行最高卡片 + 间距）", () => {
    const mixed = Array.from({ length: CANVAS_CHAPTERS_PER_ROW + 1 }, (_, i) => ({
      id: `ch-${i}`,
      // 第一行第二张带标签 → 该行最高 92；其余行全短 68
      ...(i === 1 ? { status: "final" as const } : {}),
    }));
    const positions = layoutCanvasChapters(mixed, {});
    expect(positions["ch-0"]?.y).toBe(0);
    // 第二行 = 第一行行距（92 + 24）
    expect(positions[`ch-${CANVAS_CHAPTERS_PER_ROW}`]?.y).toBe(CANVAS_CARD_HEIGHT + CANVAS_CARD_GAP);
    // 第一行行内仍按同一 y
    expect(positions[`ch-${CANVAS_CHAPTERS_PER_ROW - 1}`]?.y).toBe(0);
    const allShort = layoutCanvasChapters(
      Array.from({ length: CANVAS_CHAPTERS_PER_ROW * 2 }, (_, i) => ({ id: `ch-${i}` })),
      {},
    );
    expect(allShort[`ch-${CANVAS_CHAPTERS_PER_ROW}`]?.y).toBe(
      CANVAS_CARD_HEIGHT_BASE + CANVAS_CARD_GAP,
    );
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

describe("canvasLodLevel（缩放分级：两档）", () => {
  it("0.72 是唯一分界：归上档全量，低一点就是 far（没有 compact 中间档）", () => {
    expect(canvasLodLevel(1)).toBe("full");
    expect(canvasLodLevel(0.72)).toBe("full");
    expect(canvasLodLevel(0.719)).toBe("far");
    expect(canvasLodLevel(0.5)).toBe("far");
    expect(canvasLodLevel(0.25)).toBe("far");
  });
});

describe("canvasContentBounds（内容外包）", () => {
  it("零章 → null（首次进入不猜落点）", () => {
    expect(canvasContentBounds({}, [])).toBeNull();
  });

  it("外包含卡片自身宽高（与网格步长同源）", () => {
    expect(
      canvasContentBounds({ a: { x: 0, y: 0 }, b: { x: 244, y: 116 } }, [
        { id: "a", status: "final" },
        { id: "b", status: "revision" },
      ]),
    ).toEqual({
      x: 0,
      y: 0,
      width: 244 + CANVAS_CARD_WIDTH,
      height: 116 + CANVAS_CARD_HEIGHT,
    });
  });

  it("逐卡高度：短卡 maxY 用 68（不再一律加 92）", () => {
    expect(canvasContentBounds({ a: { x: 0, y: 0 } }, [{ id: "a" }])).toEqual({
      x: 0,
      y: 0,
      width: CANVAS_CARD_WIDTH,
      height: CANVAS_CARD_HEIGHT_BASE,
    });
    // 高卡在下方：外包取各自高度，不被短卡的 68 截断
    expect(
      canvasContentBounds({ a: { x: 0, y: 0 }, b: { x: 0, y: 100 } }, [
        { id: "a" },
        { id: "b", tags: ["伏笔"] },
      ]),
    ).toEqual({ x: 0, y: 0, width: CANVAS_CARD_WIDTH, height: 100 + CANVAS_CARD_HEIGHT });
  });

  it("负坐标也照实求外包（手工左摆的卡片不被归零）", () => {
    expect(canvasContentBounds({ a: { x: -50, y: -20 } }, [{ id: "a" }])).toEqual({
      x: -50,
      y: -20,
      width: CANVAS_CARD_WIDTH,
      height: CANVAS_CARD_HEIGHT_BASE,
    });
  });
});

describe("resolveInitialViewport（首次进入落点）", () => {
  const canvas = { width: 1000, height: 800 };

  it("装得下 → 居中（小书不放大到满屏：zoom 上界 1）", () => {
    expect(resolveInitialViewport({ x: 0, y: 0, width: 220, height: 92 }, canvas)).toEqual({
      x: (1000 - 220) / 2,
      y: (800 - 92) / 2,
      zoom: 1,
    });
  });

  it("装得下且内容有偏移 → 居中以内容为基准（不是以原点）", () => {
    const viewport = resolveInitialViewport({ x: 100, y: 50, width: 220, height: 92 }, canvas);
    expect(viewport).toEqual({ x: (1000 - 220) / 2 - 100, y: (800 - 92) / 2 - 50, zoom: 1 });
  });

  it("装不下 → 钳到全量档下界并从内容左上角 + 留白起步（不居中裁切）", () => {
    const viewport = resolveInitialViewport(
      { x: -30, y: -10, width: 2000, height: 400 },
      { width: 800, height: 600 },
    );
    expect(viewport.zoom).toBe(CANVAS_INITIAL_MIN_ZOOM);
    expect(viewport.x).toBeCloseTo(CANVAS_VIEW_PADDING + 30 * CANVAS_INITIAL_MIN_ZOOM);
    expect(viewport.y).toBeCloseTo(CANVAS_VIEW_PADDING + 10 * CANVAS_INITIAL_MIN_ZOOM);
  });

  it("无内容 / 画布尺寸未就绪 → 中性缺省（不缩放、原点）", () => {
    expect(resolveInitialViewport(null, canvas)).toEqual({ x: 0, y: 0, zoom: 1 });
    const noWidth = resolveInitialViewport({ x: 0, y: 0, width: 220, height: 92 }, {
      width: 0,
      height: 800,
    });
    expect(noWidth).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});

describe("parseCanvasState（读侧兜底与版本门）", () => {
  it("没存过 → 空状态（首次进入按 resolveInitialViewport 落点）", () => {
    expect(parseCanvasState(null)).toEqual({ nodes: {} });
  });

  it("坏 JSON / 非对象 → 空状态，不抛错", () => {
    expect(parseCanvasState("{not json")).toEqual({ nodes: {} });
    expect(parseCanvasState("null")).toEqual({ nodes: {} });
    expect(parseCanvasState('"canvas"')).toEqual({ nodes: {} });
  });

  it("坐标坏条目丢弃（NaN / 字符串 / 缺字段），好条目保留", () => {
    const raw = JSON.stringify({
      version: 3,
      nodes: {
        "ch-0": { x: 1, y: 2 },
        "ch-1": { x: "3", y: 4 },
        "ch-2": { x: 5 },
        "ch-3": "nope",
      },
    });
    expect(parseCanvasState(raw)).toEqual({ nodes: { "ch-0": { x: 1, y: 2 } } });
  });

  it("v3 才接受（坐标 + 视口都读回）", () => {
    const raw = JSON.stringify({
      version: 3,
      nodes: { "ch-0": { x: 1, y: 2 } },
      viewport: { x: 20, y: 30, zoom: 0.9 },
    });
    expect(parseCanvasState(raw)).toEqual({
      nodes: { "ch-0": { x: 1, y: 2 } },
      viewport: { x: 20, y: 30, zoom: 0.9 },
    });
  });

  it("v2 整体丢弃（nodes 空、无 viewport）：一次重排", () => {
    const raw = JSON.stringify({
      version: 2,
      nodes: { "ch-0": { x: 1, y: 2 } },
      viewport: { x: 20, y: 30, zoom: 0.5 },
    });
    expect(parseCanvasState(raw)).toEqual({ nodes: {} });
  });

  it("v1（无 version）/ 旧格式 { nodes, zoom }：整体丢弃", () => {
    expect(
      parseCanvasState(
        JSON.stringify({ nodes: { "ch-0": { x: 1, y: 2 } }, viewport: { x: 20, y: 30, zoom: 0.5 } }),
      ),
    ).toEqual({ nodes: {} });
    expect(parseCanvasState(JSON.stringify({ nodes: { "ch-0": { x: 1, y: 2 } }, zoom: 1.4 }))).toEqual(
      { nodes: {} },
    );
  });

  it("视口缩放夹到画布区间（越界旧值读得回来）", () => {
    const tooBig = JSON.stringify({ version: 3, nodes: {}, viewport: { x: 2, y: 3, zoom: 9 } });
    const tooSmall = JSON.stringify({ version: 3, nodes: {}, viewport: { x: 2, y: 3, zoom: 0.01 } });
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

  it("写盘带 version: 3（读侧只认这个版本）", () => {
    const store = fakeStorage();
    writeCanvasState("book-1", { nodes: {}, viewport: { x: 1, y: 2, zoom: 0.9 } });
    expect(JSON.parse(store.get(canvasStorageKey("book-1")) ?? "null")).toEqual({
      version: 3,
      nodes: {},
      viewport: { x: 1, y: 2, zoom: 0.9 },
    });
  });

  it("按书写读同一个 key", () => {
    const store = fakeStorage();
    const saved = { nodes: { "ch-0": { x: 1, y: 2 } }, viewport: { x: 0, y: 0, zoom: 1 } };
    writeCanvasState("book-1", saved);
    expect(readCanvasState("book-1")).toEqual(saved);
    expect(readCanvasState("book-2")).toEqual({ nodes: {} });
    expect(canvasStorageKey("book-1")).toBe("ai-editor:canvas:book-1");
    expect(store.has(canvasStorageKey("book-2"))).toBe(false);
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
