// server：pi 配置目录（本机级，`docs/design/config.md` §1）
//
// 口径：
// - 生效目录只来自 `~/.ai-editor/pi.json` 的 `agentDir`；缺失 / 空串 / 非绝对路径 → 缺省
//   `~/.ai-editor/pi-agent`。**不读**父进程的 `PI_CODING_AGENT_DIR`——那个变量在本仓是**输出**
//   （写进 env 让 pi 的 `getAgentDir()` 读到），不是输入，因此不存在优先级裁决。
// - 唯一落地方式 = 写 `process.env.PI_CODING_AGENT_DIR`：pi 的凭据 / 模型 / settings / 缓存 / 资源目录
//   全部由 `getAgentDir()` 惰性派生，所以只有一个开关，不需要逐调用点传参。
// - 改目录与改配置文件共用同一个生效点 `applyPiConfigChange()`（重设 env → 重建单例 → 释放项目运行时
//   → 重挂出站 dispatcher）。不重建就会继续用旧目录的凭据，且 httpProxy / 空闲超时也读不到新值。
// - 本模块顶层零 I/O、不写 env；env 只在 `initPiAgentDir()` 内写（测试隔离依赖这一点）。
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { writeJsonAtomic } from "@whispering233/ai-editor-db";
import { disposeProjectRuntime } from "./chat-runtime.js";
import { applyHttpProxySettings, configureHttpDispatcher } from "./http-dispatcher.js";
import { getSettingsManager, resetModelRuntime } from "./model-runtime.js";

/**
 * pi agent dir 的环境变量名（pi `dist/config.js` 的 `ENV_AGENT_DIR`）。
 * 包根入口不导出该常量，只能写字面量——正确性由 `pi-agent-dir.test.ts` 用 pi 的 `getAgentDir()` 反验。
 */
const ENV_PI_AGENT_DIR = "PI_CODING_AGENT_DIR";

/** 本机级配置目录（`~/.ai-editor/`；桌面版与 CLI/浏览器形态共用同一份） */
export const PI_HOME_DIR = join(homedir(), ".ai-editor");

/** 本项目唯一的本机级配置文件（只有 `agentDir` 一个键，未知键读侧忽略） */
export const PI_CONFIG_PATH = join(PI_HOME_DIR, "pi.json");

/** pi 配置目录缺省值（与 pi CLI 的 `~/.pi/agent` 完全隔离） */
export const DEFAULT_PI_AGENT_DIR = join(PI_HOME_DIR, "pi-agent");

/** `pi.json` 的键名（唯一字面量处） */
const AGENT_DIR_KEY = "agentDir";

/** 读整份 pi.json（文件缺失 / 坏 JSON / 顶层非对象 → 空对象，调用方按「未配置」处理） */
function readConfig(path: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 缺失 / 读取失败 / 坏 JSON：退化为未配置
  }
  return {};
}

/** 配置里的 `agentDir`（非空字符串且绝对路径才认，其余一律当未配置——相对路径会让 pi 写到 cwd） */
export function readConfiguredAgentDir(path: string = PI_CONFIG_PATH): string | null {
  const value = readConfig(path)[AGENT_DIR_KEY];
  return typeof value === "string" && value.trim() !== "" && isAbsolute(value) ? value : null;
}

/** 生效目录：配置值 → 缺省（**不读环境变量**） */
export function resolvePiAgentDir(path: string = PI_CONFIG_PATH): string {
  return readConfiguredAgentDir(path) ?? DEFAULT_PI_AGENT_DIR;
}

/** 合并写 `agentDir`（读整份 → 只改本键 → 原子写；父目录自动创建，不影响未知键） */
export function writeConfiguredAgentDir(dir: string, path: string = PI_CONFIG_PATH): void {
  const next = { ...readConfig(path), [AGENT_DIR_KEY]: dir };
  mkdirSync(dirname(path), { recursive: true });
  writeJsonAtomic(path, next);
}

/** 服务启动最早期调用：解析目录并落地 env（此后 pi 的一切路径都从它派生） */
export function initPiAgentDir(override?: string): string {
  const dir = override === undefined ? resolvePiAgentDir() : override;
  process.env[ENV_PI_AGENT_DIR] = dir;
  return dir;
}

/**
 * 配置变更统一生效点（改目录 / 改配置文件后都走这里）。
 *
 * 顺序有意义：先落地 env，再重建单例（否则 `SettingsManager` 仍指向旧目录，读到的
 * httpProxy / 空闲超时也是旧的），最后释放当前项目的运行时（它持有旧目录的凭据与设置实例）。
 * `applyHttpProxySettings` 是 `??=` 语义——同一进程内第二次改目录不会覆盖已在环境里的代理变量。
 */
export function applyPiConfigChange(override?: string): void {
  initPiAgentDir(override);
  resetModelRuntime();
  disposeProjectRuntime();
  const settings = getSettingsManager();
  applyHttpProxySettings(settings.getGlobalSettings().httpProxy);
  configureHttpDispatcher(settings.getHttpIdleTimeoutMs());
}