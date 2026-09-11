// 工具参数 schema 测试（TypeBox）：关键约束的行为锁定
// 覆盖：枚举白名单 / 必填与长度下限 / minProperties（空 patches 拒绝）/ 整数下限 /
// 数组上下限（时间点量 200 与列表 limit 对齐）/ 严格对象拒绝未知字段 / 深层 record 透传
import { describe, expect, it } from "vitest";
import { type TSchema } from "@earendil-works/pi-ai";
import { TOOL_PERMISSION } from "@whispering233/ai-editor-shared";
import { validateToolArgs } from "../registry.js";
import {
  deltaChangeSchema,
  proposeAddDeltaArgsSchema,
  proposeCreateEntityArgsSchema,
  proposeCreateReferenceArgsSchema,
  proposeMoveNodeArgsSchema,
  proposeReorderTimepointsArgsSchema,
  proposeUpdateEntityArgsSchema,
  proposeUpdateHookArgsSchema,
} from "./index.js";

/** 校验是否通过（校验器抛错即拒绝——与 executor 同一入口） */
function accepts(schema: TSchema, args: unknown): boolean {
  try {
    validateToolArgs(
      { name: "schema_probe", description: "schema 测试", parameters: schema, permission: TOOL_PERMISSION.AUTO, run: () => null },
      args,
    );
    return true;
  } catch {
    return false;
  }
}

describe("proposeReorderTimepointsArgsSchema（时间点量上限 200 与列表 limit 对齐）", () => {
  it("正常：非空时间点 id 数组通过", () => {
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: ["tp-3", "tp-1", "tp-2"] })).toBe(true);
  });

  it("200 个时间点为上限边界：200 通过、201 拒绝", () => {
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: Array.from({ length: 200 }, (_, i) => `tp-${i}`) })).toBe(true);
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: Array.from({ length: 201 }, (_, i) => `tp-${i}`) })).toBe(false);
  });

  it("非数组 / 空数组拒绝", () => {
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: [] })).toBe(false);
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: { 0: "tp-1" } })).toBe(false);
  });

  it("标量与元素按 pi 校验的 coerce 语义处理（文档已登记：比 zod strict 宽松）", () => {
    // 标量 → 包成单项数组；元素非字符串 → 转字符串（两者均在业务层再次校验全量覆盖）
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: "tp-1" })).toBe(true);
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: ["tp-1", 42] })).toBe(true);
  });

  it("未知键拒绝（严格对象，与既有提案工具 schema 同款）", () => {
    expect(accepts(proposeReorderTimepointsArgsSchema, { timepoint_ids: ["tp-1"], extra: 1 })).toBe(false);
  });
});

describe("提案工具 schema 约束", () => {
  it("patches 拒绝空对象（部分更新至少一项）", () => {
    expect(accepts(proposeUpdateEntityArgsSchema, { entity_id: "char-1", patches: { role: "主角" } })).toBe(true);
    expect(accepts(proposeUpdateEntityArgsSchema, { entity_id: "char-1", patches: {} })).toBe(false);
    expect(accepts(proposeUpdateHookArgsSchema, { hook_id: "hook-1", patches: {} })).toBe(false);
  });

  it("name / description 拒绝空串（长度下限 1）", () => {
    expect(accepts(proposeCreateEntityArgsSchema, { type: "character", name: "" })).toBe(false);
    expect(accepts(proposeCreateEntityArgsSchema, { type: "character", name: "张三" })).toBe(true);
    expect(accepts(proposeCreateEntityArgsSchema, { type: "精灵", name: "张三" })).toBe(false); // 类型枚举外
  });

  it("propose_move_node：order 为整数且 ≥ 0（非整数按 pi coerce 语义截断）", () => {
    expect(accepts(proposeMoveNodeArgsSchema, { node_id: "sc-1", parent_id: "root", order: 0 })).toBe(true);
    expect(accepts(proposeMoveNodeArgsSchema, { node_id: "sc-1", parent_id: "root", order: -1 })).toBe(false);
    // 小数/数字字符串经校验器截断/转换（文档已登记；不是 zod 的 .int() 硬拒）
    expect(accepts(proposeMoveNodeArgsSchema, { node_id: "sc-1", parent_id: "root", order: 1.5 })).toBe(true);
    expect(accepts(proposeMoveNodeArgsSchema, { node_id: "sc-1", parent_id: "root", order: "3" })).toBe(true);
  });

  it("propose_add_delta：changes 至少一项；单项按 deltaChangeSchema 校验", () => {
    const change = { field: "power", op: "set" as const, to: 100 };
    expect(accepts(proposeAddDeltaArgsSchema, { node_id: "sc-1", target: "char-1", changes: [change] })).toBe(true);
    expect(accepts(proposeAddDeltaArgsSchema, { node_id: "sc-1", target: "char-1", changes: [] })).toBe(false);
    expect(accepts(proposeAddDeltaArgsSchema, { node_id: "sc-1", target: "char-1", changes: [{ field: "power", op: "爆炸" }] })).toBe(false);
    expect(accepts(deltaChangeSchema, { field: "power", op: "add", value: "x" })).toBe(true);
    expect(accepts(deltaChangeSchema, { field: "power", op: "update", from: null, to: 5 })).toBe(true);
  });

  it("propose_create_reference：source 可空、type/content/tags 可选", () => {
    expect(accepts(proposeCreateReferenceArgsSchema, { name: "素材" })).toBe(true);
    expect(accepts(proposeCreateReferenceArgsSchema, { name: "素材", source: null, content: "正文", tags: ["a"] })).toBe(true);
    expect(accepts(proposeCreateReferenceArgsSchema, { name: "素材", source: "https://example.com" })).toBe(true);
    expect(accepts(proposeCreateReferenceArgsSchema, { name: "素材", extra: 1 })).toBe(false);
  });

  it("data / patches 承载任意结构（record 透传，不因嵌套类型被拒）", () => {
    expect(
      accepts(proposeCreateEntityArgsSchema, {
        type: "character",
        name: "张三",
        data: { role: "主角", tags: ["a", "b"], nested: { deep: true }, age: 30 },
      }),
    ).toBe(true);
  });
});
