// 工具注册表：统一工具定义结构 + 注册/查询 API + 参数校验入口
// registerTool 挂载新工具；executor 通过 getTool(name) 按名调度。
//
// 定义结构 { name, description, parameters, permission, run }：
// - parameters：TypeBox 参数 schema（运行时即 JSON Schema；执行前 preflight 校验，
//   批量 tool_call 先全部校验再执行）；校验失败即抛错（executor 统一转结构化 tool_result 喂回 LLM）
// - permission：TOOL_PERMISSION.AUTO（自动）/ PROPOSAL（提案确认）两级（「工具分级」）
// - run(ctx, args)：同步执行，返回 JSON 可序列化结果；抛错即失败（不把失败编码进正常 content）
//
// 注册语义：重复注册同名工具抛错（防后续切片扩展时撞名；注册表是唯一事实来源）。

import { validateToolArguments, type JsonObject, type Static, type TSchema } from "@earendil-works/pi-ai";
import type { ToolPermission } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "./context.js";

/**
 * 工具定义（parameters 的推断类型约束 run 的 args 入参）。
 * run 声明为**方法**（而非函数属性）：方法参数双变检查——具体 schema 的
 * ToolDefinition<X> 可赋给容器默认的 ToolDefinition<TSchema>（run args 为 unknown），
 * executor 从注册表取出后先校验（validateToolArgs 返回 unknown）再执行，
 * 运行时由 parameters 兜底，类型层面双变无实际风险。
 */
export interface ToolDefinition<TSchema_ extends TSchema = TSchema> {
 /** 工具名（工具目录，如 get_entity；LLM tool_call 的 tool 字段） */
  name: string;
 /** 人类可读描述（注入 LLM 工具列表，说明用途与参数语义） */
  description: string;
 /** 参数 TypeBox schema（入参校验；`Static<>` 即 run 的 args 类型） */
  parameters: TSchema_;
 /** 权限级别（TOOL_PERMISSION.AUTO / PROPOSAL） */
  permission: ToolPermission;
 /**
 * 执行函数：注入 ToolContext（db/outlineDir/projectId），返回可序列化结果或抛错。
 * signal：可选取消通道（「长工具执行中检查 signal」）——分析类长任务在 executor
 * 中止在途工具时命中；同步短工具可不检查。
 */
  run(ctx: ToolContext, args: Static<TSchema_>, signal?: AbortSignal): unknown;
}

/**
 * 参数校验（执行前 preflight；校验语义与 pi agent 循环一致——pi-ai 的
 * validateToolArguments：先做原始类型 coerce，再按 schema 检查，失败抛错）。
 * 校验通过返回（可能被 coerce 的）参数对象。
 * @throws Error 校验失败（消息含工具名 + 字段路径 + 原始参数）
 */
export function validateToolArgs(def: ToolDefinition, args: unknown): unknown {
  return validateToolArguments(
    { name: def.name, description: def.description, parameters: def.parameters },
    {
      type: "toolCall",
      id: `validate_${def.name}`,
      name: def.name,
      // pi 0.86 起 `ToolCall.arguments` 收紧为 JsonObject（调用方只会传 LLM 解析出的 JSON）
      arguments: (args ?? {}) as JsonObject,
    },
  );
}

/** 注册表内部存储（Map 保证按名 O(1) 查询） */
const registry = new Map<string, ToolDefinition>();

/**
 * 注册单个工具：重复注册同名工具抛错——防后续切片扩展时撞名，
 * 保证「注册表 = 工具目录唯一事实来源」。
 * 防呆：name 必须为非空字符串（拼错名不应静默注册新工具）。
 */
export function registerTool(def: ToolDefinition): void {
  if (typeof def.name !== "string" || def.name.trim() === "") {
    throw new Error("registerTool: 工具名必须为非空字符串");
  }
  if (registry.has(def.name)) {
    throw new Error(`registerTool: 工具 ${def.name} 已注册（重复注册禁止）`);
  }
  registry.set(def.name, def);
}

/** 批量注册（各工具模块组装定义数组后统一挂载；内部逐个调 registerTool 保证判重） */
export function registerTools(defs: readonly ToolDefinition[]): void {
  for (const def of defs) registerTool(def);
}

/** 按名查询工具；未注册返回 undefined（executor 收到未知工具名时按失败处理） */
export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

/** 全部已注册工具（按名称排序，稳定输出；供上下文组装注入 LLM 工具列表） */
export function listTools(): ToolDefinition[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 当前注册的工具数量（冒烟/测试断言用） */
export function toolCount(): number {
  return registry.size;
}
