// 练习展示口径单测（卡 9 / 卡 10）：状态徽标三态映射 + 「我的观察」空值取舍 + 点评卡可渲染视图 + 点评帧刷新判定。
// 契约：docs/ui/DESIGN.md §文风练习区（徽标文案三态 / 点评卡渲染）、docs/api/120-api-practice.md（列表项字段 + 卡体形状）。
// 页面级 DOM 断言在 pages/practice.test.tsx 与 pages/practice-detail.test.tsx（SSR 走查）；本文件只钉纯函数口径。
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";

// 保存动作要真发 PUT ⇒ mock 掉 api 模块（保留 ApiError 真实实现，错误码断言才有意义）
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, updatePracticeSampleDraft: vi.fn() };
});

import { updatePracticeSampleDraft } from "./api";
import {
  canRequestPracticeReview,
  practiceFeedbackSignalSampleId,
  practiceFeedbackView,
  practiceObservationText,
  practiceSampleStatus,
  savePracticeDraft,
  shouldRefreshPracticeCard,
} from "./practice";

const mockedSave = vi.mocked(updatePracticeSampleDraft);

describe("savePracticeDraft（稿件保存动作）", () => {
  it("成功：`updatedAt` 交给 onSaved 并返回 true（快捷键据此继续存档）", async () => {
    mockedSave.mockResolvedValue({ updatedAt: "2026-10-01T12:00:00.000Z" });
    const onSaved = vi.fn();
    const onFailed = vi.fn();
    await expect(
      savePracticeDraft({ sampleId: "ps-1", draft: "新稿", onSaved, onFailed }),
    ).resolves.toBe(true);
    expect(mockedSave).toHaveBeenCalledWith("ps-1", "新稿");
    expect(onSaved).toHaveBeenCalledWith("2026-10-01T12:00:00.000Z");
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("服务端失败 → **返回 false**（页面据此阻断存档）+ 错误码/文案原样交给 onFailed，不抛错", async () => {
    mockedSave.mockRejectedValue(new ApiError("VALIDATION_ERROR", "参数校验失败"));
    const onSaved = vi.fn();
    const onFailed = vi.fn();
    await expect(
      savePracticeDraft({ sampleId: "ps-1", draft: "超长稿", onSaved, onFailed }),
    ).resolves.toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith({ code: "VALIDATION_ERROR", message: "参数校验失败" });
  });

  it("样本已不存在（404）→ 仍返回 false 且码透传（页面据此切 404 态）", async () => {
    mockedSave.mockRejectedValue(new ApiError("PRACTICE_NOT_FOUND", "练习样本不存在"));
    const onFailed = vi.fn();
    await expect(
      savePracticeDraft({ sampleId: "ps-gone", draft: "", onSaved: vi.fn(), onFailed }),
    ).resolves.toBe(false);
    expect(onFailed).toHaveBeenCalledWith({ code: "PRACTICE_NOT_FOUND", message: "练习样本不存在" });
  });

  it("网络层失败（非 ApiError）→ 返回 false + CLIENT_NETWORK_ERROR 兜底文案", async () => {
    mockedSave.mockRejectedValue(new TypeError("fetch failed"));
    const onFailed = vi.fn();
    await expect(
      savePracticeDraft({ sampleId: "ps-1", draft: "稿", onSaved: vi.fn(), onFailed }),
    ).resolves.toBe(false);
    expect(onFailed).toHaveBeenCalledWith({
      code: "CLIENT_NETWORK_ERROR",
      message: "保存失败，请重试",
    });
  });
});

describe("practiceSampleStatus（样本状态徽标三态）", () => {
  it("都没写 → 未写稿（新建样本的初始态）", () => {
    expect(practiceSampleStatus({ hasDraft: false, hasFeedback: false })).toBe("未写稿");
  });

  it("有稿无卡 → 待点评", () => {
    expect(practiceSampleStatus({ hasDraft: true, hasFeedback: false })).toBe("待点评");
  });

  it("有卡 → 已点评（优先级高于有稿：有点评必然有稿）", () => {
    expect(practiceSampleStatus({ hasDraft: true, hasFeedback: true })).toBe("已点评");
  });

  it("只认 hasFeedback：稿为空但卡在（异常组合）也显示已点评，不因缺稿退成未写稿", () => {
    expect(practiceSampleStatus({ hasDraft: false, hasFeedback: true })).toBe("已点评");
  });
});

describe("practiceObservationText（我的观察：空值不占位）", () => {
  it("null / 空串 / 纯空白 → null（页面据此不渲染观察行）", () => {
    for (const input of [null, "", "   ", "\n\t "]) {
      expect(practiceObservationText(input)).toBeNull();
    }
  });

  it("有内容 → 去首尾空白后原样给（换行等内部空白保留）", () => {
    expect(practiceObservationText("  多用短句  ")).toBe("多用短句");
    expect(practiceObservationText("短句\n少形容词")).toBe("短句\n少形容词");
  });
});

// ============ 卡 10：点评卡可渲染视图 + 点评帧刷新判定 ============

describe("practiceFeedbackView（点评卡 → 可渲染视图）", () => {
  const dimension = {
    name: "句长节奏",
    sample_trait: "句子短促",
    draft_trait: "句子偏长",
    sample_quotes: ["明海出家已经四年了。"],
    draft_quotes: ["他进城已经四年了。"],
    advice: "把长句拆成短句",
  };

  it("满卡 → summary 与维度原样给（字段名保持 snake_case，不做 camelCase 改名）", () => {
    const view = practiceFeedbackView({ dimensions: [dimension], summary: "整体克制" });
    expect(view).toEqual({
      summary: "整体克制",
      dimensions: [
        {
          name: "句长节奏",
          sample_trait: "句子短促",
          draft_trait: "句子偏长",
          sample_quotes: ["明海出家已经四年了。"],
          draft_quotes: ["他进城已经四年了。"],
          advice: "把长句拆成短句",
        },
      ],
    });
  });

  it("无卡（null）→ null（页面给「还没点评」空态）", () => {
    expect(practiceFeedbackView(null)).toBeNull();
  });

  it("合法 JSON 对象但无内容（`{}`）→ null：不出现空白卡面", () => {
    // 读取侧只防「非对象」（合法 JSON 对象一律透传，`{}` 亦然）⇒ 渲染前必须逐字段收窄
    expect(practiceFeedbackView({} as never)).toBeNull();
    expect(practiceFeedbackView({ dimensions: [], summary: "   " } as never)).toBeNull();
  });

  it("字段类型/缺失防御：非数组 dimensions、非字符串字段 → 空值，不抛错", () => {
    const view = practiceFeedbackView({
      dimensions: [{ name: 7, sample_quotes: "不是数组", draft_trait: "偏长", advice: null }],
      summary: 42,
    } as never);
    expect(view).toEqual({
      summary: null,
      dimensions: [
        {
          name: "",
          sample_trait: "",
          draft_trait: "偏长",
          sample_quotes: [],
          draft_quotes: [],
          advice: "",
        },
      ],
    });
  });

  it("引用逐条收窄：非字符串 / 空串 / 纯空白丢弃（写入侧已丢一轮，这里只防手改库/旧值）", () => {
    const view = practiceFeedbackView({
      dimensions: [{ name: "引用", sample_quotes: ["好句", "", "   ", 7], draft_quotes: null }],
    } as never);
    expect(view?.dimensions[0].sample_quotes).toEqual(["好句"]);
    expect(view?.dimensions[0].draft_quotes).toEqual([]);
  });

  it("整条无内容的维度被丢弃（写入侧不约束，读取侧可能出现空元素）", () => {
    const view = practiceFeedbackView({
      dimensions: [{}, dimension],
    } as never);
    expect(view?.dimensions).toHaveLength(1);
    expect(view?.dimensions[0].name).toBe("句长节奏");
  });

  it("summary 与字段去首尾空白（换行等内部空白保留）", () => {
    const view = practiceFeedbackView({
      dimensions: [{ name: "  句长  ", advice: " 拆\n短 " }],
      summary: "  整体克制  ",
    } as never);
    expect(view?.summary).toBe("整体克制");
    expect(view?.dimensions[0]).toEqual({
      name: "句长",
      sample_trait: "",
      draft_trait: "",
      sample_quotes: [],
      draft_quotes: [],
      advice: "拆\n短",
    });
  });
});

describe("practiceFeedbackSignalSampleId（details 帧 → 归属样本）", () => {
  it("提交点评工具的帧（args.sample_id）→ 该样本 id", () => {
    expect(
      practiceFeedbackSignalSampleId({
        tool: "submit_style_feedback",
        args: { sample_id: "ps-1", dimensions: [] },
      }),
    ).toBe("ps-1");
  });

  it("别的工具的 details 帧 → null（本页不认领；工具名单取自 shared TOOL_DETAILS_TO_CLIENT）", () => {
    expect(
      practiceFeedbackSignalSampleId({ tool: "propose_create_entity", args: { sample_id: "ps-1" } }),
    ).toBeNull();
  });

  it("缺 args / args 非对象 / sample_id 非字符串 → null", () => {
    expect(practiceFeedbackSignalSampleId({ tool: "submit_style_feedback" })).toBeNull();
    expect(practiceFeedbackSignalSampleId({ tool: "submit_style_feedback", args: null })).toBeNull();
    expect(practiceFeedbackSignalSampleId({ tool: "submit_style_feedback", args: "ps-1" })).toBeNull();
    expect(
      practiceFeedbackSignalSampleId({ tool: "submit_style_feedback", args: { sample_id: 7 } }),
    ).toBeNull();
  });

  it("无帧 → null", () => {
    expect(practiceFeedbackSignalSampleId(null)).toBeNull();
  });
});

describe("canRequestPracticeReview（「让 AI 点评」的可点性）", () => {
  it("有已保存的稿件且输入与服务端一致 → 可点", () => {
    expect(canRequestPracticeReview({ draft: "他进城已经四年了。" }, "他进城已经四年了。")).toBe(true);
  });

  it("还没写稿（服务端 draft 为空 / 纯空白）→ 不可点", () => {
    expect(canRequestPracticeReview({ draft: "" }, "")).toBe(false);
    expect(canRequestPracticeReview({ draft: "   " }, "   ")).toBe(false);
  });

  it("输入框里有未保存的改动 → 不可点（点评对象会是库里的旧稿）", () => {
    expect(canRequestPracticeReview({ draft: "旧稿" }, "旧稿 加了一句")).toBe(false);
    expect(canRequestPracticeReview({ draft: "旧稿" }, "")).toBe(false);
  });
});

describe("shouldRefreshPracticeCard（点评卡刷新判定）", () => {
  const base = { consumedSeq: 3, signalSampleId: "ps-1", sampleId: "ps-1" };

  it("本样本的新帧 → true（帧里只有写库结果，卡体靠这一次 GET 取回）", () => {
    expect(shouldRefreshPracticeCard({ ...base, seq: 4 })).toBe(true);
  });

  it("旧帧（序号未前进 / 无帧）→ false（页面重挂后 store 里仍有旧帧，不得重复触发）", () => {
    expect(shouldRefreshPracticeCard({ ...base, seq: 3 })).toBe(false);
    expect(shouldRefreshPracticeCard({ ...base, seq: null })).toBe(false);
  });

  it("别的样本的帧 → false（点评帧会推到所有页面，本页只认自己这份）", () => {
    expect(shouldRefreshPracticeCard({ ...base, seq: 4, signalSampleId: "ps-2" })).toBe(false);
    expect(shouldRefreshPracticeCard({ ...base, seq: 4, signalSampleId: null })).toBe(false);
  });

  it("首次消费（尚未消费过任何帧）→ true", () => {
    expect(shouldRefreshPracticeCard({ ...base, consumedSeq: null, seq: 1 })).toBe(true);
  });
});
