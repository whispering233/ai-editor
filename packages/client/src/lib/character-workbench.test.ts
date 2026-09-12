// 人物工作台纯函数单测（卡 3.1）：行整形 / 「回到列表路由」的选中推导 / 排序档 / 溢出提示
// 选中推导是本卡最容易出错的一环（软删当前选中 → 取下一个），用例覆盖：首帧、保持、下一个、
// 末尾回退上一个、相邻项也已删、空列表。
import { describe, expect, it } from "vitest";
import type { EntitySummary } from "@whispering2333/ai-editor-shared";
import {
  RAIL_DEFAULT_SORT,
  RAIL_LIMIT,
  RAIL_SORT_OPTIONS,
  railOverflowHint,
  resolveListRouteSelection,
  resolveRailSort,
  toRailItems,
  type CharacterRailItem,
} from "./character-workbench";

function summary(id: string, name: string, role?: unknown): EntitySummary {
  return {
    id,
    type: "character",
    name,
    summary: role === undefined ? {} : { role },
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };
}

const item = (id: string): CharacterRailItem => ({ id, name: id, role: "" });

describe("toRailItems", () => {
  it("提取 name + summary.role；role 缺失/非字符串 → 空串", () => {
    const items = toRailItems([
      summary("a", "张三", "主角"),
      summary("b", "李四"),
      summary("c", "王五", 42),
    ]);
    expect(items).toEqual([
      { id: "a", name: "张三", role: "主角" },
      { id: "b", name: "李四", role: "" },
      { id: "c", name: "王五", role: "" },
    ]);
  });

  it("role 去空白并截断 30 字符（防长文本撑破 240px 栏）", () => {
    const items = toRailItems([summary("a", "甲", `  ${"配".repeat(40)}  `)]);
    expect(items[0].role).toHaveLength(30);
    expect(items[0].role.startsWith("配")).toBe(true);
  });
});

describe("resolveListRouteSelection（#/characters 无 id 时的选中推导）", () => {
  it("列表为空 → null（右栏空态）", () => {
    expect(
      resolveListRouteSelection({ items: [], previousId: "b", previousItems: [item("b")] }),
    ).toBeNull();
    expect(
      resolveListRouteSelection({ items: [], previousId: null, previousItems: [] }),
    ).toBeNull();
  });

  it("首帧/从别页进入（无上次选中）→ 第一个", () => {
    expect(
      resolveListRouteSelection({
        items: [item("a"), item("b")],
        previousId: null,
        previousItems: [],
      }),
    ).toBe("a");
  });

  it("上次选中仍在列表（点左栏导航从详情回列表）→ 保持它，不做无谓跳转", () => {
    expect(
      resolveListRouteSelection({
        items: [item("a"), item("b"), item("c")],
        previousId: "b",
        previousItems: [item("a"), item("b"), item("c")],
      }),
    ).toBe("b");
  });

  it("软删当前选中 → 取旧列表中的下一个", () => {
    expect(
      resolveListRouteSelection({
        items: [item("a"), item("c")],
        previousId: "b",
        previousItems: [item("a"), item("b"), item("c")],
      }),
    ).toBe("c");
  });

  it("软删的是最后一项 → 回退上一个", () => {
    expect(
      resolveListRouteSelection({
        items: [item("a"), item("b")],
        previousId: "c",
        previousItems: [item("a"), item("b"), item("c")],
      }),
    ).toBe("b");
  });

  it("下一个也已被删 → 继续找上一个可用项", () => {
    expect(
      resolveListRouteSelection({
        items: [item("a")],
        previousId: "b",
        previousItems: [item("a"), item("b"), item("c")],
      }),
    ).toBe("a");
  });

  it("上次选中不在旧列表快照里（搜索过滤后丢失）→ 第一个", () => {
    expect(
      resolveListRouteSelection({
        items: [item("a"), item("z")],
        previousId: "b",
        previousItems: [item("a"), item("z")],
      }),
    ).toBe("a");
  });
});

describe("排序档", () => {
  it("默认档 = updated_at 降序（后端列表默认）", () => {
    expect(RAIL_DEFAULT_SORT).toBe("updated_at:desc");
    expect(resolveRailSort(RAIL_DEFAULT_SORT)).toEqual({ sort: "updated_at", order: "desc" });
  });

  it("每档都能解析出对应 sort/order；未知值回落默认档", () => {
    for (const option of RAIL_SORT_OPTIONS) {
      expect(resolveRailSort(option.value)).toEqual({ sort: option.sort, order: option.order });
    }
    expect(resolveRailSort("脏值")).toEqual({ sort: "updated_at", order: "desc" });
  });
});

describe("railOverflowHint", () => {
  it("未超上限 / 无数据 → 空串（不渲染提示行）", () => {
    expect(railOverflowHint(3, 3)).toBe("");
    expect(railOverflowHint(10, 0)).toBe("");
    expect(railOverflowHint(RAIL_LIMIT, RAIL_LIMIT)).toBe("");
  });

  it("超出单次上限 → 提示总数与上限", () => {
    expect(railOverflowHint(RAIL_LIMIT + 5, RAIL_LIMIT)).toBe(
      `共 ${RAIL_LIMIT + 5} 个，仅显示前 ${RAIL_LIMIT} 个（用搜索缩小范围）`,
    );
  });
});
