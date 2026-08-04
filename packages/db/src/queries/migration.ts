// @ai-editor/db schema 演进：删库重建（S1.1）+ 未来版本拒绝（E4）+ 增量迁移（E5）
//
// 单一事实来源：doc/design/decisions.md 决策 13（MVP 删库重建 + E5 增补「v0.1.0 发布终止
// 删库重建」）与修订（2026-08）——
// - 以 data.db 的 PRAGMA user_version 为准判定版本；三态分流：
//   - user_version === SCHEMA_VERSION → 正常打开
//   - user_version > SCHEMA_VERSION（未来版本，E4）→ **拒绝打开**（提示升级程序，
//     不触发任何重建/备份/写操作，数据原封不动）——堵「装新版后回退旧版 → 降级清零」
//   - user_version < SCHEMA_VERSION（旧版本，E5）→ **有迁移路径**（MIGRATIONS 存在
//     从当前版本到目标版本的连续链）→ runMigrations 前向迁移（数据保全，迁移前
//     时间戳快照）；**无迁移路径** → 删库重建兜底（决策 13，备份 v{n}.bak 留档）
// - 重建时同步重置 outline.json（先备份为 outline.json.v{n}.bak，n=旧版本号）、清空回收站
// - 旧 data.db 一并备份为 data.db.v{n}.bak；备份带版本号、不覆盖旧备份（多次重建各自留档）
// - project.json 的 schema_version 仅用于 JSON 结构判断（与 user_version 不同维度），重建不修改 project.json
// - 决策 13 增补（E5）：删库重建策略于 v0.1.0 发布终止——增量迁移机制替代
// 触发语义（doc/api/endpoints.md 第 68-70 行）：open 时检测，重建完成后向客户端提示。

import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { OutlineFileTree } from "@ai-editor/shared";
import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { getUserVersion, SCHEMA_VERSION, setUserVersion } from "../schema.js";
import { OUTLINE_FILE_NAME, writeOutlineFile } from "../storage/outline.js";
import { MIGRATIONS, type Migration } from "../migrations/index.js";

/** data.db 文件名（决策 8：项目根目录，与 server middleware 的常量一致） */
export const DATA_DB_FILE_NAME = "data.db";

/** 删库重建的结果（供上层 open 流程提示客户端，endpoints.md 第 69 行） */
export interface MigrationResult {
  /** 是否发生了删库重建 */
  rebuilt: boolean;
  /** 是否发生了前向迁移（E5：有迁移路径的旧版本经 runMigrations 升级） */
  migrated?: boolean;
  /** 重建/迁移前的旧版本号（rebuilt/migrated 时有值） */
  fromVersion?: number;
  /** 重建/迁移后的版本号（恒等于 SCHEMA_VERSION） */
  toVersion: number;
  /** 重建/迁移产生的备份文件绝对路径（data.db.v{n}.bak / outline.json.v{n}.bak / 迁移快照） */
  backups: string[];
}

/** 重建流程的返回：新连接 + 结果（见 rebuildProjectStorage 注释） */
export interface RebuildOutput {
  /** 重建后的有效连接（旧连接已关闭）；未重建时为原连接 */
  db: Db;
  result: MigrationResult;
}

/**
 * data.db user_version 高于当前程序版本（E4 拒绝打开专用错误）。
 *
 * 语义（release-review §一 风险 2）：用户安装新版程序后回退旧版 → 旧版程序打开高版本库，
 * 若按「不匹配即重建」处理会把用户全部数据重建清零（且备份仅配合旧版本回滚，普通用户
 * 不可自救）。E4 起该分支改为拒绝打开并抛出本错误——**不触发任何重建/备份/写操作**，
 * 数据文件原封不动；上层（server open 路由）捕获后转 409 + 明确提示升级程序。
 *
 * 独立于 import 侧的 SCHEMA_VERSION_MISMATCH（备份导入校验）：本错误是**打开已存在项目**
 * 时发现项目版本高于程序版本；SCHEMA_VERSION_MISMATCH 是导入 zip 备份时版本不匹配。
 */
export class SchemaVersionError extends Error {
  /** 项目 data.db 的实际 user_version（未来版本） */
  readonly version: number;
  /** 当前程序支持的版本 */
  readonly current: number;
  constructor(version: number, current: number) {
    super(`项目 data.db 版本 (${version}) 高于当前程序版本 (${current})，请升级程序后打开`);
    this.name = "SchemaVersionError";
    this.version = version;
    this.current = current;
  }
}

/**
 * schema 版本检测 + 版本对齐的高层入口（open 流程调用，endpoints.md 第 68-70 行）。
 *
 * - user_version 与 SCHEMA_VERSION **匹配**：直接返回，db 为原连接，rebuilt=false。
 * - user_version **> SCHEMA_VERSION（未来版本，E4）**：**拒绝打开**——关闭连接并抛
 *   `SchemaVersionError`（提示升级程序），不触发任何重建/备份/写操作，数据原封不动。
 * - user_version **< SCHEMA_VERSION（旧版本）**：
 *   - **有迁移路径**（opts.migrations 中存在从当前版本到 SCHEMA_VERSION 的连续迁移链，
 *     默认 MIGRATIONS）→ runMigrations 前向迁移（迁移前时间戳快照，数据保全完整）
 *   - **无迁移路径** → rebuildProjectStorage 删库重建兜底（决策 13，E5 迁移机制
 *     覆盖不到的历史版本保留；备份 v{n}.bak 留档）
 *
 * @param opts.migrations 迁移集注入（默认 MIGRATIONS；测试注入假迁移）
 * @throws SchemaVersionError 未来版本拒绝打开（连接已由本函数关闭，无句柄泄漏）
 * @throws 备份/重建/迁移过程中的 I/O 错误；迁移失败时版本停在前一迁移后（快照保留）
 */
export function ensureSchemaCompatible(
  db: Db,
  dir: string,
  dbPath: string,
  opts: { migrations?: readonly Migration[] } = {},
): RebuildOutput {
  const current = getUserVersion(db);
  if (current === SCHEMA_VERSION) {
    return { db, result: { rebuilt: false, toVersion: SCHEMA_VERSION, backups: [] } };
  }
  // E4：未来版本拒绝打开（先关连接防句柄泄漏，再抛错；数据文件零触碰）
  if (current > SCHEMA_VERSION) {
    closeDatabase(db);
    throw new SchemaVersionError(current, SCHEMA_VERSION);
  }
  // E5：旧版本——有迁移路径 → 前向迁移（数据保全）；无迁移路径 → 重建兜底
  if (hasMigrationPath(current, SCHEMA_VERSION, opts.migrations ?? MIGRATIONS)) {
    try {
      const { snapshot } = runMigrations(db, {
        migrations: opts.migrations ?? MIGRATIONS,
        targetVersion: SCHEMA_VERSION,
        dbPath,
      });
      return {
        db,
        result: {
          rebuilt: false,
          migrated: true,
          fromVersion: current,
          toVersion: SCHEMA_VERSION,
          backups: snapshot === null ? [] : [snapshot],
        },
      };
    } catch (err) {
      // ora-3 S2：迁移中途失败 → 关闭本次打开的连接（对比 E4 拒绝分支与重建分支
      // 均关连接；迁移失败语义 = open 未生效，不留句柄）后 rethrow
      closeDatabase(db);
      throw err;
    }
  }
  return rebuildProjectStorage(db, dir, dbPath, current);
}

/**
 * 判定从 fromVersion 到 targetVersion 是否存在**连续迁移链**（E5 纯函数）：
 * (fromVersion, targetVersion] 区间内每个版本号都恰好有迁移条目 → true。
 * 连续性是硬要求——跳版本迁移意味着中间版本的数据形态未经处理，拒绝走迁移路径。
 *
 * @param migrations 迁移集（默认 MIGRATIONS；测试注入）
 */
export function hasMigrationPath(
  fromVersion: number,
  targetVersion: number,
  migrations: readonly Migration[] = MIGRATIONS,
): boolean {
  // from >= target 无迁移需求（相等/未来版本由调用方分支处理），视为「无需求即有路径」
  if (fromVersion >= targetVersion) return true;
  for (let v = fromVersion + 1; v <= targetVersion; v++) {
    if (!migrations.some((m) => m.version === v)) return false;
  }
  return true;
}

/**
 * 前向执行缺失的增量迁移（E5 核心）：
 *
 * 1. **迁移前快照一次**（整批；若提供 dbPath）：checkpoint 后复制 data.db →
 *    `data.db.v{from}.{YYYYMMDDHHmmssZ}.bak`（时间戳命名，不覆盖旧备份）——
 *    失败重试时现场保留（每次调用生成新时间戳快照，旧快照不删）
 * 2. **逐个执行** (fromVersion, targetVersion] 区间内按 version 升序的迁移：
 *    每个迁移一个事务（`db.transaction`）：`up(db)` + `setUserVersion(m.version)`
 *    **原子提交**——「迁移成功 ⇒ 版本已写入；失败 ⇒ 版本未变」；失败时该迁移整体
 *    回滚（含 DDL 与已写数据）、后续迁移不执行、异常向上传播（快照保留供重试）
 *
 * @param opts.dbPath data.db 绝对路径（提供则迁移前快照；缺省跳过快照——纯逻辑调用）
 * @returns 实际执行的迁移（升序）与快照路径（未快照为 null）
 */
export function runMigrations(
  db: Db,
  opts: { migrations?: readonly Migration[]; targetVersion?: number; dbPath?: string } = {},
): { applied: Migration[]; snapshot: string | null } {
  const migrations = (opts.migrations ?? MIGRATIONS).slice().sort((a, b) => a.version - b.version);
  const targetVersion = opts.targetVersion ?? SCHEMA_VERSION;
  const fromVersion = getUserVersion(db);
  const pending = migrations.filter((m) => m.version > fromVersion && m.version <= targetVersion);
  if (pending.length === 0) return { applied: [], snapshot: null };

  // 1. 迁移前快照（整批一次）：checkpoint 把 WAL 合并进主文件（连接打开期间写入的数据
  //    在 WAL 中，直接复制主文件会缺数据）→ 复制带时间戳快照
  let snapshot: string | null = null;
  if (opts.dbPath !== undefined) {
    checkpointWal(db);
    snapshot = snapshotDbFile(opts.dbPath, fromVersion);
  }

  // 2. 逐个执行（每迁移一个事务，up + setUserVersion 原子）
  const applied: Migration[] = [];
  for (const m of pending) {
    db.transaction(() => {
      m.up(db);
      setUserVersion(db, m.version);
    })();
    applied.push(m);
  }
  return { applied, snapshot };
}

/**
 * 迁移前快照 data.db → `data.db.v{n}.{YYYYMMDDHHmmssSSSZ}.bak`（E5）：
 * 复用 rebuild 备份的复制语义（copyFileSync 复制主文件），命名带 UTC 时间戳
 * （含毫秒：20260804T173000.123Z）——同版本多次迁移/重试各自留档，不覆盖。
 * WAL 一致性同 backupDbFile：调用方需先 checkpoint（runMigrations 已做）。
 */
export function snapshotDbFile(dbPath: string, fromVersion: number): string {
  const ts = new Date().toISOString().replace(/[-:]/g, ""); // 20260804T173000.123Z（保留毫秒）
  const backupPath = `${dbPath}.v${fromVersion}.${ts}.bak`;
  copyFileSync(dbPath, backupPath);
  return backupPath;
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
