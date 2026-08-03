// 服务端调试日志层（配置文件优先 + AI_EDITOR_DEBUG env 兼容回退）
//
// 背景：Node 侧 console.debug 无条件打印（无 NODE_DEBUG 类通道区分），必须显式开关防刷屏。
// 2026-08 重构：从「环境变量布尔开关」升级为「创作根配置文件 + 细粒度类别」：
//   - 配置文件：<创作根>/.ai-editor/config.json（startServer 启动时 initDebugConfig 读一次）
//   - 优先级：配置文件优先；文件不存在/非法 JSON/结构不符 → 回退 AI_EDITOR_DEBUG env
//     （env=1 = 全类别开启，与旧行为完全兼容）
//   - 五类别：chat（agent 事件日志）/ request（LLM 请求完整 prompt）/ stream（原始 SSE chunk）/
//     usage（tokens 统计）/ http（hono/logger 请求日志）
// 配置结构：{ "debug": { "enabled": true, "categories": ["request", "usage"] } }
//   - enabled=false 或缺失 → 全关；categories 缺失 → 全部类别；categories 含未知名 → 忽略（前向兼容）
// 关闭时零开销：debugLog 短路由早退（不拼接参数、不调用 console.debug）——调用方无需
// 额外 if 守卫（调用方只在高频路径无条件调用，本层内部承担开销控制）。
// 配置状态模块内持有（启动读一次；运行中改配置文件不生效——热加载 YAGNI）。
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 调试开关环境变量名（AI_EDITOR_DEBUG=1 开启；默认关） */
export const DEBUG_ENV_NAME = "AI_EDITOR_DEBUG";

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

// 模块内配置状态（startServer 启动时 initDebugConfig 初始化；测试经 initDebugConfig(undefined) 重置）
let configActive = false; // true = 配置文件模式（配置文件优先，env 不参与）；false = env 回退模式
let configEnabled = false; // 配置文件模式的 enabled（仅 configActive 时有意义）
let configCategories: ReadonlySet<DebugCategory> | null = null; // null = 全部类别

/**
 * 读取并解析 <projectRoot>/.ai-editor/config.json；任何失败 → null（回退 env，不阻断启动）：
 * - 文件不存在 / 读取失败 / 非法 JSON → null
 * - 顶层非对象 / debug 非对象 → 结构不符 → null
 * - enabled：缺失/非布尔 → false（用户设计「enabled=false 或缺失 → 全关」）
 * - categories：缺失 → null（全部类别）；非数组 → 结构不符 → null；
 *   数组 → 过滤出已知类别（未知名忽略，前向兼容）
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
 * - projectRoot 提供：读 <创作根>/.ai-editor/config.json，成功 → 配置文件模式（配置优先，
 *   env 被忽略）；失败（不存在/非法 JSON/结构不符）→ 回退 env 模式（不阻断启动）
 * - projectRoot 缺省：回到 env 模式（测试重置状态用；兼容无项目场景）
 * 运行中改配置文件不生效——模块持有启动快照（热加载 YAGNI）。
 */
export function initDebugConfig(projectRoot?: string): void {
  const loaded = projectRoot !== undefined ? loadDebugConfigFile(projectRoot) : null;
  if (loaded !== null) {
    configActive = true;
    configEnabled = loaded.enabled;
    configCategories = loaded.categories;
    return;
  }
  configActive = false;
  configEnabled = false;
  configCategories = null;
}

/**
 * 调试总开关（= 配置 enabled 或 env 开——供现有调用与 http 挂载用）：
 * - 配置文件模式：返回配置 enabled（env 不参与，配置文件优先）
 * - env 模式：每次调用读环境变量（测试经 vi.stubEnv / 直接改 process.env 即时生效，
 *   无需模块重载；env 读取开销可忽略，无需缓存）
 */
export function isDebugEnabled(): boolean {
  return configActive ? configEnabled : process.env[DEBUG_ENV_NAME] === "1";
}

/**
 * 类别开关（细粒度判定）：
 * - 总开关关 → false
 * - 配置文件模式 → 按 categories 集合判定（null = 全部类别）
 * - env 模式 → 总开关开即全类别开（与旧「AI_EDITOR_DEBUG=1 全开」语义一致）
 */
export function isCategoryEnabled(cat: DebugCategory): boolean {
  if (!isDebugEnabled()) return false;
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
