// trash 页纯函数测试（S4.4）：还原 toast 文案组装（0 计数省略）+ 409 祖先 id 解析
import { describe, expect, it } from "vitest";
import { parseAncestorId, restoreEntityToast, restoreNodeToast } from "./trash";

describe("restoreEntityToast（还原实体 toast 文案，计数 0 省略）", () => {
  it("关系与变更记录均为 0 → 仅「已还原」", () => {
    expect(restoreEntityToast(0, 0)).toBe("已还原");
  });

  it("单侧计数 → 只含对应部分", () => {
    expect(restoreEntityToast(3, 0)).toBe("已还原，连带恢复 3 条关系");
    expect(restoreEntityToast(0, 2)).toBe("已还原，连带恢复 2 条变更记录");
  });

  it("双侧计数 → 顿号连接", () => {
    expect(restoreEntityToast(3, 2)).toBe("已还原，连带恢复 3 条关系、2 条变更记录");
  });
});

describe("restoreNodeToast（还原节点 toast 文案，子节点 0 省略）", () => {
  it("无子节点 → 「已还原」", () => {
    expect(restoreNodeToast(0)).toBe("已还原");
  });

  it("有子节点 → 含计数", () => {
    expect(restoreNodeToast(5)).toBe("已还原（含 5 个子节点）");
  });
});

describe("parseAncestorId（409 OUTLINE_ANCESTOR_DELETED message → 祖先 id）", () => {
  it("服务端标准格式 → 提取 id（卷/章/场前缀均可）", () => {
    expect(parseAncestorId("存在软删祖先 ch-3，请先还原祖先再还原本节点")).toBe("ch-3");
    expect(parseAncestorId("存在软删祖先 vol-1，请先还原祖先再还原本节点")).toBe("vol-1");
    expect(parseAncestorId("存在软删祖先 sc-42，请先还原祖先再还原本节点")).toBe("sc-42");
  });

  it("格式变化（解析失败）→ null（页面降级为纯提示无快捷按钮）", () => {
    expect(parseAncestorId("上级节点已在回收站")).toBeNull();
    expect(parseAncestorId("")).toBeNull();
  });
});
