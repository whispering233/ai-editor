// outline-tree 纯函数测试（S2.3）：父节点按类型过滤（决策 19 严格三层）+ findNodeChildren
import { describe, expect, it } from "vitest";
import type { OutlineNode } from "@ai-editor/shared";
import { findNodeChildren, parentOptionsForType, resolveParentId, ROOT_NODE_ID, ROOT_PARENT_OPTION } from "./outline-tree";

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

describe("resolveParentId（创建对话框父节点保留规则，S2.3 oracle 修复）", () => {
  it("入口指定的父节点在选项中 → 保留（卷行「新建章」initialParentId=vol-x 不被挂载重置）", () => {
    expect(resolveParentId("vol-2", "chapter", tree)).toBe("vol-2");
    expect(resolveParentId("ch-2", "scene", tree)).toBe("ch-2");
  });

  it("入口指定的父节点不在选项中 → 回退第一个合法选项（挂载时 initialParentId 非法/已失效）", () => {
    // chapter 的选项首位是 root（ROOT_PARENT_OPTION 在前），非法父回退到 root
    expect(resolveParentId("vol-999", "chapter", tree)).toBe(ROOT_NODE_ID);
    // 类型切换后旧父不在新类型选项（如从 chapter 切到 scene，vol-1 不再是合法父）→ 回退第一个章
    expect(resolveParentId("vol-1", "scene", tree)).toBe("ch-1");
    expect(resolveParentId(undefined, "chapter", tree)).toBe(ROOT_NODE_ID);
  });

  it("scene 无合法父时返回空串（不选中非法值）", () => {
    expect(resolveParentId(undefined, "scene", [])).toBe("");
  });

  it("volume → 固定 root（忽略 current）", () => {
    expect(resolveParentId(undefined, "volume", tree)).toBe(ROOT_NODE_ID);
    expect(resolveParentId("vol-1", "volume", tree)).toBe(ROOT_NODE_ID);
  });

  it("root 是 chapter 的合法父：入口指定 root 保留", () => {
    expect(resolveParentId(ROOT_NODE_ID, "chapter", tree)).toBe(ROOT_NODE_ID);
  });
});
