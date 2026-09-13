// 建立关联对话框关系类型选项测试（卡片 1.6：伏笔锚点仅章——非章大纲节点源排除伏笔三类）
// 服务端契约（非章 → 400）由 packages/server/src/routes/relation.test.ts 覆盖，
// 本测试锁 UI 侧同向收窄：不留必定 400 的死胡同。
import { describe, expect, it } from "vitest";
import { RELATION_TYPE_META } from "@whispering233/ai-editor-shared";
import {
  customRelationTypeUsages,
  dialogRelationTypeOptions,
  relationTypeInputOptions,
  relationTypeSelectOptions,
  resolveRelationTypeInput,
} from "./relation-types";

const HOOK_TYPES = ["plants", "advances", "resolves"];

describe("dialogRelationTypeOptions（源端层级过滤）", () => {
  it("章节点源 → 伏笔三类全可选（与基集一致）", () => {
    const options = dialogRelationTypeOptions({ type: "outline_node", nodeType: "chapter" });
    for (const t of HOOK_TYPES) expect(options).toContain(t);
  });

  it("卷 / 场景节点源 → 排除伏笔三类（服务端 400，UI 不给入口）", () => {
    for (const nodeType of ["volume", "scene"] as const) {
      const options = dialogRelationTypeOptions({ type: "outline_node", nodeType });
      for (const t of HOOK_TYPES) expect(options).not.toContain(t);
    }
  });

  it("nodeType 缺失 → 按非章处理（fail-closed，少一个选项而非留死入口）", () => {
    const options = dialogRelationTypeOptions({ type: "outline_node" });
    for (const t of HOOK_TYPES) expect(options).not.toContain(t);
  });

  it("实体源（人物 / 参考资料）→ 不受限（含伏笔三类）", () => {
    for (const type of ["character", "reference"]) {
      const options = dialogRelationTypeOptions({ type });
      for (const t of HOOK_TYPES) expect(options).toContain(t);
    }
  });

  it("列表模式（source 为 null）→ 不受限（源端下拉只有实体类型，不产生该组合）", () => {
    const options = dialogRelationTypeOptions(null);
    for (const t of HOOK_TYPES) expect(options).toContain(t);
  });

  it("基集恒排除 occurs_at（挂载由时间轴 UI 专管）", () => {
    const sources = [
      null,
      { type: "character" },
      { type: "outline_node", nodeType: "chapter" as const },
      { type: "outline_node", nodeType: "volume" as const },
    ];
    for (const source of sources)
      expect(dialogRelationTypeOptions(source)).not.toContain("occurs_at");
  });
});

describe("customRelationTypeUsages（已用自定义类型派生，卡片 8.2）", () => {
  const rows = (types: string[]) => types.map((relationType) => ({ relationType }));

  it("distinct + 计数；预定义类型不计入", () => {
    const usages = customRelationTypeUsages(
      rows(["宿敌", "ally", "宿敌", "appears_in", "宿敌", "恩人"]),
    );
    expect(usages).toEqual([
      { type: "宿敌", count: 3 },
      { type: "恩人", count: 1 },
    ]);
  });

  it("稳定序：条数降序，同条数按类型名码点序", () => {
    const usages = customRelationTypeUsages(rows(["beta", "gamma", "alpha", "beta"]));
    expect(usages).toEqual([
      { type: "beta", count: 2 },
      { type: "alpha", count: 1 },
      { type: "gamma", count: 1 },
    ]);
  });

  it("全预定义 / 空输入 → 空数组", () => {
    expect(customRelationTypeUsages(rows(["ally", "occurs_at", "belongs_to"]))).toEqual([]);
    expect(customRelationTypeUsages([])).toEqual([]);
  });
});

describe("relationTypeSelectOptions（预定义子集 + 自定义类型拼接）", () => {
  it("子集在前（中文标签），自定义在后（原名 · 条数）", () => {
    const options = relationTypeSelectOptions(["ally", "rival"], [
      { type: "宿敌", count: 2 },
    ]);
    expect(options).toEqual([
      { value: "ally", label: RELATION_TYPE_META.ally.label },
      { value: "rival", label: RELATION_TYPE_META.rival.label },
      { value: "宿敌", label: "宿敌 · 2" },
    ]);
  });

  it("不把子集之外的预定义类型带回来（入口收窄）；无自定义时 = 子集", () => {
    const options = relationTypeSelectOptions(["ally", "kills"], []);
    expect(options.map((o) => o.value)).toEqual(["ally", "kills"]);
    expect(options.map((o) => o.value)).not.toContain("occurs_at");
  });
});

describe("relationTypeInputOptions + resolveRelationTypeInput（自由输入控件的展示/取值映射）", () => {
  it("预定义 → value = 中文标签（combobox 显示 value，不能是裸 key）；自定义 → value = 原名、label 带条数", () => {
    const options = relationTypeInputOptions(["ally", "rival"], [{ type: "宿敌", count: 2 }]);
    expect(options).toEqual([
      { value: RELATION_TYPE_META.ally.label, label: RELATION_TYPE_META.ally.label },
      { value: RELATION_TYPE_META.rival.label, label: RELATION_TYPE_META.rival.label },
      { value: "宿敌", label: "宿敌 · 2" },
    ]);
    expect(options.map((o) => o.value)).not.toContain("ally");
  });

  it("反解：预定义 key 原样、中文标签 → key、自定义原样（trim 后）", () => {
    expect(resolveRelationTypeInput("ally")).toBe("ally");
    expect(resolveRelationTypeInput(RELATION_TYPE_META.ally.label)).toBe("ally");
    expect(resolveRelationTypeInput(RELATION_TYPE_META.mentor.label)).toBe("mentor");
    expect(resolveRelationTypeInput("  宿敌  ")).toBe("宿敌");
    expect(resolveRelationTypeInput("青梅竹马")).toBe("青梅竹马");
    expect(resolveRelationTypeInput("")).toBe("");
  });
});
