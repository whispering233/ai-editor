// 人物详情双视图判据单测（卡 3.2）：默认 tab / 计算节点默认值 / 只读取值展示。
// 卡 3.3 补：字段三分分组（不可变 / 可变）、基础信息必填判据、位置四态与默认 tab 的同源判据。
// 契约：docs/ui/DESIGN.md `character-workbench`（两分区、有当前位置 → tab 2、未设置 → tab 1 + 提示）；
// docs/design/10-data-model.md §14（不可变字段不参与 Delta ⇒ 两视图一致；tab 2 只读）。
import { describe, expect, it } from "vitest";
import { IMMUTABLE_FIELDS } from "@whispering233/ai-editor-shared";
import {
  characterFieldGroups,
  hasCharacterBasicsErrors,
  isEmptyTextField,
  readOnlyFieldValue,
  resolveCurrentAtNode,
  resolveDefaultTab,
  resolvePositionState,
  resolveTabState,
  validateCharacterBasics,
  CHARACTER_BASICS_DATA_KEYS,
  CHARACTER_SECTION_BASICS,
  CHARACTER_SECTION_MUTABLE,
  DESCRIPTION_EMPTY_HINT,
  OUTLINE_LOADING_TEXT,
  READONLY_FALLBACK_TEXT,
  READONLY_JSON_MAX_LENGTH,
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

  it("基础信息字段集 = shared 不可变字段白名单（卡片 5.6：单一定义，禁止手抄）", () => {
 // 值相等 + 顺序一致 = 渲染顺序与 `IMMUTABLE_FIELDS.character` 同源；tools 提案层守卫消费同一常量
    expect(CHARACTER_BASICS_DATA_KEYS).toEqual(IMMUTABLE_FIELDS.character);
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

  it("全标量数组 → 「、」连接（与列表摘要同款展示口径）", () => {
    expect(readOnlyFieldValue(["坚韧", "多疑"])).toBe("坚韧、多疑");
    expect(readOnlyFieldValue([])).toBe("");
  });

  it("对象 → 紧凑 JSON（不再 [object Object]）", () => {
    expect(readOnlyFieldValue({ 门派: "青云门", 境界: "筑基" })).toBe(
      '{"门派":"青云门","境界":"筑基"}',
    );
    expect(readOnlyFieldValue({ nested: { level: 2 } })).toBe('{"nested":{"level":2}}');
  });

  it("含对象的数组 → 同样走 JSON（不产出 [object Object]）", () => {
    const out = readOnlyFieldValue([{ a: 1 }, "x"]);
    expect(out).toBe('[{"a":1},"x"]');
    expect(out).not.toContain("[object Object]");
  });

  it("超长对象值 → 截断到上限 + 省略号（有界串不撐破行布局）", () => {
    const long = { key: "值".repeat(400) };
    const out = readOnlyFieldValue(long);
    expect(out.length).toBe(READONLY_JSON_MAX_LENGTH + 1); // 截断段 + 「…」
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith('{"key":"值值')).toBe(true);
  });

  it("无法序列化（循环引用）→ 兑底文案，不抛错", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(readOnlyFieldValue(cyclic)).toBe(READONLY_FALLBACK_TEXT);
  });
});

describe("isEmptyTextField / DESCRIPTION_EMPTY_HINT（卡 3.3 修复轮）", () => {
  it("非字符串（undefined/null/数字）与纯空白均判空", () => {
    expect(isEmptyTextField(undefined)).toBe(true);
    expect(isEmptyTextField(null)).toBe(true);
    expect(isEmptyTextField("")).toBe(true);
    expect(isEmptyTextField("   ")).toBe(true);
    expect(isEmptyTextField(12)).toBe(true);
    expect(isEmptyTextField("青云门弟子")).toBe(false);
  });

  it("提示文案与必填错误文案是两件事（提示解释原因，错误在提交后出现）", () => {
    expect(DESCRIPTION_EMPTY_HINT).toBe("描述为空，保存前需填写");
    expect(DESCRIPTION_EMPTY_HINT).not.toBe("描述不能为空");
  });
});

describe("OUTLINE_LOADING_TEXT（文案单一来源）", () => {
  it("选择器与 tab 2 位置提示共用同一常量", () => {
    expect(OUTLINE_LOADING_TEXT).toBe("大纲加载中…");
  });
});
