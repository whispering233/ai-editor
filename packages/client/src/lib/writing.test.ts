// 写作页卷章导航栏行派生（2026-11）。契约：docs/ui/DESIGN.md `writing-page`。
// 重点：文件序（不按 chapterRows 重组）、存量根级章原位、0 章卷保留、软删跳过、编号徽标同源。
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  OutlineChapter,
  OutlineTree,
  OutlineVolume,
} from "@whispering233/ai-editor-shared";
import {
  buildWritingRailRows,
  expectedHooksForChapter,
  LAST_OPENED_CHAPTERS_KEY,
  parseLastOpenedChapters,
  pickRecentChapter,
  readLastOpenedChapter,
  resolveWritingTarget,
  writeLastOpenedChapter,
} from "./writing";

const chapter = (
  id: string,
  title: string,
  options: { textLength?: number; documentUpdatedAt?: string; deleted?: boolean } = {},
): OutlineChapter => ({
  id,
  type: "chapter",
  title,
  updatedAt: "t",
  ...((options.textLength === undefined && options.documentUpdatedAt === undefined)
    ? {}
    : {
        metadata: {
          ...(options.textLength === undefined ? {} : { textLength: options.textLength }),
          ...(options.documentUpdatedAt === undefined ? {} : { documentUpdatedAt: options.documentUpdatedAt }),
        },
      }),
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

// ============ 最近导航（`#/writing` 无 id 时的目标解析）============

describe("parseLastOpenedChapters（storage 脏值防御）", () => {
  it("坏 JSON / null / 数组 / 非对象 / 标量 → 空表", () => {
    expect(parseLastOpenedChapters(null)).toEqual({});
    expect(parseLastOpenedChapters("not json")).toEqual({});
    expect(parseLastOpenedChapters('["p-1"]')).toEqual({});
    expect(parseLastOpenedChapters("123")).toEqual({});
    expect(parseLastOpenedChapters('"p-1"')).toEqual({});
  });

  it("只保留 value 为非空 string 的条目（key 原样；空串 / null / 数字丢弃）", () => {
    expect(
      parseLastOpenedChapters('{"p-1":"ch-1","p-2":"","p-3":null,"p-4":7,"p-5":"ch-5"}'),
    ).toEqual({ "p-1": "ch-1", "p-5": "ch-5" });
  });
});

describe("readLastOpenedChapter / writeLastOpenedChapter（per-book 隔离）", () => {
  const store: Record<string, string> = {};
  const fakeStorage = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(store)) delete store[key];
  });

  it("写 → 读；两本书各存各的，合并写不互相覆盖；key = LAST_OPENED_CHAPTERS_KEY", () => {
    vi.stubGlobal("localStorage", fakeStorage);
    writeLastOpenedChapter("p-1", "ch-1");
    writeLastOpenedChapter("p-2", "ch-9");
    expect(readLastOpenedChapter("p-1")).toBe("ch-1");
    expect(readLastOpenedChapter("p-2")).toBe("ch-9");
    writeLastOpenedChapter("p-1", "ch-2");
    expect(readLastOpenedChapter("p-1")).toBe("ch-2");
    expect(readLastOpenedChapter("p-2")).toBe("ch-9");
    expect(Object.keys(store)).toEqual([LAST_OPENED_CHAPTERS_KEY]);
    expect(JSON.parse(store[LAST_OPENED_CHAPTERS_KEY])).toEqual({ "p-1": "ch-2", "p-2": "ch-9" });
  });

  it("projectId 为 null：读 null、写 no-op", () => {
    vi.stubGlobal("localStorage", fakeStorage);
    writeLastOpenedChapter(null, "ch-1");
    expect(store).toEqual({});
    expect(readLastOpenedChapter(null)).toBeNull();
  });

  it("存储不可用（getItem / setItem 抛错）：读 null、写静默不抛", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("privacy mode");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(readLastOpenedChapter("p-1")).toBeNull();
    expect(() => writeLastOpenedChapter("p-1", "ch-1")).not.toThrow();
  });
});

describe("pickRecentChapter（服务端回退：documentUpdatedAt 最大）", () => {
  it("null 树 / 无时间戳 → null（不跳第一章）", () => {
    expect(pickRecentChapter(null)).toBeNull();
    expect(pickRecentChapter(tree([volume("vol-1", "卷一", [chapter("ch-1", "无正文")])]))).toBeNull();
  });

  it("取 documentUpdatedAt 最大者；跨卷与根级章同场比较（文件序）", () => {
    const outline = tree([
      volume("vol-1", "卷一", [
        chapter("ch-1", "甲", { documentUpdatedAt: "2026-11-01T10:00:00Z" }),
        chapter("ch-2", "乙", { documentUpdatedAt: "2026-11-03T10:00:00Z" }),
      ]),
      chapter("ch-root", "根级章", { documentUpdatedAt: "2026-11-02T10:00:00Z" }),
      volume("vol-2", "卷二", [chapter("ch-3", "丙", { documentUpdatedAt: "2026-11-01T09:00:00Z" })]),
    ]);
    expect(pickRecentChapter(outline)).toBe("ch-2");
  });

  it("平局取文件序先序第一个", () => {
    const outline = tree([
      volume("vol-1", "卷一", [
        chapter("ch-1", "甲", { documentUpdatedAt: "2026-11-01T10:00:00Z" }),
        chapter("ch-2", "乙", { documentUpdatedAt: "2026-11-01T10:00:00Z" }),
      ]),
    ]);
    expect(pickRecentChapter(outline)).toBe("ch-1");
  });

  it("软删章 / 软删卷不参与回退", () => {
    const outline = tree([
      volume("vol-1", "卷一", [
        chapter("ch-1", "甲", { documentUpdatedAt: "2026-11-01T10:00:00Z" }),
        chapter("ch-2", "乙", { documentUpdatedAt: "2026-11-05T10:00:00Z", deleted: true }),
      ]),
      volume("vol-dead", "删卷", [chapter("ch-3", "丙", { documentUpdatedAt: "2026-11-06T10:00:00Z" })], true),
    ]);
    expect(pickRecentChapter(outline)).toBe("ch-1");
  });

  it("只看 documentUpdatedAt：正文为空的章不参与回退", () => {
    // 章存在但正文为空（无 documentUpdatedAt）仍可打开，但回退指针只认已保存正文
    const outline = tree([volume("vol-1", "卷一", [chapter("ch-1", "空章"), chapter("ch-2", "有正文", { documentUpdatedAt: "2026-11-01T10:00:00Z" })])]);
    expect(pickRecentChapter(outline)).toBe("ch-2");
  });
});

describe("resolveWritingTarget（最近打开优先 → 服务端回退）", () => {
  const outline = tree([
    volume("vol-1", "卷一", [
      chapter("ch-1", "甲", { documentUpdatedAt: "2026-11-01T10:00:00Z" }),
      chapter("ch-2", "乙", { documentUpdatedAt: "2026-11-02T10:00:00Z" }),
      chapter("ch-dead", "删章", { documentUpdatedAt: "2026-11-05T10:00:00Z", deleted: true }),
    ]),
  ]);

  it("大纲未加载 → null", () => {
    expect(resolveWritingTarget(null, "ch-1")).toBeNull();
  });

  it("最近打开仍在可见大纲 → 用它（优先于更大的 documentUpdatedAt）", () => {
    expect(resolveWritingTarget(outline, "ch-1")).toBe("ch-1");
  });

  it("最近打开已软删 / 不在当前树（换书残留）→ 回退最近编辑", () => {
    expect(resolveWritingTarget(outline, "ch-dead")).toBe("ch-2");
    expect(resolveWritingTarget(outline, "ch-other-book")).toBe("ch-2");
  });

  it("无最近打开且无已保存正文 → null（空态，不跳第一章）", () => {
    expect(resolveWritingTarget(tree([volume("vol-1", "卷一", [chapter("ch-1", "空章")])]), null)).toBeNull();
  });
});

describe("expectedHooksForChapter（切章瞬间不显示上一章的坑）", () => {
  const HOOKS = [{ id: "hook-1", name: "断剑来历", status: "planted" as const }];

  it("来源章 = 当前章 → 渲染该批条目", () => {
    expect(expectedHooksForChapter({ chapterId: "ch-1", items: HOOKS }, "ch-1")).toEqual(HOOKS);
  });

  it("来源章 ≠ 当前章（旧响应还没被新章的替换）→ 空", () => {
    expect(expectedHooksForChapter({ chapterId: "ch-1", items: HOOKS }, "ch-2")).toEqual([]);
  });

  it("未加载 / 无选中章 → 空", () => {
    expect(expectedHooksForChapter(null, "ch-1")).toEqual([]);
    expect(expectedHooksForChapter({ chapterId: "ch-1", items: HOOKS }, undefined)).toEqual([]);
  });
});
