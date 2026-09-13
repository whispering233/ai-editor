// 新建人物弹窗纯函数判据走查（卡片 3.5）
// 覆盖：必填三项判据（含空白串）→ 载荷裁剪（空值不写键、数字 0 保留、数组过滤）→
//       重名软提示判据（trim/大小写）→ 面板三选（模板深拷贝独立性 / 从角色复制 / 计数）。
import { describe, expect, it } from "vitest";
import {
  CHARACTER_CANDIDATE_LIMIT,
  DEFAULT_PANEL_CHOICE,
  PANEL_MODE_OPTIONS,
  buildCharacterCreatePayload,
  findDuplicateCharacterName,
  hasCharacterCreateErrors,
  normalizeCharacterName,
  panelFromCharacterData,
  panelFromTemplate,
  panelNodeCount,
  pruneCharacterFormValues,
  validateCharacterCreate,
} from "./character-create";
import { PANEL_TEMPLATES } from "./panel-tree";

describe("validateCharacterCreate（必填 = 姓名 / 角色定位 / 描述，仅前端）", () => {
  it("合法输入 → 三项全 null", () => {
    const errors = validateCharacterCreate({ name: "张三", role: "主角", description: "青云门弟子" });
    expect(errors).toEqual({ name: null, role: null, description: null });
    expect(hasCharacterCreateErrors(errors)).toBe(false);
  });

  it("空值与非字符串 → 三项各自报错", () => {
    const errors = validateCharacterCreate({ name: "", role: "", description: "" });
    expect(errors.name).toBe("姓名不能为空");
    expect(errors.role).toBe("角色定位不能为空");
    expect(errors.description).toBe("描述不能为空");
    expect(hasCharacterCreateErrors(errors)).toBe(true);

    const nonString = validateCharacterCreate({ name: null, role: 42, description: undefined });
    expect(hasCharacterCreateErrors(nonString)).toBe(true);
  });

  it("纯空白视为空（trim 口径）", () => {
    const errors = validateCharacterCreate({ name: "  ", role: "\t", description: " \n " });
    expect(errors.name).toBe("姓名不能为空");
    expect(errors.role).toBe("角色定位不能为空");
    expect(errors.description).toBe("描述不能为空");
  });
});

describe("findDuplicateCharacterName（软提示，不阻断）", () => {
  const ITEMS = [{ name: "张三" }, { name: "Li Si" }];

  it("命中返回既有条目原文名", () => {
    expect(findDuplicateCharacterName(ITEMS, "张三")).toBe("张三");
  });

  it("trim + 大小写不敏感（英文名）", () => {
    expect(findDuplicateCharacterName(ITEMS, "  li si  ")).toBe("Li Si");
    expect(normalizeCharacterName("  Li Si ")).toBe("li si");
  });

  it("空名/纯空白不提示；无命中 → null", () => {
    expect(findDuplicateCharacterName(ITEMS, "")).toBeNull();
    expect(findDuplicateCharacterName(ITEMS, "   ")).toBeNull();
    expect(findDuplicateCharacterName(ITEMS, "王五")).toBeNull();
  });
});

describe("pruneCharacterFormValues（只写非空值；data 稀疏语义）", () => {
  it("字符串 trim 后写入、空串丢弃", () => {
    const out = pruneCharacterFormValues({ alias: "  张铁柱 ", gender: "  " }, ["alias", "gender"]);
    expect(out).toEqual({ alias: "张铁柱" });
  });

  it("数字：0 保留、NaN/Infinity 丢弃", () => {
    const out = pruneCharacterFormValues({ age: 0, half: Number.NaN, inf: Number.POSITIVE_INFINITY }, [
      "age",
      "half",
      "inf",
    ]);
    expect(out).toEqual({ age: 0 });
  });

  it("数组：逐项 trim 且过滤空串，全空则丢弃键", () => {
    const out = pruneCharacterFormValues({ personality: [" 坚韧 ", "", "   ", "多疑"] }, [
      "personality",
    ]);
    expect(out).toEqual({ personality: ["坚韧", "多疑"] });
    expect(pruneCharacterFormValues({ personality: ["", "  "] }, ["personality"])).toEqual({});
  });

  it("undefined/null 跳过；清单外键不写入", () => {
    expect(pruneCharacterFormValues({ alias: undefined, gender: null }, ["alias", "gender"])).toEqual(
      {},
    );
    expect(pruneCharacterFormValues({ other: "x" }, ["alias"])).toEqual({});
  });
});

describe("buildCharacterCreatePayload（姓名走列 / 其余走 data / 面板深拷贝）", () => {
  it("姓名 trim 进 name；必填进 data；未填可选字段不产生键", () => {
    const payload = buildCharacterCreatePayload({
      name: "  张三 ",
      basics: { role: "主角", description: "青云门弟子" },
      mutable: { alias: " 张铁柱 ", gender: "", age: 18, personality: [] },
      panel: [],
    });
    expect(payload.name).toBe("张三");
    expect(payload.data).toEqual({ role: "主角", description: "青云门弟子", alias: "张铁柱", age: 18 });
    expect("ability_panel" in payload.data).toBe(false); // 空白面板 → 不写键
  });

  it("非空面板 → 深拷贝写入（改返回值不影响源结构）", () => {
    const source = panelFromTemplate("numeric");
    const payload = buildCharacterCreatePayload({
      name: "李四",
      basics: { role: "配角", description: "散修" },
      mutable: {},
      panel: source,
    });
    expect(payload.data.ability_panel).toEqual(source);
    expect(payload.data.ability_panel).not.toBe(source);
    const cloned = payload.data.ability_panel as Array<{ children?: Array<{ value?: number }> }>;
    cloned[0].children![0].value = 99;
    expect((source[0].children![0] as { value?: number }).value).toBeUndefined();
  });
});

describe("面板三选（空白 / 内置模板 / 从已有角色复制）", () => {
  it("模式下拉三项 + 默认空白", () => {
    expect(PANEL_MODE_OPTIONS.map((o) => o.value)).toEqual(["blank", "template", "copy"]);
    expect(DEFAULT_PANEL_CHOICE).toEqual({ mode: "blank", templateId: "", sourceId: "" });
  });

  it("模板派生 = 结构快照深拷贝（数值模板：1 分组 + 2 叶子）", () => {
    const panel = panelFromTemplate("numeric");
    expect(panel).toEqual([{ name: "基础属性", children: [{ name: "等级" }, { name: "熟练度" }] }]);
    expect(panelNodeCount(panel)).toBe(3);
    // 独立性：两次派生互不共享引用
    const again = panelFromTemplate("numeric");
    again[0].name = "改过的分组";
    expect(panelFromTemplate("numeric")[0].name).toBe("基础属性");
    expect(panel[0].name).toBe("基础属性");
  });

  it("空白模板 id / 未知 id → 空面板（不抛错）", () => {
    expect(panelFromTemplate("blank")).toEqual([]);
    expect(panelFromTemplate("nope")).toEqual([]);
  });

  it("内置模板清单含 blank + 至少两套可派生模板（卡 3.5 要求 ≥2 套）", () => {
    const derivable = PANEL_TEMPLATES.filter((t) => t.id !== "blank");
    expect(derivable.length).toBeGreaterThanOrEqual(2);
    for (const template of derivable) expect(panelNodeCount(template.panel)).toBeGreaterThan(0);
  });

  it("从角色复制：缺失/脏结构归一为空面板，嵌套深拷贝", () => {
    expect(panelFromCharacterData(undefined)).toEqual([]);
    expect(panelFromCharacterData({ ability_panel: "脏" })).toEqual([]);
    const source = { ability_panel: [{ name: "火系", children: [{ name: "等级", value: 3 }] }] };
    const copy = panelFromCharacterData(source);
    expect(copy).toEqual(source.ability_panel);
    (copy[0].children![0] as { value?: number }).value = 9;
    expect((source.ability_panel[0].children![0] as { value?: number }).value).toBe(3);
  });

  it("候选上限与左栏同档（200）", () => {
    expect(CHARACTER_CANDIDATE_LIMIT).toBe(200);
  });
});
