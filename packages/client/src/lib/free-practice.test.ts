// 自由练习展示口径单测（卡 5）：四态徽标映射 + 题目空态文案 + 「让 AI 点评」可点性 + 稿件保存动作
// + 出题 / 点评共用的帧刷新判定。
// 契约：`docs/ui/DESIGN.md` §作家文风练习区（列表行「（待出题）」与四态徽标 / 详情页头「待出题」）、
// `docs/api/120-api-practice.md`「自由练习」（列表项字段 + 写稿唯一入口）、
// `docs/design/60-practice.md` §4（两种形态与流程）/ §6（卡体两形态同形）。
// 页面级 DOM 断言在 `pages/free.test.tsx` 与 `pages/free-detail.test.tsx`（SSR 走查）；本文件只钉纯函数口径。
import { describe, expect, it, vi } from "vitest";
import { TOOL_DETAILS_TO_CLIENT } from "@whispering233/ai-editor-shared";
import { ApiError } from "./api";

// 保存动作要真发 PUT ⇒ mock 掉 api 模块（保留 ApiError 真实实现，错误码断言才有意义）
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, updatePracticePieceDraft: vi.fn() };
});

import { updatePracticePieceDraft } from "./api";
import {
  FREE_TOPIC_TEXT,
  freePracticeSignalPieceId,
  freePracticeStatus,
  freePracticeTopicLabel,
  freePracticeTopicTitle,
  saveFreeDraft,
  shouldRefreshFreePiece,
} from "./free-practice";

const mockedSave = vi.mocked(updatePracticePieceDraft);

/**
 * 随 `details` 帧下发的工具名（取 shared 白名单首项，**不写工具名字面量**）：白名单由卡 7 扩到
 * 出题 / 自由练习点评工具，测试跟着白名单走 ⇒ 扩表后本文件不需要改（也不锁死今天的单元素状态）。
 */
const DETAILS_TOOL = TOOL_DETAILS_TO_CLIENT[0];

describe("freePracticeStatus（自由练习状态徽标四态）", () => {
  it('题目为空 → 待出题（`topic_source: "ai"` 建的空题行）', () => {
    expect(freePracticeStatus({ topic: "", hasDraft: false, hasFeedback: false })).toBe("待出题");
  });

  it("空题优先于稿件与卡体：有稿甚至有点评仍报「待出题」（不存在「有稿却无题」的正常态）", () => {
    expect(freePracticeStatus({ topic: "   ", hasDraft: true, hasFeedback: false })).toBe("待出题");
    expect(freePracticeStatus({ topic: "   ", hasDraft: true, hasFeedback: true })).toBe("待出题");
  });

  it("有题无稿 → 待写稿；有稿无卡 → 待点评；有卡 → 已点评", () => {
    const cases = [
      [{ hasDraft: false, hasFeedback: false }, "待写稿"],
      [{ hasDraft: true, hasFeedback: false }, "待点评"],
      [{ hasDraft: true, hasFeedback: true }, "已点评"],
    ] as const;
    for (const [flags, label] of cases) {
      expect(freePracticeStatus({ topic: "写一段雨夜的告别", ...flags }), label).toBe(label);
    }
  });
});

describe("题目文案（空题的唯一字面量来源）", () => {
  it("列表行：题目去首尾空白；空题 → 「（待出题）」", () => {
    expect(freePracticeTopicLabel("  写一段雨夜的告别  ")).toBe("写一段雨夜的告别");
    expect(freePracticeTopicLabel("   ")).toBe(`（${FREE_TOPIC_TEXT}）`);
  });

  it("详情页头：空题 → 「待出题」（不带括号，同 DESIGN.md §自由练习详情）", () => {
    expect(freePracticeTopicTitle("写一段雨夜的告别")).toBe("写一段雨夜的告别");
    expect(freePracticeTopicTitle("")).toBe(FREE_TOPIC_TEXT);
  });
});

// 「让 AI 点评」可点性 = `lib/practice.ts` 的 `canRequestPracticeReview`（两形态共用同一谓词）；
// 自由练习侧只在页面接线（`free-detail.test.tsx` 的 canReview 三态）断言它生效。

describe("saveFreeDraft（稿件保存动作）", () => {
  it("成功：`updatedAt` 交给 onSaved 并返回 true（快捷键据此继续存档）", async () => {
    mockedSave.mockResolvedValue({ updatedAt: "2026-10-01T12:00:00.000Z" });
    const onSaved = vi.fn();
    const onFailed = vi.fn();
    await expect(
      saveFreeDraft({ pieceId: "pf-1", draft: "新稿", onSaved, onFailed }),
    ).resolves.toBe(true);
    expect(mockedSave).toHaveBeenCalledWith("pf-1", "新稿");
    expect(onSaved).toHaveBeenCalledWith("2026-10-01T12:00:00.000Z");
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("服务端失败 → **返回 false**（页面据此阻断存档）+ 错误码/文案原样交给 onFailed，不抛错", async () => {
    mockedSave.mockRejectedValue(new ApiError("VALIDATION_ERROR", "参数校验失败"));
    const onSaved = vi.fn();
    const onFailed = vi.fn();
    await expect(
      saveFreeDraft({ pieceId: "pf-1", draft: "超长稿", onSaved, onFailed }),
    ).resolves.toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith({ code: "VALIDATION_ERROR", message: "参数校验失败" });
  });

  it("篇已不存在（404）→ 仍返回 false 且码透传（页面据此切 404 态）", async () => {
    mockedSave.mockRejectedValue(new ApiError("PRACTICE_NOT_FOUND", "自由练习不存在"));
    const onFailed = vi.fn();
    await expect(
      saveFreeDraft({ pieceId: "pf-gone", draft: "", onSaved: vi.fn(), onFailed }),
    ).resolves.toBe(false);
    expect(onFailed).toHaveBeenCalledWith({
      code: "PRACTICE_NOT_FOUND",
      message: "自由练习不存在",
    });
  });

  it("网络层失败（非 ApiError）→ 返回 false + CLIENT_NETWORK_ERROR 兜底文案", async () => {
    mockedSave.mockRejectedValue(new TypeError("fetch failed"));
    const onFailed = vi.fn();
    await expect(
      saveFreeDraft({ pieceId: "pf-1", draft: "稿", onSaved: vi.fn(), onFailed }),
    ).resolves.toBe(false);
    expect(onFailed).toHaveBeenCalledWith({
      code: "CLIENT_NETWORK_ERROR",
      message: "保存失败，请重试",
    });
  });
});

describe("freePracticeSignalPieceId（帧归属的篇 id）", () => {
  it("白名单工具 + 入参带 `piece_id` → 认领（出题帧与点评帧同一口径）", () => {
    expect(freePracticeSignalPieceId({ tool: DETAILS_TOOL, args: { piece_id: "pf-7" } })).toBe(
      "pf-7",
    );
  });

  it("无帧 / 非白名单工具 → null（不手抄工具名，判据 = shared 白名单）", () => {
    expect(freePracticeSignalPieceId(null)).toBeNull();
    expect(
      freePracticeSignalPieceId({ tool: "get_chapter_text", args: { piece_id: "pf-7" } }),
    ).toBeNull();
  });

  it("入参缺失 / 非对象 / `piece_id` 非字符串 → null", () => {
    expect(freePracticeSignalPieceId({ tool: DETAILS_TOOL })).toBeNull();
    expect(freePracticeSignalPieceId({ tool: DETAILS_TOOL, args: "pf-7" })).toBeNull();
    expect(freePracticeSignalPieceId({ tool: DETAILS_TOOL, args: { piece_id: 7 } })).toBeNull();
  });
});

describe("shouldRefreshFreePiece（出题与点评共用的刷新判定）", () => {
  it("本 id 的新帧 → 重拉", () => {
    expect(
      shouldRefreshFreePiece({ seq: 3, seqConsumed: 2, signalPieceId: "pf-1", pieceId: "pf-1" }),
    ).toBe(true);
  });

  it("无帧 / 旧帧（序号未前进）→ 不重拉（同一个帧不得重复触发）", () => {
    expect(
      shouldRefreshFreePiece({
        seq: null,
        seqConsumed: null,
        signalPieceId: "pf-1",
        pieceId: "pf-1",
      }),
    ).toBe(false);
    expect(
      shouldRefreshFreePiece({ seq: 2, seqConsumed: 2, signalPieceId: "pf-1", pieceId: "pf-1" }),
    ).toBe(false);
  });

  it("别的篇的帧 → 不重拉（帧会推到所有页面，本页只认自己这一篇）", () => {
    expect(
      shouldRefreshFreePiece({ seq: 4, seqConsumed: 2, signalPieceId: "pf-2", pieceId: "pf-1" }),
    ).toBe(false);
    expect(
      shouldRefreshFreePiece({ seq: 4, seqConsumed: 2, signalPieceId: null, pieceId: "pf-1" }),
    ).toBe(false);
  });
});
