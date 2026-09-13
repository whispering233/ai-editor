// 能力面板树变换纯函数测试（卡片 3.4）
// 覆盖：索引路径寻址 / 增删改名 / 同级重排与拖成子级 / 叶子赋值与类型判定 /
//       规范形状保持（分支丢 value、空 children 归一为叶子）/ 防环 / 警告表 / 模板常量。
import { describe, expect, it } from "vitest";
import {
  PANEL_TEMPLATES,
  insertPanelNode,
  movePanelNode,
  panelNodeAt,
  panelPathKey,
  panelWarningMap,
  removePanelNode,
  renamePanelNode,
  setPanelLeafValue,
  siblingDropIndex,
} from "./panel-tree";
import type { AbilityPanelNode } from "@whispering233/ai-editor-shared";

/** 面板夹具：火系（等级 3 / 熟练度空）+ 水系（无子节点 → 叶子） */
function fixture(): AbilityPanelNode[] {
  return [
    { name: "火系", children: [{ name: "等级", value: 3 }, { name: "熟练度" }] },
    { name: "水系" },
  ];
}

describe("panelPathKey / panelNodeAt（索引路径寻址）", () => {
  it("键 = 下标链；空路径 = 根（返回 null——根不是节点）", () => {
    expect(panelPathKey([])).toBe("");
    expect(panelPathKey([1, 2])).toBe("1.2");
    const nodes = fixture();
    expect(panelNodeAt(nodes, [])).toBeNull();
    expect(panelNodeAt(nodes, [0])?.name).toBe("火系");
    expect(panelNodeAt(nodes, [0, 1])?.name).toBe("熟练度");
    expect(panelNodeAt(nodes, [9])).toBeNull();
    expect(panelNodeAt(nodes, [0, 9])).toBeNull();
  });
});

describe("insertPanelNode（新增同级 / 子级）", () => {
  it("根层级插入：index 越界收敛到末尾；空名/纯空白拒绝（返回 null，不改数据）", () => {
    const nodes = fixture();
    const appended = insertPanelNode(nodes, [], 99, "土系");
    expect(appended?.map((n) => n.name)).toEqual(["火系", "水系", "土系"]);
    const inserted = insertPanelNode(nodes, [], 0, "  土系  ");
    expect(inserted?.[0]?.name).toBe("土系"); // trim
    expect(insertPanelNode(nodes, [], 0, "   ")).toBeNull();
    expect(insertPanelNode(nodes, [9], 0, "x")).toBeNull();
  });

  it("子级插入：父节点保持分支，原值不丢；入参不被修改（纯函数）", () => {
    const nodes = fixture();
    const next = insertPanelNode(nodes, [1], 0, "感知");
    expect(next?.[1]).toEqual({ name: "水系", children: [{ name: "感知" }] });
    expect(nodes[1]).toEqual({ name: "水系" }); // 原数组未被改写
    expect(next).not.toBe(nodes);
  });
});

describe("renamePanelNode / removePanelNode", () => {
  it("改名保持结构；空名拒绝；路径不存在返回 null", () => {
    const nodes = fixture();
    expect(renamePanelNode(nodes, [0, 0], " 等级上限 ")?.at(0)?.children?.[0]?.name).toBe("等级上限");
    expect(renamePanelNode(nodes, [0, 0], "")).toBeNull();
    expect(renamePanelNode(nodes, [5], "x")).toBeNull();
  });

  it("删叶子：父分支保留；删到父无子节点 → 父降级为叶子（children 键被归一删除）", () => {
    const nodes = fixture();
    const afterLeaf = removePanelNode(nodes, [0, 1]);
    expect(afterLeaf?.[0]?.children?.map((n) => n.name)).toEqual(["等级"]);
    const afterBranch = removePanelNode(nodes, [0]);
    expect(afterBranch?.map((n) => n.name)).toEqual(["水系"]);
    const emptied = removePanelNode(insertPanelNode([], [], 0, "只此一子")!, []);
    expect(emptied).toBeNull(); // 根数组不可删
    const single = insertPanelNode([], [], 0, "分组")!;
    const withChild = insertPanelNode(single, [0], 0, "子")!;
    const degraded = removePanelNode(withChild, [0, 0]);
    expect(degraded).toEqual([{ name: "分组" }]); // 空 children 归一为叶子
  });
});

describe("setPanelLeafValue（叶子赋值；分支不可赋值）", () => {
  it("纯数字 → number；非数字 → string；空 → 清空；值未变化 → 原样返回入参", () => {
    const nodes = fixture();
    const num = setPanelLeafValue(nodes, [0, 0], "12");
    expect(num?.at(0)?.children?.[0]?.value).toBe(12);
    const text = setPanelLeafValue(nodes, [0, 1], "初阶");
    expect(text?.at(0)?.children?.[1]?.value).toBe("初阶");
    const cleared = setPanelLeafValue(num!, [0, 0], "   ");
    expect(cleared?.at(0)?.children?.[0]).toEqual({ name: "等级" });
    expect(setPanelLeafValue(nodes, [0, 0], "3")).toBe(nodes); // 未变化 → 同引用
  });

  it("分支不可赋值（返回 null）；路径不存在 → null", () => {
    const nodes = fixture();
    expect(setPanelLeafValue(nodes, [0], "5")).toBeNull();
    expect(setPanelLeafValue(nodes, [0, 7], "5")).toBeNull();
  });

  it("已知瑕疵：`007` 存为 7（数值语义，丢前导零）", () => {
    const nodes = fixture();
    expect(setPanelLeafValue(nodes, [0, 0], "007")?.at(0)?.children?.[0]?.value).toBe(7);
  });
});

describe("movePanelNode（同级重排 / 拖成子级 / 防环）", () => {
  it("同级重排：移到末尾", () => {
    const nodes = fixture();
    const next = movePanelNode(nodes, [0], { parent: [], index: 1 });
    expect(next?.map((n) => n.name)).toEqual(["水系", "火系"]);
  });

  it("拖成子级：父节点变分支（其叶子 value 按不变式丢弃）", () => {
    const nodes = fixture();
    const next = movePanelNode(nodes, [0], { parent: [1], index: 0 });
    expect(next?.[0]).toEqual({ name: "水系", children: [nodes[0]] });
    // 目标原为叶子且无值 —— 无值可丢；再验证「带值叶子被拖入子级后丢值」
    const withValue = setPanelLeafValue(nodes, [1], "5")!;
    const nested = movePanelNode(withValue, [0], { parent: [1], index: 0 });
    expect(nested?.[0]).toEqual({ name: "水系", children: [withValue[0]] });
  });

  it("防环：拖进自身或自身子树 → null；根不可移动", () => {
    const nodes = fixture();
    expect(movePanelNode(nodes, [0], { parent: [0], index: 0 })).toBeNull();
    expect(movePanelNode(nodes, [0], { parent: [0, 0], index: 0 })).toBeNull();
    expect(movePanelNode(nodes, [], { parent: [], index: 0 })).toBeNull();
  });

  it("siblingDropIndex：同父且原下标在目标位之前 → 摘除后左移一位", () => {
    expect(siblingDropIndex([0], [2], "after")).toBe(2); // 0 < 3 → 3-1
    expect(siblingDropIndex([2], [0], "before")).toBe(0);
    expect(siblingDropIndex([0, 1], [0, 0], "after")).toBe(1);
    expect(siblingDropIndex([0], [1, 0], "after")).toBe(1); // 跨父不折算
  });
});

describe("panelWarningMap（内联警告；不改写数据）", () => {
  it("名字含 `.` 与同层重名各给一条；健康节点不出现在表里", () => {
    const nodes: AbilityPanelNode[] = [
      { name: "火.系", children: [{ name: "等级" }] },
      { name: "同名" },
      { name: "同名" },
      { name: "正常" },
    ];
    const warnings = panelWarningMap(nodes);
    expect(warnings.get("0")).toContain("名字含「.」");
    expect(warnings.get("1")).toContain("同层重名");
    expect(warnings.get("2")).toContain("同层重名");
    expect(warnings.has("3")).toBe(false);
    expect(warnings.size).toBe(3);
  });
});

describe("PANEL_TEMPLATES（内置模板常量）", () => {
  it("三套模板：空白 / 数值面板 / 技能树；结构均规范（分支无 value）", () => {
    expect(PANEL_TEMPLATES.map((t) => t.id)).toEqual(["blank", "numeric", "skill-tree"]);
    for (const template of PANEL_TEMPLATES) {
      const stack = [...template.panel];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (Array.isArray(node.children)) {
          expect(node.children.length).toBeGreaterThan(0);
          expect(node.value).toBeUndefined();
          stack.push(...node.children);
        }
      }
    }
  });
});
