// tags-editor 纯函数测试（批次六 M1）：回车添加下一项行为决策
import { describe, expect, it } from "vitest";
import { enterBehavior } from "./tags-editor";

describe("enterBehavior（标签行内回车行为决策——M1「输入后回车添加下一项」）", () => {
  it("非末行：不追加，聚焦下一行", () => {
    expect(enterBehavior(["a", "b", "c"], 0)).toEqual({ append: false, focusIndex: 1 });
    expect(enterBehavior(["a", "b", "c"], 1)).toEqual({ append: false, focusIndex: 2 });
  });

  it("末行且当前值非空：追加空行并聚焦新行", () => {
    expect(enterBehavior(["a", "b"], 1)).toEqual({ append: true, focusIndex: 2 });
    expect(enterBehavior(["规则一"], 0)).toEqual({ append: true, focusIndex: 1 });
    // 纯空格视为空值（trim 判定）——不追加
    expect(enterBehavior(["a", "   "], 1)).toBeNull();
  });

  it("末行且当前值为空：无操作（防空行跑马灯）", () => {
    expect(enterBehavior(["a", ""], 1)).toBeNull();
    expect(enterBehavior([""], 0)).toBeNull();
  });

  it("边界防御：下标越界 / 空数组 → null", () => {
    expect(enterBehavior([], 0)).toBeNull();
    expect(enterBehavior(["a"], -1)).toBeNull();
    expect(enterBehavior(["a"], 2)).toBeNull();
  });
});
