// outline-tree 纯函数测试（S2.3 + 就地编辑 S2.4）：父节点过滤（决策 19）、子节点查找、
//   拖拽移动合法性（canMoveTo/isDescendant）、行内编辑提交判定
import { describe, expect, it } from "vitest";
import type { OutlineNode } from "@ai-editor/shared";
import {
  canMoveTo,
  editFailureRecovery,
  findNode,
  findNodeChildren,
  isDescendant,
  parentOptionsForType,
  ROOT_NODE_ID,
  ROOT_PARENT_OPTION,
  shouldCommitSummary,
  shouldCommitTitle,
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
