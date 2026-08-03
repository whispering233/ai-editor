// 服务端调试日志层（纯配置文件：<创作根>/.ai-editor/config.json）
//
// 背景：Node 侧 console.debug 无条件打印（无 NODE_DEBUG 类通道区分），必须显式开关防刷屏。
// 2026-08 演进：环境变量布尔开关 → 配置文件 + 细粒度类别 → **删除 env 模式**（本版）——
// 配置文件是唯一来源，环境变量开关不再支持。
//   - 配置文件：<创作根>/.ai-editor/config.json（startServer 启动时 initDebugConfig 读一次）
//   - 五类别：chat（agent 事件日志）/ request（LLM 请求完整 prompt）/ stream（原始 SSE chunk）/
//     usage（tokens 统计）/ http（hono/logger 请求日志）
//   - 配置结构：{ "debug": { "enabled": true, "categories": ["request", "usage"] } }
//     enabled=false 或缺失 → 全关；categories 缺失 → 全部类别；未知名类别 → 忽略（前向兼容）
//   - 无 projectRoot / 文件不存在 / 非法 JSON / 结构不符 → **全关**（不阻断启动，不回退 env）
// 关闭时零开销：debugLog 短路由早退（不拼接参数、不调用 console.debug）——调用方无需
// 额外 if 守卫（调用方只在高频路径无条件调用，本层内部承担开销控制）。
// 配置状态模块内持有（启动读一次；运行中改配置文件不生效——热加载 YAGNI）。
// 测试可控性：initDebugConfig **可重复调用**（每次调用重置快照）——测试用临时目录写
// 配置文件进入配置态，initDebugConfig(undefined) 回全关态。
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 配置文件相对创作根的路径（项目级调试配置；与 settings.ts 的用户级 ~/.ai-editor/config.json
 * 同文件名不同 base——settings 管 DeepSeek key，此处管调试开关，互不干扰） */
const DEBUG_CONFIG_RELATIVE_PATH = join(".ai-editor", "config.json");

/** 五类别清单（isCategoryEnabled 判定依据；新增类别在此扩展） */
export const DEBUG_CATEGORIES = ["chat", "request", "stream", "usage", "http"] as const;

/** 调试类别（细粒度开关；debugLog 第一参） */
export type DebugCategory = (typeof DEBUG_CATEGORIES)[number];

/** 配置文件结构（宽松解析：debug/enabled/categories 均可选，缺省语义见 loadDebugConfigFile） */
interface DebugConfigFile {
  debug?: { enabled?: boolean; categories?: string[] };
}

// 模块内配置状态（initDebugConfig 每次调用重置快照——测试可重复进入/退出配置态）
let configEnabled = false; // 配置 enabled（仅 true 开；缺失/非布尔 = false → 全关）
let configCategories: ReadonlySet<DebugCategory> | null = null; // null = 全部类别

/**
 * 读取并解析 <projectRoot>/.ai-editor/config.json；任何失败 → null（调用方按全关处理）：
 * - 文件不存在 / 读取失败 / 非法 JSON → null
 * - 顶层非对象 / debug 非对象 / categories 非数组 → 结构不符 → null
 * - enabled：缺失/非布尔 → false（「enabled=false 或缺失 → 全关」）
 * - categories：缺失 → null（全部类别）；数组 → 过滤出已知类别（未知名忽略，前向兼容）
 */
function loadDebugConfigFile(
  projectRoot: string,
): { enabled: boolean; categories: ReadonlySet<DebugCategory> | null } | null {
  let raw: string;
  try {
    raw = readFileSync(join(projectRoot, DEBUG_CONFIG_RELATIVE_PATH), "utf8");
  } catch {
    return null; // 文件不存在 / 读取失败
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // 非法 JSON
  }
  if (typeof parsed !== "object" || parsed === null) return null; // 顶层非对象 → 结构不符
  const debug = (parsed as DebugConfigFile).debug;
  if (typeof debug !== "object" || debug === null) return null; // debug 非对象 → 结构不符
  const enabled = debug.enabled === true; // 缺失/非布尔一律 false（全关）
  let categories: ReadonlySet<DebugCategory> | null = null;
  if (debug.categories !== undefined) {
    if (!Array.isArray(debug.categories)) return null; // 非数组 → 结构不符
    const known = new Set<DebugCategory>();
    for (const name of debug.categories) {
      if (typeof name === "string" && (DEBUG_CATEGORIES as readonly string[]).includes(name)) {
        known.add(name as DebugCategory);
      }
    }
    categories = known;
  }
  return { enabled, categories };
}

/**
 * 初始化调试配置（**启动时调用一次**：startServer(projectRoot) 内注入创作根路径）。
 * - projectRoot 提供：读 <创作根>/.ai-editor/config.json，成功 → 配置生效（唯一来源）；
 *   失败（不存在/非法 JSON/结构不符）→ **全关**（不阻断启动，不回退 env）
 * - projectRoot 缺省：全关（测试重置状态用；兼容无项目场景）
 * 可重复调用：每次调用重置快照（测试经临时目录写配置进入配置态、传 undefined 退出）。
 * 运行中改配置文件不生效——模块持有启动快照（热加载 YAGNI）。
 */
export function initDebugConfig(projectRoot?: string): void {
  const loaded = projectRoot !== undefined ? loadDebugConfigFile(projectRoot) : null;
  configEnabled = loaded?.enabled ?? false;
  configCategories = loaded?.categories ?? null;
}

/**
 * 类别开关（纯配置判定）：
 * - 总开关（enabled）关 → false
 * - categories 集合判定（null = 全部类别）
 */
export function isCategoryEnabled(cat: DebugCategory): boolean {
  if (!configEnabled) return false;
  return configCategories === null || configCategories.has(cat);
}

/**
 * 调试日志输出（类别 + 前缀，如 debugLog("chat", "chat", "text delta=+12") → "[chat] text delta=+12"、
 * debugLog("request", "llm", "request model=...") → "[llm] request model=..."——类别与输出前缀解耦：
 * chat 事件归 chat 类别、[llm] 前缀下 request/usage 归各自类别）。
 * 类别未开启时**零开销早退**：不拼接参数、不调用 console.debug。
 * 输出走 console.debug（stderr 通道；hono/logger 走 console.log stdout——两类日志分通道，
 * 便于 shell 按需过滤）。
 */
export function debugLog(cat: DebugCategory, prefix: string, ...args: unknown[]): void {
  if (!isCategoryEnabled(cat)) return;
  console.debug(`[${prefix}]`, ...args);
}
