// 拆解 S2 抽取结果的校验与归一（纯函数）测试。契约：docs/design/60-decompose.md §5 + §4。
// 覆盖：逐章对齐（缺章抛错 / 批外章丢弃 / 输出按批序）/ 条数上限截断（人物·设定·地点·关系）/
// 关系白名单（8 类通过、白名单外丢弃）/ 端点存在性（本批 ∪ 累计；归一化后比较）/ 字段长度与
// personality 条数 / 契约禁止字段不落（ability_panel · custom_fields · location.parent_id）/
// 空名与坏形状容忍（不整批失败）/ role 自由文本不校验。
import { describe, expect, it } from "vitest";
import {
  DECOMPOSE_CHAPTER_MAX_CHARACTERS,
  DECOMPOSE_CHAPTER_MAX_LOCATIONS,
  DECOMPOSE_CHAPTER_MAX_RELATIONS,
  DECOMPOSE_CHAPTER_MAX_SETTINGS,
  DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS,
  DECOMPOSE_DESCRIPTION_MAX_CHARS,
  DECOMPOSE_MOTIVATION_MAX_CHARS,
  DECOMPOSE_PERSONALITY_MAX_ITEMS,
  DECOMPOSE_RELATION_TYPES,
  normalizeExtraction,
} from "./extract.js";

/** 造一章原始产出（LLM 形状：字段可缺、可超限、可带契约禁止字段） */
function rawChapter(chapterIndex: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { chapterIndex, chapterTitle: `标题${chapterIndex}`, summary: `第${chapterIndex}章摘要`, ...overrides };
}

/** 一批原始产出 */
function rawBatch(chapters: unknown[]): unknown {
  return { chapters };
}

/** 造 N 个不重名的人物条目 */
function characters(count: number, prefix = "人物"): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, position) => ({ name: `${prefix}${position + 1}` }));
}

/** 白名单契约（手写字面量：故意不复用实现常量，否则「收窄到 8 类」变成自证） */
const WHITELIST = ["ally", "rival", "mentor", "family", "kills", "belongs_to", "owns", "masters"] as const;

const longText = (chars: number): string => "甲".repeat(chars);

describe("逐章对齐（缺章 = 唯一整批失败条件）", () => {
  it("缺章抛错（消息带缺的章序，runner 据此整批重试）", () => {
    const raw = rawBatch([rawChapter(1), rawChapter(3)]);
    expect(() => normalizeExtraction(raw, [1, 2, 3])).toThrowError(/缺章：2/);
  });

  it("整批不是对象 / chapters 不是数组 → 视同全部缺章", () => {
    expect(() => normalizeExtraction(null, [1])).toThrowError(/缺章：1/);
    expect(() => normalizeExtraction({ chapters: "nope" }, [1, 2])).toThrowError(/缺章：1、2/);
  });

  it("输出按 expected 顺序（不按模型给的顺序）", () => {
    const raw = rawBatch([rawChapter(3), rawChapter(1), rawChapter(2)]);
    const { result } = normalizeExtraction(raw, [1, 2, 3]);
    expect(result.chapters.map((chapter) => chapter.chapterIndex)).toEqual([1, 2, 3]);
  });

  it("批外章条目丢弃并记 discarded（不静默）", () => {
    const { result, discarded } = normalizeExtraction(rawBatch([rawChapter(1), rawChapter(9)]), [1]);
    expect(result.chapters).toHaveLength(1);
    expect(discarded.join("\n")).toContain("第9章不在本批范围内");
  });

  it("重复章序只取首条并记 discarded", () => {
    const raw = rawBatch([rawChapter(1, { summary: "首条" }), rawChapter(1, { summary: "次条" })]);
    const { result, discarded } = normalizeExtraction(raw, [1]);
    expect(result.chapters[0]?.summary).toBe("首条");
    expect(discarded.join("\n")).toContain("重复出现");
  });

  it("chapterIndex 非法（缺 / 非整数 / 0）的条目丢弃，且算缺章", () => {
    const raw = rawBatch([rawChapter(1), { chapterTitle: "无序号" }, { chapterIndex: 0 }, rawChapter(2), rawChapter(3)]);
    const { result, discarded } = normalizeExtraction(raw, [1, 2, 3]);
    expect(result.chapters.map((chapter) => chapter.chapterIndex)).toEqual([1, 2, 3]);
    expect(discarded.join("\n")).toContain("无法解析");
    expect(discarded.join("\n")).not.toContain("第0章"); // 0 不是合法章序（1-based）
    expect(() => normalizeExtraction(rawBatch([rawChapter(1), { chapterTitle: "无序号" }]), [1, 2])).toThrowError(/缺章：2/);
  });

  it("模型没给标题 → 章序兜底（标题以大纲为准）", () => {
    const { result } = normalizeExtraction(rawBatch([{ chapterIndex: 1 }]), [1]);
    expect(result.chapters[0]?.chapterTitle).toBe("第1章");
  });
});

describe("每章条数上限截断（超限截断并记日志）", () => {
  const cases = [
    { field: "characters", max: DECOMPOSE_CHAPTER_MAX_CHARACTERS },
    { field: "settings", max: DECOMPOSE_CHAPTER_MAX_SETTINGS },
    { field: "locations", max: DECOMPOSE_CHAPTER_MAX_LOCATIONS },
  ] as const;

  for (const { field, max } of cases) {
    it(`${field} 超 DECOMPOSE_CHAPTER_MAX_${field.toUpperCase()} → 截断到上限 + 记 discarded`, () => {
      const over = characters(max + 1, field);
      const { result, discarded } = normalizeExtraction(rawBatch([rawChapter(1, { [field]: over })]), [1]);
      expect(result.chapters[0]?.[field]).toHaveLength(max);
      expect(discarded.join("\n")).toContain(`超 DECOMPOSE_CHAPTER_MAX_${field.toUpperCase()}`);
    });

    it(`${field} 未超限 → 原样保留、无截断记录`, () => {
      const { result, discarded } = normalizeExtraction(rawBatch([rawChapter(1, { [field]: characters(max) })]), [1]);
      expect(result.chapters[0]?.[field]).toHaveLength(max);
      expect(discarded).toEqual([]);
    });
  }

  it("关系超 DECOMPOSE_CHAPTER_MAX_RELATIONS → 截断（先过滤后截断，只数合法关系）", () => {
    const names = characters(2);
    const relations = Array.from({ length: DECOMPOSE_CHAPTER_MAX_RELATIONS + 1 }, () => ({
      source: "人物1",
      target: "人物2",
      type: "ally",
    }));
    const { result, discarded } = normalizeExtraction(rawBatch([rawChapter(1, { characters: names, relations })]), [1]);
    expect(result.chapters[0]?.relations).toHaveLength(DECOMPOSE_CHAPTER_MAX_RELATIONS);
    expect(discarded.join("\n")).toContain("超 DECOMPOSE_CHAPTER_MAX_RELATIONS");
  });

  it("白名单外的关系不占条数（先过滤后截断）", () => {
    const names = characters(2);
    const illegal = Array.from({ length: DECOMPOSE_CHAPTER_MAX_RELATIONS + 1 }, () => ({
      source: "人物1",
      target: "人物2",
      type: "plants",
    }));
    const legal = [{ source: "人物1", target: "人物2", type: "rival" }];
    const { result, discarded } = normalizeExtraction(
      rawBatch([rawChapter(1, { characters: names, relations: [...illegal, ...legal] })]),
      [1],
    );
    expect(result.chapters[0]?.relations).toEqual([{ source: "人物1", target: "人物2", type: "rival" }]);
    expect(discarded.join("\n")).not.toContain("超 DECOMPOSE_CHAPTER_MAX_RELATIONS");
  });
});

describe("关系类型白名单（收窄到 AI 可产出的 8 类）", () => {
  it("白名单与文档 §5 逐字一致（手写字面量：不复用实现常量，否则成自证）", () => {
    expect([...DECOMPOSE_RELATION_TYPES]).toEqual([...WHITELIST]);
  });

  for (const type of WHITELIST) {
    it(`白名单内 ${type} 保留`, () => {
      const raw = rawBatch([
        rawChapter(1, { characters: characters(2), relations: [{ source: "人物1", target: "人物2", type }] }),
      ]);
      const { result } = normalizeExtraction(raw, [1]);
      expect(result.chapters[0]?.relations[0]?.type).toBe(type);
    });
  }

  it("白名单外（plants / occurs_at / 自定义类型）丢弃并记 discarded", () => {
    const relations = [
      { source: "人物1", target: "人物2", type: "plants" },
      { source: "人物1", target: "人物2", type: "occurs_at" },
      { source: "人物1", target: "人物2", type: "宿敌" },
    ];
    const { result, discarded } = normalizeExtraction(rawBatch([rawChapter(1, { characters: characters(2), relations })]), [1]);
    expect(result.chapters[0]?.relations).toEqual([]);
    expect(discarded.join("\n")).toContain("不在 DECOMPOSE_RELATION_TYPES");
  });

  it("类型首尾空白先 trim 再判白名单（「 ally 」= ally，与 S3 归并同口径）", () => {
    const relations = [{ source: "人物1", target: "人物2", type: " ally " }];
    const { result } = normalizeExtraction(rawBatch([rawChapter(1, { characters: characters(2), relations })]), [1]);
    expect(result.chapters[0]?.relations).toEqual([{ source: "人物1", target: "人物2", type: "ally" }]);
  });

  it("缺 source / target / type 的关系丢弃", () => {
    const relations = [{ source: "人物1", target: "人物2" }, { source: "人物1", type: "ally" }, { target: "人物2", type: "ally" }];
    const { result, discarded } = normalizeExtraction(rawBatch([rawChapter(1, { characters: characters(2), relations })]), [1]);
    expect(result.chapters[0]?.relations).toEqual([]);
    expect(discarded.join("\n")).toContain("缺 source/target/type");
  });
});

describe("关系端点必须存在于本批或累计候选集合（防幻觉）", () => {
  it("端点不在集合 → 丢弃", () => {
    const relations = [{ source: "人物1", target: "查无此人", type: "ally" }];
    const { result, discarded } = normalizeExtraction(rawBatch([rawChapter(1, { characters: characters(1), relations })]), [1]);
    expect(result.chapters[0]?.relations).toEqual([]);
    expect(discarded.join("\n")).toContain("端点不在候选集合");
  });

  it("端点由累计候选集合（前几批已出现）提供 → 保留", () => {
    const relations = [{ source: "前批人物", target: "人物1", type: "ally" }];
    const raw = rawBatch([rawChapter(2, { characters: characters(1), relations })]);
    const { result } = normalizeExtraction(raw, [2], ["前批人物"]);
    expect(result.chapters[0]?.relations).toHaveLength(1);
  });

  it("端点可与设定 / 地点名匹配（belongs_to / owns 的结构关系端点不限于人物）", () => {
    const relations = [{ source: "人物1", target: "青云门", type: "belongs_to" }];
    const raw = rawBatch([
      rawChapter(1, { characters: characters(1), settings: [{ name: "青云门" }], locations: [{ name: "后山" }], relations }),
    ]);
    const { result } = normalizeExtraction(raw, [1]);
    expect(result.chapters[0]?.relations).toHaveLength(1);
  });

  it("端点比较先归一化（全角空格 / 多空白不构成两个人）", () => {
    const relations = [{ source: "人\u3000物\u30001", target: "人物2", type: "ally" }];
    const characters = [{ name: "人 物 1" }, { name: "人物2" }];
    const { result } = normalizeExtraction(rawBatch([rawChapter(1, { characters, relations })]), [1]);
    expect(result.chapters[0]?.relations).toHaveLength(1);
  });

  it("本批的端点集合跨章共享（后章的端点可由前章提供）", () => {
    const raw = rawBatch([
      rawChapter(1, { characters: [{ name: "甲" }] }),
      rawChapter(2, { characters: [{ name: "乙" }], relations: [{ source: "甲", target: "乙", type: "mentor" }] }),
    ]);
    const { result } = normalizeExtraction(raw, [1, 2]);
    expect(result.chapters[1]?.relations).toHaveLength(1);
  });
});

describe("字段长度与 personality 条数上限", () => {
  it("章摘要截断到 DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS", () => {
    const raw = rawBatch([rawChapter(1, { summary: longText(DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS + 10) })]);
    expect(normalizeExtraction(raw, [1]).result.chapters[0]?.summary).toHaveLength(DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS);
  });

  it("description 截断到 DECOMPOSE_DESCRIPTION_MAX_CHARS（人物 / 设定 / 地点三处同口径）", () => {
    const description = longText(DECOMPOSE_DESCRIPTION_MAX_CHARS + 10);
    const raw = rawBatch([
      rawChapter(1, {
        characters: [{ name: "甲", description }],
        settings: [{ name: "乙", description }],
        locations: [{ name: "丙", description }],
      }),
    ]);
    const chapter = normalizeExtraction(raw, [1]).result.chapters[0];
    expect(chapter?.characters[0]?.description).toHaveLength(DECOMPOSE_DESCRIPTION_MAX_CHARS);
    expect(chapter?.settings[0]?.description).toHaveLength(DECOMPOSE_DESCRIPTION_MAX_CHARS);
    expect(chapter?.locations[0]?.description).toHaveLength(DECOMPOSE_DESCRIPTION_MAX_CHARS);
  });

  it("motivation 截断到 DECOMPOSE_MOTIVATION_MAX_CHARS", () => {
    const raw = rawBatch([
      rawChapter(1, { characters: [{ name: "甲", motivation: longText(DECOMPOSE_MOTIVATION_MAX_CHARS + 10) }] }),
    ]);
    expect(normalizeExtraction(raw, [1]).result.chapters[0]?.characters[0]?.motivation).toHaveLength(DECOMPOSE_MOTIVATION_MAX_CHARS);
  });

  it("personality 截条数到 DECOMPOSE_PERSONALITY_MAX_ITEMS", () => {
    const raw = rawBatch([
      rawChapter(1, {
        characters: [{ name: "甲", personality: Array.from({ length: DECOMPOSE_PERSONALITY_MAX_ITEMS + 3 }, (_, i) => `特质${i}`) }],
      }),
    ]);
    expect(normalizeExtraction(raw, [1]).result.chapters[0]?.characters[0]?.personality).toHaveLength(
      DECOMPOSE_PERSONALITY_MAX_ITEMS,
    );
  });

  it("未填的可选字段不产生 undefined / 空串键（JSON 落库干净）", () => {
    const raw = rawBatch([rawChapter(1, { characters: [{ name: "甲", description: "  ", personality: ["", "冷静"] }] })]);
    const character = normalizeExtraction(raw, [1]).result.chapters[0]?.characters[0];
    expect(character).toStrictEqual({ name: "甲", personality: ["冷静"] });
  });
});

describe("契约禁止字段一律丢弃（§5：不读即不落）", () => {
  it("人物的 ability_panel / custom_fields 不落结果", () => {
    const raw = rawBatch([
      rawChapter(1, {
        characters: [{ name: "甲", role: "主角", ability_panel: [{ name: "火系" }], custom_fields: { 血型: "O" } }],
      }),
    ]);
    const character = normalizeExtraction(raw, [1]).result.chapters[0]?.characters[0];
    expect(character).toStrictEqual({ name: "甲", role: "主角" });
    expect(Object.keys(character ?? {})).not.toContain("ability_panel");
    expect(Object.keys(character ?? {})).not.toContain("custom_fields");
  });

  it("设定的 custom_fields 不落结果", () => {
    const raw = rawBatch([rawChapter(1, { settings: [{ name: "青云门", tags: ["门派"], custom_fields: { 人数: 300 } }] })]);
    expect(normalizeExtraction(raw, [1]).result.chapters[0]?.settings[0]).toStrictEqual({ name: "青云门", tags: ["门派"] });
  });

  it("地点的 parent_id 不落结果（不做地点层级）", () => {
    const raw = rawBatch([rawChapter(1, { locations: [{ name: "后山", type: "野外", parent_id: "loc-1" }] })]);
    expect(normalizeExtraction(raw, [1]).result.chapters[0]?.locations[0]).toStrictEqual({ name: "后山", type: "野外" });
  });
});

describe("坏形状容忍（除缺章外都不整批失败）", () => {
  it("空名条目丢弃（人物 / 设定 / 地点各自）", () => {
    const raw = rawBatch([
      rawChapter(1, {
        characters: [{ name: "" }, { name: "  " }, { name: "甲" }],
        settings: [{ name: 42 }, { name: "乙" }],
        locations: [{ name: null }, { name: "丙" }],
      }),
    ]);
    const chapter = normalizeExtraction(raw, [1]).result.chapters[0];
    expect(chapter?.characters).toEqual([{ name: "甲" }]);
    expect(chapter?.settings).toEqual([{ name: "乙" }]);
    expect(chapter?.locations).toEqual([{ name: "丙" }]);
  });

  it("数组字段不是数组 → 视同空（不抛错）", () => {
    const raw = rawBatch([rawChapter(1, { characters: "甲", settings: null, locations: 3, relations: {} })]);
    const chapter = normalizeExtraction(raw, [1]).result.chapters[0];
    expect(chapter).toMatchObject({ characters: [], settings: [], locations: [], relations: [] });
  });

  it("role 是自由文本：任意取值原样保留（服务端不校验、不给枚举）", () => {
    const raw = rawBatch([rawChapter(1, { characters: [{ name: "甲", role: "隐藏Boss" }] })]);
    expect(normalizeExtraction(raw, [1]).result.chapters[0]?.characters[0]?.role).toBe("隐藏Boss");
  });

  it("age 接受文本或数字（与 shared characterDataSchema 同口径）", () => {
    const raw = rawBatch([rawChapter(1, { characters: [{ name: "甲", age: 17 }, { name: "乙", age: "十七八岁" }] })]);
    const chapter = normalizeExtraction(raw, [1]).result.chapters[0];
    expect(chapter?.characters.map((character) => character.age)).toEqual([17, "十七八岁"]);
  });
});
