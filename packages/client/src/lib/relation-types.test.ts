// 建立关联对话框的关系类型下拉 + 提交 guard 测试
// 端点谓词单一实现 = shared `relationTypeAllowedFor`（矩阵本身由 packages/shared/src/utils/relation-type.test.ts 锁），
// 本测试锁客户端派生：双端收窄 + 两条非矩阵口径（mount 组不进对话框、层级未知的节点源 fail-closed）。
import { describe, expect, it } from "vitest";
import {
  HOOK_RELATION_TYPES,
  RELATION_TYPES,
  RELATION_TYPE_META,
  relationTypeAllowedFor,
} from "@whispering233/ai-editor-shared";
import {
  customRelationTypeUsages,
  dialogRelationTypeOptions,
  relationEndpointError,
  relationSubmitError,
  relationTypeInputOptions,
  relationTypeSelectOptions,
  resolveRelationTypeInput,
} from "./relation-types";

const HOOK_TYPES = HOOK_RELATION_TYPES;
const MOUNT_TYPES = RELATION_TYPES.filter((t) => RELATION_TYPE_META[t].group === "mount");

describe("dialogRelationTypeOptions（双端端点收窄）", () => {
  it("地点 → 人物：不含 ally / kills", () => {
    const options = dialogRelationTypeOptions({ type: "location" }, { type: "character" });
    expect(options).not.toContain("ally");
    expect(options).not.toContain("kills");
  });

  it("人物 → 人物：不含 belongs_to / plants", () => {
    const options = dialogRelationTypeOptions({ type: "character" }, { type: "character" });
    expect(options).not.toContain("belongs_to");
    expect(options).not.toContain("plants");
    expect(options).toContain("ally");
  });

  it("章 → 伏笔：含伏笔三类", () => {
    const options = dialogRelationTypeOptions(
      { type: "outline_node", nodeType: "chapter" },
      { type: "hook" },
    );
    for (const t of HOOK_TYPES) expect(options).toContain(t);
  });

  it("卷 → 伏笔：不含伏笔三类（矩阵 + fail-closed 双重保证）", () => {
    const options = dialogRelationTypeOptions(
      { type: "outline_node", nodeType: "volume" },
      { type: "hook" },
    );
    for (const t of HOOK_TYPES) expect(options).not.toContain(t);
  });

  it("卷 / 场景节点源 → 排除伏笔三类（服务端 400，UI 不给入口）", () => {
    for (const nodeType of ["volume", "scene"] as const) {
      const options = dialogRelationTypeOptions({ type: "outline_node", nodeType }, { type: "hook" });
      for (const t of HOOK_TYPES) expect(options, `${nodeType}/${t}`).not.toContain(t);
    }
  });

  it("nodeType 缺失 → 不含伏笔三类（fail-closed；shared 谓词此时通配）", () => {
    const options = dialogRelationTypeOptions({ type: "outline_node" }, { type: "hook" });
    for (const t of HOOK_TYPES) expect(options).not.toContain(t);
    // 反向对照：同端点对上 shared 谓词是通配（客户端更严的理由）
    expect(relationTypeAllowedFor("plants", { type: "outline_node" }, { type: "hook" })).toBe(true);
  });

  it("章 → 卷：不含 plot_edge；章 → 章：含（目标层级参与收窄）", () => {
    expect(
      dialogRelationTypeOptions(
        { type: "outline_node", nodeType: "chapter" },
        { type: "outline_node", nodeType: "volume" },
      ),
    ).not.toContain("plot_edge");
    expect(
      dialogRelationTypeOptions(
        { type: "outline_node", nodeType: "chapter" },
        { type: "outline_node", nodeType: "chapter" },
      ),
    ).toContain("plot_edge");
  });

  it("mount 组恒不进对话框（挂载只由时间轴 UI 建）", () => {
    const pairs = [
      [null, undefined],
      [{ type: "character" } as const, { type: "character" } as const],
      [{ type: "outline_node", nodeType: "chapter" } as const, { type: "hook" } as const],
      [{ type: "outline_node", nodeType: "chapter" } as const, { type: "location" } as const],
    ] as const;
    for (const [from, to] of pairs) {
      const options = dialogRelationTypeOptions(from, to);
      for (const t of MOUNT_TYPES) expect(options).not.toContain(t);
    }
  });

  it("from === null（未定源）→ 只给基集，不由矩阵收窄", () => {
    const base = dialogRelationTypeOptions(null);
    expect(base).toEqual(
      RELATION_TYPES.filter((t) => RELATION_TYPE_META[t].group !== "mount"),
    );
    for (const t of HOOK_TYPES) expect(base).toContain(t);
  });
});

describe("relationEndpointError（提交 guard）", () => {
  it("非法组合 → 中文文案（中文类型名 + 双端标签）", () => {
    expect(relationEndpointError("ally", { type: "location" }, { type: "character" })).toBe(
      "「盟友」不能用于 地点 → 人物",
    );
  });

  it("合法组合 / 自定义类型 → null", () => {
    expect(relationEndpointError("ally", { type: "character" }, { type: "character" })).toBeNull();
    expect(relationEndpointError("宿敌", { type: "location" }, { type: "character" })).toBeNull();
    expect(
      relationEndpointError("plants", { type: "outline_node", nodeType: "chapter" }, { type: "hook" }),
    ).toBeNull();
  });

  it("层级未知的节点源 + 伏笔三类 → 拦下（fail-closed，与下拉同口径）", () => {
    expect(relationEndpointError("plants", { type: "outline_node" }, { type: "hook" })).toBe(
      "「埋设」不能用于 大纲节点 → 伏笔",
    );
  });

  it("occurs_at 自由输入（大纲节点 → 地点）→ 拦下（mount 组不进对话框）", () => {
    expect(relationEndpointError("occurs_at", { type: "outline_node" }, { type: "location" })).toBe(
      "「发生于」不能用于 大纲节点 → 地点",
    );
  });
});

describe("relationSubmitError（提交判定纯函数）", () => {
  it("盟友（地点 → 人物）→ 非空", () => {
    expect(
      relationSubmitError(resolveRelationTypeInput("盟友"), { type: "location" }, { type: "character" }),
    ).not.toBeNull();
  });

  it("发生于（章 → 地点）→ 非空", () => {
    expect(
      relationSubmitError(
        resolveRelationTypeInput("发生于"),
        { type: "outline_node", nodeType: "chapter" },
        { type: "location" },
      ),
    ).not.toBeNull();
  });

  it("ally（人物 → 人物）→ null", () => {
    expect(relationSubmitError("ally", { type: "character" }, { type: "character" })).toBeNull();
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
