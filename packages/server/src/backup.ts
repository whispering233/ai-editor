// 自动备份与恢复（B2.2，决策 27）
//
// 单一事实来源：doc/design/decisions.md 决策 27、doc/api/endpoints.md「备份管理」节。
// 职责：
//   - 备份管道：三文件 + wal_checkpoint → .backups/<YYYYMMDD-HHmmss>.zip（复用 E1 打包）
//   - 保留策略：每项目保留最近 MAX_BACKUPS_PER_PROJECT 份，超出删除最旧（含覆盖前快照）
//   - 自动定时器：跟随当前项目生命周期（middleware/project.ts setCurrentProject 挂载启停），
//     有变更才备份（三文件 mtime 与 .backups/ 最新备份时间比较，无状态、服务重启不丢）
//   - 备份包校验（restore 与 import 共用）：zip 解析/白名单/三文件齐全/顶层契约/
//     data.db user_version 三态分流（E4/E5，绝不静默重建）
//   - restore：fileName 白名单 → 覆盖前自动快照 → 校验 → 原子替换三文件
//
// 依赖方向：本模块不依赖 middleware（避免循环依赖——定时器持有所调度项目引用，
// 由 setCurrentProject 显式启停）；仅 import type ProjectContext（类型擦除）。

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { closeSync, fsyncSync, openSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Unzip, UnzipInflate, zipSync } from "fflate";
import { BACKUP_FREQUENCIES, DEFAULT_BACKUP_FREQUENCY_MINUTES, formatBackupFileName, MAX_BACKUPS_PER_PROJECT, parseBackupFileName } from "@whispering233/ai-editor-shared";
import { PROJECT_EXPORT_FILE_NAMES } from "@whispering233/ai-editor-shared/schemas";
import {
  closeDatabase,
  checkpointWal,
  DATA_DB_FILE_NAME,
  ensureSchemaCompatible,
  getUserVersion,
  hasMigrationPath,
  openDatabase,
  OUTLINE_FILE_NAME,
  PROJECT_FILE_NAME,
  readProjectFile,
  SCHEMA_VERSION,
} from "@whispering233/ai-editor-db";
import { HttpError } from "./middleware/error.js";
import type { ProjectContext } from "./middleware/project.js";

/** 备份目录名（决策 27：项目目录内 .backups/，随书籍移动自然携带） */
export const BACKUPS_DIR_NAME = ".backups";

/** 解压总字节预算（200MB，zip 炸弹防御——与 import 同款，restore 复用） */
const MAX_UNZIP_BUDGET = 200 * 1024 * 1024;

/**
 * mtime 变更判定容差（毫秒）：备份管道内 wal_checkpoint 会把 WAL 合并回 data.db 主文件，
 * 其 mtime 刷新到「备份时刻」（毫秒精度），而上次备份时刻来自备份文件名（秒精度截断）——
 * 若用严格 `mtime > lastBackupAt` 判定，checkpoint 后的 data.db mtime 恒晚于文件名秒时间，
 * 每轮 tick 都会误判「有变更」产生自激垃圾备份。加 1s 容差：备份后三文件 mtime 落在
 * [备份时刻秒, 备份时刻秒+1s) 内一律视为「已包含在本次备份中」；最小 tick 5 分钟，
 * 用户变更必然超出容差窗口。
 */
const BACKUP_CHANGE_TOLERANCE_MS = 1000;

/** 备份文件信息（GET /backups 列表项与 POST /backup 响应，endpoints.md） */
export interface BackupFileInfo {
  fileName: string;
  size: number;
  createdAt: string; // ISO 8601，由文件名时间戳解析（决策 27 无状态语义）
}

// ============ 备份管道（复用 E1 打包，避免复制） ============

/**
 * 打包当前项目三文件为 zip（E1 export 同款管道）：
 * wal_checkpoint(TRUNCATE) 把 WAL 合并回主文件（zip 内 data.db 为完整快照，
 * 无需附带 -wal/-shm）→ zipSync 打包（键序稳定：project.json → outline.json → data.db）。
 * 三文件缺失任一 → 抛错（打开的项目三文件必然齐全，缺失即损坏，不导出半成品包）。
 */
export function createBackupZip(project: ProjectContext): Uint8Array<ArrayBuffer> {
  const dir = project.root;
  checkpointWal(project.db);
  return zipSync(
    {
      [PROJECT_FILE_NAME]: readFileSync(join(dir, PROJECT_FILE_NAME)),
      [OUTLINE_FILE_NAME]: readFileSync(join(dir, OUTLINE_FILE_NAME)),
      [DATA_DB_FILE_NAME]: readFileSync(join(dir, DATA_DB_FILE_NAME)),
    },
    { level: 6 },
  );
}

/**
 * 生成不冲突的备份文件名：`<YYYYMMDD-HHmmss>.zip`（shared formatBackupFileName）。
 *
 * 同秒冲突（如「立即备份 + restore 覆盖前快照」连续触发）处理：时间戳 +1 秒循环去重，
 * **保持 <YYYYMMDD-HHmmss>.zip 格式契约**——不追加毫秒/后缀（那会破坏
 * parseBackupFileName 解析与 restore 白名单校验），加 1 秒后文件名仍合法且排序位置正确。
 */
function uniqueBackupFileName(backupsDir: string, date: Date): string {
  let name = formatBackupFileName(date);
  while (existsSync(join(backupsDir, name))) {
    date = new Date(date.getTime() + 1000);
    name = formatBackupFileName(date);
  }
  return name;
}

/**
 * 立即备份当前项目（手动触发 / 自动定时器 / restore 覆盖前快照共用）：
 * 打包 → 写入 .backups/<时间戳>.zip（同秒去重）→ 触发保留策略清理（失败不阻塞）。
 * 写盘失败向上抛（errorHandler → 500 INTERNAL_ERROR，endpoints.md POST /backup 语义）。
 */
export function writeBackup(project: ProjectContext): BackupFileInfo {
  const zip = createBackupZip(project);
  const backupsDir = join(project.root, BACKUPS_DIR_NAME);
  mkdirSync(backupsDir, { recursive: true });
  const fileName = uniqueBackupFileName(backupsDir, new Date());
  writeFileSync(join(backupsDir, fileName), zip); // 失败抛错 → 500（不产出半截备份）
  pruneBackups(backupsDir); // 清理失败仅记日志，不阻塞备份主流程
  return { fileName, size: zip.length, createdAt: toIso(parseBackupFileName(fileName) as Date) };
}

/**
 * 保留策略（决策 27）：每项目保留最近 MAX_BACKUPS_PER_PROJECT 份，超出删除最旧。
 * 排序依据 = 文件名时间戳（可解析的才参与；非法文件名不参与保留判定）。
 * 清理失败不阻塞调用方（记日志即可，决策 27「清理失败不阻塞备份主流程」）。
 */
export function pruneBackups(backupsDir: string): void {
  let files: string[];
  try {
    files = readdirSync(backupsDir);
  } catch {
    return; // 目录不存在 → 无事可做
  }
  const parsed = files
    .map((f) => ({ fileName: f, time: parseBackupFileName(f) }))
    .filter((x): x is { fileName: string; time: Date } => x.time !== null)
    .sort((a, b) => b.time.getTime() - a.time.getTime()); // 最新在前
  for (const extra of parsed.slice(MAX_BACKUPS_PER_PROJECT)) {
    try {
      unlinkSync(join(backupsDir, extra.fileName));
    } catch (err) {
      console.error(`[backup] 清理旧备份失败（跳过，不阻塞）: ${extra.fileName}`, err);
    }
  }
}

/** 备份列表（GET /backups）：时间倒序（最新在前）；.backups/ 不存在 → 空数组（不报错） */
export function listBackups(project: ProjectContext): BackupFileInfo[] {
  const backupsDir = join(project.root, BACKUPS_DIR_NAME);
  let files: string[];
  try {
    files = readdirSync(backupsDir);
  } catch {
    return [];
  }
  return files
    .map((f) => {
      const time = parseBackupFileName(f);
      if (time === null) return null; // 非法文件名（手工放入等）不展示
      try {
        return { fileName: f, size: statSync(join(backupsDir, f)).size, createdAt: toIso(time) };
      } catch {
        return null; // 列表读取瞬间被删（竞态）→ 跳过
      }
    })
    .filter((x): x is BackupFileInfo => x !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // ISO 字符串字典序 = 时间序
}

/** Date → ISO 8601（文件名时间戳解析结果转列表/响应字段） */
function toIso(date: Date): string {
  return date.toISOString();
}

// ============ 备份包校验（restore 与 import 共用，import 校验顺序 3-7 提取） ============

/** 拼接 Uint8Array 分块（Unzip ondata 流累计） */
function concatChunks(chunks: Uint8Array[], totalSize: number): Uint8Array {
  const out = new Uint8Array(totalSize);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * 带预算的 zip 解压（ora-4 zip 炸弹防御，自 E2 import 提取）：
 * fflate Unzip 流式解压（同步 push）——onfile 回调中**只解压白名单条目**（未知条目
 * 仅记名不 start，省预算；白名单检查由调用方用 names 列表执行），ondata 累计解压总字节，
 * 超过预算抛 HttpError 中止。返回 { entries（白名单条目解压结果）, names（全部条目名）}。
 */
function unzipWithBudget(zipData: Uint8Array, budget: number): { entries: Record<string, Uint8Array>; names: string[] } {
  const entries: Record<string, Uint8Array> = {};
  const names: string[] = [];
  let total = 0;
  const unzipper = new Unzip((file) => {
    names.push(file.name);
    if (!(PROJECT_EXPORT_FILE_NAMES as readonly string[]).includes(file.name)) return; // 未知条目不解压
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      size += chunk.length;
      total += chunk.length;
      if (total > budget) {
        throw new HttpError(400, "VALIDATION_ERROR", `备份包解压超出预算（${budget} 字节上限，zip 炸弹防御）`);
      }
      chunks.push(chunk);
      if (final) entries[file.name] = concatChunks(chunks, size);
    };
    file.start();
  });
  // 关键（fflate API 契约）：Unzip 默认仅注册 stored(0) 解码器——deflate(8) 压缩的
  // zip（zipSync 默认）必须显式 register(UnzipInflate)，否则 start() 报 unknown
  // compression type（fflate README 明确要求）
  unzipper.register(UnzipInflate);
  unzipper.push(zipData, true);
  // 防御：无 EOCD/零条目的输入 Unzip 流式**静默返回空**（unzipSync 会抛）——
  // 显式判定坏包（非 zip 内容 → 「不是有效的项目备份包」而非「缺少文件」）
  if (names.length === 0) {
    throw new HttpError(400, "VALIDATION_ERROR", "不是有效的项目备份包（zip 解析失败）");
  }
  return { entries, names };
}

/** project.json 顶层契约最小校验（shared 无文件形态 schema，不扩契约范围） */
function isValidProjectFile(parsed: unknown): parsed is { id: string; name: string; schema_version: number } {
  if (typeof parsed !== "object" || parsed === null) return false;
  const p = parsed as Record<string, unknown>;
  return typeof p.id === "string" && p.id.length > 0 && typeof p.name === "string" && typeof p.schema_version === "number";
}

/** outline.json 顶层契约校验（与 db 包 validateOutlineFile 同构：root 根 + schema_version 数字 + children 数组） */
function isValidOutlineFile(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  const p = parsed as Record<string, unknown>;
  return p.id === "root" && p.type === "root" && typeof p.schema_version === "number" && Array.isArray(p.children);
}

/**
 * 备份包完整校验（自 E2 import 校验顺序 3-7 提取，restore 与 import 共用）：
 *
 * 1. zip 解析（流式 + 解压总字节预算 200MB，zip 炸弹防御；失败 400「不是有效的项目备份包」）
 * 2. 条目白名单（只接受 PROJECT_EXPORT_FILE_NAMES 三文件名，逐名比对天然防 zip 路径穿越）
 * 3. 三文件齐全
 * 4. 临时目录写入 → project.json / outline.json 顶层契约（JSON 损坏 / 契约不符 → 400）
 * 5. data.db 校验（**大小 > 0 → 打开成功 → user_version**）：
 *    - v === SCHEMA_VERSION → 接受（现状）
 *    - v < SCHEMA_VERSION → **有迁移路径** → 接受（open/restore 后自动前向迁移，E5）；
 *      **无迁移路径** → 409（文案标注版本过旧无路径）
 *    - v > SCHEMA_VERSION → 409（E4 语义：备份来自更高版本程序）
 *    拒绝均不静默重建——恢复备份须明示版本不兼容。
 *
 * 校验在 mkdtemp 临时目录完成（finally 清理，无论成败）；通过后返回解压内容与
 * project_id（调用方负责搬入/替换）。**校验通过前不触碰目标项目任何数据**（零触碰）。
 *
 * @throws HttpError 400（坏包/缺文件/未知条目/契约不符）/ 409 SCHEMA_VERSION_MISMATCH
 */
export function validateBackupPackage(zipData: Uint8Array): { entries: Record<string, Uint8Array>; projectId: string } {
  // 1/2. 解压 + 白名单（严格拒绝）：只接受三数据文件名
  let entries: Record<string, Uint8Array>;
  let entryNames: string[];
  try {
    const result = unzipWithBudget(zipData, MAX_UNZIP_BUDGET);
    entries = result.entries;
    entryNames = result.names;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "VALIDATION_ERROR", "不是有效的项目备份包（zip 解析失败）");
  }
  const unknown = entryNames.filter((k) => !(PROJECT_EXPORT_FILE_NAMES as readonly string[]).includes(k));
  if (unknown.length > 0) {
    throw new HttpError(400, "VALIDATION_ERROR", `备份包含未知条目: ${unknown.join(", ")}（只接受 ${PROJECT_EXPORT_FILE_NAMES.join("/")}）`);
  }
  const missing = PROJECT_EXPORT_FILE_NAMES.filter((f) => !(f in entries));
  if (missing.length > 0) {
    throw new HttpError(400, "VALIDATION_ERROR", `备份包缺少文件: ${missing.join(", ")}（非完整项目备份）`);
  }

  // 3-5. 临时目录校验（全部通过才算有效；finally 清理）
  const tmpDir = mkdtempSync(join(tmpdir(), "ai-editor-restore-"));
  try {
    for (const f of PROJECT_EXPORT_FILE_NAMES) {
      writeFileSync(join(tmpDir, f), entries[f]);
    }

    // project.json 顶层契约（JSON 可解析 + id/name/schema_version）
    let projectConfig: unknown;
    try {
      projectConfig = JSON.parse(readFileSync(join(tmpDir, PROJECT_FILE_NAME), "utf8"));
    } catch {
      throw new HttpError(400, "VALIDATION_ERROR", "备份包内 project.json 不是合法 JSON");
    }
    if (!isValidProjectFile(projectConfig)) {
      throw new HttpError(400, "VALIDATION_ERROR", "备份包内 project.json 顶层契约不符（需 id/name/schema_version）");
    }

    // outline.json 顶层契约（{id:"root",type:"root",schema_version,children[]}）
    try {
      const outline = JSON.parse(readFileSync(join(tmpDir, OUTLINE_FILE_NAME), "utf8"));
      if (!isValidOutlineFile(outline)) {
        throw new HttpError(400, "VALIDATION_ERROR", "备份包内 outline.json 顶层契约不符（需 {id:root,type:root,schema_version,children[]}）");
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, "VALIDATION_ERROR", "备份包内 outline.json 不是合法 JSON");
    }

    // data.db 校验顺序（ora-4）：**文件大小 > 0 → 打开成功 → user_version**——
    // 0 字节文件 SQLite 会当新库打开（user_version=0），必须先按坏包拒绝（400 而非 409）；
    // 非 SQLite 内容打开失败 → 400 坏包。
    // user_version 判定（E5 决议，tasks.md E5 卡规格追加句）：
    //   v === SCHEMA_VERSION → 接受（现状）
    //   v < SCHEMA_VERSION → **有迁移路径**（MIGRATIONS 存在连续链，替换后 open 时自动前向
    //     迁移，数据保全完整）→ 接受；**无迁移路径** → 409（文案标注版本过旧无路径）
    //   v > SCHEMA_VERSION → 409（E4 语义：备份来自更高版本程序）
    const dbPath = join(tmpDir, DATA_DB_FILE_NAME);
    if (statSync(dbPath).size === 0) {
      throw new HttpError(400, "VALIDATION_ERROR", "备份包内 data.db 为空文件（损坏包）");
    }
    let db: ReturnType<typeof openDatabase> | null = null;
    try {
      db = openDatabase(dbPath);
      const v = getUserVersion(db);
      const acceptable = v === SCHEMA_VERSION || (v < SCHEMA_VERSION && hasMigrationPath(v, SCHEMA_VERSION));
      if (!acceptable) {
        const hint = v > SCHEMA_VERSION ? "备份来自更高版本程序" : "备份来自旧版本程序且无可用迁移路径";
        throw new HttpError(
          409,
          "SCHEMA_VERSION_MISMATCH",
          `备份包 data.db 版本 (${v}) ${hint}（当前程序 ${SCHEMA_VERSION}），暂不支持导入或恢复`,
        );
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, "VALIDATION_ERROR", "备份包内 data.db 不是有效的 SQLite 数据库");
    } finally {
      if (db !== null) closeDatabase(db);
    }

    return { entries, projectId: projectConfig.id };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ============ 自动定时器（决策 27：有变更才备份，跟随项目生命周期） ============

/** 备份频率读侧语义（与 shared 读映射一致 + B2.1 疑问裁决 2）：缺失 → 缺省 10；null/0/非枚举 → 关闭（null） */
function resolveBackupFrequency(value: number | null | undefined): number | null {
  if (value === undefined) return DEFAULT_BACKUP_FREQUENCY_MINUTES;
  if (value === null || value === 0) return null;
  return (BACKUP_FREQUENCIES as readonly number[]).includes(value) ? value : null;
}

/** .backups/ 中最新备份时间（文件名时间戳最大值）；目录不存在/无合法备份 → null */
function latestBackupTime(backupsDir: string): Date | null {
  let files: string[];
  try {
    files = readdirSync(backupsDir);
  } catch {
    return null;
  }
  let latest: Date | null = null;
  for (const f of files) {
    const t = parseBackupFileName(f);
    if (t !== null && (latest === null || t.getTime() > latest.getTime())) latest = t;
  }
  return latest;
}

/**
 * 三文件是否在 since 之后有变更（决策 27「任一 mtime 晚于上次备份时刻」）：
 * 任一文件 mtime > since + 容差 → 有变更；文件缺失 → 视为有变更（防御：不静默跳过，
 * 让备份管道报错暴露损坏）；mtime 判定见 BACKUP_CHANGE_TOLERANCE_MS 注释。
 */
function hasFileChangesSince(project: ProjectContext, since: Date): boolean {
  const limit = since.getTime() + BACKUP_CHANGE_TOLERANCE_MS;
  for (const name of [PROJECT_FILE_NAME, OUTLINE_FILE_NAME, DATA_DB_FILE_NAME]) {
    try {
      if (statSync(join(project.root, name)).mtimeMs > limit) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * 自动备份单次检查（定时器 tick 核心，纯同步、可单测）：
 *
 * 1. 频率判定：关闭（null/0/非枚举）→ 直接返回 false（决策 27：null/0 = 关闭；
 *    B2.1 疑问裁决 2：读侧非枚举值按关闭处理，不开启自动备份）
 * 2. 变更判定：`.backups/` 为空（无上次备份时刻）→ 需要备份；否则三文件 mtime
 *    均早于「上次备份时刻 + 容差」→ 跳过（无变更不产生垃圾备份，决策 27）
 * 3. 有变更 → writeBackup（含保留策略清理）
 *
 * @returns 本次是否生成了备份
 */
export function maybeAutoBackup(project: ProjectContext): boolean {
  if (resolveBackupFrequency(project.config.backup_frequency_minutes) === null) return false;
  const backupsDir = join(project.root, BACKUPS_DIR_NAME);
  const lastBackupAt = latestBackupTime(backupsDir);
  if (lastBackupAt !== null && !hasFileChangesSince(project, lastBackupAt)) return false;
  writeBackup(project);
  return true;
}

// ============ 定时器调度（跟随当前项目生命周期，middleware setCurrentProject 挂载） ============

/** 当前排程的定时器句柄（null = 未排程/已停止） */
let backupTimer: ReturnType<typeof setTimeout> | null = null;
/** 定时器当前服务的项目（stop 时清空；restore 替换 config/db 后同一引用仍有效） */
let scheduledProject: ProjectContext | null = null;

/**
 * 启动/重启自动备份调度（open/切换项目时调用；restore 后频率可能变化也调用）：
 * 按当前项目频率 setTimeout 链——每 tick 检查「有变更才备份」后按最新频率重新排程
 * （tick 内重读 config，restore 改变频率无需显式通知）。
 * 频率关闭（null/0/非枚举）→ 不排程（等价停止）。
 */
export function startAutoBackup(project: ProjectContext): void {
  stopAutoBackup();
  scheduledProject = project;
  scheduleNext(project);
}

/** 停止自动备份调度（close 项目/服务关闭时调用；幂等） */
export function stopAutoBackup(): void {
  if (backupTimer !== null) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }
  scheduledProject = null;
}

/** 按项目当前频率排程下一次检查；频率关闭 → 不排程 */
function scheduleNext(project: ProjectContext): void {
  const freq = resolveBackupFrequency(project.config.backup_frequency_minutes);
  if (freq === null) return;
  backupTimer = setTimeout(() => {
    backupTimer = null;
    try {
      maybeAutoBackup(project); // 单次检查失败（如 I/O 错）不中断调度，记日志继续
    } catch (err) {
      console.error("[backup] 自动备份检查失败:", err);
    }
    scheduleNext(project); // 每次 tick 重读频率（restore/切换可能改变）
  }, freq * 60_000);
  // unref：定时器不阻止进程退出（测试/服务关闭后无残留句柄）
  (backupTimer as { unref?: () => void }).unref?.();
}

/** 当前被定时器服务的项目（测试用；null = 未排程） */
export function getScheduledProject(): ProjectContext | null {
  return scheduledProject;
}

// ============ 恢复（restore：白名单 → 快照 → 校验 → 原子替换） ============

// ============ 覆盖恢复共享管道（restore / import 覆盖 / 新书导入共用，B2.3 提取） ============

/**
 * 用备份包内容替换目录三文件（restore 与 import 分流共用，B2.3 提取）：
 *
 * - project.json：JSON 解析后按 opts 覆盖——`keepId`（决策 27：覆盖恢复以 project_id 为
 *   唯一 key，换 id 即断连 chat_messages 会话历史——决策 18；备份包可能来自异项目，
 *   防御性强制保留）与 `name`（「目录名 = 书名」不变式：import 覆盖归一为目录名、
 *   新书导入同步为去重名）；其余字段随备份替换。序列化走 2 空格缩进 + 尾换行
 *   （与 db 包 writeJsonAtomic 同款格式惯例）
 * - outline.json / data.db：原样字节原子写
 *
 * 注意：本函数只管文件层，不含 data.db 连接管理（重连见 overwriteProjectFiles）。
 */
export function writeProjectFilesFromBackup(
  dir: string,
  entries: Record<string, Uint8Array>,
  opts: { keepId?: string; name?: string } = {},
): void {
  const parsedProject = JSON.parse(new TextDecoder().decode(entries[PROJECT_FILE_NAME])) as Record<string, unknown>;
  const nextProject = {
    ...parsedProject,
    ...(opts.keepId !== undefined ? { id: opts.keepId } : {}),
    ...(opts.name !== undefined ? { name: opts.name } : {}),
  };
  // 顺序：JSON 两文件在前，data.db 最后——db 替换失败时其余已替换（校验已通过，
  // 文件内容本身有效，部分替换可经重新恢复修复）
  writeFileAtomic(join(dir, PROJECT_FILE_NAME), new TextEncoder().encode(`${JSON.stringify(nextProject, null, 2)}\n`));
  writeFileAtomic(join(dir, OUTLINE_FILE_NAME), entries[OUTLINE_FILE_NAME]);
  writeFileAtomic(join(dir, DATA_DB_FILE_NAME), entries[DATA_DB_FILE_NAME]);
}

/**
 * 覆盖管道（restore 与 import 覆盖当前打开的书共用，B2.3 从 restoreBackup 提取）：
 *
 * 1. 释放当前 data.db 连接（替换 data.db 前必须；顺带清理陈旧 WAL/SHM 残留——
 *    替换后新库不得复用旧 WAL）
 * 2. writeProjectFilesFromBackup 原子替换三文件（保留当前项目 id；opts.name 归一）
 * 3. 重连 + 版本对齐（v < 当前且有迁移路径 → 前向迁移，E5；v === 当前 → 原样。
 *    校验阶段已拒绝 v > 当前与无路径旧版，此处不会触发重建/拒绝）
 * 4. 同步内存 config（刚原子写入，readProjectFile 必非 null；损坏抛错由 catch 恢复连接）
 * 5. 重启定时器（备份包内频率可能不同：5 → 60 等）
 *
 * 调用方职责：覆盖前自动快照 + 备份包校验（validateBackupPackage）。
 * 失败时尝试恢复连接（原库可能未被替换或已替换为校验过的有效库），保证后续请求
 * 不因悬挂连接报 500「connection not open」；恢复失败由路由清空 currentProject 单例。
 */
export function overwriteProjectFiles(
  project: ProjectContext,
  entries: Record<string, Uint8Array>,
  opts: { name?: string } = {},
): void {
  const dbPath = join(project.root, DATA_DB_FILE_NAME);
  closeDatabase(project.db); // 释放当前连接（替换 data.db 前必须；替换失败恢复见 catch）
  try {
    // 清理陈旧 WAL/SHM 残留（正常关闭通常已清理；防御：替换后新库不得复用旧 WAL）
    for (const suffix of ["-wal", "-shm"]) {
      try {
        unlinkSync(`${dbPath}${suffix}`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    writeProjectFilesFromBackup(project.root, entries, { keepId: project.config.id, ...(opts.name !== undefined ? { name: opts.name } : {}) });
    // 重连 + 版本对齐
    let active = openDatabase(dbPath);
    const out = ensureSchemaCompatible(active, project.root, dbPath);
    active = out.db;
    project.db = active;
    // 同步内存 config（覆盖后的 project.json——含 name/prompt/backup_frequency_minutes 等）
    const restoredConfig = readProjectFile(project.root);
    if (restoredConfig === null) {
      throw new HttpError(500, "INTERNAL_ERROR", "覆盖后 project.json 读取失败");
    }
    project.config = restoredConfig;
  } catch (err) {
    // 替换/重连失败：尝试恢复连接（原库可能未被替换或已替换为校验过的有效库），
    // 保证后续请求不因悬挂连接报 500「connection not open」；恢复失败则清空单例
    try {
      project.db = openDatabase(dbPath);
    } catch {
      // 恢复失败：由调用方（路由）清空 currentProject 单例，后续请求 409 NO_PROJECT_OPEN
    }
    throw err;
  }
  startAutoBackup(project); // 重启定时器（覆盖包内频率可能不同）
}

/**
 * 为**未打开的书**生成覆盖前快照（import 覆盖书架其他书场景，决策 27「覆盖前自动快照」）：
 * 临时打开 data.db 连接走备份管道（wal_checkpoint 保证快照完整性），完成后关闭连接。
 * 已打开的书走 writeBackup(project)（复用现有连接，见 import 路由分流）。
 */
export function snapshotBookDir(dir: string): BackupFileInfo {
  const config = readProjectFile(dir);
  if (config === null) {
    throw new HttpError(500, "INTERNAL_ERROR", `目录不是项目（缺 project.json）: ${dir}`);
  }
  const db = openDatabase(join(dir, DATA_DB_FILE_NAME));
  try {
    return writeBackup({ root: dir, config, db });
  } finally {
    closeDatabase(db);
  }
}

/**
 * 原子写任意字节（决策 11 同款流程：写同目录临时文件 → fsync → rename 覆盖；
 * 供 restore/import 替换三文件用——JSON 版见 db 包 writeJsonAtomic，此处为通用 bytes 版）。
 * 失败保留临时文件供排查，原文件未被触碰。
 */
function writeFileAtomic(filePath: string, data: Uint8Array): void {
  const tmpPath = join(dirname(filePath), `.${basename(filePath)}.restore-tmp`);
  let fd: number | undefined;
  try {
    // 清理上次崩溃可能残留的临时文件（ENOENT 忽略），再独占创建——杜绝并发/残留覆盖
    try {
      unlinkSync(tmpPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    fd = openSync(tmpPath, "wx", 0o644);
    writeFileSync(fd, data);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmpPath, filePath); // 原子覆盖
  } catch (err) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // 忽略关闭失败，原始异常优先
      }
    }
    throw err;
  }
}

/**
 * 从备份恢复当前项目（POST /project/backup/restore，决策 27）：
 *
 * 1. fileName 白名单校验：仅允许 `.backups/` 下 `<YYYYMMDD-HHmmss>.zip` 格式
 *    （shared parseBackupFileName，^$ 锚定天然拒绝路径分隔符/`..`，防路径穿越）；
 *    格式合法但文件不存在 → 404
 * 2. **覆盖前自动快照**：当前三文件打包为快照存入 .backups/（复用备份管道，
 *    就是普通备份文件，自然参与保留策略——后悔药，决策 27）
 * 3. 备份包校验（validateBackupPackage：zip/白名单/契约/user_version 三态，
 *    E4/E5 语义，拒绝时数据零触碰——校验通过前不触碰任何数据文件）
 * 4. **原子替换**：closeDatabase（释放当前连接）→ 三文件逐文件原子写
 *    （临时文件 + rename；data.db 顺带清理 -wal/-shm 残留）→ 重新 openDatabase
 *    + ensureSchemaCompatible（校验阶段已保证 v ≤ 当前且有迁移路径或匹配——
 *    v < 有路径时此处前向迁移，E5）→ project.config 同步新 project.json
 * 5. 项目 id 保留（当前项目引用不变，决策 27）；重启定时器（频率可能随备份变化）
 *
  * @throws HttpError 400（文件名非法/坏包）、404（备份不存在）、409 SCHEMA_VERSION_MISMATCH
  */
export function restoreBackup(project: ProjectContext, fileName: string): { snapshot: Pick<BackupFileInfo, "fileName" | "createdAt"> } {
  // 1. 白名单校验（parseBackupFileName 全格式校验，防路径穿越）
  if (parseBackupFileName(fileName) === null) {
    throw new HttpError(400, "VALIDATION_ERROR", `备份文件名格式非法（仅接受 <YYYYMMDD-HHmmss>.zip）: ${fileName}`);
  }
  const backupPath = join(project.root, BACKUPS_DIR_NAME, fileName);
  if (!existsSync(backupPath)) {
    throw new HttpError(404, "VALIDATION_ERROR", `备份不存在: ${fileName}`);
  }

  // 2. 覆盖前自动快照（复用备份管道；误操作/选错备份永远有后悔药）
  const snapshot = writeBackup(project);

  // 3. 备份包校验（零触碰：通过前不写任何数据文件）
  const zip = readFileSync(backupPath);
  const { entries } = validateBackupPackage(zip);

  // 4. 覆盖管道（B2.3 提取，import 覆盖复用）：原子替换三文件（保留当前 id）+
  //    重连 data.db + 同步 config + 重启定时器
  overwriteProjectFiles(project, entries);

  // 契约（endpoints.md）：snapshot 仅含 fileName/createdAt（size 属内部信息不暴露）
  return { snapshot: { fileName: snapshot.fileName, createdAt: snapshot.createdAt } };
}
