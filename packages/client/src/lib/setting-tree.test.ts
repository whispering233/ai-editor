// 设定树构建纯函数测试（批次四 I4，决策 30）：根判定 / 父子组装 / 截断孤儿提升防御
import { describe, expect, it } from "vitest";
import { buildSettingTree } from "./setting-tree";

const settings = [
  { id: "set-a", name: "修真界", category: "世界" },
  { id: "set-b", name: "灵界大陆", category: "区域" },
  { id: "set-c", name: "青云门", category: "门派" },
  { id: "set-d", name: "幽冥界", category: "区域" },
  { id: "set-e", name: "天地法则", category: "法则" },
];

describe("buildSettingTree（决策 30：belongs_to 子→父，childId → parentId）", () => {
  it("根判定：无父的设定为根；父子按边组装为嵌套树（保持输入序）", () => {
    const edges = [
      { childId: "set-b", parentId: "set-a" }, // 灵界大陆 belongs_to 修真界
      { childId: "set-c", parentId: "set-b" }, // 青云门 belongs_to 灵界大陆
      { childId: "set-d", parentId: "set-a" }, // 幽冥界 belongs_to 修真界
    ];
    const { roots, hasOrphanEdges } = buildSettingTree(settings, edges);
    expect(hasOrphanEdges).toBe(false);
    expect(roots.map((r) => r.id)).toEqual(["set-a", "set-e"]); // set-e 无父 → 根
    const a = roots[0];
    expect(a.name).toBe("修真界");
    expect(a.category).toBe("世界");
    expect(a.children.map((c) => c.id)).toEqual(["set-b", "set-d"]); // 输入序（settings 序）
    expect(a.children[0].children.map((c) => c.id)).toEqual(["set-c"]);
  });

  it("根按 settings 输入序排出（无父的设定保持原序）", () => {
    const { roots } = buildSettingTree(settings, []);
    expect(roots.map((r) => r.id)).toEqual(["set-a", "set-b", "set-c", "set-d", "set-e"]);
  });

  it("截断防御：父实体未加载（id 不在 settings）→ 子节点提升为根，hasOrphanEdges=true", () => {
    const edges = [
      { childId: "set-b", parentId: "set-ghost" }, // 父在 limit 截断外（未加载）
      { childId: "set-c", parentId: "set-b" },
    ];
    const { roots, hasOrphanEdges } = buildSettingTree(settings, edges);
    expect(hasOrphanEdges).toBe(true);
    // set-b 提升为根（含其子树 set-c）；无父的 set-a/d/e 也是根
    expect(roots.map((r) => r.id).sort()).toEqual(["set-a", "set-b", "set-d", "set-e"]);
    const b = roots.find((r) => r.id === "set-b")!;
    expect(b.children.map((c) => c.id)).toEqual(["set-c"]);
  });

  it("category 非字符串/空串不渲染（undefined 键省略）", () => {
    const s = [
      { id: "x", name: "X", category: "" },
      { id: "y", name: "Y", category: 42 },
    ];
    const { roots } = buildSettingTree(s, []);
    expect(roots[0]).toEqual({ id: "x", name: "X", children: [] });
    expect(roots[1]).toEqual({ id: "y", name: "Y", children: [] });
  });

  it("空设定 → 空树", () => {
    expect(buildSettingTree([], [])).toEqual({ roots: [], hasOrphanEdges: false });
  });
});
