// 卡 2 练习 helper 读写测试（文风仿写练习两表，2026-10）
// 覆盖：目标 CRUD（含列表 sampleCount）/ 样本 CRUD（列表只出投影、详情含全文与点评卡）/
// 删目标级联删样本与计数 / 目标存在性守卫 / 点评卡写入口（只写 feedback）/
// feedback 坏 JSON 防御解析（坏行不抛错、同表其他行照常）
//
// 注：`feedback` 的唯一**写**入口 = updatePracticeFeedback（由 AI 工具 `submit_style_feedback` 调）；
// 坏 JSON 防御解析用例仍用直写构造（写入口只会序列化出合法 JSON）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, type Db } from "../connection.js";
import {
  createPracticeSample,
  createPracticeTarget,
  deletePracticeSample,
  deletePracticeTarget,
  getPracticeSample,
  getPracticeTarget,
  listPracticeSamples,
  listPracticeTargets,
  updatePracticeDraft,
  updatePracticeFeedback,
  updatePracticeTarget,
} from "./practice.js";

let dir: string;
let db: Db;

/** 直查行数（绕过 helper，验证落库形态而非 helper 自说自话） */
function countTargets(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM practice_targets").get() as { c: number }).c;
}
function countSamples(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM practice_samples").get() as { c: number }).c;
}

/** 直写 updated_at（helper 内部取当前时刻，同毫秒会并列——排序测试用已知时间戳构造确定次序） */
function setTargetUpdatedAt(id: string, t: string): void {
  db.prepare("UPDATE practice_targets SET created_at = ?, updated_at = ? WHERE id = ?").run(t, t, id);
}
function setSampleUpdatedAt(id: string, t: string): void {
  db.prepare("UPDATE practice_samples SET created_at = ?, updated_at = ? WHERE id = ?").run(t, t, id);
}

/** 直写点评卡（只为构造坏 JSON 行；合法写入走 updatePracticeFeedback） */
function setFeedback(id: string, raw: string | null): void {
  db.prepare("UPDATE practice_samples SET feedback = ? WHERE id = ?").run(raw, id);
}

/** 直查某行的范本 / 稿件原文（验证写入口没碰它们——不靠 helper 自说自话） */
function readVerbatim(id: string): { text: string; draft: string } {
  return db.prepare("SELECT text, draft FROM practice_samples WHERE id = ?").get(id) as { text: string; draft: string };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-practice-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("文风目标（practice_targets）", () => {
  it("建目标：id 前缀 pt-、observation 缺省与空串一律写 NULL、created_at = updated_at", () => {
    const bare = createPracticeTarget(db, { name: "汪曾祺" });
    expect(bare.id).toMatch(/^pt-/);
    expect(bare.observation).toBeNull();
    expect(bare.created_at).toBe(bare.updated_at);

    const emptyObservation = createPracticeTarget(db, { name: "海明威", observation: "" });
    expect(emptyObservation.observation).toBeNull();

    const withObservation = createPracticeTarget(db, { name: "张爱玲", observation: "冷峭的比喻" });
    expect(withObservation.observation).toBe("冷峭的比喻");
    expect(countTargets()).toBe(3);

    // 详情按 id 取回（落库形态）
    expect(getPracticeTarget(db, withObservation.id)).toEqual(withObservation);
    expect(getPracticeTarget(db, "pt-missing")).toBeNull();
  });

  it("列表：按 updatedAt 倒序（同值按 id 升序）+ sampleCount（无样本 = 0）", () => {
    const a = createPracticeTarget(db, { name: "甲" });
    const b = createPracticeTarget(db, { name: "乙" });
    createPracticeSample(db, { targetId: a.id, sourceLabel: "节选一", text: "范文一" });
    createPracticeSample(db, { targetId: a.id, sourceLabel: "节选二", text: "范文二" });

    setTargetUpdatedAt(a.id, "2026-10-02T00:00:00Z"); // 较新
    setTargetUpdatedAt(b.id, "2026-10-01T00:00:00Z");

    expect(listPracticeTargets(db)).toEqual([
      { id: a.id, name: "甲", observation: null, sampleCount: 2, createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" },
      { id: b.id, name: "乙", observation: null, sampleCount: 0, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
    ]);

    // 同值（同毫秒写入）时按 id 升序作稳定次序：次序确定且可复现
    setTargetUpdatedAt(b.id, "2026-10-02T00:00:00Z");
    const tied = [a.id, b.id].sort();
    expect(listPracticeTargets(db).map((t) => t.id)).toEqual(tied);

    // 样本删光后 sampleCount 回落（列表计数走同一查询，不留缓存）
    deletePracticeSample(db, listPracticeSamples(db, a.id)![0]!.id);
    deletePracticeSample(db, listPracticeSamples(db, a.id)![0]!.id);
    expect(listPracticeTargets(db)[0]!.sampleCount).toBe(0);
  });

  it("改目标：省略字段不动、空串清空 observation、updated_at 推进；不存在 → null", () => {
    const created = createPracticeTarget(db, { name: "旧名", observation: "旧观察" });
    setTargetUpdatedAt(created.id, "2026-10-01T00:00:00Z");

    const renamed = updatePracticeTarget(db, created.id, { name: "新名" });
    expect(renamed).toMatchObject({ id: created.id, name: "新名", observation: "旧观察" });
    expect(renamed!.updated_at > "2026-10-01T00:00:00Z").toBe(true); // 版本戳推进

    const cleared = updatePracticeTarget(db, created.id, { observation: "" });
    expect(cleared).toMatchObject({ name: "新名", observation: null });

    const untouched = updatePracticeTarget(db, created.id, {});
    expect(untouched).toMatchObject({ name: "新名", observation: null });

    expect(updatePracticeTarget(db, "pt-missing", { name: "无" })).toBeNull();
  });

  it("删目标：物理删 + 级联删该目标下全部样本并返回计数；不存在 → null", () => {
    const doomed = createPracticeTarget(db, { name: "待删" });
    const keeper = createPracticeTarget(db, { name: "保留" });
    createPracticeSample(db, { targetId: doomed.id, sourceLabel: "一", text: "范文一" });
    createPracticeSample(db, { targetId: doomed.id, sourceLabel: "二", text: "范文二" });
    const kept = createPracticeSample(db, { targetId: keeper.id, sourceLabel: "三", text: "范文三" });

    expect(deletePracticeTarget(db, doomed.id)).toEqual({ deleted: true, deletedSamples: 2 });
    expect(getPracticeTarget(db, doomed.id)).toBeNull();
    expect(countTargets()).toBe(1);
    // 级联只作用于该目标下的样本：其他目标的样本原样保留
    expect(countSamples()).toBe(1);
    expect(getPracticeSample(db, kept!.id)).not.toBeNull();

    expect(deletePracticeTarget(db, doomed.id)).toBeNull();
    expect(deletePracticeTarget(db, "pt-missing")).toBeNull();
  });
});

describe("练习样本（practice_samples）", () => {
  it("建样本：id 前缀 ps-、sourceKind 缺省 paste、draft 空串、feedback null；目标不存在 → null 且不落行", () => {
    const target = createPracticeTarget(db, { name: "目标" });
    const sample = createPracticeSample(db, { targetId: target.id, sourceLabel: "受戒节选", text: "明海出家已经四年了。" });

    expect(sample).toMatchObject({
      target_id: target.id,
      source_kind: "paste",
      source_label: "受戒节选",
      text: "明海出家已经四年了。",
      draft: "",
      feedback: null,
    });
    expect(sample!.id).toMatch(/^ps-/);
    expect(sample!.created_at).toBe(sample!.updated_at);

    expect(createPracticeSample(db, { targetId: "pt-missing", sourceLabel: "无主", text: "范文" })).toBeNull();
    expect(countSamples()).toBe(1);
  });

  it("列表只出投影字段（返回对象无 text / draft / feedback 键）、charCount = 范文字符数、hasDraft / hasFeedback 随写入变化", () => {
    const target = createPracticeTarget(db, { name: "目标" });
    const sample = createPracticeSample(db, { targetId: target.id, sourceLabel: "节选", text: "一二三四五" })!;

    const before = listPracticeSamples(db, target.id)!;
    expect(before).toHaveLength(1);
    expect(Object.keys(before[0]!).sort()).toEqual([
      "charCount",
      "createdAt",
      "hasDraft",
      "hasFeedback",
      "id",
      "sourceKind",
      "sourceLabel",
      "updatedAt",
    ]);
    expect(before[0]).not.toHaveProperty("text");
    expect(before[0]).not.toHaveProperty("draft");
    expect(before[0]).not.toHaveProperty("feedback");
    expect(before[0]).toMatchObject({
      id: sample.id,
      sourceKind: "paste",
      sourceLabel: "节选",
      charCount: 5,
      hasDraft: false,
      hasFeedback: false,
    });

    // 写稿 → hasDraft；写卡 → hasFeedback（charCount 仍按范文，不受稿件影响）
    setSampleUpdatedAt(sample.id, "2026-10-02T00:00:00Z");
    updatePracticeDraft(db, sample.id, "一二三");
    setFeedback(sample.id, JSON.stringify({ dimensions: [], summary: "总评" }));
    expect(listPracticeSamples(db, target.id)![0]).toMatchObject({ charCount: 5, hasDraft: true, hasFeedback: true });

    // 清空稿件 → hasDraft 回落（空串 = 未写稿）
    updatePracticeDraft(db, sample.id, "");
    expect(listPracticeSamples(db, target.id)![0]!.hasDraft).toBe(false);

    expect(listPracticeSamples(db, "pt-missing")).toBeNull();
  });

  it("列表按 updatedAt 倒序（同值按 id 升序）；详情含 text / draft / feedback（卡体解析为对象）", () => {
    const target = createPracticeTarget(db, { name: "目标" });
    const older = createPracticeSample(db, { targetId: target.id, sourceLabel: "旧", text: "旧范文", sourceKind: "paste" })!;
    const newer = createPracticeSample(db, { targetId: target.id, sourceLabel: "新", text: "新范文", sourceKind: "paste" })!;
    setSampleUpdatedAt(older.id, "2026-10-01T00:00:00Z");
    setSampleUpdatedAt(newer.id, "2026-10-02T00:00:00Z");

    expect(listPracticeSamples(db, target.id)!.map((s) => s.id)).toEqual([newer.id, older.id]);

    // 同值（同毫秒写入）时按 id 升序作稳定次序——两行 updated_at 逐字相同，次序仍确定（可复现）
    const tieA = createPracticeSample(db, { targetId: target.id, sourceLabel: "平一", text: "范文平一" })!;
    const tieB = createPracticeSample(db, { targetId: target.id, sourceLabel: "平二", text: "范文平二" })!;
    setSampleUpdatedAt(tieA.id, "2026-10-03T00:00:00Z");
    setSampleUpdatedAt(tieB.id, "2026-10-03T00:00:00Z");
    const tied = [tieA.id, tieB.id].sort();
    expect(listPracticeSamples(db, target.id)!.slice(0, 2).map((s) => s.id)).toEqual(tied);

    const card = { dimensions: [{ name: "句长节奏", sample_trait: "短句", draft_trait: "长句", sample_quotes: [], draft_quotes: [], advice: "切短" }], summary: "总评" };
    updatePracticeDraft(db, newer.id, "我的仿写稿");
    setFeedback(newer.id, JSON.stringify(card));

    expect(getPracticeSample(db, newer.id)).toMatchObject({
      id: newer.id,
      target_id: target.id,
      text: "新范文",
      draft: "我的仿写稿",
      feedback: card,
    });
    expect(getPracticeSample(db, "ps-missing")).toBeNull();
  });

  it("改稿：整体覆盖（含清空）、updated_at 推进、范文与点评卡不动；不存在 → null", () => {
    const target = createPracticeTarget(db, { name: "目标" });
    const sample = createPracticeSample(db, { targetId: target.id, sourceLabel: "节选", text: "范文原样" })!;
    setSampleUpdatedAt(sample.id, "2026-10-01T00:00:00Z");
    setFeedback(sample.id, JSON.stringify({ dimensions: [] }));

    const first = updatePracticeDraft(db, sample.id, "初稿");
    expect(first).toEqual({ updatedAt: getPracticeSample(db, sample.id)!.updated_at });
    expect(first!.updatedAt > "2026-10-01T00:00:00Z").toBe(true);

    updatePracticeDraft(db, sample.id, ""); // 清空稿件
    expect(getPracticeSample(db, sample.id)).toMatchObject({
      text: "范文原样",
      draft: "",
      feedback: { dimensions: [] },
    });

    expect(updatePracticeDraft(db, "ps-missing", "无")).toBeNull();
  });

  it("写点评卡：只写 feedback（JSON 序列化写入）、updated_at 推进、范文与稿件一字不动；不存在 → null", () => {
    const target = createPracticeTarget(db, { name: "目标" });
    const sample = createPracticeSample(db, { targetId: target.id, sourceLabel: "节选", text: "范文原样" })!;
    updatePracticeDraft(db, sample.id, "我的稿原样");
    setSampleUpdatedAt(sample.id, "2026-10-01T00:00:00Z");

    const card = {
      dimensions: [
        { name: "句长节奏", sample_trait: "短促", draft_trait: "绵长", sample_quotes: ["范文原样"], draft_quotes: ["我的稿原样"], advice: "收短" },
      ],
      summary: "总评",
    };
    const written = updatePracticeFeedback(db, sample.id, card);
    expect(written!.updatedAt > "2026-10-01T00:00:00Z").toBe(true);
    expect(getPracticeSample(db, sample.id)!.feedback).toEqual(card);
    expect(readVerbatim(sample.id)).toEqual({ text: "范文原样", draft: "我的稿原样" });
    expect(getPracticeSample(db, sample.id)!.updated_at).toBe(written!.updatedAt);

    // 覆盖同一张卡（重写 = 覆盖，不留历史）
    const rewritten = { dimensions: [] };
    updatePracticeFeedback(db, sample.id, rewritten);
    expect(getPracticeSample(db, sample.id)!.feedback).toEqual(rewritten);
    expect(readVerbatim(sample.id)).toEqual({ text: "范文原样", draft: "我的稿原样" });

    expect(updatePracticeFeedback(db, "ps-missing", card)).toBeNull();
  });

  it("删样本：物理删且只删自身；不存在 → false", () => {
    const target = createPracticeTarget(db, { name: "目标" });
    const doomed = createPracticeSample(db, { targetId: target.id, sourceLabel: "一", text: "范文一" })!;
    const kept = createPracticeSample(db, { targetId: target.id, sourceLabel: "二", text: "范文二" })!;

    expect(deletePracticeSample(db, doomed.id)).toBe(true);
    expect(countSamples()).toBe(1);
    expect(getPracticeSample(db, doomed.id)).toBeNull();
    expect(getPracticeSample(db, kept.id)).not.toBeNull();

    expect(deletePracticeSample(db, doomed.id)).toBe(false);
    expect(deletePracticeSample(db, "ps-missing")).toBe(false);
  });
});

describe("feedback 防御解析与卡内层命名", () => {
  it("卡体按行原样解析：内存卡体键名与落库 JSON 逐字相同（内层 snake_case，无 camelCase 转换）", () => {
    const target = createPracticeTarget(db, { name: "目标" });
    const sample = createPracticeSample(db, { targetId: target.id, sourceLabel: "节选", text: "范文" })!;
    const card = {
      dimensions: [
        { name: "叙述距离", sample_trait: "远", draft_trait: "近", sample_quotes: ["范文"], draft_quotes: ["稿"], advice: "拉远" },
      ],
      summary: "总评",
    };
    setFeedback(sample.id, JSON.stringify(card));

    const stored = getPracticeSample(db, sample.id)!.feedback!;
    expect(stored).toEqual(card);
    const dimensions = stored.dimensions as Record<string, unknown>[];
    expect(Object.keys(dimensions[0]!).sort()).toEqual([
      "advice",
      "draft_quotes",
      "draft_trait",
      "name",
      "sample_quotes",
      "sample_trait",
    ]);
  });

  it("坏 JSON（非法文本 / 非对象 / 数组 / JSON null）行不抛错：详情按 null、列表 hasFeedback = false，同表其他行照常返回", () => {
    const target = createPracticeTarget(db, { name: "目标" });
    const card = { dimensions: [{ name: "叙述距离" }], summary: "总评" };
    const rows: Array<{ label: string; raw: string | null; expectCard: unknown }> = [
      { label: "非法 JSON", raw: "{ 这不是 JSON", expectCard: null },
      { label: "JSON 字符串", raw: '"就一段字符串"', expectCard: null },
      { label: "JSON 数组", raw: "[1,2,3]", expectCard: null },
      { label: "JSON null", raw: "null", expectCard: null },
      { label: "空对象", raw: "{}", expectCard: {} }, // 合法 JSON 对象一律透传（形状校验在写入侧）
      { label: "合法卡", raw: JSON.stringify(card), expectCard: card },
      { label: "未点评", raw: null, expectCard: null },
    ];
    for (const [index, row] of rows.entries()) {
      const sample = createPracticeSample(db, { targetId: target.id, sourceLabel: row.label, text: "范文" })!;
      setSampleUpdatedAt(sample.id, `2026-10-0${index + 1}T00:00:00Z`); // 固定次序：列表按 updatedAt 倒序
      setFeedback(sample.id, row.raw);
    }

    // 列表：整表照常返回（坏行不丢也不打挂），hasFeedback 与详情同口径（防御解析后非 null）
    const listed = listPracticeSamples(db, target.id)!;
    expect(listed).toHaveLength(rows.length);
    for (const [index, row] of rows.entries()) {
      const summary = listed.find((s) => s.sourceLabel === row.label)!;
      expect(summary, `列表缺失 ${row.label} 行`).toBeDefined();
      expect(summary.hasFeedback, `${row.label} 的 hasFeedback`).toBe(row.expectCard !== null);
      expect(summary.charCount).toBe(2);
      expect(summary.updatedAt).toBe(`2026-10-0${index + 1}T00:00:00Z`);
    }

    // 详情：坏行 feedback = null（不抛错），合法行照常解析为对象
    for (const row of rows) {
      const id = (db.prepare("SELECT id FROM practice_samples WHERE source_label = ?").get(row.label) as { id: string }).id;
      expect(getPracticeSample(db, id)!.feedback, `${row.label} 的详情反馈`).toEqual(row.expectCard);
    }

    // 坏行仍可正常改稿/删除（防御解析只影响读呈现，不改数据）
    const brokenId = (db.prepare("SELECT id FROM practice_samples WHERE source_label = '非法 JSON'").get() as { id: string }).id;
    expect(updatePracticeDraft(db, brokenId, "仍可写")).toEqual({ updatedAt: expect.any(String) });
    expect(deletePracticeSample(db, brokenId)).toBe(true);
  });
});
