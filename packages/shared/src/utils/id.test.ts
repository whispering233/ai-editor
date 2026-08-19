// ID 生成测试（T1.3）：前缀映射（endpoints.md id 约定）+ 唯一性
import { describe, expect, it } from "vitest";
import {
  ENTITY_ID_PREFIX,
  OUTLINE_NODE_ID_PREFIX,
  RUNTIME_ID_PREFIX,
  generateEntityId,
  generateId,
  generateOutlineNodeId,
  generateProjectId,
  generateRuntimeId,
} from "./id.js";

describe("generateId", () => {
  it("生成 {prefix}{nanoid} 形状（连字符前缀 + 21 字符 nanoid）", () => {
    expect(generateId("char-")).toMatch(/^char-[A-Za-z0-9_-]{21}$/);
  });

  it("唯一性：50 个 id 互不重复", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateId("sc-")));
    expect(ids.size).toBe(50);
  });
});

describe("前缀映射（endpoints.md id 约定）", () => {
  it("实体类型前缀：char-/set-/loc-/hook-/ev-/tp-/ref-（ev- 时间轴事件决策 26；tp- 时间标签点 G2；ref- 参考资料决策 36）", () => {
    expect(ENTITY_ID_PREFIX).toEqual({
      character: "char-",
      setting: "set-",
      location: "loc-",
      hook: "hook-",
      event: "ev-",
      timepoint: "tp-",
      reference: "ref-",
    });
    expect(generateEntityId("character")).toMatch(/^char-/);
    expect(generateEntityId("setting")).toMatch(/^set-/);
    expect(generateEntityId("location")).toMatch(/^loc-/);
    expect(generateEntityId("hook")).toMatch(/^hook-/);
    expect(generateEntityId("event")).toMatch(/^ev-/);
    expect(generateEntityId("timepoint")).toMatch(/^tp-/);
    expect(generateEntityId("reference")).toMatch(/^ref-/);
  });

  it("大纲节点前缀：vol-/ch-/sc-", () => {
    expect(OUTLINE_NODE_ID_PREFIX).toEqual({ volume: "vol-", chapter: "ch-", scene: "sc-" });
    expect(generateOutlineNodeId("volume")).toMatch(/^vol-/);
    expect(generateOutlineNodeId("chapter")).toMatch(/^ch-/);
    expect(generateOutlineNodeId("scene")).toMatch(/^sc-/);
  });

  it("项目前缀：proj-", () => {
    expect(generateProjectId()).toMatch(/^proj-/);
  });

  it("运行时前缀：prop_/sess_/call_（下划线分隔，区别于连字符前缀）", () => {
    expect(RUNTIME_ID_PREFIX).toEqual({ proposal: "prop_", session: "sess_", toolCall: "call_" });
    expect(generateRuntimeId("proposal")).toMatch(/^prop_/);
    expect(generateRuntimeId("session")).toMatch(/^sess_/);
    expect(generateRuntimeId("toolCall")).toMatch(/^call_/);
  });
});
