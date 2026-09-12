// 创作根级偏好：<创作根>/.ai-editor/config.json 的 `lastProject` 键
//
// 用途（2026-09，用户需求「打开时直接进入上一次选择的书籍」）：POST /project/open 成功后
// 记下目标目录的绝对路径；startServer 在创作根自身不是项目时按它恢复上次打开的书。
//
// 与 debug.ts 同文件不同键：debug 段由用户手编、服务端只在启动读一次；lastProject 由服务端
// 写（**合并写**：先读整份 JSON，只覆盖本键——否则会把用户手编的 debug 段清掉）。
// 任何失败（文件不存在/非法 JSON/只读目录）都不抛错也不阻断调用方：
// 偏好丢失只是下次启动回到书架，不该让一次 open 失败。
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeJsonAtomic } from "@whispering233/ai-editor-db";

/** 配置文件相对创作根的路径（与 debug.ts 同一文件，各自只读写自己的键） */
const ROOT_CONFIG_RELATIVE_PATH = join(".ai-editor", "config.json");

function configFilePath(projectRoot: string): string {
  return join(projectRoot, ROOT_CONFIG_RELATIVE_PATH);
}

/** `lastProject` 键名（读写的唯一字面量处） */
export const LAST_PROJECT_KEY = "lastProject";

/** 读取整份配置（文件不存在/非法 JSON/顶层非对象 → 空对象——调用方按「无该键」处理） */
function readRootConfig(projectRoot: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configFilePath(projectRoot), "utf8"));
    if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
  } catch {
    // 文件不存在 / 读取失败 / 非法 JSON：都退化为空配置
  }
  return {};
}

/** 上次打开的项目目录绝对路径（无记录 / 字段非字符串 → null） */
export function readLastProject(projectRoot: string): string | null {
  const value = readRootConfig(projectRoot)[LAST_PROJECT_KEY];
  return typeof value === "string" && value !== "" ? value : null;
}

/** 记下本次打开的项目目录（合并写；失败静默——见文件头注释） */
export function writeLastProject(projectRoot: string, projectDir: string): void {
  try {
    const next = { ...readRootConfig(projectRoot), [LAST_PROJECT_KEY]: projectDir };
    mkdirSync(dirname(configFilePath(projectRoot)), { recursive: true });
    writeJsonAtomic(configFilePath(projectRoot), next);
  } catch {
    // 只读创作根 / 磁盘错误：偏好写入失败不影响已完成的 open
  }
}
