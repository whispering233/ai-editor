// 关系类型自定义值语法校验测试（卡片 8.2）
// 覆盖边界：非字符串 / 空 / 纯空白 / 合法最短 / 32 字（上限内）/ 33 字（超限）/ 中文 / 控制字符 /
// 归一（trim）；并锁「错误消息是可直接回显的中文」。
import { describe, expect, it } from "vitest";
import {
  allowedRelationTypes,
  normalizeRelationType,
  RELATION_TYPE_MAX_LENGTH,
  relationTypeAllowedFor,
  relationTypeSyntaxError,
  type RelationEndpointRef,
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

// 端点适用性矩阵：声明源 = docs/db/schema.md「预定义关系类型表」的「端点」列
const character: RelationEndpointRef = { type: "character" };
const location: RelationEndpointRef = { type: "location" };
const setting: RelationEndpointRef = { type: "setting" };
const hook: RelationEndpointRef = { type: "hook" };
const event: RelationEndpointRef = { type: "event" };
const timepoint: RelationEndpointRef = { type: "timepoint" };
const chapter: RelationEndpointRef = { type: "outline_node", nodeType: "chapter" };
const volume: RelationEndpointRef = { type: "outline_node", nodeType: "volume" };
const node: RelationEndpointRef = { type: "outline_node" };

describe("relationTypeAllowedFor（端点适用性）", () => {
  it("人↔人类型：character→character 通过；location→character 拒绝", () => {
    for (const t of ["ally", "rival", "mentor", "family", "kills"]) {
      expect(relationTypeAllowedFor(t, character, character)).toBe(true);
      expect(relationTypeAllowedFor(t, location, character)).toBe(false);
    }
  });

  it("层级类：character→setting / setting→setting 通过；setting→character 拒绝", () => {
    expect(relationTypeAllowedFor("belongs_to", character, setting)).toBe(true);
    expect(relationTypeAllowedFor("belongs_to", setting, setting)).toBe(true);
    expect(relationTypeAllowedFor("belongs_to", setting, character)).toBe(false);
    expect(relationTypeAllowedFor("owns", character, setting)).toBe(true);
    expect(relationTypeAllowedFor("masters", character, setting)).toBe(true);
  });

  it("occurs_at 双语义：timepoint→event 通过、timepoint→location 拒绝（成对而非集合）、outline_node→location 通过", () => {
    expect(relationTypeAllowedFor("occurs_at", timepoint, event)).toBe(true);
    expect(relationTypeAllowedFor("occurs_at", timepoint, location)).toBe(false);
    expect(relationTypeAllowedFor("occurs_at", node, location)).toBe(true);
    expect(relationTypeAllowedFor("occurs_at", event, timepoint)).toBe(false);
  });

  it("plot_edge 仅章→章：章→章通过；卷→章 / 章→卷拒绝", () => {
    expect(relationTypeAllowedFor("plot_edge", chapter, chapter)).toBe(true);
    expect(relationTypeAllowedFor("plot_edge", volume, chapter)).toBe(false);
    expect(relationTypeAllowedFor("plot_edge", chapter, volume)).toBe(false);
  });

  it("nodeType 只在两侧都给出时比较：未给 = 通配", () => {
    expect(relationTypeAllowedFor("plot_edge", node, node)).toBe(true);
    expect(relationTypeAllowedFor("plot_edge", { type: "outline_node", nodeType: "scene" }, chapter)).toBe(false);
  });

  it("伏笔链：plants/advances/resolves 仅章→hook；depends_on 仅 hook→hook", () => {
    for (const t of ["plants", "advances", "resolves"]) {
      expect(relationTypeAllowedFor(t, chapter, hook)).toBe(true);
      expect(relationTypeAllowedFor(t, volume, hook)).toBe(false);
      expect(relationTypeAllowedFor(t, chapter, character)).toBe(false);
    }
    expect(relationTypeAllowedFor("depends_on", hook, hook)).toBe(true);
    expect(relationTypeAllowedFor("depends_on", hook, character)).toBe(false);
  });

  it("occurs_in 仅 event→outline_node", () => {
    expect(relationTypeAllowedFor("occurs_in", event, node)).toBe(true);
    expect(relationTypeAllowedFor("occurs_in", event, character)).toBe(false);
  });

  it("通配侧：appears_in 任意实体→outline_node、involves hook→任意实体；方向不符拒绝", () => {
    expect(relationTypeAllowedFor("appears_in", character, node)).toBe(true);
    expect(relationTypeAllowedFor("appears_in", location, chapter)).toBe(true);
    expect(relationTypeAllowedFor("appears_in", character, character)).toBe(false);
    expect(relationTypeAllowedFor("appears_in", character, setting)).toBe(false);
    expect(relationTypeAllowedFor("involves", hook, location)).toBe(true);
    expect(relationTypeAllowedFor("involves", hook, chapter)).toBe(true);
    expect(relationTypeAllowedFor("involves", character, location)).toBe(false);
  });

  it("声明侧 `*` 不看层级：appears_in 任意实体→章/卷/场景均通过", () => {
    expect(relationTypeAllowedFor("appears_in", character, chapter)).toBe(true);
    expect(relationTypeAllowedFor("appears_in", character, volume)).toBe(true);
    expect(relationTypeAllowedFor("appears_in", character, { type: "outline_node", nodeType: "scene" })).toBe(true);
    expect(relationTypeAllowedFor("involves", hook, volume)).toBe(true);
  });

  it("未知 / 自定义类型恒通过（含原型链键名）", () => {
    expect(relationTypeAllowedFor("宿敌", location, character)).toBe(true);
    expect(relationTypeAllowedFor("", location, character)).toBe(true);
    expect(relationTypeAllowedFor("__proto__", location, character)).toBe(true);
    expect(relationTypeAllowedFor("toString", location, character)).toBe(true);
  });
});

describe("allowedRelationTypes（一次取全）", () => {
  it("character→character 只含人↔人类型（通配类型方向不符被排除）", () => {
    const allowed = allowedRelationTypes(character, character);
    expect(allowed).toEqual(["ally", "rival", "mentor", "family", "kills"]);
  });

  it("character→outline_node 含 appears_in，但不含 involves / occurs_in / plot_edge", () => {
    const allowed = allowedRelationTypes(character, chapter);
    expect(allowed).toContain("appears_in");
    expect(allowed).not.toContain("involves");
    expect(allowed).not.toContain("occurs_in");
    expect(allowed).not.toContain("plot_edge");
  });

  it("章→章 = plot_edge + appears_in（involves 源端仅 hook）", () => {
    expect(allowedRelationTypes(chapter, chapter)).toEqual(["appears_in", "plot_edge"]);
  });
});
