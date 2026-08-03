// outline-detail 纯函数测试（S12.2 节点详情页）：data 字段配置（决策 23 麦基字段集，按层级）、
//   冲突层次多选切换、场景节点选择器选项（仅 scene 叶子）、引用字段「未设置」值归一
import { describe, expect, it } from "vitest";
import type { OutlineNode } from "@ai-editor/shared";
import {
  CONFLICT_LEVEL_LABEL,
  detailFieldsForNodeType,
  sceneNodeOptions,
  sceneSelectValue,
  toggleConflictLevel,
} from "./outline-detail";

/** 造树：卷1（章1（场1/场2）、章2）+ 根直挂章3（无场景） */
const tree: OutlineNode[] = [
  {
    id: "vol-1",
    type: "volume",
    title: "第一卷",
    updatedAt: "t0",
    children: [
      {
        id: "ch-1",
        type: "chapter",
        title: "第一章",
        updatedAt: "t0",
        children: [
          { id: "sc-1", type: "scene", title: "场景一", updatedAt: "t0" },
          { id: "sc-2", type: "scene", title: "场景二", updatedAt: "t0" },
        ],
      },
      { id: "ch-2", type: "chapter", title: "第二章", updatedAt: "t0" },
    ],
  },
  { id: "ch-3", type: "chapter", title: "第三章（根直挂）", updatedAt: "t0" },
];

describe("detailFieldsForNodeType（data 字段按层级，决策 23）", () => {
  it("scene：goal/conflict_levels/value_from/value_to（文本上限 1000/200）", () => {
    const fields = detailFieldsForNodeType("scene");
    expect(fields.map((f) => f.key)).toEqual(["goal", "conflict_levels", "value_from", "value_to"]);
    const goal = fields.find((f) => f.key === "goal")!;
    expect(goal.control).toBe("textarea");
    expect(goal.maxLength).toBe(1000);
    const conflict = fields.find((f) => f.key === "conflict_levels")!;
    expect(conflict.control).toBe("checkbox-group");
    expect(conflict.options).toEqual(["inner", "personal", "extra_personal"]);
    expect(conflict.optionsLabels).toBe(CONFLICT_LEVEL_LABEL);
    expect(fields.find((f) => f.key === "value_from")!.maxLength).toBe(200);
    expect(fields.find((f) => f.key === "value_to")!.maxLength).toBe(200);
  });

  it("chapter：reversal（多行 1000）+ climax_scene（场景选择器）", () => {
    const fields = detailFieldsForNodeType("chapter");
    expect(fields.map((f) => f.key)).toEqual(["reversal", "climax_scene"]);
    expect(fields[0].control).toBe("textarea");
    expect(fields[1].control).toBe("scene-select");
  });

  it("volume：climax_scene + inciting_scene（双场景选择器）", () => {
    const fields = detailFieldsForNodeType("volume");
    expect(fields.map((f) => f.key)).toEqual(["climax_scene", "inciting_scene"]);
    expect(fields.every((f) => f.control === "scene-select")).toBe(true);
  });
});

describe("toggleConflictLevel（checkbox 组 ↔ conflict_levels 数组）", () => {
  it("勾选追加（保持声明序）、取消移除", () => {
    expect(toggleConflictLevel([], "inner")).toEqual(["inner"]);
    expect(toggleConflictLevel(["inner"], "inner")).toEqual([]);
    expect(toggleConflictLevel(["inner"], "personal")).toEqual(["inner", "personal"]);
    expect(toggleConflictLevel(["personal", "inner"], "inner")).toEqual(["personal"]);
  });

  it("非法值忽略（不进入数组，也不因未知值报错）", () => {
    expect(toggleConflictLevel([], "social")).toEqual([]);
    expect(toggleConflictLevel(["inner"], "social")).toEqual(["inner"]);
  });
});

describe("sceneNodeOptions（引用字段选择器选项）", () => {
  it("仅列 scene 叶子（含深度缩进），卷/章不入列", () => {
    const options = sceneNodeOptions(tree);
    expect(options).toEqual([
      { id: "sc-1", label: "场景一", depth: 2 },
      { id: "sc-2", label: "场景二", depth: 2 },
    ]);
  });

  it("空树 → 空数组", () => {
    expect(sceneNodeOptions([])).toEqual([]);
  });
});

describe("sceneSelectValue（引用字段「未设置」值归一）", () => {
  it("缺失/空串/非字符串 → 空串（「（未设置）」）；有值 → id 原文", () => {
    expect(sceneSelectValue(undefined)).toBe("");
    expect(sceneSelectValue("")).toBe("");
    expect(sceneSelectValue(42)).toBe("");
    expect(sceneSelectValue("sc-5")).toBe("sc-5");
  });
});
