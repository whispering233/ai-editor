// 关系类型自定义值语法校验测试（卡片 8.2）
// 覆盖边界：非字符串 / 空 / 纯空白 / 合法最短 / 32 字（上限内）/ 33 字（超限）/ 中文 / 控制字符 /
// 归一（trim）；并锁「错误消息是可直接回显的中文」。
import { describe, expect, it } from "vitest";
import {
  normalizeRelationType,
  RELATION_TYPE_MAX_LENGTH,
  relationTypeSyntaxError,
} from "./relation-type.js";

describe("relationTypeSyntaxError（语法校验单一来源）", () => {
  it("长度上限 = 32", () => {
    expect(RELATION_TYPE_MAX_LENGTH).toBe(32);
  });

  it("空 / 纯空白 → 中文错误", () => {
    expect(relationTypeSyntaxError("")).toBe("关系类型不能为空");
    expect(relationTypeSyntaxError("   ")).toBe("关系类型不能为空");
    expect(relationTypeSyntaxError("\t\n")).toBe("关系类型不能为空");
  });

  it("非字符串 → 中文错误（防御：调用侧类型收窄前的兜底）", () => {
    expect(relationTypeSyntaxError(undefined)).toBe("关系类型必须是字符串");
    expect(relationTypeSyntaxError(null)).toBe("关系类型必须是字符串");
    expect(relationTypeSyntaxError(17)).toBe("关系类型必须是字符串");
  });

  it("32 字通过、33 字拒绝（长度按 trim 后计）", () => {
    const atLimit = "x".repeat(32);
    const overLimit = "x".repeat(33);
    expect(relationTypeSyntaxError(atLimit)).toBeNull();
    expect(relationTypeSyntaxError(overLimit)).toBe(
      `关系类型不能超过 ${RELATION_TYPE_MAX_LENGTH} 个字符`,
    );
    // 首尾空白不计入长度
    expect(relationTypeSyntaxError(` ${atLimit} `)).toBeNull();
    expect(relationTypeSyntaxError(`  ${overLimit}`)).toBe(
      `关系类型不能超过 ${RELATION_TYPE_MAX_LENGTH} 个字符`,
    );
  });

  it("中文合法（自定义类型如「宿敌」）", () => {
    expect(relationTypeSyntaxError("宿敌")).toBeNull();
    expect(relationTypeSyntaxError("  宿敌 ")).toBeNull();
  });

  it("控制字符（U+0000–U+001F / U+007F）→ 中文错误", () => {
    expect(relationTypeSyntaxError("宿\u0000敌")).toBe("关系类型不能包含控制字符");
    expect(relationTypeSyntaxError("宿\u001f敌")).toBe("关系类型不能包含控制字符");
    expect(relationTypeSyntaxError("宿\u007f敌")).toBe("关系类型不能包含控制字符");
    expect(relationTypeSyntaxError("宿\u0080敌")).toBeNull(); // 边界外（非控制字符区）放行
  });

  it("预定义与自定义混用同一口径（不再枚举白名单）", () => {
    for (const t of ["ally", "occurs_at", "appears_in"]) {
      expect(relationTypeSyntaxError(t)).toBeNull();
    }
  });
});

describe("normalizeRelationType（归一）", () => {
  it("去首尾空白，保留内部空白", () => {
    expect(normalizeRelationType(" 宿敌 ")).toBe("宿敌");
    expect(normalizeRelationType("宿 敌")).toBe("宿 敌");
    expect(normalizeRelationType("")).toBe("");
  });
});
