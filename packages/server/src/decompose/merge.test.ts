// 拆解 S3 规则归并（四步有序纯管线）与写入计划（纯函数）测试。契约：docs/design/60-decompose.md §6 + §6.1。
// 覆盖：name 归一化（trim / 折叠空白 / 全角空格）/ 同名同类型同一实体（跨类型不并）/ 关系去重 + 对称关系方向归一
// （判据 = shared RELATION_TYPE_META.symmetric）/ 跨章阈值（人物·关系设、设定·地点不设）/ **四步顺序**（去重、
// 别名重映射与重新去重、自环丢弃、别名归并后阈值才生效、悬空关系过滤）/ 别名组硬校验（名字必须存在 /
// 不重复分组 / 组 ≥ 2 / 组大小上限 / 候选按提及次数截断）/ 候选排序稳定性 /
// merge_written 三路比对五分支（create · reuse · keep-user-edited · soft-delete · keep-and-report）+ 跨轮 baseline 面
// （复用已有行不重复建 · 跨轮 keep 不软删 · 用户编辑优先）。
import { describe, expect, it } from "vitest";
import {
  DECOMPOSE_ALIAS_CANDIDATE_MAX,
  DECOMPOSE_ALIAS_GROUP_MAX,
  DECOMPOSE_ALIAS_GROUP_MIN_NAMES,
  DECOMPOSE_MENTION_MIN_CHAPTERS,
  dedupeCandidates,
  mergeCandidates,
  normalizeEntityName,
  planMergeWrite,
  selectAliasCandidates,
  validateAliasGroups,
  type AliasCandidate,
  type MergeSnapshotRow,
  type MergeWrittenEntry,
} from "./merge.js";
import type { DecomposeBatchResult, DecomposeExtractedChapter } from "@whispering233/ai-editor-shared";

/** 造一章归并输入（已经过 S2 归一，形状 = shared 的抽取结果） */
function chapter(chapterIndex: number, overrides: Partial<DecomposeExtractedChapter> = {}): DecomposeExtractedChapter {
  return { chapterIndex, chapterTitle: `标题${chapterIndex}`, summary: "摘要", characters: [], settings: [], locations: [], relations: [], ...overrides };
}

const batch = (...chapters: DecomposeExtractedChapter[]): DecomposeBatchResult => ({ chapters });
const named = (...names: string[]): Array<{ name: string }> => names.map((name) => ({ name }));
const relation = (source: string, target: string, type: string) => ({ source, target, type });

const candidate = (name: string, chapterCount: number, firstChapter = 1): AliasCandidate => ({ name, chapterCount, firstChapter });

describe("normalizeEntityName（同名判据的单一来源）", () => {
  it("trim + 折叠空白（含全角空格）为单个半角空格", () => {
    expect(normalizeEntityName("  张三  ")).toBe("张三");
    expect(normalizeEntityName("张\u3000三")).toBe("张 三");
    expect(normalizeEntityName("张  三\t四")).toBe("张 三 四");
  });

  it("全角空格与半角空格归一后同名（同一实体的两种写法）", () => {
    expect(normalizeEntityName("张\u3000三")).toBe(normalizeEntityName("张 三"));
  });

  it("非空白字符不归一（全角字母保留原样，不猜测等价）", () => {
    expect(normalizeEntityName("ＡＢ")).toBe("ＡＢ");
    expect(normalizeEntityName("ＡＢ")).not.toBe(normalizeEntityName("AB"));
  });
});

describe("实体归并：名字归一化后同名同类型 = 同一实体", () => {
  it("跨章同名合并为一条，chapters 升序去重", () => {
    const outcome = mergeCandidates([
      batch(chapter(2, { characters: named("张三") }), chapter(1, { characters: named(" 张三 ") }), chapter(2, { characters: named("张\u3000三") })),
    ]);
    expect(outcome.entities).toEqual([{ type: "character", name: "张三", chapters: [1, 2] }]);
  });

  it("同名不同类型是两个实体（设定「龙」与人物「龙」不并）", () => {
    const outcome = mergeCandidates([
      batch(
        chapter(1, { characters: named("龙"), settings: named("龙"), locations: named("龙") }),
        chapter(2, { characters: named("龙") }), // 人物过阈值（阈值按章计）
      ),
    ]);
    expect(outcome.entities.map((entity) => entity.type)).toEqual(["character", "setting", "location"]);
    expect(outcome.entities.map((entity) => entity.name)).toEqual(["龙", "龙", "龙"]);
  });

  it("空名 / 纯空白名不产生实体", () => {
    const outcome = mergeCandidates([batch(chapter(1, { characters: named("", "  ") }))]);
    expect(outcome.entities).toEqual([]);
    expect(outcome.filtered.characters).toEqual([]);
  });
});

describe("关系归并：去重 + 对称方向归一（判据 = shared RELATION_TYPE_META.symmetric）", () => {
  // 对称归一的规范方向 = 名字升序（「张三」<「李四」），故期望里都是张三在前
  const pair = (type: string, chapters: [number, number], first: [string, string], second: [string, string]) =>
    mergeCandidates([
      batch(
        chapter(chapters[0], { characters: named("张三", "李四"), relations: [relation(...first, type)] }),
        chapter(chapters[1], { characters: named("张三", "李四"), relations: [relation(...second, type)] }),
      ),
    ]);

  it("同 (source, target, type) 跨章去重，chapters 聚合", () => {
    const outcome = pair("mentor", [1, 3], ["张三", "李四"], ["张三", "李四"]);
    expect(outcome.relations).toEqual([{ source: "张三", target: "李四", type: "mentor", chapters: [1, 3] }]);
  });

  it("对称关系（shared 注册表标注 symmetric 的类型）反向写法归一到同一枚关系", () => {
    // 手写字面量（故意不复用 RELATION_TYPE_META）：断言注册表本身的对称口径，而非循环自证
    for (const type of ["ally", "rival", "family"]) {
      const outcome = pair(type, [1, 2], ["张三", "李四"], ["李四", "张三"]);
      expect(outcome.relations).toEqual([{ source: "张三", target: "李四", type, chapters: [1, 2] }]);
    }
  });

  it("有向关系（mentor / kills）反向写法是两枚关系，不归一", () => {
    for (const type of ["mentor", "kills"]) {
      const outcome = mergeCandidates([
        batch(
          chapter(1, {
            characters: named("张三", "李四"),
            relations: [relation("张三", "李四", type), relation("李四", "张三", type)],
          }),
          chapter(2, {
            characters: named("张三", "李四"),
            relations: [relation("张三", "李四", type), relation("李四", "张三", type)],
          }),
        ),
      ]);
      expect(outcome.relations.map((item) => `${item.source}→${item.target}:${item.type}`)).toEqual([
        `张三→李四:${type}`,
        `李四→张三:${type}`,
      ]);
    }
  });

  it("自定义类型（不在 RELATION_TYPE_META）一律有向：反向写法不归一", () => {
    const outcome = mergeCandidates([
      batch(
        chapter(1, { characters: named("张三", "李四"), relations: [relation("张三", "李四", "宿敌")] }),
        chapter(2, { characters: named("张三", "李四"), relations: [relation("张三", "李四", "宿敌"), relation("李四", "张三", "宿敌")] }),
        chapter(3, { characters: named("张三", "李四"), relations: [relation("李四", "张三", "宿敌")] }),
      ),
    ]);
    expect(outcome.relations.map((item) => `${item.source}→${item.target}`)).toEqual(["张三→李四", "李四→张三"]);
  });

  it("关系类型 trim（「 ally 」与「ally」同一枚）；端点名字归一化后比较", () => {
    const outcome = mergeCandidates([
      batch(
        chapter(1, { characters: named("张三", "李四"), relations: [relation("张三", "李四", "ally")] }),
        chapter(2, { characters: named("张三", "李四"), relations: [relation(" 李四 ", " 张三 ", " ally ")] }),
      ),
    ]);
    expect(outcome.relations).toEqual([{ source: "张三", target: "李四", type: "ally", chapters: [1, 2] }]);
  });
});

describe("跨章阈值（人物与关系设阈值；设定与地点不设）", () => {
  it("单章人物不落库、进 filtered（报告里透明化）", () => {
    const outcome = mergeCandidates([batch(chapter(1, { characters: named("路人") }))]);
    expect(outcome.entities).toEqual([]);
    expect(outcome.filtered.characters).toEqual([{ type: "character", name: "路人", chapters: [1] }]);
  });

  it(`跨章出现 ≥ DECOMPOSE_MENTION_MIN_CHAPTERS 的人物落库`, () => {
    const chapters = Array.from({ length: DECOMPOSE_MENTION_MIN_CHAPTERS }, (_, position) => chapter(position + 1, { characters: named("张三") }));
    expect(mergeCandidates([batch(...chapters)]).entities).toHaveLength(1);
  });

  it("单章设定 / 地点照常落库（一次出现也可能是重要宝物）", () => {
    const outcome = mergeCandidates([batch(chapter(1, { settings: named("青云剑"), locations: named("后山") }))]);
    expect(outcome.entities.map((entity) => entity.type)).toEqual(["setting", "location"]);
    expect(outcome.filtered.characters).toEqual([]);
  });

  it("单章关系不落库、进 filtered", () => {
    const outcome = mergeCandidates([
      batch(chapter(1, { characters: named("张三", "李四"), relations: [relation("张三", "李四", "ally")] })),
    ]);
    expect(outcome.relations).toEqual([]);
    expect(outcome.filtered.relations).toEqual([{ source: "张三", target: "李四", type: "ally", chapters: [1] }]);
  });

  it("同一章内重复提及不凑阈值（去重按章，不按提及次数）", () => {
    const outcome = mergeCandidates([batch(chapter(1, { characters: named("甲", "甲", "甲") }))]);
    expect(outcome.entities).toEqual([]);
    expect(outcome.filtered.characters[0]?.chapters).toEqual([1]);
  });
});

describe("四步有序纯管线（去重 → 别名 → 阈值 → 悬空过滤）", () => {
  // 对称关系（ally）的规范方向 = 名字升序：「乙」（U+4E59）< 「甲」（U+7532），故期望里都是乙在前
  it("第 1 步单独调用不设阈值（单章人物原样保留；阈值是第 3 步的事）", () => {
    const deduped = dedupeCandidates([batch(chapter(1, { characters: named("路人") }))]);
    expect(deduped.entities).toEqual([{ type: "character", name: "路人", chapters: [1] }]);
  });

  it("关系去重键含 relation_type：同 (source, target) 的 ally 与 rival 各存一枚", () => {
    const outcome = mergeCandidates([
      batch(
        chapter(1, { characters: named("甲", "乙"), relations: [relation("甲", "乙", "ally"), relation("甲", "乙", "rival")] }),
        chapter(2, { characters: named("甲", "乙"), relations: [relation("甲", "乙", "rival"), relation("甲", "乙", "ally")] }),
      ),
    ]);
    expect(outcome.relations.map((item) => `${item.source}→${item.target}:${item.type}`)).toEqual(["乙→甲:ally", "乙→甲:rival"]);
    expect(outcome.relations.map((item) => item.chapters)).toEqual([[1, 2], [1, 2]]);
  });

  it("第 4 步 · 端点被阈值滤掉 ⇒ 关系即便达阈值也丢进 filtered（悬空边不留）", () => {
    const outcome = mergeCandidates([
      batch(
        chapter(1, { characters: named("甲", "乙"), relations: [relation("甲", "乙", "ally")] }),
        chapter(2, { characters: named("乙"), relations: [relation("甲", "乙", "ally")] }),
      ),
    ]);
    expect(outcome.entities.map((entity) => entity.name)).toEqual(["乙"]);
    expect(outcome.filtered.characters.map((entity) => entity.name)).toEqual(["甲"]);
    expect(outcome.relations).toEqual([]);
    expect(outcome.filtered.relations).toEqual([{ source: "乙", target: "甲", type: "ally", chapters: [1, 2] }]);
  });

  it("第 2 步 · 别名组：实体合并（章节集并集）+ 关系端点重映射并重新去重", () => {
    const outcome = mergeCandidates(
      [
        batch(
          chapter(1, { characters: named("甲", "乙"), relations: [relation("甲", "乙", "ally")] }),
          chapter(2, { characters: named("甲某", "乙"), relations: [relation("甲某", "乙", "ally")] }),
        ),
      ],
      [{ canonical: "甲某", aliases: ["甲"] }],
    );
    expect(outcome.entities).toEqual([
      { type: "character", name: "甲某", chapters: [1, 2] },
      { type: "character", name: "乙", chapters: [1, 2] },
    ]);
    expect(outcome.relations).toEqual([{ source: "乙", target: "甲某", type: "ally", chapters: [1, 2] }]);
  });

  it("第 3 步在第 2 步之后 · 别名把两个单章名并成跨 2 章实体 ⇒ 合并后不被阈值滤掉", () => {
    const outcome = mergeCandidates(
      [batch(chapter(1, { characters: named("甲") }), chapter(2, { characters: named("甲某") }))],
      [{ canonical: "甲某", aliases: ["甲"] }],
    );
    expect(outcome.entities).toEqual([{ type: "character", name: "甲某", chapters: [1, 2] }]);
    expect(outcome.filtered.characters).toEqual([]);
  });

  it("第 2 步 · 自环关系（别名把两端并成同一实体）被丢弃，且不计入 filtered", () => {
    const outcome = mergeCandidates(
      [
        batch(
          chapter(1, { characters: named("甲", "甲某"), relations: [relation("甲", "甲某", "ally")] }),
          chapter(2, { characters: named("甲某", "甲"), relations: [relation("甲某", "甲", "ally")] }),
        ),
      ],
      [{ canonical: "甲某", aliases: ["甲"] }],
    );
    expect(outcome.entities).toEqual([{ type: "character", name: "甲某", chapters: [1, 2] }]);
    expect(outcome.relations).toEqual([]);
    expect(outcome.filtered.relations).toEqual([]);
  });
});

describe("别名组硬校验（§6 第 2 层）", () => {
  const candidates = [candidate("张三", 8), candidate("张老三", 5), candidate("三哥", 3), candidate("李四", 2)];

  it("合法组接受（名字全部在候选集合内、组大小在区间内）", () => {
    const group = { canonical: "张三", aliases: ["张老三", "三哥"] };
    expect(validateAliasGroups([group], candidates)).toEqual({ accepted: [group], rejected: [] });
  });

  it("名字必须存在于候选集合（含规范名；禁止发明新名字）", () => {
    const invented = validateAliasGroups([{ canonical: "张三", aliases: ["查无此人"] }], candidates);
    expect(invented.accepted).toEqual([]);
    expect(invented.rejected[0]?.reason).toContain("不在候选集合");
    const inventedCanonical = validateAliasGroups([{ canonical: "王五", aliases: ["张三"] }], candidates);
    expect(inventedCanonical.accepted).toEqual([]);
  });

  it("同一名字不得出现在两组（后一组丢弃，前一组保留）", () => {
    const first = { canonical: "张三", aliases: ["张老三"] };
    const second = { canonical: "三哥", aliases: ["张老三"] };
    const validation = validateAliasGroups([first, second], candidates);
    expect(validation.accepted).toEqual([first]);
    expect(validation.rejected[0]?.group).toEqual(second);
    expect(validation.rejected[0]?.reason).toContain("已出现在前一组");
  });

  it(`组内名字数少于 DECOMPOSE_ALIAS_GROUP_MIN_NAMES → 丢弃（单名组 / 归一化后同名的组）`, () => {
    expect(validateAliasGroups([{ canonical: "张三", aliases: [] }], candidates).accepted).toEqual([]);
    const sameName = validateAliasGroups([{ canonical: "张 三", aliases: ["张\u3000三"] }], candidates);
    expect(sameName.accepted).toEqual([]);
    expect(sameName.rejected[0]?.reason).toContain("少于 DECOMPOSE_ALIAS_GROUP_MIN_NAMES");
  });

  it(`恰好 DECOMPOSE_ALIAS_GROUP_MIN_NAMES 个名字 → 接受（下界是闭区间）`, () => {
    const names = candidates.slice(0, DECOMPOSE_ALIAS_GROUP_MIN_NAMES).map((item) => item.name);
    const minimal = { canonical: names[0] as string, aliases: names.slice(1) };
    expect(validateAliasGroups([minimal], candidates).accepted).toEqual([minimal]);
  });

  it(`组大小超过 DECOMPOSE_ALIAS_GROUP_MAX → 丢弃（保守：多半是把不同实体错并）`, () => {
    const many = Array.from({ length: DECOMPOSE_ALIAS_GROUP_MAX + 1 }, (_, position) => candidate(`别名${position}`, 9 - position));
    const group = { canonical: "别名0", aliases: many.slice(1).map((item) => item.name) };
    const validation = validateAliasGroups([group], many);
    expect(validation.accepted).toEqual([]);
    expect(validation.rejected[0]?.reason).toContain("DECOMPOSE_ALIAS_GROUP_MAX");
  });

  it("候选按提及次数截断：被截断的名字视为不存在（组被丢弃）", () => {
    const many = Array.from({ length: DECOMPOSE_ALIAS_CANDIDATE_MAX + 1 }, (_, position) => candidate(`人物${position}`, 100 - position));
    const dropped = many[DECOMPOSE_ALIAS_CANDIDATE_MAX] as AliasCandidate; // 提及次数最低 ⇒ 被截断
    const group = { canonical: "人物0", aliases: [dropped.name] };
    expect(validateAliasGroups([group], many).accepted).toEqual([]);
    expect(selectAliasCandidates(many)).not.toContainEqual(dropped);
  });

  it("候选排序：按提及次数降序、等次数保持入参顺序（两次调用结果一致）", () => {
    const ties = [candidate("甲", 3), candidate("乙", 5), candidate("丙", 3)];
    expect(selectAliasCandidates(ties).map((item) => item.name)).toEqual(["乙", "甲", "丙"]);
    expect(selectAliasCandidates(ties)).toEqual(selectAliasCandidates(ties));
  });
});

describe("merge_written 三路比对（新产物 × 记录面 × 库内快照）", () => {
  const written = (id: string, updatedAt: string): MergeWrittenEntry => ({ id, type: "character", updated_at: updatedAt });
  const row = (id: string, updatedAt: string, deletedAt: string | null = null): MergeSnapshotRow => ({
    id,
    type: "character",
    updated_at: updatedAt,
    deleted_at: deletedAt,
  });

  it("分支 1 · 新产物有、记录面与库内都没有 → create", () => {
    const plan = planMergeWrite([{ key: "character:新人物", id: null }], [], []);
    expect(plan).toEqual([{ action: "create", id: null, key: "character:新人物" }]);
  });

  it("分支 1 变体 · 库内已有同身份行但记录面都没有（用户手工建的）→ 复用该行、不 create 重复行", () => {
    const plan = planMergeWrite([{ key: "character:张三", id: "char-1" }], [], [row("char-1", "t1")]);
    expect(plan).toEqual([{ action: "keep-user-edited", id: "char-1", key: "character:张三" }]);
  });

  it("跨轮 · baseline 有记录、本 job 清单没有，库内值一致 → reuse（复用 + 增量更新）", () => {
    const plan = planMergeWrite([{ key: "character:张三", id: "char-1" }], [], [row("char-1", "t1")], [written("char-1", "t1")]);
    expect(plan).toEqual([{ action: "reuse", id: "char-1", key: "character:张三" }]);
  });

  it("跨轮 · baseline 有记录与库内不一致（用户改过）→ keep-user-edited（不覆盖、不认领）", () => {
    const plan = planMergeWrite([{ key: "character:张三", id: "char-1" }], [], [row("char-1", "t2")], [written("char-1", "t1")]);
    expect(plan).toEqual([{ action: "keep-user-edited", id: "char-1", key: "character:张三" }]);
  });

  it("跨轮 · baseline 有、本 job 清单没有、新产物也没有 → 不进计划（不软删——续拆不是全量重算）", () => {
    expect(planMergeWrite([], [], [row("char-1", "t1")], [written("char-1", "t1")])).toEqual([]);
    expect(planMergeWrite([], [], [row("char-1", "t2")], [written("char-1", "t1")])).toEqual([]);
  });

  it("本 job 清单是软删面：跨轮条目即使库内行已消失也不产计划项", () => {
    expect(planMergeWrite([], [written("char-1", "t1")], [], [written("char-1", "t1")])).toEqual([]);
  });

  it("分支 2 · 新旧都有且库内 updated_at 等于清单记录值 → reuse（不动）", () => {
    const plan = planMergeWrite([{ key: "character:张三", id: "char-1" }], [written("char-1", "t1")], [row("char-1", "t1")]);
    expect(plan).toEqual([{ action: "reuse", id: "char-1", key: "character:张三" }]);
  });

  it("分支 3 · 新旧都有但 updated_at 变了（用户改过）→ keep-user-edited（不覆盖）", () => {
    const plan = planMergeWrite([{ key: "character:张三", id: "char-1" }], [written("char-1", "t1")], [row("char-1", "t2")]);
    expect(plan).toEqual([{ action: "keep-user-edited", id: "char-1", key: "character:张三" }]);
  });

  it("分支 4a · 清单里有、新产物没有且 updated_at 未变 → soft-delete", () => {
    const plan = planMergeWrite([], [written("char-1", "t1")], [row("char-1", "t1")]);
    expect(plan).toEqual([{ action: "soft-delete", id: "char-1", key: null }]);
  });

  it("分支 4b · 清单里有、新产物没有但 updated_at 变了 → keep-and-report（保留 + 提示）", () => {
    const plan = planMergeWrite([], [written("char-1", "t1")], [row("char-1", "t2")]);
    expect(plan).toEqual([{ action: "keep-and-report", id: "char-1", key: null }]);
  });

  it("清单里有、库内行已不存在（软删/物理删）→ 无事可做（不产计划项）", () => {
    expect(planMergeWrite([], [written("char-1", "t1")], [])).toEqual([]);
    expect(planMergeWrite([], [written("char-1", "t1")], [row("char-1", "t1", "t2")])).toEqual([]);
  });

  it("软删行视同不存在：同身份产物按新行创建（不复活回收站里的旧行）", () => {
    const plan = planMergeWrite([{ key: "character:张三", id: "char-1" }], [written("char-1", "t1")], [row("char-1", "t1", "t2")]);
    expect(plan).toEqual([{ action: "create", id: null, key: "character:张三" }]);
  });

  it("四分支同一份输入一次算清（产物顺序 = 计划顺序，清单残留按清单顺序追加）", () => {
    const plan = planMergeWrite(
      [
        { key: "character:张三", id: "char-1" },
        { key: "character:李四", id: "char-2" },
        { key: "character:王五", id: null },
      ],
      [written("char-1", "t1"), written("char-2", "t1"), written("char-3", "t1"), written("char-4", "t1")],
      [row("char-1", "t1"), row("char-2", "t9"), row("char-3", "t1"), row("char-4", "t9")],
    );
    expect(plan.map((item) => item.action)).toEqual(["reuse", "keep-user-edited", "create", "soft-delete", "keep-and-report"]);
    expect(plan.map((item) => item.id)).toEqual(["char-1", "char-2", null, "char-3", "char-4"]);
  });

  it("不改 db：入参数组与快照对象原样（纯函数）", () => {
    const products = [{ key: "character:张三", id: "char-1" }];
    const entries = [written("char-1", "t1")];
    const snapshot = [row("char-1", "t2")];
    const baseline = [written("char-1", "t0")];
    const before = JSON.stringify({ products, entries, snapshot, baseline });
    planMergeWrite(products, entries, snapshot, baseline);
    expect(JSON.stringify({ products, entries, snapshot, baseline })).toBe(before);
  });
});
