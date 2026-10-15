// 查询类工具测试：作家文风练习（四只读 + 三写 AI 产出，2026-10 改版）
// 覆盖：四个只读工具的形状与分页（截断显式告知 + 两页拼回原文 + clamp 上限 + 越界与负 offset）/
// 未写稿空态 / 风格说明「用户覆盖 ?? 预置」与 customized / 作品名兜底「其他」/ 样本与篇不存在报错 /
// 两个提交点评卡的引用校验源（按字段分源：`sample_quotes` ⊆ 依据——仿写 = 范文、自由练习 = 风格说明；
// `draft_quotes` ⊆ 稿件；合法保留、非法丢弃计数、空串与纯空白丢弃、全部非法仍写卡）/ 维度超上限报错 / 出题题目的「题目非空 / 空白 / 篇不存在」拒绝 /
// 三个写工具「只写 AI 自己的列」的边界（直查行验证其他列一字不动）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeDatabase,
  createPracticePiece,
  createPracticeSample,
  getPracticePiece,
  getPracticeSample,
  openDatabase,
  SCHEMA_VERSION,
  updatePracticePieceDraft,
  updatePracticeSampleDraft,
  upsertStylePack,
  writeProjectFile,
  type Db,
} from "@whispering233/ai-editor-db";
import {
  AUTHOR_IDS,
  MAX_FEEDBACK_DIMENSIONS,
  PRACTICE_OTHER_WORK_LABEL,
  resolveAuthor,
  resolveWork,
} from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import type { FeedbackDimensionArgs } from "../schemas/index.js";
import { DEFAULT_TEXT_PAGE_CHARS, MAX_TEXT_PAGE_CHARS } from "./manuscript.js";
import {
  runGetFreeDraft,
  runGetPracticeDraft,
  runGetPracticeSample,
  runGetStyleNotes,
  runSubmitFreeFeedback,
  runSubmitPracticeTopic,
  runSubmitStyleFeedback,
} from "./practice.js";

let dir: string;
let db: Db;

const AUTHOR_ID = AUTHOR_IDS[0];
const SAMPLE_TEXT = "范文第一段。\n\n范文第二段——仿写练习的分页测试文本。";
const DRAFT_TEXT = "我的仿写稿第一段。我的仿写稿第二段。";
const PIECE_DRAFT_TEXT = "自由练习稿第一段。自由练习稿第二段。";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-practice-"));
  db = openDatabase(join(dir, "data.db"));
  // 工具从 project.json 现读 author_id（练习工作区 = 一位预置作家）
  writeProjectFile(dir, projectFile(AUTHOR_ID));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

/** 练习工作区的 project.json（工具从这里现读 author_id） */
function projectFile(authorId: string) {
  return {
    id: "proj-practice-test",
    name: "练习工作区",
    language: "zh" as const,
    schema_version: SCHEMA_VERSION,
    current_position: null,
    kind: "practice" as const,
    author_id: authorId,
  };
}

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-practice-test" };
}

/** 样本（范文 = SAMPLE_TEXT；可选稿件） */
function seedSample(options: { text?: string; draft?: string; workId?: string | null; excerptLabel?: string } = {}): string {
  const sample = createPracticeSample(db, {
    workId: options.workId === undefined ? null : options.workId,
    excerptLabel: options.excerptLabel ?? "节选",
    text: options.text ?? SAMPLE_TEXT,
  });
  if (options.draft !== undefined) updatePracticeSampleDraft(db, sample.id, options.draft);
  return sample.id;
}

/** 自由练习篇（可选题目 / 写作要求 / 稿件） */
function seedPiece(options: { topic?: string; brief?: string; draft?: string } = {}): string {
  const piece = createPracticePiece(db, {
    topicSource: options.topic === undefined ? "ai" : "user",
    topic: options.topic,
    brief: options.brief,
  });
  if (options.draft !== undefined) updatePracticePieceDraft(db, piece.id, options.draft);
  return piece.id;
}

/** 一条维度（引用缺省 = 无证据） */
function dimension(overrides: Partial<FeedbackDimensionArgs> = {}): FeedbackDimensionArgs {
  return {
    name: "句长节奏",
    sample_trait: "以短句推进",
    draft_trait: "长句偏多",
    advice: "把超过三行的句子拆开",
    ...overrides,
  };
}

describe("get_practice_sample / get_practice_draft（只读分页）", () => {
  it("范文读取：形状逐字段（作品名 / 片段说明 / 字数齐备），未截断时 text = 原文", () => {
    const work = resolveAuthor(AUTHOR_ID)!.works[0]!;
    const id = seedSample({ workId: work.id, excerptLabel: "《受戒》节选" });
    expect(runGetPracticeSample(makeCtx(), { sample_id: id })).toEqual({
      sample_id: id,
      work_name: work.name,
      excerpt_label: "《受戒》节选",
      char_count: SAMPLE_TEXT.length,
      offset: 0,
      returned_chars: SAMPLE_TEXT.length,
      text: SAMPLE_TEXT,
      truncated: false,
    });
  });

  it("work_id 空 / 未知 → work_name = shared 兜底文案「其他」（读取照常成功）", () => {
    const noWork = seedSample();
    const unknownWork = seedSample({ workId: "work-does-not-exist" });
    expect(runGetPracticeSample(makeCtx(), { sample_id: noWork }).work_name).toBe(PRACTICE_OTHER_WORK_LABEL);
    expect(runGetPracticeSample(makeCtx(), { sample_id: unknownWork }).work_name).toBe(PRACTICE_OTHER_WORK_LABEL);
    expect(resolveWork(AUTHOR_ID, "work-does-not-exist")).toBeNull();
  });

  it("长范文分页：截断页附续读提示，按 returned_chars 推移 offset 拼回原文（提示不计入 returned_chars）", () => {
    const long = "范".repeat(MAX_TEXT_PAGE_CHARS + 1000);
    const id = seedSample({ text: long });

    const first = runGetPracticeSample(makeCtx(), { sample_id: id });
    expect(first.truncated).toBe(true);
    expect(first.returned_chars).toBe(DEFAULT_TEXT_PAGE_CHARS); // 缺省页 = DEFAULT（上限只在显式传 max_chars 时生效）
    expect(first.char_count).toBe(long.length);
    expect(first.text).toContain(`offset=${first.offset + first.returned_chars}`);
    expect(first.text).not.toBe(long.slice(0, MAX_TEXT_PAGE_CHARS));

    const second = runGetPracticeSample(makeCtx(), { sample_id: id, offset: first.returned_chars });
    expect(second.text).toBe(long.slice(DEFAULT_TEXT_PAGE_CHARS));
    expect(second.truncated).toBe(false);
    // 拼回 = 原文（续读提示只在截断页出现，不进 returned_chars）
    expect(long.slice(0, first.returned_chars) + second.text).toBe(long);
  });

  it("分页 clamp：max_chars 超上限按 MAX_TEXT_PAGE_CHARS 截；offset 越界返回空 text（不报错）", () => {
    const long = "范".repeat(MAX_TEXT_PAGE_CHARS + 10);
    const id = seedSample({ text: long });
    const clamped = runGetPracticeSample(makeCtx(), { sample_id: id, max_chars: MAX_TEXT_PAGE_CHARS * 2 });
    expect(clamped.returned_chars).toBe(MAX_TEXT_PAGE_CHARS);

    const beyond = runGetPracticeSample(makeCtx(), { sample_id: id, offset: long.length + 5 });
    expect(beyond.returned_chars).toBe(0);
    expect(beyond.text).toBe("");
    expect(beyond.truncated).toBe(false);
  });

  it("offset 非非负整数 → 报错（schema 之外防御）", () => {
    const id = seedSample();
    expect(() => runGetPracticeSample(makeCtx(), { sample_id: id, offset: -1 })).toThrow(/offset/);
  });

  it("仿写稿读取：text = 稿件（形状与范文同形）；未写稿 → char_count=0、text=\"\"", () => {
    const id = seedSample({ draft: DRAFT_TEXT });
    const page = runGetPracticeDraft(makeCtx(), { sample_id: id, max_chars: 10 });
    expect(page.sample_id).toBe(id);
    expect(page.char_count).toBe(DRAFT_TEXT.length);
    expect(page.text).toBe(DRAFT_TEXT.slice(0, 10) + "\n\n（已截断，可用 offset=10 继续读取）");
    expect(page.truncated).toBe(true);

    const empty = runGetPracticeDraft(makeCtx(), { sample_id: seedSample() });
    expect(empty).toMatchObject({ char_count: 0, offset: 0, returned_chars: 0, text: "", truncated: false });
  });

  it("样本不存在 → 报错（两个样本侧只读工具同口径）", () => {
    expect(() => runGetPracticeSample(makeCtx(), { sample_id: "ps-missing" })).toThrow(/ps-missing/);
    expect(() => runGetPracticeDraft(makeCtx(), { sample_id: "ps-missing" })).toThrow(/ps-missing/);
  });
});

describe("get_free_draft / get_style_notes（只读分页）", () => {
  it("自由稿：text = 稿件、char_count = 稿件长度；未写稿 → 空态", () => {
    const id = seedPiece({ topic: "写一段雨夜", draft: PIECE_DRAFT_TEXT });
    expect(runGetFreeDraft(makeCtx(), { piece_id: id })).toEqual({
      piece_id: id,
      char_count: PIECE_DRAFT_TEXT.length,
      offset: 0,
      returned_chars: PIECE_DRAFT_TEXT.length,
      text: PIECE_DRAFT_TEXT,
      truncated: false,
    });
    expect(runGetFreeDraft(makeCtx(), { piece_id: seedPiece() })).toMatchObject({
      char_count: 0,
      text: "",
      truncated: false,
    });
  });

  it("自由稿分页续读：截断页附续读提示，按 returned_chars 推移 offset 拼回原文（提示不计入 returned_chars）", () => {
    const long = "自".repeat(MAX_TEXT_PAGE_CHARS + 500);
    const id = seedPiece({ topic: "写一段雨夜", draft: long });

    const first = runGetFreeDraft(makeCtx(), { piece_id: id });
    expect(first.truncated).toBe(true);
    expect(first.returned_chars).toBe(DEFAULT_TEXT_PAGE_CHARS);
    expect(first.char_count).toBe(long.length);
    expect(first.text).toContain(`已截断，可用 offset=${first.offset + first.returned_chars} 继续读取`);

    const second = runGetFreeDraft(makeCtx(), { piece_id: id, offset: first.returned_chars });
    expect(second.truncated).toBe(false);
    expect(long.slice(0, first.returned_chars) + second.text).toBe(long);
  });

  it("风格说明分页续读：长覆盖内容截断后同样给续读 offset，分页拼回原文", () => {
    const long = "风".repeat(MAX_TEXT_PAGE_CHARS + 400);
    upsertStylePack(db, AUTHOR_ID, long);

    const first = runGetStyleNotes(makeCtx(), {});
    expect(first.customized).toBe(true);
    expect(first.char_count).toBe(long.length);
    expect(first.truncated).toBe(true);
    expect(first.text).toContain(`offset=${first.offset + first.returned_chars}`);

    const second = runGetStyleNotes(makeCtx(), { offset: first.returned_chars });
    expect(second.truncated).toBe(false);
    expect(long.slice(0, first.returned_chars) + second.text).toBe(long);
  });

  it("风格说明：无用户覆盖 → shared 预置内容、customized=false", () => {
    const author = resolveAuthor(AUTHOR_ID)!;
    const page = runGetStyleNotes(makeCtx(), {});
    expect(page.author_id).toBe(author.id);
    expect(page.author_name).toBe(author.name);
    expect(page.customized).toBe(false);
    expect(page.char_count).toBe(author.styleNotes.length);
    expect(page.text).toBe(author.styleNotes);
    expect(page.truncated).toBe(false);
  });

  it("风格说明：有用户覆盖 → 覆盖内容生效、customized=true（覆盖 ?? 预置）", () => {
    const override = "自定义风格说明：短句、留白、少形容。";
    upsertStylePack(db, AUTHOR_ID, override);
    const page = runGetStyleNotes(makeCtx(), {});
    expect(page).toMatchObject({ customized: true, char_count: override.length, text: override, truncated: false });
    expect(page.text).not.toBe(resolveAuthor(AUTHOR_ID)!.styleNotes);
  });

  it("风格说明：工作区未关联预置作家（author_id 未知）→ 报错；范文读取不受影响（作品名退兜底）", () => {
    const id = seedSample();
    writeProjectFile(dir, projectFile("author-does-not-exist"));
    expect(() => runGetStyleNotes(makeCtx(), {})).toThrow(/未关联预置作家/);
    expect(runGetPracticeSample(makeCtx(), { sample_id: id }).work_name).toBe(PRACTICE_OTHER_WORK_LABEL);
  });

  it("篇不存在 → 报错", () => {
    expect(() => runGetFreeDraft(makeCtx(), { piece_id: "pf-missing" })).toThrow(/pf-missing/);
  });
});

describe("submit_style_feedback（仿写点评卡）", () => {
  it("引用逐条校验：范文侧对范文、稿件侧对稿件；合法保留、非法丢弃计数", () => {
    const id = seedSample({ draft: DRAFT_TEXT });
    const result = runSubmitStyleFeedback(makeCtx(), {
      sample_id: id,
      dimensions: [
        dimension({
          sample_quotes: ["范文第一段。", "范文里没有这句。", ""],
          draft_quotes: ["我的仿写稿第二段。", "   ", "稿件里没有这句。"],
        }),
      ],
      summary: "语感已接近",
    });

    expect(result).toEqual({ saved: true, dimension_count: 1, dropped_quotes: 4 });
    const stored = getPracticeSample(db, id)!;
    const card = stored.feedback as { dimensions: { sample_quotes: string[]; draft_quotes: string[] }[]; summary?: string };
    expect(card.dimensions[0]!.sample_quotes).toEqual(["范文第一段。"]);
    expect(card.dimensions[0]!.draft_quotes).toEqual(["我的仿写稿第二段。"]);
    expect(card.summary).toBe("语感已接近");
    // 只写 feedback：范文与用户稿一字不动
    expect(stored.text).toBe(SAMPLE_TEXT);
    expect(stored.draft).toBe(DRAFT_TEXT);
  });

  it("引用数组可省 → 落库卡补空数组（读取侧形状完整），无引用不计 dropped_quotes", () => {
    const id = seedSample({ draft: DRAFT_TEXT });
    expect(runSubmitStyleFeedback(makeCtx(), { sample_id: id, dimensions: [dimension()] })).toEqual({
      saved: true,
      dimension_count: 1,
      dropped_quotes: 0,
    });
    const card = getPracticeSample(db, id)!.feedback as { dimensions: { sample_quotes: string[]; draft_quotes: string[] }[] };
    expect(card.dimensions[0]!.sample_quotes).toEqual([]);
    expect(card.dimensions[0]!.draft_quotes).toEqual([]);
  });

  it("全部引用非法仍成功写卡（诊断不依赖引用数）；范文与稿件仍一字不动", () => {
    const id = seedSample({ draft: DRAFT_TEXT });
    const result = runSubmitStyleFeedback(makeCtx(), {
      sample_id: id,
      dimensions: [dimension({ sample_quotes: ["凭印象复述的句子"], draft_quotes: ["凭印象复述的稿件"] })],
    });
    expect(result).toEqual({ saved: true, dimension_count: 1, dropped_quotes: 2 });
    const stored = getPracticeSample(db, id)!;
    expect(stored.feedback).not.toBeNull();
    expect(stored.text).toBe(SAMPLE_TEXT);
    expect(stored.draft).toBe(DRAFT_TEXT);
  });

  it("维度超上限 → 报错且不落库", () => {
    const id = seedSample();
    const dimensions = Array.from({ length: MAX_FEEDBACK_DIMENSIONS + 1 }, () => dimension());
    expect(() => runSubmitStyleFeedback(makeCtx(), { sample_id: id, dimensions })).toThrow(
      new RegExp(String(MAX_FEEDBACK_DIMENSIONS)),
    );
    expect(getPracticeSample(db, id)!.feedback).toBeNull();
  });

  it("样本不存在 → 报错", () => {
    expect(() => runSubmitStyleFeedback(makeCtx(), { sample_id: "ps-missing", dimensions: [dimension()] })).toThrow(
      /ps-missing/,
    );
  });
});

describe("submit_free_feedback（自由练习点评卡）", () => {
  it("引用校验源 = 风格说明（用户覆盖）+ 自由稿：范文侧文案不命中", () => {
    const override = "自定义风格说明：短句、留白、少形容。";
    upsertStylePack(db, AUTHOR_ID, override);
    const id = seedPiece({ topic: "写一段雨夜", draft: PIECE_DRAFT_TEXT });

    const result = runSubmitFreeFeedback(makeCtx(), {
      piece_id: id,
      dimensions: [
        dimension({
          sample_quotes: ["短句、留白", "预置风格说明里的句子"],
          draft_quotes: ["自由练习稿第一段。", "稿件里没有这句。"],
        }),
      ],
    });
    expect(result).toEqual({ saved: true, dimension_count: 1, dropped_quotes: 2 });

    const card = getPracticePiece(db, id)!.feedback as { dimensions: { sample_quotes: string[]; draft_quotes: string[] }[] };
    expect(card.dimensions[0]!.sample_quotes).toEqual(["短句、留白"]);
    expect(card.dimensions[0]!.draft_quotes).toEqual(["自由练习稿第一段。"]);
  });

  it("无用户覆盖时引用校验源 = 预置风格说明", () => {
    const preset = resolveAuthor(AUTHOR_ID)!.styleNotes;
    const id = seedPiece({ draft: PIECE_DRAFT_TEXT });
    expect(
      runSubmitFreeFeedback(makeCtx(), {
        piece_id: id,
        dimensions: [dimension({ sample_quotes: [preset.slice(0, 8)] })],
      }),
    ).toEqual({ saved: true, dimension_count: 1, dropped_quotes: 0 });
  });

  it("只写 feedback：题目 / 写作要求 / 用户稿一字不动", () => {
    const id = seedPiece({ topic: "写一段雨夜", brief: "第一人称，300 字", draft: PIECE_DRAFT_TEXT });
    const before = getPracticePiece(db, id)!;
    runSubmitFreeFeedback(makeCtx(), { piece_id: id, dimensions: [dimension({ draft_quotes: [PIECE_DRAFT_TEXT] })] });
    const after = getPracticePiece(db, id)!;
    expect(after.feedback).not.toBeNull();
    expect(after.topic).toBe(before.topic);
    expect(after.brief).toBe(before.brief);
    expect(after.draft).toBe(before.draft);
    expect(after.topic_source).toBe(before.topic_source);
  });

  it("维度超上限 / 篇不存在 / 工作区未关联作家 → 报错", () => {
    const id = seedPiece();
    const dimensions = Array.from({ length: MAX_FEEDBACK_DIMENSIONS + 1 }, () => dimension());
    expect(() => runSubmitFreeFeedback(makeCtx(), { piece_id: id, dimensions })).toThrow(
      new RegExp(String(MAX_FEEDBACK_DIMENSIONS)),
    );
    expect(() => runSubmitFreeFeedback(makeCtx(), { piece_id: "pf-missing", dimensions: [dimension()] })).toThrow(
      /pf-missing/,
    );
    writeProjectFile(dir, projectFile("author-does-not-exist"));
    expect(() => runSubmitFreeFeedback(makeCtx(), { piece_id: id, dimensions: [dimension()] })).toThrow(
      /未关联预置作家/,
    );
  });
});

describe("submit_practice_topic（AI 出题）", () => {
  it("新篇出题：写 topic / brief，返回 { saved, piece_id }", () => {
    const id = seedPiece();
    expect(runSubmitPracticeTopic(makeCtx(), { piece_id: id, topic: "写一段雨夜独行", brief: "第一人称，400 字" })).toEqual(
      { saved: true, piece_id: id },
    );
    const row = getPracticePiece(db, id)!;
    expect(row.topic).toBe("写一段雨夜独行");
    expect(row.brief).toBe("第一人称，400 字");
    expect(row.draft).toBe("");
    expect(row.feedback).toBeNull();
  });

  it("brief 省略 → 保留原写作要求；题目两端空白被去掉", () => {
    const id = seedPiece({ brief: "原写作要求" });
    runSubmitPracticeTopic(makeCtx(), { piece_id: id, topic: "  写一段雨夜  " });
    const row = getPracticePiece(db, id)!;
    expect(row.topic).toBe("写一段雨夜");
    expect(row.brief).toBe("原写作要求");
  });

  it("题目已非空 → 报错拒写（题目 / 写作要求一行未改）", () => {
    const id = seedPiece({ topic: "用户自拟的题", brief: "用户写作要求" });
    expect(() => runSubmitPracticeTopic(makeCtx(), { piece_id: id, topic: "换一个题", brief: "换一个要求" })).toThrow(
      /已有题目/,
    );
    const row = getPracticePiece(db, id)!;
    expect(row.topic).toBe("用户自拟的题");
    expect(row.brief).toBe("用户写作要求");
  });

  it("空白题目 → 报错拒写（不落一条看不见的题目）", () => {
    const id = seedPiece();
    expect(() => runSubmitPracticeTopic(makeCtx(), { piece_id: id, topic: "   " })).toThrow(/题目不能为空/);
    expect(getPracticePiece(db, id)!.topic).toBe("");
  });

  it("篇不存在 → 报错", () => {
    expect(() => runSubmitPracticeTopic(makeCtx(), { piece_id: "pf-missing", topic: "题" })).toThrow(/pf-missing/);
  });
});
