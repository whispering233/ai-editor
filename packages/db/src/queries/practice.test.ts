// 卡 2 练习 helper 读写测试（练习三表，2026-10 改版）
// 覆盖：样本 CRUD（列表只出投影、详情含全文与点评卡、`work_id` 可空）/ 自由练习 CRUD
// （空题目 = 待出题、出题入口只写 topic / brief）/ 风格说明素材包（覆盖 upsert、幂等删除、无覆盖 = 无行）/
// 每列唯一写入口（范文与用户稿不被点评写入口碰到，反之亦然）/ feedback 坏 JSON 防御解析
//
// 注：`feedback` 的唯一**写**入口 = updatePracticeFeedback / updatePracticePieceFeedback（由 AI 工具调）；
// 坏 JSON 防御解析用例仍用直写构造（写入口只会序列化出合法 JSON）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, type Db } from "../connection.js";
import {
  createPracticePiece,
  createPracticeSample,
  deletePracticePiece,
  deletePracticeSample,
  deleteStylePack,
  getPracticePiece,
  getPracticeSample,
  getStylePack,
  listPracticePieces,
  listPracticeSamples,
  updatePracticeFeedback,
  updatePracticePieceDraft,
  updatePracticePieceFeedback,
  updatePracticePieceTopic,
  updatePracticeSampleDraft,
  upsertStylePack,
} from "./practice.js";

let dir: string;
let db: Db;

/** 直查行数（绕过 helper，验证落库形态而非 helper 自说自话） */
function countSamples(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM practice_samples").get() as { c: number }).c;
}
function countPieces(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM practice_free_pieces").get() as { c: number }).c;
}

/** 直写 updated_at（helper 内部取当前时刻，同毫秒会并列——排序测试用已知时间戳构造确定次序） */
function setSampleUpdatedAt(id: string, t: string): void {
  db.prepare("UPDATE practice_samples SET created_at = ?, updated_at = ? WHERE id = ?").run(t, t, id);
}
function setPieceUpdatedAt(id: string, t: string): void {
  db.prepare("UPDATE practice_free_pieces SET created_at = ?, updated_at = ? WHERE id = ?").run(t, t, id);
}

/** 直写点评卡（只为构造坏 JSON 行；合法写入走 updatePracticeFeedback 等写入口） */
function setSampleFeedback(id: string, raw: string | null): void {
  db.prepare("UPDATE practice_samples SET feedback = ? WHERE id = ?").run(raw, id);
}
function setPieceFeedback(id: string, raw: string | null): void {
  db.prepare("UPDATE practice_free_pieces SET feedback = ? WHERE id = ?").run(raw, id);
}

/** 直查范本 / 稿件原文（验证写入口没碰它们——不靠 helper 自说自话） */
function readSampleVerbatim(id: string): { text: string; draft: string } {
  return db.prepare("SELECT text, draft FROM practice_samples WHERE id = ?").get(id) as { text: string; draft: string };
}
function readPieceVerbatim(id: string): { topic: string; brief: string; draft: string } {
  return db.prepare("SELECT topic, brief, draft FROM practice_free_pieces WHERE id = ?").get(id) as {
    topic: string;
    brief: string;
    draft: string;
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-practice-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("范文样本（practice_samples）", () => {
  it("建样本：id 前缀 ps-、workId 缺省与显式 null 一律落 NULL、excerptLabel 缺省空串、draft 空串、feedback null", () => {
    const bare = createPracticeSample(db, { text: "明海出家已经四年了。" });
    expect(bare.id).toMatch(/^ps-/);
    expect(bare).toMatchObject({
      work_id: null,
      excerpt_label: "",
      text: "明海出家已经四年了。",
      draft: "",
      feedback: null,
    });
    expect(bare.created_at).toBe(bare.updated_at);

    const explicitNull = createPracticeSample(db, { workId: null, excerptLabel: "受戒节选", text: "范文二" });
    expect(explicitNull.work_id).toBeNull();
    expect(explicitNull.excerpt_label).toBe("受戒节选");

    const withWork = createPracticeSample(db, { workId: "longzu", text: "范文三" });
    expect(withWork.work_id).toBe("longzu");
    expect(countSamples()).toBe(3);

    // 详情按 id 取回（存储形态）
    expect(getPracticeSample(db, withWork.id)).toEqual(withWork);
    expect(getPracticeSample(db, "ps-missing")).toBeNull();
  });

  it("列表只出投影字段（无 text / draft / feedback 键）、charCount = 范文字符数、hasDraft / hasFeedback 随写入变化", () => {
    const sample = createPracticeSample(db, { workId: "longzu", excerptLabel: "节选", text: "一二三四五" });

    const before = listPracticeSamples(db);
    expect(before).toHaveLength(1);
    expect(Object.keys(before[0]!).sort()).toEqual([
      "charCount",
      "createdAt",
      "excerptLabel",
      "hasDraft",
      "hasFeedback",
      "id",
      "updatedAt",
      "workId",
    ]);
    expect(before[0]).not.toHaveProperty("text");
    expect(before[0]).not.toHaveProperty("draft");
    expect(before[0]).not.toHaveProperty("feedback");
    expect(before[0]).toMatchObject({
      id: sample.id,
      workId: "longzu",
      excerptLabel: "节选",
      charCount: 5,
      hasDraft: false,
      hasFeedback: false,
    });

    // 写稿 → hasDraft；写卡 → hasFeedback（charCount 仍按范文，不受稿件影响）
    setSampleUpdatedAt(sample.id, "2026-10-02T00:00:00Z");
    updatePracticeSampleDraft(db, sample.id, "一二三");
    setSampleFeedback(sample.id, JSON.stringify({ dimensions: [], summary: "总评" }));
    expect(listPracticeSamples(db)[0]).toMatchObject({ charCount: 5, hasDraft: true, hasFeedback: true });

    // 清空稿件 → hasDraft 回落（空串 = 未写稿）
    updatePracticeSampleDraft(db, sample.id, "");
    expect(listPracticeSamples(db)[0]!.hasDraft).toBe(false);
  });

  it("列表按 updatedAt 倒序（同值按 id 升序）；详情含 text / draft / feedback（卡体解析为对象）", () => {
    const older = createPracticeSample(db, { text: "旧范文" });
    const newer = createPracticeSample(db, { text: "新范文" });
    setSampleUpdatedAt(older.id, "2026-10-01T00:00:00Z");
    setSampleUpdatedAt(newer.id, "2026-10-02T00:00:00Z");

    expect(listPracticeSamples(db).map((s) => s.id)).toEqual([newer.id, older.id]);

    // 同值（同毫秒写入）时按 id 升序作稳定次序——两行 updated_at 逐字相同，次序仍确定（可复现）
    const tieA = createPracticeSample(db, { text: "范文平一" });
    const tieB = createPracticeSample(db, { text: "范文平二" });
    setSampleUpdatedAt(tieA.id, "2026-10-03T00:00:00Z");
    setSampleUpdatedAt(tieB.id, "2026-10-03T00:00:00Z");
    expect(listPracticeSamples(db).slice(0, 2).map((s) => s.id)).toEqual([tieA.id, tieB.id].sort());

    const card = {
      dimensions: [
        {
          name: "句长节奏",
          sample_trait: "短句",
          draft_trait: "长句",
          sample_quotes: ["新范文"],
          draft_quotes: ["我的仿写稿"],
          advice: "切短",
        },
      ],
      summary: "总评",
    };
    updatePracticeSampleDraft(db, newer.id, "我的仿写稿");
    setSampleFeedback(newer.id, JSON.stringify(card));

    expect(getPracticeSample(db, newer.id)).toMatchObject({
      id: newer.id,
      work_id: null,
      text: "新范文",
      draft: "我的仿写稿",
      feedback: card,
    });
  });

  it("改稿：整体覆盖（含清空）、updated_at 推进、范文与点评卡不动；不存在 → null", () => {
    const sample = createPracticeSample(db, { text: "范文原样" });
    setSampleUpdatedAt(sample.id, "2026-10-01T00:00:00Z");
    setSampleFeedback(sample.id, JSON.stringify({ dimensions: [] }));

    const first = updatePracticeSampleDraft(db, sample.id, "初稿");
    expect(first).toEqual({ updatedAt: getPracticeSample(db, sample.id)!.updated_at });
    expect(first!.updatedAt > "2026-10-01T00:00:00Z").toBe(true);

    updatePracticeSampleDraft(db, sample.id, ""); // 清空稿件
    expect(getPracticeSample(db, sample.id)).toMatchObject({
      text: "范文原样",
      draft: "",
      feedback: { dimensions: [] },
    });

    expect(updatePracticeSampleDraft(db, "ps-missing", "无")).toBeNull();
  });

  it("写点评卡：只写 feedback（JSON 序列化写入）、updated_at 推进、范文与稿件一字不动；不存在 → null", () => {
    const sample = createPracticeSample(db, { text: "范文原样" });
    updatePracticeSampleDraft(db, sample.id, "我的稿原样");
    setSampleUpdatedAt(sample.id, "2026-10-01T00:00:00Z");

    const card = {
      dimensions: [
        {
          name: "句长节奏",
          sample_trait: "短促",
          draft_trait: "绵长",
          sample_quotes: ["范文原样"],
          draft_quotes: ["我的稿原样"],
          advice: "收短",
        },
      ],
      summary: "总评",
    };
    const written = updatePracticeFeedback(db, sample.id, card);
    expect(written!.updatedAt > "2026-10-01T00:00:00Z").toBe(true);
    expect(getPracticeSample(db, sample.id)!.feedback).toEqual(card);
    expect(readSampleVerbatim(sample.id)).toEqual({ text: "范文原样", draft: "我的稿原样" });
    expect(getPracticeSample(db, sample.id)!.updated_at).toBe(written!.updatedAt);

    // 覆盖同一张卡（重写 = 覆盖，不留历史）
    const rewritten = { dimensions: [] };
    updatePracticeFeedback(db, sample.id, rewritten);
    expect(getPracticeSample(db, sample.id)!.feedback).toEqual(rewritten);
    expect(readSampleVerbatim(sample.id)).toEqual({ text: "范文原样", draft: "我的稿原样" });

    expect(updatePracticeFeedback(db, "ps-missing", card)).toBeNull();
  });

  it("删样本：物理删且只删自身；重复删除与不存在均返回 false（幂等不抛错）", () => {
    const doomed = createPracticeSample(db, { text: "范文一" });
    const kept = createPracticeSample(db, { text: "范文二" });

    expect(deletePracticeSample(db, doomed.id)).toBe(true);
    expect(countSamples()).toBe(1);
    expect(getPracticeSample(db, doomed.id)).toBeNull();
    expect(getPracticeSample(db, kept.id)).not.toBeNull();

    expect(deletePracticeSample(db, doomed.id)).toBe(false);
    expect(deletePracticeSample(db, "ps-missing")).toBe(false);
  });
});

describe("自由练习（practice_free_pieces）", () => {
  it("建篇：id 前缀 pf-、topic / brief 缺省空串、draft 空串、feedback null、topic_source 原样落库", () => {
    const pending = createPracticePiece(db, { topicSource: "ai" });
    expect(pending.id).toMatch(/^pf-/);
    expect(pending).toMatchObject({ topic: "", brief: "", topic_source: "ai", draft: "", feedback: null });
    expect(pending.created_at).toBe(pending.updated_at);

    const authored = createPracticePiece(db, { topicSource: "user", topic: "写一场雨", brief: "三百字内" });
    expect(authored).toMatchObject({ topic: "写一场雨", brief: "三百字内", topic_source: "user" });
    expect(countPieces()).toBe(2);

    expect(getPracticePiece(db, authored.id)).toEqual(authored);
    expect(getPracticePiece(db, "pf-missing")).toBeNull();
  });

  it("列表只出投影字段（无 draft / feedback 键）、charCount = 稿件字符数、待出题篇照常列出", () => {
    const pending = createPracticePiece(db, { topicSource: "ai" });

    const before = listPracticePieces(db);
    expect(Object.keys(before[0]!).sort()).toEqual([
      "brief",
      "charCount",
      "createdAt",
      "hasDraft",
      "hasFeedback",
      "id",
      "topic",
      "topicSource",
      "updatedAt",
    ]);
    expect(before[0]).not.toHaveProperty("draft");
    expect(before[0]).not.toHaveProperty("feedback");
    expect(before[0]).toMatchObject({
      id: pending.id,
      topic: "",
      brief: "",
      topicSource: "ai",
      charCount: 0,
      hasDraft: false,
      hasFeedback: false,
    });

    setPieceUpdatedAt(pending.id, "2026-10-02T00:00:00Z");
    updatePracticePieceDraft(db, pending.id, "一二三四");
    setPieceFeedback(pending.id, JSON.stringify({ dimensions: [] }));
    expect(listPracticePieces(db)[0]).toMatchObject({ charCount: 4, hasDraft: true, hasFeedback: true });
  });

  it("列表按 updatedAt 倒序（同值按 id 升序）；详情含 topic / brief / draft / feedback", () => {
    const older = createPracticePiece(db, { topicSource: "user", topic: "旧题" });
    const newer = createPracticePiece(db, { topicSource: "user", topic: "新题" });
    setPieceUpdatedAt(older.id, "2026-10-01T00:00:00Z");
    setPieceUpdatedAt(newer.id, "2026-10-02T00:00:00Z");

    expect(listPracticePieces(db).map((p) => p.id)).toEqual([newer.id, older.id]);
    expect(getPracticePiece(db, newer.id)).toMatchObject({ topic: "新题", brief: "", draft: "", feedback: null });
  });

  it("改稿：整体覆盖（含清空）、updated_at 推进、题目 / 要求 / 点评卡不动；不存在 → null", () => {
    const piece = createPracticePiece(db, { topicSource: "user", topic: "题目原样", brief: "要求原样" });
    setPieceUpdatedAt(piece.id, "2026-10-01T00:00:00Z");
    setPieceFeedback(piece.id, JSON.stringify({ dimensions: [] }));

    const first = updatePracticePieceDraft(db, piece.id, "初稿");
    expect(first!.updatedAt > "2026-10-01T00:00:00Z").toBe(true);

    updatePracticePieceDraft(db, piece.id, "");
    expect(getPracticePiece(db, piece.id)).toMatchObject({
      topic: "题目原样",
      brief: "要求原样",
      draft: "",
      feedback: { dimensions: [] },
    });

    expect(updatePracticePieceDraft(db, "pf-missing", "无")).toBeNull();
  });

  it("出题入口：只写 topic / brief（brief 省略 = 不改）、updated_at 推进、稿件与点评卡不动；不存在 → null", () => {
    const piece = createPracticePiece(db, { topicSource: "ai" });
    updatePracticePieceDraft(db, piece.id, "用户已开始的稿");
    setPieceFeedback(piece.id, JSON.stringify({ dimensions: [{ name: "旧卡" }] }));
    setPieceUpdatedAt(piece.id, "2026-10-01T00:00:00Z");

    const written = updatePracticePieceTopic(db, piece.id, { topic: "写一场雨", brief: "三百字内" });
    expect(written!.updatedAt > "2026-10-01T00:00:00Z").toBe(true);
    expect(readPieceVerbatim(piece.id)).toEqual({
      topic: "写一场雨",
      brief: "三百字内",
      draft: "用户已开始的稿",
    });
    expect(getPracticePiece(db, piece.id)!.feedback).toEqual({ dimensions: [{ name: "旧卡" }] });
    expect(getPracticePiece(db, piece.id)!.updated_at).toBe(written!.updatedAt);

    // brief 省略 = 保持原值（部分更新口径，同 updatePracticeTarget）
    updatePracticePieceTopic(db, piece.id, { topic: "换个题" });
    expect(readPieceVerbatim(piece.id)).toEqual({
      topic: "换个题",
      brief: "三百字内",
      draft: "用户已开始的稿",
    });

    expect(updatePracticePieceTopic(db, "pf-missing", { topic: "无" })).toBeNull();
  });

  it("写点评卡：只写 feedback、updated_at 推进、题目 / 要求 / 稿件一字不动；不存在 → null", () => {
    const piece = createPracticePiece(db, { topicSource: "user", topic: "题目原样", brief: "要求原样" });
    updatePracticePieceDraft(db, piece.id, "稿件原样");
    setPieceUpdatedAt(piece.id, "2026-10-01T00:00:00Z");

    const card = { dimensions: [{ name: "叙述距离", sample_quotes: [], draft_quotes: ["稿件原样"], advice: "拉远" }] };
    const written = updatePracticePieceFeedback(db, piece.id, card);
    expect(written!.updatedAt > "2026-10-01T00:00:00Z").toBe(true);
    expect(getPracticePiece(db, piece.id)!.feedback).toEqual(card);
    expect(readPieceVerbatim(piece.id)).toEqual({ topic: "题目原样", brief: "要求原样", draft: "稿件原样" });
    expect(getPracticePiece(db, piece.id)!.updated_at).toBe(written!.updatedAt);

    expect(updatePracticePieceFeedback(db, "pf-missing", card)).toBeNull();
  });

  it("删篇：物理删且只删自身；重复删除与不存在均返回 false（幂等不抛错）", () => {
    const doomed = createPracticePiece(db, { topicSource: "ai" });
    const kept = createPracticePiece(db, { topicSource: "user", topic: "保留" });

    expect(deletePracticePiece(db, doomed.id)).toBe(true);
    expect(countPieces()).toBe(1);
    expect(getPracticePiece(db, doomed.id)).toBeNull();
    expect(getPracticePiece(db, kept.id)).not.toBeNull();

    expect(deletePracticePiece(db, doomed.id)).toBe(false);
    expect(deletePracticePiece(db, "pf-missing")).toBe(false);
  });
});

describe("风格说明素材包（practice_style_packs）", () => {
  it("无覆盖 = 无行（getStylePack 返回 null）；upsert 新建与覆盖都推进 updated_at；两作家互不干扰", () => {
    expect(getStylePack(db, "jiangnan")).toBeNull();

    const created = upsertStylePack(db, "jiangnan", "第一版覆盖");
    expect(created).toEqual({ author_id: "jiangnan", content: "第一版覆盖", updated_at: expect.any(String) });
    expect(getStylePack(db, "jiangnan")).toEqual(created);

    // 覆盖同作家 = 同一行（主键即作家 id），内容与时间戳推进，行数不增
    const overwritten = upsertStylePack(db, "jiangnan", "第二版覆盖");
    expect(overwritten.content).toBe("第二版覆盖");
    expect((db.prepare("SELECT COUNT(*) AS c FROM practice_style_packs").get() as { c: number }).c).toBe(1);
    expect(getStylePack(db, "jiangnan")).toEqual(overwritten);

    upsertStylePack(db, "other-author", "另一位");
    expect(getStylePack(db, "jiangnan")!.content).toBe("第二版覆盖");
    expect(getStylePack(db, "other-author")!.content).toBe("另一位");
  });

  it("删覆盖 = 恢复预置：幂等（有覆盖 → true 且行消失，再删 / 无覆盖 → false 不抛错）", () => {
    upsertStylePack(db, "jiangnan", "覆盖");

    expect(deleteStylePack(db, "jiangnan")).toBe(true);
    expect(getStylePack(db, "jiangnan")).toBeNull();
    expect(deleteStylePack(db, "jiangnan")).toBe(false);
    expect(deleteStylePack(db, "never-written")).toBe(false);
  });
});

describe("feedback 防御解析与卡内层命名", () => {
  it("卡体按行原样解析：内存卡体键名与落库 JSON 逐字相同（内层 snake_case，无 camelCase 转换）", () => {
    const sample = createPracticeSample(db, { text: "范文" });
    const card = {
      dimensions: [
        {
          name: "叙述距离",
          sample_trait: "远",
          draft_trait: "近",
          sample_quotes: ["范文"],
          draft_quotes: ["稿"],
          advice: "拉远",
        },
      ],
      summary: "总评",
    };
    setSampleFeedback(sample.id, JSON.stringify(card));

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

  it("坏 JSON（非法文本 / 非对象 / 数组 / JSON null）行不抛错：详情按 null、列表 hasFeedback = false，同表其他行照常返回（两表同口径）", () => {
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
    const sampleIds = rows.map((row, index) => {
      const sample = createPracticeSample(db, { excerptLabel: row.label, text: "范文" });
      setSampleUpdatedAt(sample.id, `2026-10-0${index + 1}T00:00:00Z`); // 固定次序：列表按 updatedAt 倒序
      setSampleFeedback(sample.id, row.raw);
      return sample.id;
    });
    const pieceIds = rows.map((row, index) => {
      const piece = createPracticePiece(db, { topicSource: "user", topic: row.label });
      setPieceUpdatedAt(piece.id, `2026-10-0${index + 1}T00:00:00Z`);
      setPieceFeedback(piece.id, row.raw);
      return piece.id;
    });

    // 列表：整表照常返回（坏行不丢也不打挂），hasFeedback 与详情同口径（防御解析后非 null）
    const listedSamples = listPracticeSamples(db);
    const listedPieces = listPracticePieces(db);
    expect(listedSamples).toHaveLength(rows.length);
    expect(listedPieces).toHaveLength(rows.length);
    for (const [index, row] of rows.entries()) {
      expect(listedSamples.find((s) => s.id === sampleIds[index])!.hasFeedback, `样本 ${row.label}`).toBe(
        row.expectCard !== null,
      );
      expect(listedPieces.find((p) => p.id === pieceIds[index])!.hasFeedback, `自由练习 ${row.label}`).toBe(
        row.expectCard !== null,
      );
      expect(listedSamples[index]!.charCount).toBe(2);
    }

    // 详情：坏行 feedback = null（不抛错），合法行照常解析为对象
    for (const [index, row] of rows.entries()) {
      expect(getPracticeSample(db, sampleIds[index]!)!.feedback, `样本 ${row.label}`).toEqual(row.expectCard);
      expect(getPracticePiece(db, pieceIds[index]!)!.feedback, `自由练习 ${row.label}`).toEqual(row.expectCard);
    }

    // 坏行仍可正常改稿 / 删除（防御解析只影响读呈现，不改数据）
    expect(updatePracticeSampleDraft(db, sampleIds[0]!, "仍可写")).toEqual({ updatedAt: expect.any(String) });
    expect(deletePracticeSample(db, sampleIds[0]!)).toBe(true);
    expect(updatePracticePieceDraft(db, pieceIds[0]!, "仍可写")).toEqual({ updatedAt: expect.any(String) });
    expect(deletePracticePiece(db, pieceIds[0]!)).toBe(true);
  });
});