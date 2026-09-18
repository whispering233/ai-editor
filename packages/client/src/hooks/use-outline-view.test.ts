// use-outline-view 纯函数测试（卡 18.3）：解析口径（只有 "chapters" 是章视图，其余回落大纲树）。
// hook 本体依赖 window.localStorage（读写副作用），node 环境不渲染（仓库无 jsdom，同 use-panels.test.ts）。
import { describe, expect, it } from "vitest";
import { OUTLINE_VIEW_STORAGE_KEY, parseOutlineView } from "./use-outline-view";

describe("parseOutlineView（localStorage 值 → 视图）", () => {
  it("存章视图时才回章视图", () => {
    expect(parseOutlineView("chapters")).toBe("chapters");
  });

  it("树视图 / 首次访问（null）/ 空串 / 未知坏值一律回落大纲树", () => {
    for (const value of ["tree", null, "", "CHAPTERS", "章视图", "{}"]) {
      expect(parseOutlineView(value), String(value)).toBe("tree");
    }
  });

  it("key 名固定（改 key 会静默丢用户偏好；DESIGN.md / config.md 同值）", () => {
    expect(OUTLINE_VIEW_STORAGE_KEY).toBe("ai-editor:outline-view");
  });
});
