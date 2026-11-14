// 写作页卷章导航栏行派生（2026-11）。契约：docs/ui/DESIGN.md `writing-page`。
// 重点：文件序（不按 chapterRows 重组）、存量根级章原位、0 章卷保留、软删跳过、编号徽标同源。
import { describe, expect, it } from "vitest";
import type {
  OutlineChapter,
  OutlineTree,
  OutlineVolume,
} from "@whispering233/ai-editor-shared";
import { buildWritingRailRows } from "./writing";

const chapter = (
  id: string,
  title: string,
  options: { textLength?: number; deleted?: boolean } = {},
): OutlineChapter => ({
  id,
  type: "chapter",
  title,
  updatedAt: "t",
  ...(options.textLength === undefined ? {} : { metadata: { textLength: options.textLength } }),
  ...(options.deleted === true ? { deleted: true } : {}),
});

const volume = (
  id: string,
  title: string,
  children: OutlineChapter[],
  deleted?: boolean,
): OutlineVolume => ({
  id,
  type: "volume",
  title,
  updatedAt: "t",
  children,
  ...(deleted === true ? { deleted: true } : {}),
});

function tree(children: OutlineTree["children"]): OutlineTree {
  return { id: "root", type: "root", schemaVersion: 1, children };
}

describe("buildWritingRailRows", () => {
  it("null 树 / 空树 → 空行", () => {
    expect(buildWritingRailRows(null)).toEqual([]);
    expect(buildWritingRailRows(tree([]))).toEqual([]);
  });

  it("按文件序：卷行 → 该卷章行；徽标查 numberOutline、字数取 metadata、volumeId 归卷", () => {
    const outline = tree([
      volume("vol-1", "第一卷", [chapter("ch-1", "雪夜出走", { textLength: 1200 }), chapter("ch-2", "旧盟友")]),
      volume("vol-2", "第二卷", [chapter("ch-3", "入城", { textLength: 500 })]),
    ]);
    expect(buildWritingRailRows(outline)).toEqual([
      { kind: "volume", id: "vol-1", label: "第1卷", title: "第一卷", chapterCount: 2 },
      {
        kind: "chapter",
        id: "ch-1",
        label: "第1章",
        title: "雪夜出走",
        textLength: 1200,
        volumeId: "vol-1",
      },
      {
        kind: "chapter",
        id: "ch-2",
        label: "第2章",
        title: "旧盟友",
        textLength: 0,
        volumeId: "vol-1",
      },
      { kind: "volume", id: "vol-2", label: "第2卷", title: "第二卷", chapterCount: 1 },
      {
        kind: "chapter",
        id: "ch-3",
        label: "第3章",
        title: "入城",
        textLength: 500,
        volumeId: "vol-2",
      },
    ]);
  });

  it("存量根级章在顶层原位置就地显示（volumeId=null），章号跨卷连续不另起编号", () => {
    const outline = tree([
      volume("vol-1", "第一卷", [chapter("ch-1", "雪夜出走")]),
      chapter("ch-2", "根级旧章"),
      volume("vol-2", "第二卷", [chapter("ch-3", "入城")]),
    ]);
    expect(buildWritingRailRows(outline).map((row) => row.id)).toEqual([
      "vol-1",
      "ch-1",
      "ch-2",
      "vol-2",
      "ch-3",
    ]);
    const rootChapter = buildWritingRailRows(outline)[2];
    expect(rootChapter).toMatchObject({
      kind: "chapter",
      id: "ch-2",
      label: "第2章",
      volumeId: null,
    });
    expect(buildWritingRailRows(outline)[4]).toMatchObject({
      kind: "chapter",
      id: "ch-3",
      label: "第3章",
    });
  });

  it("0 个可见章的卷保留卷行（chapterCount=0；软删章不计数、不出章行）", () => {
    const outline = tree([
      volume("vol-1", "空卷", []),
      volume("vol-2", "删空卷", [chapter("ch-1", "已删章", { deleted: true })]),
    ]);
    expect(buildWritingRailRows(outline)).toEqual([
      { kind: "volume", id: "vol-1", label: "第1卷", title: "空卷", chapterCount: 0 },
      { kind: "volume", id: "vol-2", label: "第2卷", title: "删空卷", chapterCount: 0 },
    ]);
  });

  it("软删卷整棵跳过；软删章跳过但后续章号按可见序重排（展示口径）", () => {
    const outline = tree([
      volume("vol-1", "第一卷", [
        chapter("ch-1", "雪夜出走"),
        chapter("ch-2", "旧盟友", { deleted: true }),
        chapter("ch-3", "入城"),
      ]),
      volume("vol-2", "删掉的卷", [chapter("ch-4", "不该出现")], true),
    ]);
    expect(buildWritingRailRows(outline)).toEqual([
      { kind: "volume", id: "vol-1", label: "第1卷", title: "第一卷", chapterCount: 2 },
      {
        kind: "chapter",
        id: "ch-1",
        label: "第1章",
        title: "雪夜出走",
        textLength: 0,
        volumeId: "vol-1",
      },
      {
        kind: "chapter",
        id: "ch-3",
        label: "第2章",
        title: "入城",
        textLength: 0,
        volumeId: "vol-1",
      },
    ]);
  });
});
