// outline-detail 纯函数测试（S12.2 节点详情页）：data 字段配置（麦基字段集，按层级）、
// 冲突层次多选切换、场景节点选择器选项（仅 scene 叶子）、引用字段「未设置」值归一
import { describe, expect, it } from "vitest";
import type { OutlineNode } from "@whispering233/ai-editor-shared";
import {
  CONFLICT_LEVEL_LABEL,
  chapterTagPool,
  detailFieldsForNodeType,
  normalizeOutlineDataForm,
  sceneNodeOptions,
  sceneSelectValue,
  toggleConflictLevel,
} from "./outline-detail";
import { diffData } from "./entity-detail";

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

describe("detailFieldsForNodeType（data 字段按层级）", () => {
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

  it("chapter 六项：状态 → 剧情线标签 → 叙事功能 → 张力度 → 章末反转 → 章高潮场景", () => {
    const fields = detailFieldsForNodeType("chapter");
    expect(fields.map((f) => f.key)).toEqual([
      "status",
      "tags",
      "function",
      "tension",
      "reversal",
      "climax_scene",
    ]);
    expect(fields.map((f) => f.control)).toEqual([
      "select",
      "tags",
      "select",
      "select",
      "textarea",
      "scene-select",
    ]);
    // 枚举下拉复用 options / optionsLabels；状态缺省即草稿（服务端 schema 同口径）
    expect(fields[0].options).toEqual(["draft", "revision", "final"]);
    expect(fields[0].optionsLabels?.final).toBe("定稿");
    expect(fields[0].defaultValue).toBe("draft");
    expect(fields[2].options).toEqual(["setup", "advance", "turn", "resolve", "breather"]);
    expect(fields[2].optionsLabels?.turn).toBe("转折");
    expect(fields[3].options).toEqual(["low", "mid", "high"]);
    expect(fields[3].optionsLabels?.high).toBe("高");
    expect(fields[4].maxLength).toBe(1000);
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

describe("chapterTagPool（章标签候选池）", () => {
  const tagged: OutlineNode[] = [
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
          data: { tags: ["复仇线", "感情线"] },
          children: [
            { id: "sc-1", type: "scene", title: "场景一", updatedAt: "t0", data: { tags: ["复仇线"] } },
          ],
        },
        { id: "ch-2", type: "chapter", title: "第二章", updatedAt: "t0", data: { tags: ["权谋"] } },
      ],
    },
    {
      id: "ch-3",
      type: "chapter",
      title: "第三章",
      updatedAt: "t0",
      data: { tags: ["感情线", ""] },
    },
  ];

  it("遍历全书章与场景标签：去重计数 + 次数降序 + 同频字典序", () => {
    expect(chapterTagPool(tagged)).toEqual([
      { value: "复仇线", count: 2 },
      { value: "感情线", count: 2 },
      { value: "权谋", count: 1 },
    ]);
  });

  it("无标签 / 脏值（非数组、非字符串项、空串）不产生候选", () => {
    expect(chapterTagPool([])).toEqual([]);
    expect(
      chapterTagPool([
        { id: "ch-1", type: "chapter", title: "第一章", updatedAt: "t0", data: { tags: "复仇线" } },
        { id: "ch-2", type: "chapter", title: "第二章", updatedAt: "t0", data: {} },
        { id: "ch-3", type: "chapter", title: "第三章", updatedAt: "t0" },
      ]),
    ).toEqual([]);
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

describe("normalizeOutlineDataForm（tags 归一：末行空串 / 前后空格）", () => {
  it("tags 数组：trim + 丢弃空串，其它 key 原样", () => {
    expect(normalizeOutlineDataForm({ tags: ["验收线", "", "  b  "], status: "draft" })).toEqual({
      tags: ["验收线", "b"],
      status: "draft",
    });
    expect(normalizeOutlineDataForm({ tags: ["", "   "] })).toEqual({ tags: [] });
  });

  it("无 tags 键 / tags 非数组 → 返回入参同一对象", () => {
    const noTags = { status: "draft" };
    expect(normalizeOutlineDataForm(noTags)).toBe(noTags);
    const scalarTags = { tags: "a" };
    expect(normalizeOutlineDataForm(scalarTags)).toBe(scalarTags);
  });

  // K5 回归：TagsEditor 保留末行空串续输 → 归一后 payload 里不得再出现空串（schema min(1) 会 400）
  it("diffData(normalize(...)) 提交的 tags 不含空串", () => {
    const form = { tags: ["验收线", ""] };
    expect(diffData({}, normalizeOutlineDataForm(form))).toEqual({ tags: ["验收线"] });
    expect(diffData({ tags: ["验收线"] }, normalizeOutlineDataForm(form))).toBeNull();
  });
});
