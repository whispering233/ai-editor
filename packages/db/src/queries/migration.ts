// @ai-editor/db schema 演进：删库重建（S1.1）
//
// 单一事实来源：doc/design/decisions.md 决策 13（MVP 删库重建）与修订（2026-08）——
// - 以 data.db 的 PRAGMA user_version 为准判定是否重建；与当前版本不匹配即删库重建，无迁移脚本（YAGNI）
// - 重建时同步重置 outline.json（先备份为 outline.json.v{n}.bak，n=旧版本号）、清空回收站
// - 旧 data.db 一并备份为 data.db.v{n}.bak；备份带版本号、不覆盖旧备份（多次重建各自留档）
// - project.json 的 schema_version 仅用于 JSON 结构判断（与 user_version 不同维度），重建不修改 project.json
// - 此策略仅在正式发布前可接受；首次发布前必须复审（决策 13 约束）
// 触发语义（doc/api/endpoints.md 第 68-70 行）：open 时检测，重建完成后向客户端提示。

import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { OutlineFileTree } from "@ai-editor/shared";
import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { getUserVersion, SCHEMA_VERSION, setUserVersion } from "../schema.js";
import { OUTLINE_FILE_NAME, writeOutlineFile } from "../storage/outline.js";

/** data.db 文件名（决策 8：项目根目录，与 server middleware 的常量一致） */
export const DATA_DB_FILE_NAME = "data.db";

/** 删库重建的结果（供上层 open 流程提示客户端，endpoints.md 第 69 行） */
export interface MigrationResult {
  /** 是否发生了删库重建 */
  rebuilt: boolean;
  /** 重建前的旧版本号（rebuilt=true 时有值） */
  fromVersion?: number;
  /** 重建后的版本号（恒等于 SCHEMA_VERSION） */
  toVersion: number;
  /** 重建产生的备份文件绝对路径（data.db.v{n}.bak / outline.json.v{n}.bak） */
  backups: string[];
}

/** 重建流程的返回：新连接 + 结果（见 rebuildProjectStorage 注释） */
export interface RebuildOutput {
  /** 重建后的有效连接（旧连接已关闭）；未重建时为原连接 */
  db: Db;
  result: MigrationResult;
}

/**
 * schema 版本检测 + 删库重建的高层入口（open 流程调用，endpoints.md 第 68-70 行）。
 *
 * - user_version 与 SCHEMA_VERSION **匹配**：直接返回，db 为原连接，rebuilt=false。
 * - **不匹配**（含旧版本与未来版本——决策 13「与当前版本不匹配则重建」，降级同样重建）：
 *   执行 rebuildProjectStorage 并返回新连接与重建信息，供上层提示「已重建」。
 *
 * 注意（brand-new 库场景）：新 openDatabase 的库 user_version=0，若不匹配当前版本会触发
 * 一次**无意义重建**并留下空库备份 data.db.v0.bak——建议调用方（S1.2 create 流程）在
 * 初始化三文件时立即 setUserVersion(SCHEMA_VERSION)（决策 8 初始化流程已含版本号写入），
 * 使后续 open 直接命中匹配分支；本函数不自动写版本号，保持「检测/重建」单一职责。
 *
 * @param db 已打开 data.db 的连接（openDatabase 后立即调用）
 * @param dir 项目根目录（outline.json 所在）
 * @param dbPath data.db 绝对路径
 * @throws 备份/重建过程中的 I/O 错误；重建失败时旧连接已关闭，调用方需自行恢复
 */
export function ensureSchemaCompatible(db: Db, dir: string, dbPath: string): RebuildOutput {
  const current = getUserVersion(db);
  if (current === SCHEMA_VERSION) {
    return { db, result: { rebuilt: false, toVersion: SCHEMA_VERSION, backups: [] } };
  }
  return rebuildProjectStorage(db, dir, dbPath, current);
}

/**
 * WAL checkpoint（TRUNCATE）：把 WAL 内容合并回主文件并截断（busy>0 说明有其他连接
 * 在写——MVP 单进程单连接，不检查）。供**导出前**调用（E1：release-review §二）——
 * 保证 data.db 主文件为完整快照，导出 zip 内的 data.db 无需附带 -wal/-shm。
 */
export function checkpointWal(db: Db): void {
  db.pragma("wal_checkpoint(TRUNCATE)");
}

/**
 * 删库重建全流程（决策 13）：
 *
 * 1. **checkpoint + 关闭连接**：`wal_checkpoint(TRUNCATE)` 把 WAL 内容合并回主文件并截断，
 *    然后关闭连接——保证后续复制的是完整快照（WAL 一致性取舍见 backupDbFile 注释）
 * 2. **备份 data.db** → `data.db.v{n}.bak`（n=旧版本号；文件复制，原文件随后删除重建）
 * 3. **备份 outline.json** → `outline.json.v{n}.bak`（文件复制；非 SQLite 文件无 WAL 问题，
 *    复制保留原始字节，不存在时跳过备份）
 * 4. **删除旧库文件**（data.db + -wal + -shm，checkpoint 后 -wal 已截断但文件仍在，一并删除）
 * 5. **重建空库**：openDatabase（自动建表）→ setUserVersion(SCHEMA_VERSION)
 * 6. **重置 outline.json**：写最小空树（严格三层空树，决策 19；与 T2.2 readOutlineFile
 *    缺失语义的空树同形）——顶层 schema_version 同步写 SCHEMA_VERSION（决策 13 修订）
 *
 * **清空回收站**：新库四张表全空，软删行（deleted_at 非 NULL）天然不存在，无需单独操作。
 * **project.json 不动**：其 schema_version 仅用于 JSON 结构判断（决策 13），id/name 跨启动稳定。
 *
 * **崩溃窗口（MVP 可接受）**：步骤 4（删除旧库）与步骤 5（重建空库）之间进程崩溃 →
 * 磁盘上无 data.db（下次 open 自动重建空库），且旧库备份已留档不丢数据；
 * 但同版本号多次重建会覆盖旧备份（命名 v{n}.bak 不带时间戳，决策 13 修订的
 * 「各自留档」仅对不同版本号成立）——MVP 阶段无真实用户数据，可接受。
 *
 * @param db 待重建的连接（流程内关闭；调用方丢弃原引用，使用返回值中的新连接）
 * @param dir 项目根目录
 * @param dbPath data.db 绝对路径
 * @param oldVersion 重建前的旧版本号（备份文件名与 fromVersion 用）
 * @returns 新连接（已开库、版本号已写、表已建）+ 重建结果
 */
export function rebuildProjectStorage(db: Db, dir: string, dbPath: string, oldVersion: number): RebuildOutput {
  // 1. WAL 合并回主文件后关闭连接（busy>0 说明有其他连接在写——MVP 单进程单连接，不检查）
  checkpointWal(db);
  closeDatabase(db);

  // 2/3. 备份（复制而非 rename：原文件在重建流程中继续使用/删除）
  const dbBackup = backupDbFile(dbPath, oldVersion);
  const outlineBackup = backupOutlineFile(dir, oldVersion);

  // 4. 删除旧库文件（含 WAL/SHM 伴生文件）
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  // 5. 重建空库并写版本号（openDatabase 自动建表 + WAL + synchronous=FULL）
  const fresh = openDatabase(dbPath);
  setUserVersion(fresh, SCHEMA_VERSION);

  // 6. 重置 outline.json 为最小空树（决策 13 修订：顶层 schema_version 同步写入）
  const emptyTree: OutlineFileTree = { id: "root", type: "root", schema_version: SCHEMA_VERSION, children: [] };
  writeOutlineFile(dir, emptyTree);

  const backups = [dbBackup, ...(outlineBackup === null ? [] : [outlineBackup])];
  return {
    db: fresh,
    result: { rebuilt: true, fromVersion: oldVersion, toVersion: SCHEMA_VERSION, backups },
  };
}

/**
 * 备份 data.db 主文件 → `data.db.v{n}.bak`（决策 13：备份带版本号、不覆盖旧备份）。
 *
 * **WAL 一致性取舍**：调用方必须在连接关闭前先执行 `wal_checkpoint(TRUNCATE)`（rebuildProjectStorage
 * 已做）——checkpoint 后主文件即完整快照，只需复制主文件；-wal/-shm 内容已合并进主文件
 * （TRUNCATE 后 -wal 为空文件），不再复制。若库处于 DELETE journal 模式（从未开过 WAL），
 * 主文件本身即全部数据，同样安全。
 *
 * @returns 备份文件绝对路径
 */
export function backupDbFile(dbPath: string, oldVersion: number): string {
  const backupPath = `${dbPath}.v${oldVersion}.bak`;
  copyFileSync(dbPath, backupPath);
  return backupPath;
}

/**
 * 备份 outline.json → `outline.json.v{n}.bak`（决策 13 修订：重建时同步重置并留档）。
 *
 * 取舍：用复制而非 rename——outline.json 不是 SQLite 文件、无 WAL 问题，复制保留原始字节
 * （含格式/顺序）；rename 会把原文件移走，与「随后重置为空树」的流程相斥。
 * outline.json 不存在（异常状态）时跳过备份返回 null——重置仍会执行（写空树）。
 *
 * @returns 备份文件绝对路径；文件不存在返回 null
 */
export function backupOutlineFile(dir: string, oldVersion: number): string | null {
  const src = join(dir, OUTLINE_FILE_NAME);
  if (!existsSync(src)) return null;
  const backupPath = join(dir, `${OUTLINE_FILE_NAME}.v${oldVersion}.bak`);
  copyFileSync(src, backupPath);
  return backupPath;
}
