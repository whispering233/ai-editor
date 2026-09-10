// 标签 tint 分配测试（DESIGN.md §Colors 分配规则的执行断言）：
// 规则值 = 「同名恒同色 + 跨进程稳定 + 不抛错」；改名/改哈希实现若破坏前两条即红。
import { describe, expect, it } from "vitest";
import { TAG_TINTS, tagTint, tagTintClass } from "./tag-tint";

describe("tagTint：名称 → tint 稳定性", () => {
  it("同名恒同色、重复调用一致", () => {
    for (const name of ["主角", "宗门", "伏笔", "tag-a", "🍀"]) {
      expect(tagTint(name)).toBe(tagTint(name));
    }
  });

  it("固定值锁定（改哈希实现或色档顺序必须显式更新本断言——防「悄悄换色」）", () => {
    expect(tagTint("主角")).toBe("peach");
    expect(tagTint("宗门")).toBe("mint");
    expect(tagTintClass("伏笔")).toBe("bg-tag-sky");
    // 6 个色档都可达（不同名称散列到不同档，避免实现退化成常量）
    const reached = new Set(Array.from({ length: 200 }, (_, i) => tagTint(`标签${i}`)));
    expect(reached.size).toBe(TAG_TINTS.length);
  });

  it("边界：空串/空白不抛错且稳定", () => {
    expect(tagTint("")).toBe(TAG_TINTS[0]);
    expect(tagTint("   ")).toBe(TAG_TINTS[0]);
    expect(tagTintClass("")).toBe(`bg-tag-${TAG_TINTS[0]}`);
  });

  it("trim 归一：前后空白不改变色调", () => {
    expect(tagTint(" 宗门 ")).toBe(tagTint("宗门"));
  });
});
