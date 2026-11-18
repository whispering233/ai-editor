// 画布卡片第三行（状态 + 剧情线标签）渲染单测：草稿不占位、标签截断 +N、全空不渲染整行。
// 卡面是画布的读数面（状态 / 标签只能在这里看到），显隐错了等于信息静默丢失。
// 另守高度两档：68px 只装得下两行（章号 + 章名），第三行必须在无元信息时不渲染。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import {
  CANVAS_CARD_HEIGHT,
  CANVAS_CARD_HEIGHT_BASE,
  canvasCardHeight,
  type CanvasChapterCard,
} from "../../lib/outline-canvas-layout";
import { ChapterCard, type ChapterCardData, type ChapterCardNode } from "./ChapterCard";

function card(over: Partial<CanvasChapterCard> = {}): CanvasChapterCard {
  return {
    id: "ch-1",
    title: "开端",
    volumeLabel: "第1卷",
    chapterNumber: 3,
    chapterLabel: "第3章",
    sceneCount: 5,
    written: false,
    tags: [],
    ...over,
  };
}

function render(data: Partial<ChapterCardData> & { card: CanvasChapterCard }): string {
  const props = {
    id: data.card.id,
    data: { marks: [], reading: false, deduction: false, filtered: false, ...data },
    selected: false,
  } as unknown as NodeProps<ChapterCardNode>;
  return renderToString(
    <ReactFlowProvider>
      <ChapterCard {...props} />
    </ReactFlowProvider>,
  );
}

describe("ChapterCard 第三行（状态 + 剧情线标签）", () => {
  it("非草稿状态可见：修正中 / 定稿（定稿带 primary 圆点）", () => {
    expect(render({ card: card({ status: "revision" }) })).toContain("修正中");
    const final = render({ card: card({ status: "final" }) });
    expect(final).toContain("定稿");
    expect(final).toContain("bg-primary");
  });

  it("草稿 = 默认值不显示，且状态与标签全空时整行不渲染", () => {
    for (const status of ["draft", undefined] as const) {
      const html = render({ card: card({ status }) });
      expect(html).not.toContain("草稿");
      expect(html).not.toContain('data-lod="status"');
    }
  });

  it("标签最多 2 个，超出显示 +N；完整列表进 title", () => {
    const html = render({ card: card({ tags: ["伏笔", "转折", "高潮"] }) });
    // 卡面只有前两个（title 里有完整列表，故按 tint 底色计数，不按文案）
    expect(html.match(/bg-tag-/g)).toHaveLength(2);
    expect(html).toContain("+<!-- -->1");
    expect(html).toContain("#伏笔 #转折 #高潮");
  });

  it("title = 卷号·章号 章名 · 场数；data-written 供 far 档底色", () => {
    const html = render({ card: card({ written: true }) });
    expect(html).toContain("第1卷·第3章 开端 · 5 场");
    expect(html).toContain('data-written="true"');
    expect(render({ card: card() })).toContain('data-written="false"');
  });

  it("筛选未命中 → data-filtered=\"true\"（透明度钩子在 canvas-theme.css）", () => {
    expect(render({ card: card(), filtered: true })).toContain('data-filtered="true"');
    expect(render({ card: card() })).toContain('data-filtered="false"');
  });

  it("far 档章号角标 = 纯数字（无「第/章」；显隐与配色在 canvas-theme.css）", () => {
    expect(render({ card: card() })).toContain('<span data-lod="far-number">3</span>');
  });
});

describe("ChapterCard 高度两档（68 / 92）", () => {
  // 两行内容高 = py-2 (16) + 徽标 22 + gap-1 (4) + 章名 20 = 62；再挂第三行 +20 ⇒ 82
  const TWO_ROWS = 62;
  const THREE_ROWS = 82;

  it("无状态无标签 → 68，只渲染章号 + 章名（第三行在 DOM 里都不存在）", () => {
    const html = render({ card: card() });
    expect(canvasCardHeight(card())).toBe(CANVAS_CARD_HEIGHT_BASE);
    expect(html).toContain('data-lod="head"');
    expect(html).toContain('data-lod="title"');
    expect(html).not.toContain('data-lod="status"');
    // 68 刚好夹在两行与三行之间：装得下两行、装不下第三行（这就是 base 档的由来）
    expect(CANVAS_CARD_HEIGHT_BASE).toBeGreaterThanOrEqual(TWO_ROWS);
    expect(CANVAS_CARD_HEIGHT_BASE).toBeLessThan(THREE_ROWS);
  });

  it("有状态或标签 → 92，第三行存在（三行装得下）", () => {
    for (const over of [{ status: "final" as const }, { tags: ["伏笔"] }]) {
      expect(canvasCardHeight(card(over))).toBe(CANVAS_CARD_HEIGHT);
      expect(render({ card: card(over) })).toContain('data-lod="status"');
    }
    expect(CANVAS_CARD_HEIGHT).toBeGreaterThanOrEqual(THREE_ROWS);
  });
});
