// tags-editor 纯函数测试（批次六 M1/M3）：回车添加下一项行为决策 + 拖拽排序数组移动
import { describe, expect, it } from "vitest";
import { enterBehavior, moveArrayItem } from "./tags-editor";

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

describe("moveArrayItem（拖拽排序数组移动——M3）", () => {
  it("向后移：0 → 2", () => {
    expect(moveArrayItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("向前移：3 → 1", () => {
    expect(moveArrayItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("原地放下（from === to）：顺序不变，返回副本", () => {
    const src = ["规则一", "规则二"];
    expect(moveArrayItem(src, 1, 1)).toEqual(src);
    expect(moveArrayItem(src, 1, 1)).not.toBe(src); // 副本（不修改原数组）
  });

  it("下标越界：防御返回副本不抛错", () => {
    expect(moveArrayItem(["a"], -1, 0)).toEqual(["a"]);
    expect(moveArrayItem(["a"], 0, 5)).toEqual(["a"]);
    expect(moveArrayItem([], 0, 0)).toEqual([]);
  });

  it("单元素：原地放下不变", () => {
    expect(moveArrayItem(["x"], 0, 0)).toEqual(["x"]);
  });
});
