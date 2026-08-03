// outline-tree 纯函数测试（S2.3 + 就地编辑 S2.4）：父节点过滤（决策 19）、子节点查找、
//   拖拽移动合法性（canMoveTo/isDescendant）、行内编辑提交判定
import { describe, expect, it } from "vitest";
import type { OutlineNode } from "@ai-editor/shared";
import {
  canMoveTo,
  dropInsertOrder,
  editFailureRecovery,
  findNode,
  findNodeChildren,
  findNodePath,
  findNodePosition,
  findParentIdOf,
  flattenTree,
  isDescendant,
  isNoopDrop,
  parentOptionsForType,
  ROOT_NODE_ID,
  ROOT_PARENT_OPTION,
  sameDragTarget,
  shouldCommitSummary,
  shouldCommitTitle,
  type DropInsert,
} from "./outline-tree";

/** 造树：卷1（章1（场1/场2）、章2）、卷2（章3） */
const tree: OutlineNode[] = [
  {
    id: "vol-1",
    type: "volume",
    title: "第一卷",
    updatedAt: "t0",
    children: [
      { id: "ch-1", type: "chapter", title: "第一章", updatedAt: "t0", children: [
        { id: "sc-1", type: "scene", title: "场景一", updatedAt: "t0" },
        { id: "sc-2", type: "scene", title: "场景二", updatedAt: "t0" },
      ] },
      { id: "ch-2", type: "chapter", title: "第二章", updatedAt: "t0" },
    ],
  },
  {
    id: "vol-2",
    type: "volume",
    title: "第二卷",
    updatedAt: "t0",
    children: [{ id: "ch-3", type: "chapter", title: "第三章", updatedAt: "t0" }],
  },
];

describe("parentOptionsForType（父节点按类型过滤，决策 19）", () => {
  it("volume → 仅 root（严格三层：卷只能挂根）", () => {
    expect(parentOptionsForType(tree, "volume")).toEqual([ROOT_PARENT_OPTION]);
  });

  it("chapter → root + 全部 volume（不收集 chapter/scene）", () => {
    const options = parentOptionsForType(tree, "chapter");
    expect(options).toEqual([
      ROOT_PARENT_OPTION,
      { id: "vol-1", label: "第一卷", depth: 1 },
      { id: "vol-2", label: "第二卷", depth: 1 },
    ]);
  });

  it("scene → 仅 chapter（不含 root、不含 volume）", () => {
    const options = parentOptionsForType(tree, "scene");
    expect(options).toEqual([
      { id: "ch-1", label: "第一章", depth: 2 },
      { id: "ch-2", label: "第二章", depth: 2 },
      { id: "ch-3", label: "第三章", depth: 2 },
    ]);
  });

  it("空树：chapter 仅 root；scene 空（无合法父）", () => {
    expect(parentOptionsForType([], "chapter")).toEqual([ROOT_PARENT_OPTION]);
    expect(parentOptionsForType([], "scene")).toEqual([]);
    expect(parentOptionsForType([], "volume")).toEqual([ROOT_PARENT_OPTION]);
  });

  it("scene 不收集挂在 root 下的 chapter（决策 19 合法场景）", () => {
    const flat: OutlineNode[] = [
      { id: "ch-9", type: "chapter", title: "根下章", updatedAt: "t0" },
      ...tree,
    ];
    const options = parentOptionsForType(flat, "scene");
    expect(options.map((o) => o.id)).toEqual(["ch-9", "ch-1", "ch-2", "ch-3"]);
  });
});

describe("findNodeChildren（move order 计算）", () => {
  it("root → 顶层 children", () => {
    expect(findNodeChildren(tree, ROOT_NODE_ID)?.map((n) => n.id)).toEqual(["vol-1", "vol-2"]);
  });

  it("卷 → 其章列表；未找到 → null", () => {
    expect(findNodeChildren(tree, "vol-1")?.map((n) => n.id)).toEqual(["ch-1", "ch-2"]);
    expect(findNodeChildren(tree, "vol-2")?.map((n) => n.id)).toEqual(["ch-3"]);
    expect(findNodeChildren(tree, "vol-999")).toBeNull();
  });

  it("scene（无 children）→ 空数组", () => {
    expect(findNodeChildren(tree, "sc-1")).toEqual([]);
  });
});

describe("findNode / isDescendant（拖拽「不能挂自己/后代」判定）", () => {
  it("findNode：按 id 查节点（含深层）；未找到 → null", () => {
    expect(findNode(tree, "vol-2")?.title).toBe("第二卷");
    expect(findNode(tree, "sc-1")?.title).toBe("场景一");
    expect(findNode(tree, "vol-999")).toBeNull();
  });

  it("isDescendant：target 在 node 子树中（含自身）→ true；无关/祖先 → false", () => {
    expect(isDescendant(tree, "vol-1", "ch-1")).toBe(true);
    expect(isDescendant(tree, "vol-1", "sc-2")).toBe(true);
    expect(isDescendant(tree, "vol-1", "vol-1")).toBe(true); // 含自身
    expect(isDescendant(tree, "ch-1", "vol-1")).toBe(false); // 祖先不是后代
    expect(isDescendant(tree, "vol-1", "vol-2")).toBe(false); // 无关节点
    expect(isDescendant(tree, "vol-999", "ch-1")).toBe(false); // node 不存在
  });
});

describe("findNodePath（根到节点祖先链，U4 跨页定位）", () => {
  it("深层节点 → [卷, 章, 场] 全链（含自身，不含 root）", () => {
    expect(findNodePath(tree, "sc-2")).toEqual(["vol-1", "ch-1", "sc-2"]);
    expect(findNodePath(tree, "ch-3")).toEqual(["vol-2", "ch-3"]);
  });

  it("顶层节点 → 仅自身", () => {
    expect(findNodePath(tree, "vol-1")).toEqual(["vol-1"]);
  });

  it("未找到 → null；空树 → null", () => {
    expect(findNodePath(tree, "sc-99")).toBeNull();
    expect(findNodePath([], "vol-1")).toBeNull();
  });
});

describe("canMoveTo（拖拽目标合法性，S2.4）", () => {
  const vol1 = findNode(tree, "vol-1")!;
  const vol2 = findNode(tree, "vol-2")!;
  const ch1 = findNode(tree, "ch-1")!;
  const sc1 = findNode(tree, "sc-1")!;

  it("scene → 仅 chapter 可接收（root/volume 拒绝）", () => {
    expect(canMoveTo(sc1, "ch-1", tree)).toBe(true);
    expect(canMoveTo(sc1, "ch-3", tree)).toBe(true);
    expect(canMoveTo(sc1, ROOT_NODE_ID, tree)).toBe(false);
    expect(canMoveTo(sc1, "vol-1", tree)).toBe(false);
  });

  it("chapter → root 或 volume 可接收（scene 拒绝——chapter 不能挂 chapter）", () => {
    expect(canMoveTo(ch1, ROOT_NODE_ID, tree)).toBe(true);
    expect(canMoveTo(ch1, "vol-2", tree)).toBe(true);
    expect(canMoveTo(ch1, "ch-3", tree)).toBe(false);
  });

  it("volume → 仅 root 可接收", () => {
    expect(canMoveTo(vol1, ROOT_NODE_ID, tree)).toBe(true);
    expect(canMoveTo(vol1, "vol-2", tree)).toBe(false);
  });

  it("不能挂到自己（拖动无意义）", () => {
    expect(canMoveTo(vol1, "vol-1", tree)).toBe(false);
    expect(canMoveTo(ch1, "ch-1", tree)).toBe(false);
  });

  it("不能挂到自己的后代（子树循环）", () => {
    expect(canMoveTo(vol1, "ch-1", tree)).toBe(false);
    expect(canMoveTo(vol1, "sc-1", tree)).toBe(false);
    expect(canMoveTo(ch1, "sc-1", tree)).toBe(false);
  });

  it("root 是 volume/chapter 的合法目标（顶层拖放区）", () => {
    expect(canMoveTo(vol2, ROOT_NODE_ID, tree)).toBe(true);
    expect(canMoveTo(ch1, ROOT_NODE_ID, tree)).toBe(true);
    expect(canMoveTo(sc1, ROOT_NODE_ID, tree)).toBe(false);
  });
});

describe("shouldCommitTitle / shouldCommitSummary（行内编辑提交判定，S2.4）", () => {
  it("标题：非空且有变化才提交；空值/无变化不提交", () => {
    expect(shouldCommitTitle("第一章", "第一章改")).toBe(true);
    expect(shouldCommitTitle("第一章", " 第一章改 ")).toBe(true); // 首尾空白裁剪后比较
    expect(shouldCommitTitle("第一章", "第一章")).toBe(false); // 无变化
    expect(shouldCommitTitle("第一章", "   ")).toBe(false); // 空值
    expect(shouldCommitTitle("第一章", "")).toBe(false);
  });

  it("摘要：有变化才提交；允许清空（清除摘要）", () => {
    expect(shouldCommitSummary("旧摘要", "新摘要")).toBe(true);
    expect(shouldCommitSummary("旧摘要", "")).toBe(true); // 清空
    expect(shouldCommitSummary("旧摘要", "旧摘要")).toBe(false);
    expect(shouldCommitSummary(undefined, "")).toBe(false); // 本来就无摘要
    expect(shouldCommitSummary(undefined, "新增")).toBe(true);
  });
});

describe("editFailureRecovery（行内编辑失败恢复决策，S2.4 oracle 补丁）", () => {
  it("OUTLINE_NODE_NOT_FOUND → abandon（节点已不存在，放弃编辑并重拉树）", () => {
    expect(editFailureRecovery("OUTLINE_NODE_NOT_FOUND")).toBe("abandon");
  });

  it("其余错误（VALIDATION_ERROR/网络/未知）→ restore（恢复编辑态保留输入）", () => {
    expect(editFailureRecovery("VALIDATION_ERROR")).toBe("restore");
    expect(editFailureRecovery("CLIENT_NETWORK_ERROR")).toBe("restore");
    expect(editFailureRecovery("SOME_UNKNOWN")).toBe("restore");
    expect(editFailureRecovery(null)).toBe("restore");
  });
});

describe("flattenTree（大纲节点选择器选项，S3.6）", () => {
  it("树序遍历展开（卷→章→场），带深度（root=0、卷=1、章=2）", () => {
    const flat = flattenTree(tree);
    expect(flat.map((o) => o.id)).toEqual(["vol-1", "ch-1", "sc-1", "sc-2", "ch-2", "vol-2", "ch-3"]);
    expect(flat[0]).toEqual({ id: "vol-1", label: "第一卷", depth: 0 });
    expect(flat[1].depth).toBe(1);
    expect(flat[2].depth).toBe(2);
  });

  it("空树 → 空数组", () => {
    expect(flattenTree([])).toEqual([]);
  });
});

describe("dropInsertOrder（拖拽插入位置 → order，S13.1）", () => {
  /** tree[0] = 卷1（children: [ch-1, ch-2]）——索引访问不做判别收窄，显式断言 */
  const children = ((tree[0] as { children?: OutlineNode[] }).children ?? []) as OutlineNode[];

  it("before = 目标 index；after = index + 1；end = children.length", () => {
    expect(dropInsertOrder(children, { kind: "before", nodeId: "ch-1" })).toBe(0);
    expect(dropInsertOrder(children, { kind: "after", nodeId: "ch-1" })).toBe(1);
    expect(dropInsertOrder(children, { kind: "before", nodeId: "ch-2" })).toBe(1);
    expect(dropInsertOrder(children, { kind: "after", nodeId: "ch-2" })).toBe(2);
    expect(dropInsertOrder(children, { kind: "end" })).toBe(2);
  });

  it("目标不在 children（异常/已移动）→ 回退末尾（服务端 clamp 兜底）", () => {
    expect(dropInsertOrder(children, { kind: "before", nodeId: "ghost" })).toBe(2);
    expect(dropInsertOrder(children, { kind: "after", nodeId: "ghost" })).toBe(2);
  });

  it("excludeId：剔除拖拽节点后计算（oracle M1 方案 B——同父重排不错位）", () => {
    // [ch-1, ch-2] 剔除 ch-2 后 = [ch-1]：after ch-1 → 1（= ch-2 当前 index → 原地）
    expect(dropInsertOrder(children, { kind: "after", nodeId: "ch-1" }, "ch-2")).toBe(1);
    // 剔除 ch-2 后 = [ch-1]：before ch-1 → 0（= 移到最前）
    expect(dropInsertOrder(children, { kind: "before", nodeId: "ch-1" }, "ch-2")).toBe(0);
    // 剔除 ch-1 后 = [ch-2]：after ch-2 → 1（末尾）
    expect(dropInsertOrder(children, { kind: "after", nodeId: "ch-2" }, "ch-1")).toBe(1);
    // 交叉父/锚点不在 children：剔除无效果（行为与不传一致）
    expect(dropInsertOrder(children, { kind: "before", nodeId: "ch-2" }, "ghost")).toBe(1);
    expect(dropInsertOrder(children, { kind: "end" }, "ch-1")).toBe(1);
  });
});

describe("sameDragTarget（dragover 高频去重，S13.1）", () => {
  it("同位置等价（含 null），不同位置不等价", () => {
    expect(sameDragTarget(null, null)).toBe(true);
    expect(sameDragTarget({ kind: "before", nodeId: "ch-1" }, { kind: "before", nodeId: "ch-1" })).toBe(true);
    expect(sameDragTarget({ kind: "after", nodeId: "ch-1" }, { kind: "after", nodeId: "ch-1" })).toBe(true);
    expect(sameDragTarget({ kind: "root-end" }, { kind: "root-end" })).toBe(true);
    expect(sameDragTarget(null, { kind: "before", nodeId: "ch-1" })).toBe(false);
    expect(sameDragTarget({ kind: "before", nodeId: "ch-1" }, { kind: "after", nodeId: "ch-1" })).toBe(false);
    expect(sameDragTarget({ kind: "before", nodeId: "ch-1" }, { kind: "before", nodeId: "ch-2" })).toBe(false);
    expect(sameDragTarget({ kind: "root-end" }, { kind: "before", nodeId: "ch-1" })).toBe(false);
  });
});

describe("findParentIdOf / findNodePosition（拖拽目标父与原地判定，S13.1）", () => {
  it("findParentIdOf：深层/root 顶层/找不到", () => {
    expect(findParentIdOf(tree, "sc-1")).toBe("ch-1");
    expect(findParentIdOf(tree, "ch-1")).toBe("vol-1");
    expect(findParentIdOf(tree, "ch-3")).toBe("vol-2");
    expect(findParentIdOf(tree, "vol-1")).toBe(ROOT_NODE_ID);
    expect(findParentIdOf(tree, "ghost")).toBe(null);
  });

  it("findParentIdOf：root 直挂章（决策 19 chapter 可挂 root）", () => {
    const rootChapter: OutlineNode = { id: "ch-9", type: "chapter", title: "直挂章", updatedAt: "t0" };
    expect(findParentIdOf([rootChapter], "ch-9")).toBe(ROOT_NODE_ID);
    expect(findParentIdOf([rootChapter], "ghost")).toBe(null);
  });

  it("findNodePosition：父 + 兄弟序号", () => {
    expect(findNodePosition(tree, "ch-1")).toEqual({ parentId: "vol-1", index: 0 });
    expect(findNodePosition(tree, "ch-2")).toEqual({ parentId: "vol-1", index: 1 });
    expect(findNodePosition(tree, "ch-3")).toEqual({ parentId: "vol-2", index: 0 });
    expect(findNodePosition(tree, "vol-2")).toEqual({ parentId: ROOT_NODE_ID, index: 1 });
    expect(findNodePosition(tree, "sc-2")).toEqual({ parentId: "ch-1", index: 1 });
    expect(findNodePosition(tree, "ghost")).toBe(null);
  });
});

describe("isNoopDrop（原地放置判定，S13.1 oracle M1 方案 B 修订）", () => {
  // children [ch-1, ch-2] 在 vol-1 下；ch-1 index 0、ch-2 index 1；
  // order 语义 = 剔除拖拽节点后的插入位置（dropInsertOrder 第三参）——order === 当前 index 即原地
  it("同父且 order === 当前 index → 原地", () => {
    expect(isNoopDrop(tree, "ch-1", "vol-1", 0)).toBe(true);
    expect(isNoopDrop(tree, "ch-2", "vol-1", 1)).toBe(true);
  });

  it("同父但 order ≠ index → 移动；跨父 → 必然移动", () => {
    expect(isNoopDrop(tree, "ch-2", "vol-1", 0)).toBe(false); // 移到最前
    expect(isNoopDrop(tree, "ch-2", "vol-1", 2)).toBe(false);
    expect(isNoopDrop(tree, "ch-1", "vol-1", 1)).toBe(false);
    expect(isNoopDrop(tree, "ch-1", "vol-2", 0)).toBe(false); // 跨父
    expect(isNoopDrop(tree, "ch-2", ROOT_NODE_ID, 2)).toBe(false); // 跨父到 root
  });

  it("节点不存在 → false（无当前位置可判定）", () => {
    expect(isNoopDrop(tree, "ghost", "vol-1", 0)).toBe(false);
  });
});

describe("同父重排端到端模拟（oracle S1：dropInsertOrder → isNoopDrop → 服务端 remove-then-insert）", () => {
  /** 四兄弟 [a,b,c,d] 挂卷 vol-x 下（≥3 兄弟才能暴露 pre-removal 数组 off-by-one，oracle M1） */
  const four: OutlineNode[] = [
    { id: "a", type: "chapter", title: "A", updatedAt: "t0" },
    { id: "b", type: "chapter", title: "B", updatedAt: "t0" },
    { id: "c", type: "chapter", title: "C", updatedAt: "t0" },
    { id: "d", type: "chapter", title: "D", updatedAt: "t0" },
  ];
  const tree4 = [
    { id: "vol-x", type: "volume", title: "卷", updatedAt: "t0", children: four },
  ] as OutlineNode[];

  /**
   * 模拟完整拖放链（与 Outline.tsx handleDrop 同逻辑）：
   * 1) 锚点 = 拖拽节点自身 → 原地（handleDrop 提前拦截——剔除后锚点消失会误回退末尾）
   * 2) dropInsertOrder(children, insert, dragId)（剔除拖拽节点）
   * 3) isNoopDrop 判定 → 原地则返回原序
   * 4) 服务端语义：从 children 移除 dragId 后插入 order（越界 clamp）→ 断言最终顺序
   */
  function simulateDrop(dragId: string, insert: DropInsert): string[] {
    const children = (findNodeChildren(tree4, "vol-x") ?? []) as OutlineNode[];
    if (insert.kind !== "end" && insert.nodeId === dragId) {
      return children.map((n) => n.id); // 拖自己到自己前/后 = 原地
    }
    const order = dropInsertOrder(children, insert, dragId);
    if (isNoopDrop(tree4, dragId, "vol-x", order)) {
      return children.map((n) => n.id); // 原地放置 → 不发请求
    }
    const rest = children.filter((n) => n.id !== dragId);
    const clamped = Math.min(order, rest.length);
    const dragNode = children.find((n) => n.id === dragId)!;
    rest.splice(clamped, 0, dragNode);
    return rest.map((n) => n.id);
  }

  it("拖 B 到下方锚点（oracle M1 四 case 全部修正——修复前 [A,C,D,B] 错位）", () => {
    expect(simulateDrop("b", { kind: "after", nodeId: "c" })).toEqual(["a", "c", "b", "d"]);
    expect(simulateDrop("b", { kind: "before", nodeId: "d" })).toEqual(["a", "c", "b", "d"]);
    expect(simulateDrop("b", { kind: "before", nodeId: "c" })).toEqual(["a", "b", "c", "d"]); // 相邻 → noop
    expect(simulateDrop("b", { kind: "after", nodeId: "d" })).toEqual(["a", "c", "d", "b"]); // 末尾
  });

  it("拖 B 到上方锚点 / 顶端 / 空白末尾", () => {
    expect(simulateDrop("b", { kind: "before", nodeId: "a" })).toEqual(["b", "a", "c", "d"]);
    expect(simulateDrop("b", { kind: "after", nodeId: "a" })).toEqual(["a", "b", "c", "d"]); // 相邻 → noop
    expect(simulateDrop("b", { kind: "end" })).toEqual(["a", "c", "d", "b"]);
  });

  it("拖到自身前/后 → 原地；两端节点同样", () => {
    expect(simulateDrop("b", { kind: "before", nodeId: "b" })).toEqual(["a", "b", "c", "d"]);
    expect(simulateDrop("b", { kind: "after", nodeId: "b" })).toEqual(["a", "b", "c", "d"]);
    expect(simulateDrop("a", { kind: "after", nodeId: "a" })).toEqual(["a", "b", "c", "d"]);
    expect(simulateDrop("d", { kind: "before", nodeId: "d" })).toEqual(["a", "b", "c", "d"]);
  });
});
