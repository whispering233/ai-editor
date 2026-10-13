// 查询类工具测试：文风仿写练习（get_practice_sample / get_practice_draft / submit_style_feedback，2026-10）
// 覆盖：两个只读工具的形状与分页（截断显式告知 + 两页拼回原文 + clamp 上限 + 越界与负 offset）/
// 未写稿空态 / 样本不存在报错 / 提交点评卡的引用子串校验（范文侧与稿件侧：合法保留、非法丢弃计数、
// 全部非法仍写卡）/ 维度超上限报错 / 只读与只写 feedback 的边界（直查行验证其他列一字不动）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeDatabase,
  createPracticeSample,
  createPracticeTarget,
  getPracticeSample,
  openDatabase,
  updatePracticeDraft,
  type Db,
} from "@whispering233/ai-editor-db";
import { MAX_FEEDBACK_DIMENSIONS } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { MAX_TEXT_PAGE_CHARS } from "./manuscript.js";
import { runGetPracticeDraft, runGetPracticeSample, runSubmitStyleFeedback } from "./practice.js";

let dir: string;
let db: Db;

const SAMPLE_TEXT = "范文第一段。\n\n范文第二段——仿写练习的分页测试文本。";
const DRAFT_TEXT = "我的仿写稿第一段。我的仿写稿第二段。";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-practice-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

/** 目标 + 样本（范文 = SAMPLE_TEXT；不给稿件 → 空稿） */
function seedSample(options: { text?: string; draft?: string; observation?: string } = {}): string {
  const target = createPracticeTarget(db, { name: "汪曾祺式短句", observation: options.observation ?? "句子短、留白多" });
  const sample = createPracticeSample(db, {
    targetId: target.id,
    sourceLabel: "汪曾祺《受戒》节选",
    text: options.text ?? SAMPLE_TEXT,
  });
  if (sample === null) throw new Error("夹具：建样本失败");
  if (options.draft !== undefined) updatePracticeDraft(db, sample.id, options.draft);
  return sample.id;
}

/** 直查样本整行（验证「只读」与「只写 feedback」——不靠工具自说自话） */
function readSampleRow(id: string): Record<string, unknown> {
  return db.prepare("SELECT * FROM practice_samples WHERE id = ?").get(id) as Record<string, unknown>;
}

describe("get_practice_sample / get_practice_draft（只读分页）", () => {
  it("范文读取：形状逐字段（目标名 / 观察 / 来源说明 / 字数齐备），未截断时 text = 原文", () => {
    const id = seedSample();
    expect(runGetPracticeSample(makeCtx(), { sample_id: id })).toEqual({
      sample_id: id,
      target_name: "汪曾祺式短句",
      observation: "句子短、留白多",
      source_label: "汪曾祺《受戒》节选",
      char_count: SAMPLE_TEXT.length,
      offset: 0,
      returned_chars: SAMPLE_TEXT.length,
      text: SAMPLE_TEXT,
      truncated: false,
    });
  });

  it("长范文分页：截断页附续读提示，按 returned_chars 推移 offset 拼回原文（提示不计入 returned_chars）", () => {
    // 长样本 = 上限 + 1000（跨 3 页读完），顺带锁定「长样本可读全」
    const long = "甲".repeat(MAX_TEXT_PAGE_CHARS + 999) + "乙";
    const id = seedSample({ text: long });
    const ctx = makeCtx();
    const pages: string[] = [];
    let offset = 0;
    let page = runGetPracticeSample(ctx, { sample_id: id, offset });
    let guard = 0;
    for (;;) {
      guard++;
      expect(guard).toBeLessThan(10); // 页数 = ceil(len / 上限)，不该无限翻页
      pages.push(page.text.slice(0, page.returned_chars));
      if (!page.truncated) break;
      expect(page.text).toContain(`已截断，可用 offset=${offset + page.returned_chars} 继续读取`);
      offset += page.returned_chars;
      page = runGetPracticeSample(ctx, { sample_id: id, offset });
    }
    expect(pages.join("")).toBe(long);
    expect(page.char_count).toBe(long.length); // 全长与 offset 无关
    expect(page.truncated).toBe(false); // 末页无续读提示
  });

  it("max_chars 缺省 = DEFAULT_TEXT_PAGE_CHARS；超上限按 MAX_TEXT_PAGE_CHARS clamp（与 get_chapter_text 同一对常量）", () => {
    const id = seedSample({ text: "甲".repeat(MAX_TEXT_PAGE_CHARS + 1000) });
    const ctx = makeCtx();
    // 缺省页一次读完 6000 字符以内文本（不截断）
    const shortId = seedSample({ text: "乙".repeat(6000) });
    expect(runGetPracticeSample(ctx, { sample_id: shortId }).truncated).toBe(false);
    // 超上限 → clamp 到 MAX_TEXT_PAGE_CHARS（预算连信封与提示一起压进单条工具结果上限）
    const clamped = runGetPracticeSample(ctx, { sample_id: id, max_chars: 999999 });
    expect(clamped.returned_chars).toBe(MAX_TEXT_PAGE_CHARS);
    expect(clamped.truncated).toBe(true);
  });

  it("稿件：未写稿 → char_count=0、text=\"\"（不报错）；写稿后分页读稿（拼回原稿）", () => {
    const id = seedSample();
    const empty = runGetPracticeDraft(makeCtx(), { sample_id: id });
    expect(empty).toMatchObject({ sample_id: id, char_count: 0, offset: 0, returned_chars: 0, text: "", truncated: false });

    updatePracticeDraft(db, id, DRAFT_TEXT);
    const whole = runGetPracticeDraft(makeCtx(), { sample_id: id });
    expect(whole).toMatchObject({ char_count: DRAFT_TEXT.length, returned_chars: DRAFT_TEXT.length, text: DRAFT_TEXT, truncated: false });

    const pages: string[] = [];
    let offset = 0;
    let page = runGetPracticeDraft(makeCtx(), { sample_id: id, offset, max_chars: 6 });
    for (;;) {
      pages.push(page.text.slice(0, page.returned_chars));
      if (!page.truncated) break;
      offset += page.returned_chars;
      page = runGetPracticeDraft(makeCtx(), { sample_id: id, offset, max_chars: 6 });
    }
    expect(pages.join("")).toBe(DRAFT_TEXT);
  });

  it("样本不存在（或目标行缺失）→ 抛错（两个只读工具同口径）", () => {
    expect(() => runGetPracticeSample(makeCtx(), { sample_id: "ps-missing" })).toThrow(/练习样本不存在/);
    expect(() => runGetPracticeDraft(makeCtx(), { sample_id: "ps-missing" })).toThrow(/练习样本不存在/);

    const id = seedSample();
    db.prepare("DELETE FROM practice_targets").run(); // 孤儿样本行（目标被直删）
    expect(() => runGetPracticeSample(makeCtx(), { sample_id: id })).toThrow(/练习样本不存在/);
  });

  it("offset 越界 → 空片段（无截断标记）；负 offset 抛错（schema 之外防御）", () => {
    const id = seedSample();
    expect(runGetPracticeSample(makeCtx(), { sample_id: id, offset: 999 })).toMatchObject({
      offset: 999,
      returned_chars: 0,
      text: "",
      truncated: false,
    });
    expect(() => runGetPracticeSample(makeCtx(), { sample_id: id, offset: -1 })).toThrow(/offset 必须为非负整数/);
  });

  it("只读边界：两个只读工具读完后样本整行一字不动（含 updated_at / feedback / draft）", () => {
    const id = seedSample({ draft: DRAFT_TEXT });
    const before = readSampleRow(id);
    runGetPracticeSample(makeCtx(), { sample_id: id, max_chars: 5 });
    runGetPracticeDraft(makeCtx(), { sample_id: id, max_chars: 5 });
    expect(readSampleRow(id)).toEqual(before);
  });
});

describe("submit_style_feedback（点评卡写入）", () => {
  it("引用子串校验：范文侧与稿件侧各留合法、各丢非法，dropped_quotes 计数正确", () => {
    const id = seedSample({ draft: DRAFT_TEXT });
    const result = runSubmitStyleFeedback(makeCtx(), {
      sample_id: id,
      dimensions: [
        {
          name: "句长节奏",
          sample_trait: "短句为主",
          draft_trait: "句子偏长",
          sample_quotes: ["范文第一段。", "范文里没有的句子（改写）"],
          draft_quotes: ["我的仿写稿第一段。", "稿件里没有的句子"],
          advice: "把长句拆成短句",
        },
      ],
      summary: "整体靠得住，节奏再收一点",
    });
    expect(result).toEqual({ saved: true, dimension_count: 1, dropped_quotes: 2 });

    const stored = getPracticeSample(db, id)!;
    expect(stored.feedback).toEqual({
      dimensions: [
        {
          name: "句长节奏",
          sample_trait: "短句为主",
          draft_trait: "句子偏长",
          sample_quotes: ["范文第一段。"],
          draft_quotes: ["我的仿写稿第一段。"],
          advice: "把长句拆成短句",
        },
      ],
      summary: "整体靠得住，节奏再收一点",
    });
  });

  it("全部引用非法时仍成功写卡（卡片可无引用）：维度与建议照常落库，dropped_quotes = 全部条数", () => {
    const id = seedSample({ draft: DRAFT_TEXT });
    const result = runSubmitStyleFeedback(makeCtx(), {
      sample_id: id,
      dimensions: [
        {
          name: "叙述距离",
          sample_trait: "远",
          draft_trait: "近",
          sample_quotes: ["凭印象复述的句子"],
          draft_quotes: ["另一句凭印象的"],
          advice: "拉开叙述距离",
        },
      ],
    });
    expect(result).toEqual({ saved: true, dimension_count: 1, dropped_quotes: 2 });
    expect(getPracticeSample(db, id)!.feedback).toEqual({
      dimensions: [
        {
          name: "叙述距离",
          sample_trait: "远",
          draft_trait: "近",
          sample_quotes: [],
          draft_quotes: [],
          advice: "拉开叙述距离",
        },
      ],
    });
  });

  it("引用数组可省（= 无证据，落库补 []）；dimensions 空数组 → 卡体 { dimensions: [] }、dimension_count = 0", () => {
    const id = seedSample();
    expect(
      runSubmitStyleFeedback(makeCtx(), {
        sample_id: id,
        dimensions: [{ name: "词汇密度", sample_trait: "素", draft_trait: "密", advice: "减形容词" }],
      }),
    ).toEqual({ saved: true, dimension_count: 1, dropped_quotes: 0 });
    expect(getPracticeSample(db, id)!.feedback).toEqual({
      dimensions: [{ name: "词汇密度", sample_trait: "素", draft_trait: "密", sample_quotes: [], draft_quotes: [], advice: "减形容词" }],
    });

    expect(runSubmitStyleFeedback(makeCtx(), { sample_id: id, dimensions: [] })).toEqual({
      saved: true,
      dimension_count: 0,
      dropped_quotes: 0,
    });
    expect(getPracticeSample(db, id)!.feedback).toEqual({ dimensions: [] });
  });

  it("维度超上限 → 抛错（等于上限通过；不把失败编码进返回）", () => {
    const id = seedSample();
    const dimension = (index: number) => ({
      name: `维度${index}`,
      sample_trait: "范文特征",
      draft_trait: "稿件写法",
      advice: "建议",
    });
    expect(
      runSubmitStyleFeedback(makeCtx(), {
        sample_id: id,
        dimensions: Array.from({ length: MAX_FEEDBACK_DIMENSIONS }, (_, i) => dimension(i)),
      }).dimension_count,
    ).toBe(MAX_FEEDBACK_DIMENSIONS);

    expect(() =>
      runSubmitStyleFeedback(makeCtx(), {
        sample_id: id,
        dimensions: Array.from({ length: MAX_FEEDBACK_DIMENSIONS + 1 }, (_, i) => dimension(i)),
      }),
    ).toThrow(new RegExp(`最多 ${MAX_FEEDBACK_DIMENSIONS} 个维度`));
  });

  it("只写 feedback：范文与用户稿一字不动（直查整行比对），updated_at 推进", () => {
    const id = seedSample({ draft: DRAFT_TEXT });
    const before = readSampleRow(id);
    runSubmitStyleFeedback(makeCtx(), {
      sample_id: id,
      dimensions: [{ name: "叙述距离", sample_trait: "远", draft_trait: "近", advice: "拉远" }],
    });
    const after = readSampleRow(id);
    expect(after.text).toBe(before.text);
    expect(after.draft).toBe(before.draft);
    expect(after.feedback).not.toBeNull();
    expect(String(after.updated_at) >= String(before.updated_at)).toBe(true);
    // 卡片之外没有别的列被写（键集相同 ⇒ 没有新增/删除行内字段）
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  });

  it("样本不存在 → 抛错且不落任何卡（写入前先守卫）", () => {
    expect(() =>
      runSubmitStyleFeedback(makeCtx(), {
        sample_id: "ps-missing",
        dimensions: [{ name: "维度", sample_trait: "范文", draft_trait: "稿件", advice: "建议" }],
      }),
    ).toThrow(/练习样本不存在/);
    expect(db.prepare("SELECT COUNT(*) AS c FROM practice_samples").get()).toEqual({ c: 0 });
  });
});
