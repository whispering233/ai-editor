// 人物详情双视图判据单测（卡 3.2）：默认 tab / 计算节点默认值 / 只读取值展示。
// 卡 3.3 补：字段三分分组（不可变 / 可变）、基础信息必填判据、位置四态与默认 tab 的同源判据。
// 契约：docs/ui/DESIGN.md `character-workbench`（两分区、有当前位置 → tab 2、未设置 → tab 1 + 提示）；
// docs/design/10-data-model.md §14（不可变字段不参与 Delta ⇒ 两视图一致；tab 2 只读）。
import { describe, expect, it } from "vitest";
import {
  characterFieldGroups,
  hasCharacterBasicsErrors,
  readOnlyFieldValue,
  resolveCurrentAtNode,
  resolveDefaultTab,
  resolvePositionState,
  resolveTabState,
  validateCharacterBasics,
  CHARACTER_SECTION_BASICS,
  CHARACTER_SECTION_MUTABLE,
} from "./character-detail";

describe("resolveDefaultTab", () => {
  it("设置了当前位置 → 「当前位置数据」", () => {
    expect(resolveDefaultTab("ch-1")).toBe("current");
  });

  it("未设置（null/undefined/空串/纯空白）→ 「初始化数据」", () => {
    expect(resolveDefaultTab(null)).toBe("initial");
    expect(resolveDefaultTab(undefined)).toBe("initial");
    expect(resolveDefaultTab("")).toBe("initial");
    expect(resolveDefaultTab("   ")).toBe("initial");
  });
});

describe("resolveCurrentAtNode", () => {
  it("当前位置存在于大纲树 → 作为计算节点", () => {
    expect(resolveCurrentAtNode("ch-2", ["ch-1", "ch-2"])).toBe("ch-2");
  });

  it("失效/软删/未设置 → 空串（要求手动选择，不做无效计算）", () => {
    expect(resolveCurrentAtNode("ch-9", ["ch-1", "ch-2"])).toBe("");
    expect(resolveCurrentAtNode(null, ["ch-1"])).toBe("");
    expect(resolveCurrentAtNode("", ["ch-1"])).toBe("");
  });
});

describe("characterFieldGroups（字段三分）", () => {
  const [basics, mutable] = characterFieldGroups();

  it("分区标题 = 「基础信息」/「可变数据」（与 DESIGN.md 逐字一致）", () => {
    expect(basics.title).toBe(CHARACTER_SECTION_BASICS);
    expect(mutable.title).toBe(CHARACTER_SECTION_MUTABLE);
  });

  it("不可变区 = 角色定位 / 描述（姓名是 entities.name，由视图单独渲染）", () => {
    expect(basics.fields.map((f) => f.key)).toEqual(["role", "description"]);
  });

  it("可变区 = 假名 / 性别 / 年龄 / 种族 / 动机 / 性格（能力面板由宿主区块渲染，不在字段清单）", () => {
    expect(mutable.fields.map((f) => f.key)).toEqual([
      "alias",
      "gender",
      "age",
      "race",
      "motivation",
      "personality",
    ]);
  });

  it("两区不重叠、不遗漏（并集 = 人物字段清单去掉已废弃的 abilities）", () => {
    const keys = [...basics.fields, ...mutable.fields].map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("abilities");
    expect(keys).not.toContain("status");
  });
});

describe("validateCharacterBasics（必填判据，仅前端）", () => {
  it("正常值 → 无错", () => {
    expect(validateCharacterBasics({ name: "张三", description: "主角" })).toEqual({
      name: null,
      description: null,
    });
  });

  it("空值与纯空白 → 各自报错", () => {
    expect(validateCharacterBasics({ name: "", description: "" })).toEqual({
      name: "姓名不能为空",
      description: "描述不能为空",
    });
    expect(validateCharacterBasics({ name: "  ", description: "\n\t" })).toEqual({
      name: "姓名不能为空",
      description: "描述不能为空",
    });
  });

  it("非字符串（undefined / 数字）→ 视为空", () => {
    expect(validateCharacterBasics({ name: undefined, description: undefined }).description).toBe(
      "描述不能为空",
    );
    expect(validateCharacterBasics({ name: "张三", description: 3 }).description).toBe(
      "描述不能为空",
    );
  });

  it("hasCharacterBasicsErrors：任一非空即拦提交", () => {
    expect(hasCharacterBasicsErrors({ name: null, description: null })).toBe(false);
    expect(hasCharacterBasicsErrors({ name: null, description: "描述不能为空" })).toBe(true);
    expect(hasCharacterBasicsErrors({ name: "姓名不能为空", description: null })).toBe(true);
  });
});

describe("resolvePositionState（当前位置四态）", () => {
  const base = { configLoaded: true, currentPosition: "ch-1", outlineLoaded: true, nodeIds: ["ch-1"] };

  it("config 未加载 → pending（不得瞬时误判为「未设置」）", () => {
    expect(resolvePositionState({ ...base, configLoaded: false })).toBe("pending");
  });

  it("已确认未设置 → unset", () => {
    expect(resolvePositionState({ ...base, currentPosition: null })).toBe("unset");
  });

  it("指向的节点不在大纲树（已软删/被删）→ invalid", () => {
    expect(resolvePositionState({ ...base, currentPosition: "ch-9" })).toBe("invalid");
  });

  it("大纲未到位但位置存在 → ok（不误判失效；计算节点选择器自行给加载态）", () => {
    expect(resolvePositionState({ ...base, outlineLoaded: false, nodeIds: [] })).toBe("ok");
  });
});

describe("resolveTabState（默认 tab 与四态同源）", () => {
  it("有效当前位置 → tab 2", () => {
    const s = resolveTabState({
      configLoaded: true,
      currentPosition: "ch-1",
      outlineLoaded: true,
      nodeIds: ["ch-1"],
    });
    expect(s).toEqual({ tab: "current", positionState: "ok" });
  });

  it("失效当前位置 → 回落 tab 1 + invalid", () => {
    const s = resolveTabState({
      configLoaded: true,
      currentPosition: "ch-9",
      outlineLoaded: true,
      nodeIds: ["ch-1"],
    });
    expect(s).toEqual({ tab: "initial", positionState: "invalid" });
  });

  it("config 未加载 → tab 1 + pending", () => {
    const s = resolveTabState({
      configLoaded: false,
      currentPosition: null,
      outlineLoaded: false,
      nodeIds: [],
    });
    expect(s).toEqual({ tab: "initial", positionState: "pending" });
  });
});

describe("readOnlyFieldValue", () => {
  it("undefined/null → 空串；标量 String 化", () => {
    expect(readOnlyFieldValue(undefined)).toBe("");
    expect(readOnlyFieldValue(null)).toBe("");
    expect(readOnlyFieldValue(3)).toBe("3");
    expect(readOnlyFieldValue("主角")).toBe("主角");
  });

  it("数组 → 「、」连接（与列表摘要同款展示口径）", () => {
    expect(readOnlyFieldValue(["坚韧", "多疑"])).toBe("坚韧、多疑");
    expect(readOnlyFieldValue([])).toBe("");
  });
});
