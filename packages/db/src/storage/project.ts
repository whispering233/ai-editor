// @whispering233/ai-editor-db project.json 存储模块（T2.2）
//
// 单一事实来源：doc/database/schema.md 第 157-186 行（project.json 契约）——
// id/name/language/prompt/schema_version/current_position/created_at/updated_at，
// 文件写入走决策 11 原子写同款流程（第 186 行），DeepSeek key 绝不写入本文件（决策 17）。
// 决策 41（2026-08 批次十）：AGENTS.md 项目规则文件读写也收敛于此（schema.md「AGENTS.md」节）——
// 项目规则唯一事实源 = 项目目录 AGENTS.md（取代 project.json `prompt` 字段，不再读写）。

import { join } from "node:path";
import { statSync } from "node:fs";
import type { ProjectFileConfig } from "@whispering233/ai-editor-shared";
import { readTextFileOrNull, writeJsonAtomic, writeTextAtomic } from "./atomic.js";

/** project.json 文件名（决策 8：项目根目录） */
export const PROJECT_FILE_NAME = "project.json";

/** AGENTS.md 文件名（决策 41：项目规则文件，项目根目录，与 project.json 同级） */
export const AGENTS_FILE_NAME = "AGENTS.md";

/**
 * 读取 project.json。
 *
 * 缺失文件语义：**返回 null**——project.json 是项目「是否已初始化」的判定文件
 * （决策 8：首次初始化时自动创建），null 即未初始化，由上层决定创建流程；
 * 与 readOutlineFile（缺失返回空树）语义不同：大纲空树可直接使用，项目配置
 * 不存在则无法合成默认值（id 需生成、name 需取目录名，属初始化逻辑）。
 *
 * 文件存在但 JSON 损坏：**抛错**，不静默重建（同 readOutlineFile 的取舍）。
 *
 * @param dir 项目根目录
 * @returns 项目配置；文件不存在返回 null
 * @throws 文件存在但 JSON 解析失败或顶层结构不符契约时抛出
 */
export function readProjectFile(dir: string): ProjectFileConfig | null {
  const raw = readTextFileOrNull(join(dir, PROJECT_FILE_NAME));
  if (raw === null) return null;
  return validateProjectFile(JSON.parse(raw)); // JSON 损坏抛 SyntaxError，不静默吞
}

/**
 * 校验 project.json 顶层结构（读时校验，与 outline.ts 的 validateOutlineFile 对称）。
 * 必检字段（oracle 审核补）：id / name / schema_version——schema_version 是 JSON
 * 结构演进判定依据（决策 13），id/name 是初始化即写入的必填项；language/prompt/
 * current_position/时间戳等属可缺省或后续扩展字段，不在此拦截（避免旧文件误伤）。
 * 节点级字段不逐一校验——文件格式演进由 schema_version 判定，此处只拦
 * 「完全不是项目配置」的脏数据。
 */
function validateProjectFile(parsed: unknown): ProjectFileConfig {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).id !== "string" ||
    typeof (parsed as Record<string, unknown>).name !== "string" ||
    typeof (parsed as Record<string, unknown>).schema_version !== "number"
  ) {
    throw new Error("project.json 顶层结构不符契约（需 {id:string, name:string, schema_version:number, ...}）");
  }
  return parsed as ProjectFileConfig;
}

/**
 * 原子写 project.json（决策 11 同款流程：临时文件 + fsync + rename，schema.md 第 186 行）。
 * schema_version 随 config 原样写入——与 outline.json 同步写入是调用方职责（决策 13 修订）。
 */
export function writeProjectFile(dir: string, config: ProjectFileConfig): void {
  writeJsonAtomic(join(dir, PROJECT_FILE_NAME), config);
}

// ============ AGENTS.md 项目规则文件（决策 41） ============

/**
 * 读取项目规则文件 AGENTS.md 内容。
 *
 * 缺失文件语义：**返回 null**——AGENTS.md 是可选文件（新项目/未迁移项目可能没有），
 * 由上层决定（GET /project/agents 返回 exists:false + 空串；chat 注入跳过「## 项目设定」段）。
 *
 * @param dir 项目根目录
 * @returns 文件内容；文件不存在返回 null
 * @throws 文件存在但读取失败（权限等）时抛出
 */
export function readAgentsFile(dir: string): string | null {
  return readTextFileOrNull(join(dir, AGENTS_FILE_NAME));
}

/**
 * 原子写项目规则文件 AGENTS.md（决策 41 + 决策 11 同款流程：临时文件 + fsync + rename）。
 * 文件不存在时自动创建；内容**整体替换**（空串 = 清空规则，保留空文件不删除——exists 语义稳定）。
 *
 * @param dir 项目根目录
 * @param content AGENTS.md 完整内容
 * @throws 目录不可写 / 磁盘错误时抛出，且原文件保持完好
 */
export function writeAgentsFile(dir: string, content: string): void {
  writeTextAtomic(join(dir, AGENTS_FILE_NAME), content);
}

/**
 * 读取 AGENTS.md 的 mtime（ISO 8601）——外部修改检测依据（决策 41）。
 * 文件不存在返回 null（与 GET /project/agents 的 updatedAt 语义一致）。
 *
 * @param dir 项目根目录
 * @returns 文件 mtime ISO 字符串；文件不存在返回 null
 */
export function agentsFileMtimeIso(dir: string): string | null {
  try {
    return statSync(join(dir, AGENTS_FILE_NAME)).mtime.toISOString();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
