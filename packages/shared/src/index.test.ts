// 冒烟测试：验证 @whispering233/ai-editor-shared 入口可正常导入（T0.3）+ 契约类型断言（T1.1）
import { describe, expect, expectTypeOf, it } from "vitest";
import * as m from "./index.js";
import type {
  ComputeStateResult,
  DeltaChange,
  Entity,
  EntitySummary,
  OutlineTree,
  ProjectConfig,
  RelationRecord,
} from "./index.js";

describe("@whispering233/ai-editor-shared 入口冒烟", () => {
  it("可正常导入且导出包名常量", () => {
    expect(m).toBeDefined();
    expect(m.SHARED_PKG_NAME).toBe("@whispering233/ai-editor-shared");
    expect(m.SHARED_PKG_VERSION).toBe("0.1.0");
  });

  it("根 barrel 不含运行时 Zod schema（客户端打包安全，2026-08 修订）", () => {
    expect(m).not.toHaveProperty("entityCreateReqSchema");
    expect(m).not.toHaveProperty("deltaRecordSchema");
    expect(m).not.toHaveProperty("apiSuccessSchema");
    expect(m).not.toHaveProperty("ENTITY_DATA_SCHEMAS");
    expect(m).not.toHaveProperty("errorCodeSchema");
  });

  it("运行时常量与纯函数仍从根导出", () => {
    expect(m.ENTITY_TYPES).toBeDefined();
    expect(m.truncate).toBeTypeOf("function");
    expect(m.generateId).toBeTypeOf("function");
  });
});

// T1.1 契约类型断言：字段形态与文档（endpoints.md / schema.md）一致
describe("@whispering233/ai-editor-shared 契约类型（T1.1）", () => {
  it("Entity / EntitySummary 字段为 API 形态（camelCase）", () => {
    expectTypeOf<Entity>().toMatchTypeOf<{
      id: string;
      type: "character" | "setting" | "location" | "hook" | "event";
      name: string;
      data: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
    }>();
    expectTypeOf<EntitySummary>().toHaveProperty("summary").toEqualTypeOf<Record<string, unknown>>();
  });

  it("RelationRecord / DeltaChange / ComputeStateResult 契约字段", () => {
    expectTypeOf<RelationRecord>().toMatchTypeOf<{
      id: string;
      sourceType: string;
      sourceId: string;
      targetType: string;
      targetId: string;
      relationType: string;
      createdAt: string;
    }>();
    expectTypeOf<DeltaChange["op"]>().toEqualTypeOf<"set" | "update" | "add" | "remove">();
    expectTypeOf<ComputeStateResult["state"]>().toMatchTypeOf<Record<string, unknown>>();
    expectTypeOf<ComputeStateResult["conflicts"]>().toMatchTypeOf<
      { deltaId: string; field: string; expected: unknown; actual: unknown }[]
    >();
  });

  it("OutlineTree 严格三层（决策 19）：根下卷、卷下章、章下场景、场景无 children", () => {
    expectTypeOf<OutlineTree["id"]>().toEqualTypeOf<"root">();
    expectTypeOf<OutlineTree["children"][number]["type"]>().toEqualTypeOf<"volume">();
    expectTypeOf<ProjectConfig["language"]>().toEqualTypeOf<"zh" | "en">();
  });
});
