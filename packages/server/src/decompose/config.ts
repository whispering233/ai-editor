// 拆解吞吐配置读取（创作根 `<创作根>/.ai-editor/config.json` 的 `decompose` 段）。
//
// 契约：docs/design/config.md「创作根 `.ai-editor/config.json`」的 `decompose` 段与
// docs/design/60-decompose.md §2.2（并发数 = 创作根配置，**建 job 时读取一次并快照**进
// `decompose_jobs.concurrency`；resume / 重跑按快照重算段，改配置只影响新 job）。
//
// 容错口径与 `src/debug.ts` 的 `debug` 段同款（**有意各读一份**，不重构既有两处读取）：
// 文件不存在 / 读取失败 / 非法 JSON / 顶层非对象 / `decompose` 非对象 → **缺省**；
// 值必须是 ≥ 1 的整数，否则缺省；超过上限只钳制、不判非法（配置是「吞吐意图」，不是校验对象）。
// 读取点 = 建 job（首拆 / 续拆）时一次：本模块不做缓存，调用方即快照点（模块级缓存会让
// 「改配置只影响新 job」变成「重启才生效」）。
//
// 缺省与钳制数值**单点定义在本模块并导出**（config.md 与 60-decompose.md 不复述数字）。

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 拆解并发段数下限（显式配置到下限 = 退回串行；低于此值判非法） */
export const MIN_DECOMPOSE_CONCURRENCY = 1;
/** 拆解并发段数缺省（未配置 / 配置非法）：并发是拆解提速的主杠杆，缺省即启用 */
export const DEFAULT_DECOMPOSE_CONCURRENCY = 4;
/** 拆解并发段数上限（超限钳制，不判非法）：再大只会多撞 provider 限流，墙钟不再变短 */
export const MAX_DECOMPOSE_CONCURRENCY = 8;

/** 配置文件相对创作根的路径（与 debug 段同文件；本模块只读 `decompose` 段，不碰其他键） */
const DECOMPOSE_CONFIG_RELATIVE_PATH = join(".ai-editor", "config.json");

/** 钳制到合法区间（纯函数；非整数 / 非有限值先归位到缺省——调用方只在解析出数值后用它） */
export function clampDecomposeConcurrency(value: number): number {
  return Math.min(Math.max(Math.floor(value), MIN_DECOMPOSE_CONCURRENCY), MAX_DECOMPOSE_CONCURRENCY);
}

/**
 * 读创作根的拆解并发段数。`projectRoot` = 创作根目录（不是项目目录）；未初始化 / 任何失败 → 缺省。
 * @returns 合法区间内的段数（永不抛错）
 */
export function readDecomposeConcurrency(projectRoot: string | null | undefined): number {
  if (projectRoot === null || projectRoot === undefined) return DEFAULT_DECOMPOSE_CONCURRENCY;
  let raw: string;
  try {
    raw = readFileSync(join(projectRoot, DECOMPOSE_CONFIG_RELATIVE_PATH), "utf8");
  } catch {
    return DEFAULT_DECOMPOSE_CONCURRENCY; // 文件不存在 / 读取失败
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_DECOMPOSE_CONCURRENCY; // 非法 JSON
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_DECOMPOSE_CONCURRENCY; // 顶层非对象 → 结构不符
  const decompose = (parsed as { decompose?: unknown }).decompose;
  if (typeof decompose !== "object" || decompose === null) return DEFAULT_DECOMPOSE_CONCURRENCY; // 段缺失 / 非对象
  const value = (decompose as { concurrency?: unknown }).concurrency;
  // 值非法（缺失 / 非 number / 非整数 / < 最小值）→ 缺省；超上限 → 钳制
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_DECOMPOSE_CONCURRENCY) {
    return DEFAULT_DECOMPOSE_CONCURRENCY;
  }
  return clampDecomposeConcurrency(value);
}
