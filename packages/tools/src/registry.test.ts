// 工具注册表测试：注册/查询 API + 工具注册完整性
// 覆盖：registerTool/getTool/listTools/toolCount / 重复注册抛错 /
// 入口副作用注册（import index 即挂载全部工具，权限分级）/
// 参数 schema 严格校验（严格对象拒绝未知字段；枚举白名单；必填字段）
import { beforeEach, describe, expect, it } from "vitest";

import { Type } from "@earendil-works/pi-ai";
import { TOOL_PERMISSION } from "@whispering233/ai-editor-shared";
import { registerTool, getTool, listTools, toolCount, validateToolArgs, type ToolDefinition } from "./registry.js";
import type { ToolContext } from "./context.js";

const noopCtx: ToolContext = { db: undefined as never, outlineDir: "", projectId: "proj-test" };

/** 无参工具的空参数 schema（测试辅助；严格对象 = 拒绝未知字段） */
const emptyArgs = (): ToolDefinition["parameters"] => Type.Object({}, { additionalProperties: false });

/** 参数校验是否通过（校验器抛错即拒绝——与 executor 同一入口） */
function accepts(def: ToolDefinition, args: unknown): boolean {
  try {
    validateToolArgs(def, args);
    return true;
  } catch {
    return false;
  }
}

describe("registry 注册/查询 API", () => {
  it("registerTool 后 getTool 可取回；listTools 按名称排序；toolCount 计数", () => {
    const def: ToolDefinition = {
      name: "zz_test_tool",
      description: "注册表测试工具",
      parameters: emptyArgs(),
      permission: TOOL_PERMISSION.AUTO,
      run: () => "ok",
    };
    registerTool(def);
    expect(getTool("zz_test_tool")).toBe(def);
    expect(getTool("不存在")).toBeUndefined();
    expect(listTools().map((t) => t.name)).toContain("zz_test_tool");
    expect(listTools().every((t, i, arr) => i === 0 || arr[i - 1].name <= t.name)).toBe(true);
    expect(toolCount()).toBeGreaterThan(0);
  });

  it("重复注册同名工具抛错（注册表唯一事实来源）", () => {
    const def: ToolDefinition = {
      name: "dup_test_tool",
      description: "重复注册测试",
      parameters: emptyArgs(),
      permission: TOOL_PERMISSION.AUTO,
      run: () => "ok",
    };
    registerTool(def);
    expect(() => registerTool(def)).toThrow(/已注册/);
  });

  it("注册防呆：name 非空字符串（空串/空白/缺失抛错）", () => {
    expect(() =>
      registerTool({ name: "", description: "x", parameters: emptyArgs(), permission: TOOL_PERMISSION.AUTO, run: () => "ok" }),
    ).toThrow(/工具名必须为非空字符串/);
    expect(() =>
      registerTool({ name: "   ", description: "x", parameters: emptyArgs(), permission: TOOL_PERMISSION.AUTO, run: () => "ok" }),
    ).toThrow(/工具名必须为非空字符串/);
  });

  it("run 通过 ctx 注入上下文执行（db/outlineDir/projectId 透传）", () => {
    const def: ToolDefinition = {
      name: "ctx_test_tool",
      description: "上下文透传测试",
      parameters: emptyArgs(),
      permission: TOOL_PERMISSION.AUTO,
      run: (ctx) => ctx.projectId,
    };
    registerTool(def);
    expect(getTool("ctx_test_tool")!.run(noopCtx, {})).toBe("proj-test");
  });

  it("run 取消通道：signal 透传（长工具执行中检查 signal）", () => {    const def: ToolDefinition = {
      name: "signal_test_tool",
      description: "signal 透传测试",
      parameters: emptyArgs(),
      permission: TOOL_PERMISSION.AUTO,
      run: (_ctx, _args, signal) => (signal?.aborted === true ? "aborted" : "done"),
    };
    registerTool(def);
    const controller = new AbortController();
    expect(getTool("signal_test_tool")!.run(noopCtx, {})).toBe("done"); // 未传 signal
    expect(getTool("signal_test_tool")!.run(noopCtx, {}, controller.signal)).toBe("done");
    controller.abort();
    expect(getTool("signal_test_tool")!.run(noopCtx, {}, controller.signal)).toBe("aborted");
  });
});

describe("工具注册（入口副作用，import ./index.js 触发）", () => {
  beforeEach(async () => {
 // 确保 index.ts 的注册副作用已执行（vitest 按文件隔离模块图，显式导入）
    await import("./index.js");
  });

  it("查询/分析类工具全部注册且权限为 AUTO、description 非空", () => {
    const names = listTools().map((t) => t.name);
    for (const expected of [
 // 查询类（「查询类（自动）」）
      "get_entity",
      "search_entities",
      "query_relationships",
      "get_outline",
      "get_outline_path",
      "compute_state",
      "get_delta_history",
      "get_entity_summary",
 // 分析类（「分析类（自动）」）
      "analyze_consistency",
      "detect_conflicts",
      "trace_plot_paths",
      "find_orphan_elements",
      "suggest_connections",
    ]) {
      expect(names).toContain(expected);
      expect(getTool(expected)!.permission).toBe(TOOL_PERMISSION.AUTO);
      expect(getTool(expected)!.description.length).toBeGreaterThan(0);
    }
    expect(toolCount()).toBeGreaterThanOrEqual(13); // 本文件注册辅助测试工具，故用下限断言
  });

  it("validateToolArgs：校验通过返回参数对象；失败抛错（消息含工具名与字段）", () => {
    expect(validateToolArgs(getTool("get_entity")!, { type: "character", id: "char-1" })).toEqual({
      type: "character",
      id: "char-1",
    });
    expect(() => validateToolArgs(getTool("get_entity")!, { type: "character" })).toThrow(/get_entity/);
    expect(() => validateToolArgs(getTool("get_entity")!, { type: "character" })).toThrow(/id/);
  });

  it("分析工具 schema：参数必填校验（detect_conflicts 的 types/relation_filter 复用既有枚举）", () => {
    expect(accepts(getTool("analyze_consistency")!, { entity_id: "char-1" })).toBe(true);
    expect(accepts(getTool("analyze_consistency")!, {})).toBe(false);
    const detect = getTool("detect_conflicts")!;
    expect(accepts(detect, {})).toBe(true); // 全部可选
    expect(accepts(detect, { types: ["character"], relation_filter: ["ally"] })).toBe(true);
    expect(accepts(detect, { types: ["精灵"] })).toBe(false); // 实体类型枚举外
    expect(accepts(detect, { relation_filter: ["自定义"] })).toBe(false); // 关系类型枚举外
    expect(accepts(getTool("trace_plot_paths")!, { from_node_id: "sc-1", to_node_id: "sc-2" })).toBe(true);
    expect(accepts(getTool("trace_plot_paths")!, { from_node_id: "sc-1" })).toBe(false);
    expect(accepts(getTool("find_orphan_elements")!, {})).toBe(true);
    expect(accepts(getTool("find_orphan_elements")!, { x: 1 })).toBe(false); // 严格：未知字段拒绝
    expect(accepts(getTool("suggest_connections")!, { entity_id: "char-1" })).toBe(true);
  });

  it("参数 schema 严格校验：未知参数拒绝，合法参数通过", () => {
    const def = getTool("get_entity")!;
    expect(accepts(def, { type: "character", id: "char-1" })).toBe(true);
    expect(accepts(def, { type: "character", id: "char-1", extra: 1 })).toBe(false);
    expect(accepts(def, { type: "精灵", id: "char-1" })).toBe(false); // 类型枚举外
    expect(accepts(def, { type: "character" })).toBe(false); // id 必填
  });

  it("query_relationships：depth 必填且限 1|2|3；relation_type 限预定义枚举", () => {
    const def = getTool("query_relationships")!;
    expect(accepts(def, { depth: 1 })).toBe(true);
    expect(accepts(def, { depth: 3 })).toBe(true);
    expect(accepts(def, { depth: 0 })).toBe(false);
    expect(accepts(def, { depth: 4 })).toBe(false);
    expect(accepts(def, { depth: 1, relation_type: "ally" })).toBe(true);
    expect(accepts(def, { depth: 1, relation_type: "自定义类型" })).toBe(false);
  });

  it("get_outline 无参数；compute_state / get_delta_history / get_outline_path 必填字段校验", () => {
    expect(accepts(getTool("get_outline")!, {})).toBe(true);
    expect(accepts(getTool("get_outline")!, { with_metadata: true })).toBe(false); // 严格：未知字段拒绝
    const compute = getTool("compute_state")!;
    expect(accepts(compute, { target_type: "character", target_id: "char-1", at_node_id: "sc-1" })).toBe(true);
    expect(accepts(compute, { target_type: "character", target_id: "char-1" })).toBe(false);
    expect(accepts(getTool("get_outline_path")!, { node_id: "sc-1" })).toBe(true);
    expect(accepts(getTool("get_delta_history")!, { target_type: "character", target_id: "char-1" })).toBe(true);
    expect(accepts(getTool("get_entity_summary")!, { type: "hook" })).toBe(true);
    expect(accepts(getTool("get_entity_summary")!, { type: "outline_node" })).toBe(false);
  });
});
