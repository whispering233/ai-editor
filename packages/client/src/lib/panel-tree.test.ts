// 能力面板树变换纯函数测试（卡片 3.4）
// 覆盖：索引路径寻址 / 增删改名 / 同级重排与拖成子级 / 叶子赋值与类型判定 /
//       规范形状保持（分支丢 value、空 children 归一为叶子）/ 防环 / 警告表 / 模板常量。
import { describe, expect, it } from "vitest";
import {
  PANEL_TEMPLATES,
  insertPanelNode,
  isLegalPanelDrop,
  isPanelPathAtOrUnder,
  movePanelNode,
  panelNodeAt,
  panelPathKey,
  panelWarningMap,
  planPanelRowDrop,
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

  it("拖成子级：无值叶子可成为父节点；**带值叶子拒绝**（不静默丢值）", () => {
    const nodes = fixture();
    const next = movePanelNode(nodes, [0], { parent: [1], index: 0 });
    expect(next?.[0]).toEqual({ name: "水系", children: [nodes[0]] });
    const withValue = setPanelLeafValue(nodes, [1], "5")!;
    expect(withValue[1]?.value).toBe(5);
    // 目标父是带值叶子 → 拒绝（返回 null，值不丢）——策略同源：新增子级 / 拖成子级
    expect(movePanelNode(withValue, [0], { parent: [1], index: 0 })).toBeNull();
    expect(withValue[1]).toEqual({ name: "水系", value: 5 });
    // 新增子级（insert）同策略
    expect(insertPanelNode(withValue, [1], 0, "新字段")).toBeNull();
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

describe("isLegalPanelDrop / planPanelRowDrop（落点合法性；非法落点无反馈）", () => {
  it("子树前缀判断：自身 / 子孙 / 兄弟 / 跨分支 / 根", () => {
    expect(isPanelPathAtOrUnder([], [])).toBe(true); // 根包含一切（空路径 = 根）
    expect(isPanelPathAtOrUnder([1], [])).toBe(true);
    expect(isPanelPathAtOrUnder([0, 1], [0])).toBe(true); // 子孙
    expect(isPanelPathAtOrUnder([0], [0, 1])).toBe(false); // 父不在子内
    expect(isPanelPathAtOrUnder([1, 0], [0])).toBe(false); // 兄弟子树
  });

  it("非法落点：自拖 / 拖进自身子树（含 before·after 落在自身子孙行上）/ 根 / 目标行不存在", () => {
    expect(isLegalPanelDrop([0], [0], "on")).toBe(false);
    expect(isLegalPanelDrop([0], [0], "before")).toBe(false); // 自拖（无意义）
    expect(isLegalPanelDrop([0], [0], "after")).toBe(false);
    expect(isLegalPanelDrop([0], [0, 1], "on")).toBe(false); // 拖进自身子树
    expect(isLegalPanelDrop([0], [0, 1], "before")).toBe(false); // 落点父 = [0]（自身）
    expect(isLegalPanelDrop([0], [0, 1], "after")).toBe(false);
    expect(isLegalPanelDrop([], [1], "on")).toBe(false); // 根不可移动
  });

  it("合法落点：兄弟 / 跨分支 / 子级升到根；计划带折算后的下标", () => {
    const nodes = fixture();
    expect(isLegalPanelDrop([0], [1], "before")).toBe(true);
    expect(planPanelRowDrop(nodes, [0], [1], "before")).toEqual({
      kind: "move",
      parent: [],
      index: 0, // 同父“先摘后插”折算（0 在目标位之前 → 目标位左移一位）
    });
    expect(isLegalPanelDrop([0, 1], [1], "on")).toBe(true); // 子级升到根分支下
    expect(planPanelRowDrop(nodes, [0, 1], [1], "on")).toEqual({
      kind: "move",
      parent: [1],
      index: 0, // 目标原为无值叶子 → 成为其首个子级
    });
    // 非法（拖进自身子树）→ null：UI 不显插入线/高亮，也不弹 toast
    expect(planPanelRowDrop(nodes, [0], [0, 0], "on")).toBeNull();
  });

  it("带值叶子：拖成其子级 → 拒绝计划（UI 提示且不改数据）；无值叶子 → 正常计划", () => {
    const nodes = fixture();
    const withValue = setPanelLeafValue(nodes, [1], "5")!;
    expect(planPanelRowDrop(withValue, [0], [1], "on")).toEqual({ kind: "reject-value-leaf" });
    expect(planPanelRowDrop(nodes, [0], [1], "on")).toEqual({
      kind: "move",
      parent: [1],
      index: 0,
    });
    // 同一条策略下，move 也拒绝（纯函数层兜底）
    expect(movePanelNode(withValue, [0], { parent: [1], index: 0 })).toBeNull();
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
