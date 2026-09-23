// 推演节点标记的切换与派生文案测试（卡片 D2）：徽标文案 / 章号一律来自 shared
// `buildDeductionMarks`（唯一编号口径，§15 不变式 2/3）——本测试也经 shared 派生，防止两处手抄。
// `submitDeductionMarks` 只在调用点触发 store action + toast（无纯逻辑），服务端契约由
// packages/server/src/routes/project.test.ts 覆盖（非章 / 不可见 → 400）。
import { describe, expect, it } from "vitest";
import { buildDeductionMarks, type DeductionTreeLike } from "@whispering233/ai-editor-shared";
import {
  deductionMarkTitle,
  deductionMenuLabel,
  isDeductionMarkHost,
  nextDeductionNodes,
} from "./deduction";

/** 卷1（ch-1、ch-2）+ 卷2（ch-3） */
const TREE: DeductionTreeLike = {
  children: [
    {
      id: "vol-1",
      type: "volume",
      title: "第一卷",
      children: [
        { id: "ch-1", type: "chapter", title: "雪夜出走" },
        { id: "ch-2", type: "chapter", title: "旧盟友" },
      ],
    },
    {
      id: "vol-2",
      type: "volume",
      title: "第二卷",
      children: [{ id: "ch-3", type: "chapter", title: "入城" }],
    },
  ],
};

describe("nextDeductionNodes（切换标记）", () => {
  it("未标记 → 追加（已标记元素的相对顺序不变）", () => {
    expect(nextDeductionNodes(["ch-3"], "ch-1")).toEqual(["ch-3", "ch-1"]);
    expect(nextDeductionNodes([], "ch-2")).toEqual(["ch-2"]);
  });

  it("已标记 → 移除，其余顺序不变", () => {
    expect(nextDeductionNodes(["ch-1", "ch-3", "ch-2"], "ch-3")).toEqual(["ch-1", "ch-2"]);
    expect(nextDeductionNodes(["ch-1"], "ch-1")).toEqual([]);
  });

  it("纯函数：不改动入参数组", () => {
    const current = ["ch-1"];
    nextDeductionNodes(current, "ch-2");
    nextDeductionNodes(current, "ch-1");
    expect(current).toEqual(["ch-1"]);
  });
});

describe("isDeductionMarkHost（仅章，§15 不变式 1）", () => {
  it("chapter → true", () => {
    expect(isDeductionMarkHost("chapter")).toBe(true);
  });

  it("volume / scene → false（卷太粗、场景太碎）", () => {
    expect(isDeductionMarkHost("volume")).toBe(false);
    expect(isDeductionMarkHost("scene")).toBe(false);
  });
});

describe("deductionMenuLabel（入口文案按当前状态切换）", () => {
  it("未标记 → 标记为推演节点；已标记 → 移出推演节点", () => {
    expect(deductionMenuLabel(false)).toBe("标记为推演节点");
    expect(deductionMenuLabel(true)).toBe("移出推演节点");
  });
});

describe("deductionMarkTitle（徽标 hover 完整语义）", () => {
  it("单标记 = 文案（第N章），不附 k / N", () => {
    const [mark] = buildDeductionMarks(TREE, ["ch-2"]);
    expect(mark.label).toBe("推演节点"); // 文案来自 shared
    expect(deductionMarkTitle(mark, 1)).toBe("推演节点（第2章）");
  });

  it("多标记 = 文案（第N章）· 第 k / 共 N 个推演节点（k = 标记序号）", () => {
    const marks = buildDeductionMarks(TREE, ["ch-1", "ch-3"]);
    expect(marks.map((m) => m.label)).toEqual(["推演起点", "推演终点"]);
    expect(deductionMarkTitle(marks[0], marks.length)).toBe(
      "推演起点（第1章） · 第 1 / 共 2 个推演节点",
    );
    expect(deductionMarkTitle(marks[1], marks.length)).toBe(
      "推演终点（第3章） · 第 2 / 共 2 个推演节点",
    );
  });
});
