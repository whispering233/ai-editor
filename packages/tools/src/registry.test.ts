// S6.3 注册表测试：注册/查询 API + S6.3 八个查询工具注册完整性
// 覆盖：registerTool/getTool/listTools/toolCount / 重复注册抛错 /
//   入口副作用注册（import index 即挂载 8 个查询工具，权限 AUTO）/
//   argsSchema 严格校验（strict：未知参数拒绝；depth 必填 1|2|3）
import { beforeEach, describe, expect, it } from "vitest";

import { TOOL_PERMISSION } from "@whispering233/ai-editor-shared";
import { registerTool, getTool, listTools, toolCount, type ToolDefinition } from "./registry.js";
import type { ToolContext } from "./context.js";
import { z } from "zod";

const noopCtx: ToolContext = { db: undefined as never, outlineDir: "", projectId: "proj-test" };

describe("registry 注册/查询 API", () => {
  it("registerTool 后 getTool 可取回；listTools 按名称排序；toolCount 计数", () => {
    const def: ToolDefinition = {
      name: "zz_test_tool",
      description: "注册表测试工具",
      argsSchema: z.object({}).strict(),
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
      argsSchema: z.object({}).strict(),
      permission: TOOL_PERMISSION.AUTO,
      run: () => "ok",
    };
    registerTool(def);
    expect(() => registerTool(def)).toThrow(/已注册/);
  });

  it("注册防呆：name 非空字符串（空串/空白/缺失抛错）", () => {
    expect(() =>
      registerTool({ name: "", description: "x", argsSchema: z.object({}).strict(), permission: TOOL_PERMISSION.AUTO, run: () => "ok" }),
    ).toThrow(/工具名必须为非空字符串/);
    expect(() =>
      registerTool({ name: "   ", description: "x", argsSchema: z.object({}).strict(), permission: TOOL_PERMISSION.AUTO, run: () => "ok" }),
    ).toThrow(/工具名必须为非空字符串/);
  });

  it("run 通过 ctx 注入上下文执行（db/outlineDir/projectId 透传）", () => {
    const def: ToolDefinition = {
      name: "ctx_test_tool",
      description: "上下文透传测试",
      argsSchema: z.object({}).strict(),
      permission: TOOL_PERMISSION.AUTO,
      run: (ctx) => ctx.projectId,
    };
    registerTool(def);
    expect(getTool("ctx_test_tool")!.run(noopCtx, {})).toBe("proj-test");
  });

  it("run 取消通道：signal 透传（决策 16 ③长工具执行中检查 signal；S6.4 分析类预留）", () => {
    const def: ToolDefinition = {
      name: "signal_test_tool",
      description: "signal 透传测试",
      argsSchema: z.object({}).strict(),
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

describe("S6.3+S6.4 工具注册（入口副作用，import ./index.js 触发）", () => {
  beforeEach(async () => {
    // 确保 index.ts 的注册副作用已执行（vitest 按文件隔离模块图，显式导入）
    await import("./index.js");
  });

  it("13 个工具全部注册（8 查询 + 5 分析）且权限为 AUTO、description 非空", () => {
    const names = listTools().map((t) => t.name);
    for (const expected of [
      // S6.3 查询类（tools.md「查询类（自动）」）
      "get_entity",
      "search_entities",
      "query_relationships",
      "get_outline",
      "get_outline_path",
      "compute_state",
      "get_delta_history",
      "get_entity_summary",
      // S6.4 分析类（tools.md「分析类（自动）」）
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
    expect(toolCount()).toBeGreaterThanOrEqual(13); // 本文件注册辅助测试工具，故用下限断言（8 查询 + 5 分析）
  });

  it("分析工具 schema：参数必填校验（detect_conflicts 的 types/relation_filter 复用既有枚举）", () => {
    expect(getTool("analyze_consistency")!.argsSchema.safeParse({ entity_id: "char-1" }).success).toBe(true);
    expect(getTool("analyze_consistency")!.argsSchema.safeParse({}).success).toBe(false);
    const detect = getTool("detect_conflicts")!.argsSchema;
    expect(detect.safeParse({}).success).toBe(true); // 全部可选
    expect(detect.safeParse({ types: ["character"], relation_filter: ["ally"] }).success).toBe(true);
    expect(detect.safeParse({ types: ["精灵"] }).success).toBe(false); // 实体类型枚举外
    expect(detect.safeParse({ relation_filter: ["自定义"] }).success).toBe(false); // 关系类型枚举外
    expect(getTool("trace_plot_paths")!.argsSchema.safeParse({ from_node_id: "sc-1", to_node_id: "sc-2" }).success).toBe(true);
    expect(getTool("trace_plot_paths")!.argsSchema.safeParse({ from_node_id: "sc-1" }).success).toBe(false);
    expect(getTool("find_orphan_elements")!.argsSchema.safeParse({}).success).toBe(true);
    expect(getTool("find_orphan_elements")!.argsSchema.safeParse({ x: 1 }).success).toBe(false); // strict
    expect(getTool("suggest_connections")!.argsSchema.safeParse({ entity_id: "char-1" }).success).toBe(true);
  });

  it("argsSchema 严格校验：未知参数拒绝（strict），合法参数通过", () => {
    const def = getTool("get_entity")!;
    expect(def.argsSchema.safeParse({ type: "character", id: "char-1" }).success).toBe(true);
    expect(def.argsSchema.safeParse({ type: "character", id: "char-1", extra: 1 }).success).toBe(false);
    expect(def.argsSchema.safeParse({ type: "精灵", id: "char-1" }).success).toBe(false); // 类型枚举外
    expect(def.argsSchema.safeParse({ type: "character" }).success).toBe(false); // id 必填
  });

  it("query_relationships：depth 必填且限 1|2|3；relation_type 限预定义枚举", () => {
    const def = getTool("query_relationships")!;
    expect(def.argsSchema.safeParse({ depth: 1 }).success).toBe(true);
    expect(def.argsSchema.safeParse({ depth: 3 }).success).toBe(true);
    expect(def.argsSchema.safeParse({ depth: 0 }).success).toBe(false);
    expect(def.argsSchema.safeParse({ depth: 4 }).success).toBe(false);
    expect(def.argsSchema.safeParse({ depth: 1, relation_type: "ally" }).success).toBe(true);
    expect(def.argsSchema.safeParse({ depth: 1, relation_type: "自定义类型" }).success).toBe(false);
  });

  it("get_outline 无参数；compute_state / get_delta_history / get_outline_path 必填字段校验", () => {
    expect(getTool("get_outline")!.argsSchema.safeParse({}).success).toBe(true);
    expect(getTool("get_outline")!.argsSchema.safeParse({ with_metadata: true }).success).toBe(false); // strict
    const compute = getTool("compute_state")!.argsSchema;
    expect(compute.safeParse({ target_type: "character", target_id: "char-1", at_node_id: "sc-1" }).success).toBe(true);
    expect(compute.safeParse({ target_type: "character", target_id: "char-1" }).success).toBe(false);
    expect(getTool("get_outline_path")!.argsSchema.safeParse({ node_id: "sc-1" }).success).toBe(true);
    expect(getTool("get_delta_history")!.argsSchema.safeParse({ target_type: "character", target_id: "char-1" }).success).toBe(true);
    expect(getTool("get_entity_summary")!.argsSchema.safeParse({ type: "hook" }).success).toBe(true);
    expect(getTool("get_entity_summary")!.argsSchema.safeParse({ type: "outline_node" }).success).toBe(false);
  });
});
