// 工具参数 schema 测试（TypeBox）：关键约束的行为锁定
// 覆盖：枚举白名单 / 必填与长度下限 / minProperties（空 patches 拒绝）/ 整数下限 /
// 数组上下限（时间点量 200 与列表 limit 对齐）/ 严格对象拒绝未知字段 / 深层 record 透传 /
// 练习工具（分页下限 / 点评卡卡形 / 出题长度上限 = shared 常量）
import { describe, expect, it } from "vitest";
import { type TSchema } from "@earendil-works/pi-ai";
import { MAX_PRACTICE_BRIEF_CHARS, MAX_PRACTICE_TOPIC_CHARS, TOOL_PERMISSION } from "@whispering233/ai-editor-shared";
import { validateToolArgs } from "../registry.js";
import {
  deltaChangeSchema,
  freeDraftPageArgsSchema,
  practiceTextPageArgsSchema,
  proposeAddDeltaArgsSchema,
  proposeCreateEntityArgsSchema,
  proposeCreateReferenceArgsSchema,
  proposeMoveNodeArgsSchema,
  proposeReorderTimepointsArgsSchema,
  proposeUpdateEntityArgsSchema,
  proposeUpdateHookArgsSchema,
  styleNotesPageArgsSchema,
  submitFreeFeedbackArgsSchema,
  submitPracticeTopicArgsSchema,
  submitStyleFeedbackArgsSchema,
  webSearchArgsSchema,
  MAX_SEARCH_QUERY_CHARS,
  MAX_SEARCH_RESULT_COUNT,
  fetchContentArgsSchema,
  MAX_FETCH_URL_CHARS,
} from "./index.js";

/** 校验是否通过（校验器抛错即拒绝——与 executor 同一入口） */
function accepts(schema: TSchema, args: unknown): boolean {
  try {
    validateToolArgs(
      { name: "schema_probe", description: "schema 测试", parameters: schema, permission: TOOL_PERMISSION.AUTO, run: () => null },
      args,
    );
    return true;
  } catch {
    return false;
  }
}

describe("proposeReorderTimepointsArgsSchema（时间点量上限 200 与列表 limit 对齐）", () => {
  it("正常：非空时间点 id 数组通过", () => {
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: ["tp-3", "tp-1", "tp-2"] })).toBe(true);
  });

  it("200 个时间点为上限边界：200 通过、201 拒绝", () => {
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: Array.from({ length: 200 }, (_, i) => `tp-${i}`) })).toBe(true);
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: Array.from({ length: 201 }, (_, i) => `tp-${i}`) })).toBe(false);
  });

  it("非数组 / 空数组拒绝", () => {
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: [] })).toBe(false);
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: { 0: "tp-1" } })).toBe(false);
  });

  it("标量与元素按 pi 校验的 coerce 语义处理（文档已登记：比 zod strict 宽松）", () => {
    // 标量 → 包成单项数组；元素非字符串 → 转字符串（两者均在业务层再次校验全量覆盖）
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: "tp-1" })).toBe(true);
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: ["tp-1", 42] })).toBe(true);
  });

  it("未知键拒绝（严格对象，与既有提案工具 schema 同款）", () => {
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: ["tp-1"], extra: 1 })).toBe(false);
  });
});

describe("提案工具 schema 约束", () => {
  it("patches 拒绝空对象（部分更新至少一项）", () => {
    expect(accepts(proposeUpdateEntityArgsSchema, { entity_id: "char-1", patches: { role: "主角" } })).toBe(true);
    expect(accepts(proposeUpdateEntityArgsSchema, { entity_id: "char-1", patches: {} })).toBe(false);
    expect(accepts(proposeUpdateHookArgsSchema, { hook_id: "hook-1", patches: {} })).toBe(false);
  });

  it("name / description 拒绝空串（长度下限 1）", () => {
    expect(accepts(proposeCreateEntityArgsSchema, { type: "character", name: "" })).toBe(false);
    expect(accepts(proposeCreateEntityArgsSchema, { type: "character", name: "张三" })).toBe(true);
    expect(accepts(proposeCreateEntityArgsSchema, { type: "精灵", name: "张三" })).toBe(false); // 类型枚举外
  });

  it("propose_move_node：order 为整数且 ≥ 0（非整数按 pi coerce 语义截断）", () => {
    expect(accepts(proposeMoveNodeArgsSchema, { node_id: "sc-1", parent_id: "root", order: 0 })).toBe(true);
    expect(accepts(proposeMoveNodeArgsSchema, { node_id: "sc-1", parent_id: "root", order: -1 })).toBe(false);
    // 小数/数字字符串经校验器截断/转换（文档已登记；不是 zod 的 .int() 硬拒）
    expect(accepts(proposeMoveNodeArgsSchema, { node_id: "sc-1", parent_id: "root", order: 1.5 })).toBe(true);
    expect(accepts(proposeMoveNodeArgsSchema, { node_id: "sc-1", parent_id: "root", order: "3" })).toBe(true);
  });

  it("propose_add_delta：changes 至少一项；单项按 deltaChangeSchema 校验", () => {
    const change = { field: "power", op: "set" as const, to: 100 };
    expect(accepts(proposeAddDeltaArgsSchema, { node_id: "sc-1", target: "char-1", changes: [change] })).toBe(true);
    expect(accepts(proposeAddDeltaArgsSchema, { node_id: "sc-1", target: "char-1", changes: [] })).toBe(false);
    expect(accepts(proposeAddDeltaArgsSchema, { node_id: "sc-1", target: "char-1", changes: [{ field: "power", op: "爆炸" }] })).toBe(false);
    expect(accepts(deltaChangeSchema, { field: "power", op: "add", value: "x" })).toBe(true);
    expect(accepts(deltaChangeSchema, { field: "power", op: "update", from: null, to: 5 })).toBe(true);
  });

  it("propose_create_reference：source 可空、type/content/tags 可选", () => {
    expect(accepts(proposeCreateReferenceArgsSchema, { name: "素材" })).toBe(true);
    expect(accepts(proposeCreateReferenceArgsSchema, { name: "素材", source: null, content: "正文", tags: ["a"] })).toBe(true);
    expect(accepts(proposeCreateReferenceArgsSchema, { name: "素材", source: "https://example.com" })).toBe(true);
    expect(accepts(proposeCreateReferenceArgsSchema, { name: "素材", extra: 1 })).toBe(false);
  });

  it("data / patches 承载任意结构（record 透传，不因嵌套类型被拒）", () => {
    expect(
      accepts(proposeCreateEntityArgsSchema, {
        type: "character",
        name: "张三",
        data: { role: "主角", tags: ["a", "b"], nested: { deep: true }, age: 30 },
      }),
    ).toBe(true);
  });
});

describe("练习工具 schema 约束（作家文风练习，2026-10 改版）", () => {
  it("submit_practice_topic：题目 / 写作要求的上限 = shared 常量（超一字符即拒）", () => {
    expect(accepts(submitPracticeTopicArgsSchema, { piece_id: "pf-1", topic: "题".repeat(MAX_PRACTICE_TOPIC_CHARS) })).toBe(true);
    expect(accepts(submitPracticeTopicArgsSchema, { piece_id: "pf-1", topic: "题".repeat(MAX_PRACTICE_TOPIC_CHARS + 1) })).toBe(false);
    expect(
      accepts(submitPracticeTopicArgsSchema, {
        piece_id: "pf-1",
        topic: "题",
        brief: "要".repeat(MAX_PRACTICE_BRIEF_CHARS),
      }),
    ).toBe(true);
    expect(
      accepts(submitPracticeTopicArgsSchema, {
        piece_id: "pf-1",
        topic: "题",
        brief: "要".repeat(MAX_PRACTICE_BRIEF_CHARS + 1),
      }),
    ).toBe(false);
  });

  it("分页工具：offset 非负整数 / max_chars ≥ 1；未知键拒绝（四个只读工具同款严格对象）", () => {
    expect(accepts(practiceTextPageArgsSchema, { sample_id: "ps-1" })).toBe(true);
    expect(accepts(practiceTextPageArgsSchema, { sample_id: "ps-1", offset: 0, max_chars: 1 })).toBe(true);
    expect(accepts(practiceTextPageArgsSchema, { sample_id: "ps-1", offset: -1 })).toBe(false);
    expect(accepts(practiceTextPageArgsSchema, { sample_id: "ps-1", max_chars: 0 })).toBe(false);
    expect(accepts(practiceTextPageArgsSchema, { sample_id: "ps-1", extra: 1 })).toBe(false);
    expect(accepts(freeDraftPageArgsSchema, { piece_id: "pf-1" })).toBe(true);
    expect(accepts(freeDraftPageArgsSchema, { sample_id: "ps-1" })).toBe(false); // 刻意不做「一个工具 + 多态 id」
    expect(accepts(styleNotesPageArgsSchema, {})).toBe(true);
    expect(accepts(styleNotesPageArgsSchema, { author_id: "jiangnan" })).toBe(false); // 作家由工作区决定，不自由传
  });

  it("两个提交点评卡 schema 同形：dimensions 必填、summary 可省；未知键拒绝", () => {
    const dimensions = [{ name: "d", sample_trait: "a", draft_trait: "b", advice: "c" }];
    expect(accepts(submitStyleFeedbackArgsSchema, { sample_id: "ps-1", dimensions })).toBe(true);
    expect(accepts(submitStyleFeedbackArgsSchema, { sample_id: "ps-1", dimensions, summary: "总评" })).toBe(true);
    expect(accepts(submitStyleFeedbackArgsSchema, { sample_id: "ps-1" })).toBe(false);
    expect(accepts(submitStyleFeedbackArgsSchema, { sample_id: "ps-1", dimensions, extra: 1 })).toBe(false);
    expect(accepts(submitFreeFeedbackArgsSchema, { piece_id: "pf-1", dimensions })).toBe(true);
    expect(accepts(submitStyleFeedbackArgsSchema, { sample_id: "ps-1", dimensions: [{ name: "d" }] })).toBe(false);
  });

  it("web_search：query 必填且不超上限、count 为 1..上限整数、未知键拒绝", () => {
    expect(accepts(webSearchArgsSchema, { query: "红楼梦 版本" })).toBe(true);
    expect(accepts(webSearchArgsSchema, { query: "红楼梦", count: 1 })).toBe(true);
    expect(accepts(webSearchArgsSchema, { query: "红楼梦", count: MAX_SEARCH_RESULT_COUNT })).toBe(true);
    // 上限边界：恰好等于上限通过、多一字 / 多一条拒绝
    expect(accepts(webSearchArgsSchema, { query: "字".repeat(MAX_SEARCH_QUERY_CHARS) })).toBe(true);
    expect(accepts(webSearchArgsSchema, { query: "字".repeat(MAX_SEARCH_QUERY_CHARS + 1) })).toBe(false);
    expect(accepts(webSearchArgsSchema, { query: "红楼梦", count: MAX_SEARCH_RESULT_COUNT + 1 })).toBe(false);
    expect(accepts(webSearchArgsSchema, { query: "红楼梦", count: 0 })).toBe(false);
    expect(accepts(webSearchArgsSchema, { query: "" })).toBe(false);
    expect(accepts(webSearchArgsSchema, {})).toBe(false);
    // 严格对象：不自造 recency / domain 一类结构化过滤字段（过滤语法写在 query 里）
    expect(accepts(webSearchArgsSchema, { query: "红楼梦", recency: "week" })).toBe(false);
  });

  it("fetch_content：url 必填且不超上限、未知键拒绝", () => {
    expect(accepts(fetchContentArgsSchema, { url: "https://example.com/a" })).toBe(true);
    // 上限边界：恰好等于上限通过、多一字拒绝
    expect(accepts(fetchContentArgsSchema, { url: "h".repeat(MAX_FETCH_URL_CHARS) })).toBe(true);
    expect(accepts(fetchContentArgsSchema, { url: "h".repeat(MAX_FETCH_URL_CHARS + 1) })).toBe(false);
    expect(accepts(fetchContentArgsSchema, { url: "" })).toBe(false);
    expect(accepts(fetchContentArgsSchema, {})).toBe(false);
    expect(accepts(fetchContentArgsSchema, { url: "https://example.com/a", max_chars: 100 })).toBe(false);
  });
});
