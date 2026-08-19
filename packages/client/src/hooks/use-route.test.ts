// parseHashRoute 纯函数单测（T7.1 路由骨架）
import { describe, expect, it } from "vitest";
import { parseHashRoute } from "./use-route";

describe("parseHashRoute", () => {
  it("空 hash 解析为根路由", () => {
    expect(parseHashRoute("")).toEqual({ path: "/", segments: [], isFallback: false });
  });

  it("根 hash 解析为根路由", () => {
    expect(parseHashRoute("#/")).toEqual({ path: "/", segments: [], isFallback: false });
  });

  it("解析二级路由（大纲）", () => {
    expect(parseHashRoute("#/outline")).toEqual({
      path: "/outline",
      segments: ["outline"],
      isFallback: false,
    });
  });

  it("解析实体详情三级路由", () => {
    expect(parseHashRoute("#/entities/character/char-abc")).toEqual({
      path: "/entities/character/char-abc",
      segments: ["entities", "character", "char-abc"],
      isFallback: false,
    });
  });

  it("尾斜杠不产生空段", () => {
    expect(parseHashRoute("#/entities/character/")).toEqual({
      path: "/entities/character",
      segments: ["entities", "character"],
      isFallback: false,
    });
  });

  it("未知 hash 回退根路由", () => {
    const route = parseHashRoute("#/unknown-page");
    expect(route.isFallback).toBe(true);
    expect(route.path).toBe("/");
    expect(route.segments).toEqual([]);
  });
});


  it("references 参考资料段解析（1 段列表 / 2 段详情，决策 36）", () => {
    expect(parseHashRoute("#/references")).toEqual({ path: "/references", segments: ["references"], isFallback: false });
    expect(parseHashRoute("#/references/ref-abc")).toEqual({ path: "/references/ref-abc", segments: ["references", "ref-abc"], isFallback: false });
  });
