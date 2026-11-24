// 写作页「回填本章摘要」口径单测（章摘要回填闭环 C2）：消息文案 + 按钮可点性。
// 契约：`docs/ui/DESIGN.md` `writing-page`「页头『回填本章摘要』」。
// 页头接线（`sendMessage(..., { focus_node_id })` + 按钮位置）在 `components/manuscript/chapter-editor.test.ts`
// 的源码扫描里（仓内无 jsdom，同该文件既有手法）；本文件只钉纯函数口径。
import { describe, expect, it } from "vitest";
import { CHAPTER_SUMMARY_MESSAGE, canRequestChapterSummary } from "./writing-summary";

describe("canRequestChapterSummary（按钮可点性）", () => {
  it("正文已落库且非空 → 可点", () => {
    expect(canRequestChapterSummary(1200)).toBe(true);
  });

  it("空章 / 正文未落库（charCount 0）→ 不可点（AI 读不到可摘的内容）", () => {
    expect(canRequestChapterSummary(0)).toBe(false);
  });
});

describe("CHAPTER_SUMMARY_MESSAGE（用户可见文案）", () => {
  it("是发给 AI 的一句普通用户消息（非空、提到「本章正文」与「摘要」）", () => {
    expect(CHAPTER_SUMMARY_MESSAGE.trim()).not.toBe("");
    expect(CHAPTER_SUMMARY_MESSAGE).toContain("本章正文");
    expect(CHAPTER_SUMMARY_MESSAGE).toContain("摘要");
  });
});