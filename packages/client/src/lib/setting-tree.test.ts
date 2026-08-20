// 设定树构建纯函数测试（批次四 I4，决策 30 + 决策 42 交互树扩展）：
// 根判定 / 父子组装 / 截断孤儿提升防御 / 交互树辅助（findSettingNode / canMoveSettingTo / 树内过滤）
import { describe, expect, it } from "vitest";
import {
  buildSettingTree,
  canMoveSettingTo,
  expandableSettingNodeIds,
  filterSettingTree,
  findSettingNode,
  isSettingDescendant,
  matchesSettingSearch,
  matchesSettingTag,
  nodeTags,
} from "./setting-tree";

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

  it("决策 42：summary / parentId 透传到节点（交互树标签过滤/拖拽判定用）；缺省省略", () => {
    const s = [
      { id: "set-a", name: "修真界", summary: { tags: ["世界"] } },
      { id: "set-b", name: "青云门", summary: { tags: ["门派"] }, parentId: "set-a" },
    ];
    const { roots } = buildSettingTree(s, [{ childId: "set-b", parentId: "set-a" }]);
    expect(roots[0].summary).toEqual({ tags: ["世界"] });
    expect(roots[0].parentId).toBeUndefined(); // 根节点无父
    expect(roots[0].children[0].summary).toEqual({ tags: ["门派"] });
    expect(roots[0].children[0].parentId).toBe("set-a");
  });
});

describe("expandableSettingNodeIds（批次八 O5：全部折叠用，仅收非叶子）", () => {
  it("空树 → 空数组", () => {
    expect(expandableSettingNodeIds([])).toEqual([]);
  });

  it("全部为叶子（无子）→ 空数组（叶子无箭头不参与折叠）", () => {
    const roots = [
      { id: "set-a", name: "A", children: [] },
      { id: "set-b", name: "B", children: [] },
    ];
    expect(expandableSettingNodeIds(roots)).toEqual([]);
  });

  it("单层：仅父设收集，叶子不收", () => {
    const roots = [
      { id: "set-a", name: "A", children: [{ id: "set-b", name: "B", children: [] }] },
    ];
    expect(expandableSettingNodeIds(roots)).toEqual(["set-a"]);
  });

  it("多层嵌套：所有有子节点的 id 按先根序收集", () => {
    const roots = [
      {
        id: "set-a",
        name: "A",
        children: [
          {
            id: "set-b",
            name: "B",
            children: [{ id: "set-c", name: "C", children: [] }],
          },
          { id: "set-d", name: "D", children: [] },
        ],
      },
    ];
    // set-a（有子）→ set-b（有子）→ set-c（叶子跳过）；set-d 叶子跳过
    expect(expandableSettingNodeIds(roots)).toEqual(["set-a", "set-b"]);
  });

  it("多根各自递归，互不干扰", () => {
    const roots = [
      { id: "set-a", name: "A", children: [{ id: "set-b", name: "B", children: [] }] },
      { id: "set-x", name: "X", children: [] },
    ];
    expect(expandableSettingNodeIds(roots)).toEqual(["set-a"]);
  });
});

describe("决策 42 交互树：findSettingNode / isSettingDescendant / canMoveSettingTo", () => {
  // 树：a → b → c；a → d；e（独立根）
  const roots = [
    {
      id: "set-a",
      name: "修真界",
      parentId: undefined,
      children: [
        {
          id: "set-b",
          name: "灵界大陆",
          parentId: "set-a",
          children: [{ id: "set-c", name: "青云门", parentId: "set-b", children: [] }],
        },
        { id: "set-d", name: "幽冥界", parentId: "set-a", children: [] },
      ],
    },
    { id: "set-e", name: "天地法则", parentId: undefined, children: [] },
  ];

  it("findSettingNode：任意深度可查；找不到 → null", () => {
    expect(findSettingNode(roots, "set-a")?.name).toBe("修真界");
    expect(findSettingNode(roots, "set-c")?.name).toBe("青云门");
    expect(findSettingNode(roots, "set-e")?.name).toBe("天地法则");
    expect(findSettingNode(roots, "set-ghost")).toBeNull();
    expect(findSettingNode([], "set-a")).toBeNull();
  });

  it("isSettingDescendant：含自身；含后代；不含非后代/其他根", () => {
    expect(isSettingDescendant(roots, "set-a", "set-a")).toBe(true); // 含自身
    expect(isSettingDescendant(roots, "set-a", "set-c")).toBe(true); // 后代
    expect(isSettingDescendant(roots, "set-b", "set-c")).toBe(true);
    expect(isSettingDescendant(roots, "set-a", "set-e")).toBe(false); // 其他根
    expect(isSettingDescendant(roots, "set-c", "set-a")).toBe(false); // 祖先不是后代
    expect(isSettingDescendant(roots, "set-ghost", "set-a")).toBe(false); // 祖先不存在
  });

  it("canMoveSettingTo：null 父（移根）恒合法；不能挂自己/后代；其余任意设定可互为父子", () => {
    const drag = findSettingNode(roots, "set-b")!;
    expect(canMoveSettingTo(drag, null, roots)).toBe(true); // 移根
    expect(canMoveSettingTo(drag, "set-b", roots)).toBe(false); // 挂自己
    expect(canMoveSettingTo(drag, "set-c", roots)).toBe(false); // 挂后代（防环）
    expect(canMoveSettingTo(drag, "set-a", roots)).toBe(true); // 挂回父
    expect(canMoveSettingTo(drag, "set-d", roots)).toBe(true); // 挂兄弟
    expect(canMoveSettingTo(drag, "set-e", roots)).toBe(true); // 挂其他根
  });
});

describe("决策 42 交互树：nodeTags / matchesSettingSearch / matchesSettingTag / filterSettingTree", () => {
  // 树：修真界（tags: [世界]）→ 灵界大陆（tags: [区域, 修真]）→ 青云门（tags: [门派]）；
  //    幽冥界（tags: [区域]）；天地法则（tags: [法则]）
  const roots = [
    {
      id: "set-a",
      name: "修真界",
      summary: { tags: ["世界"] },
      children: [
        {
          id: "set-b",
          name: "灵界大陆",
          summary: { tags: ["区域", "修真"] },
          children: [{ id: "set-c", name: "青云门", summary: { tags: ["门派"] }, children: [] }],
        },
        { id: "set-d", name: "幽冥界", summary: { tags: ["区域"] }, children: [] },
      ],
    },
    { id: "set-e", name: "天地法则", summary: { tags: ["法则"] }, children: [] },
  ];

  it("nodeTags：summary.tags 数组过滤非空字符串；缺失/非数组 → 空数组", () => {
    expect(nodeTags(roots[0])).toEqual(["世界"]);
    expect(nodeTags({ id: "x", name: "X", children: [] })).toEqual([]);
    expect(
      nodeTags({ id: "y", name: "Y", summary: { tags: ["a", "", 42] }, children: [] }),
    ).toEqual(["a"]);
  });

  it("matchesSettingSearch：名称包含（大小写不敏感）；空 q = 全部", () => {
    expect(matchesSettingSearch(roots[0], "修真")).toBe(true);
    expect(matchesSettingSearch(roots[0], " 修真 ")).toBe(true);
    expect(matchesSettingSearch(roots[0], "法则")).toBe(false);
    expect(matchesSettingSearch(roots[0], "")).toBe(true);
  });

  it("matchesSettingTag：tags 包含；空 tag = 全部", () => {
    // roots[0].children[0] = 灵界大陆（tags: [区域, 修真]）
    const lingjie = roots[0].children[0];
    expect(matchesSettingTag(lingjie, "区域")).toBe(true);
    expect(matchesSettingTag(lingjie, "世界")).toBe(false);
    expect(matchesSettingTag(lingjie, "")).toBe(true);
  });

  it("filterSettingTree：无筛选返回全部（新对象，不改原树）", () => {
    const filtered = filterSettingTree(roots, "", "");
    expect(filtered.map((r) => r.id)).toEqual(["set-a", "set-e"]);
    expect(filtered).not.toBe(roots); // 新对象
    expect(filtered[0].children.map((c) => c.id)).toEqual(["set-b", "set-d"]);
  });

  it("filterSettingTree：搜索命中节点及其祖先链保留，非命中子树裁剪", () => {
    // 搜「青云门」→ 命中 set-c；祖先 set-b / set-a 保留为链；set-d（兄弟，不命中）裁剪
    const filtered = filterSettingTree(roots, "青云门", "");
    expect(filtered.map((r) => r.id)).toEqual(["set-a"]);
    expect(filtered[0].children.map((c) => c.id)).toEqual(["set-b"]);
    expect(filtered[0].children[0].children.map((c) => c.id)).toEqual(["set-c"]);
  });

  it("filterSettingTree：命中节点的非命中子节点被裁剪（只留命中链）", () => {
    // 搜「灵界」→ 命中 set-b；set-c（子，不命中）裁剪；set-a 保留为祖先链；set-d 裁剪
    const filtered = filterSettingTree(roots, "灵界", "");
    expect(filtered.map((r) => r.id)).toEqual(["set-a"]);
    expect(filtered[0].children.map((c) => c.id)).toEqual(["set-b"]);
    expect(filtered[0].children[0].children).toEqual([]);
  });

  it("filterSettingTree：标签过滤同语义（命中节点及祖先链保留）", () => {
    // 标签「区域」→ 命中 set-b / set-d；set-b 的祖先 set-a 保留；set-c（不命中）裁剪；set-e 裁剪
    const filtered = filterSettingTree(roots, "", "区域");
    expect(filtered.map((r) => r.id)).toEqual(["set-a"]);
    expect(filtered[0].children.map((c) => c.id)).toEqual(["set-b", "set-d"]);
    expect(filtered[0].children[0].children).toEqual([]);
  });

  it("filterSettingTree：搜索 + 标签 AND 组合（须同时命中）", () => {
    // 搜「灵」+ 标签「区域」→ 命中 set-b；set-a 保留为链
    const filtered = filterSettingTree(roots, "灵", "区域");
    expect(filtered.map((r) => r.id)).toEqual(["set-a"]);
    expect(filtered[0].children.map((c) => c.id)).toEqual(["set-b"]);
  });

  it("filterSettingTree：无命中 → 空数组", () => {
    expect(filterSettingTree(roots, "不存在", "")).toEqual([]);
    expect(filterSettingTree(roots, "", "不存在")).toEqual([]);
    expect(filterSettingTree([], "x", "")).toEqual([]);
  });
});
