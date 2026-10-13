// 练习展示口径单测（卡 9）：状态徽标三态映射 + 「我的观察」空值取舍。
// 契约：docs/ui/DESIGN.md §文风练习区（徽标文案三态）、docs/api/120-api-practice.md（列表项字段）。
// 页面级 DOM 断言在 pages/practice.test.tsx（SSR 走查）；本文件只钉纯函数口径。
import { describe, expect, it } from "vitest";
import { practiceObservationText, practiceSampleStatus } from "./practice";

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
