// 自动备份与恢复（B2.2 决策 27 + B2.5 决策 28 + B2.6 决策 29）
//
// 单一事实来源：doc/design/decisions.md 决策 27/28/29、doc/api/endpoints.md「备份管理」节。
// 职责：
//   - 备份管道：三文件 + wal_checkpoint → .backups/<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip
//     （复用 E1 打包；决策 28 毫秒精度；决策 29 kind 段：手动备份落 -m[-<名称>]、
//     自动备份/覆盖前快照纯时间戳、重命名后自动备份落 -a-<名称>）
//   - 保留策略：每项目保留最近 MAX_BACKUPS_PER_PROJECT 份，超出删除最旧（含覆盖前快照；
//     新旧格式文件名均参与——parseBackupFileName 兼容解析）
//   - 自动定时器：跟随当前项目生命周期（middleware/project.ts setCurrentProject 挂载启停），
//     有变更才备份（三文件 mtime 与 .backups/ 最新备份时间比较，无状态、服务重启不丢）
//   - 备份包校验（restore 与 import 共用）：zip 解析/白名单/三文件齐全/顶层契约/
//     data.db user_version 三态分流（E4/E5，绝不静默重建）
//   - restore：fileName 白名单 → 覆盖前自动快照 → 校验 → 原子替换三文件
//   - rename：只改名称段（时间戳与 kind 保持，决策 29）
//
// 依赖方向：本模块不依赖 middleware（避免循环依赖——定时器持有所调度项目引用，
// 由 setCurrentProject 显式启停）；仅 import type ProjectContext（类型擦除）。

import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Unzip, UnzipInflate, zipSync } from "fflate";
import { BACKUP_FREQUENCIES, DEFAULT_BACKUP_FREQUENCY_MINUTES, formatBackupFileName, MAX_BACKUPS_PER_PROJECT, MAX_BACKUP_NAME_LENGTH, parseBackupFileName, sanitizeBackupName, type BackupKind } from "@whispering233/ai-editor-shared";
import { PROJECT_EXPORT_FILE_NAMES } from "@whispering233/ai-editor-shared/schemas";
import {
  closeDatabase,
  checkpointWal,
  DATA_DB_FILE_NAME,
  ensureSchemaCompatible,
  getUserVersion,
  hasMigrationPath,
  migrateChatMessagesProject,
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
 * 其 mtime 刷新到「备份时刻」（毫秒精度）。决策 28 起文件名时间戳为毫秒精度，
 * 文件名截断误差已消除——但容差**保留 1s**：粗粒度 mtime 文件系统（如 FAT/exFAT 2s 粒度）
 * 下，严格 `mtime > lastBackupAt` 仍可能误判，1s 容差是必要防御；最小 tick 5 分钟，
 * 用户变更必然超出容差窗口。
 */
const BACKUP_CHANGE_TOLERANCE_MS = 1000;

/** 备份文件信息（GET /backups 列表项与 POST /backup 响应，endpoints.md） */
export interface BackupFileInfo {
  fileName: string;
  size: number;
  createdAt: string; // ISO 8601，由文件名时间戳解析（决策 27 无状态语义）
  /** 备份类型（决策 29，由文件名 kind 段解析：auto = 自动/manual = 手动） */
  kind: BackupKind;
  /** 手动备份自定义名称（决策 28；由文件名解析，自动备份/快照/旧备份无此字段） */
  name?: string;
}

/**
 * 备份文件名白名单校验（renameBackup / restoreBackup 共用，防路径穿越）：
 * parseBackupFileName 全格式校验（时间戳部分 ^$ 锚定纯数字 + 名称部分拒绝 /\\，
 * 天然防路径分隔符与 `..` 穿越；含旧格式兼容解析）；非法 → 400 VALIDATION_ERROR（文案统一）。
 *
 * @returns 解析结果（校验通过即返回非 null——调用方直接取 time/kind/name，免二次解析）
 * @throws HttpError 400 VALIDATION_ERROR（文件名格式非法）
 */
function assertBackupFileNameFormat(fileName: string): NonNullable<ReturnType<typeof parseBackupFileName>> {
  const parsed = parseBackupFileName(fileName);
  if (parsed === null) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `备份文件名格式非法（仅接受 <YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip 时间戳格式）: ${fileName}`,
    );
  }
  return parsed;
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
 * 生成不冲突的备份文件名：`<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip`（决策 28 毫秒精度 +
 * 决策 29 kind 段；shared formatBackupFileName；kind 缺省 auto——纯时间戳；带自定义名称 →
 * `-a-<名称>`（auto）/ `-m-<名称>`（manual））。
 *
 * 同毫秒冲突（如「立即备份 + restore 覆盖前快照」连续触发，理论罕见）处理：
 * 时间戳 +1 毫秒循环去重，**保持 <YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip 格式契约**——
 * parseBackupFileName 解析与 restore 白名单校验不受影响。
 *
 * @returns { fileName, date }——date 为最终去重后的时间戳（与 fileName 时间戳段一致，
 *   调用方直接用于构造 createdAt，免 parse 回读）
 */
function uniqueBackupFileName(
  backupsDir: string,
  date: Date,
  opts?: { kind?: BackupKind; name?: string },
): { fileName: string; date: Date } {
  const kind = opts?.kind ?? "auto";
  const name = opts?.name;
  let fileName = formatBackupFileName(date, { kind, name });
  while (existsSync(join(backupsDir, fileName))) {
    date = new Date(date.getTime() + 1);
    fileName = formatBackupFileName(date, { kind, name });
  }
  return { fileName, date };
}

/**
 * 立即备份当前项目（手动触发 / 自动定时器 / restore 覆盖前快照共用）：
 * 打包 → 写入 .backups/<时间戳>[-<kind>][-<名称>].zip（毫秒精度；同毫秒 +1ms 去重）→
 * 触发保留策略清理（失败不阻塞）。
 * 写盘失败向上抛（errorHandler → 500 INTERNAL_ERROR，endpoints.md POST /backup 语义）。
 *
 * @param opts.kind 备份类型（决策 29，缺省 "auto"）：手动触发传 "manual"（文件名落 -m 段）；
 *   自动备份/覆盖前快照不传（auto，纯时间戳）
 * @param opts.name 手动备份自定义名称（决策 28，仅带名称的手动/重命名场景传入）：
 *   sanitizeBackupName 是名称校验/规范化**唯一执行点**——非法（含路径分隔符/超长/纯点）→
 *   400 VALIDATION_ERROR；自动备份/覆盖前快照不传 name，文件名保持纯时间戳。
 *   注意：name 仅在 opts.name !== undefined 且 sanitize 通过后传入 formatBackupFileName。
 */
export function writeBackup(project: ProjectContext, opts?: { name?: string; kind?: BackupKind }): BackupFileInfo {
  const kind = opts?.kind ?? "auto";
  let name: string | undefined;
  if (opts?.name !== undefined) {
    const sanitized = sanitizeBackupName(opts.name);
    if (sanitized === null) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        `备份名称非法（trim 后 1-${MAX_BACKUP_NAME_LENGTH} 字符，禁路径分隔符/保留字符/控制字符/纯点）`,
      );
    }
    name = sanitized;
  }
  const zip = createBackupZip(project);
  const backupsDir = join(project.root, BACKUPS_DIR_NAME);
  mkdirSync(backupsDir, { recursive: true });
  const { fileName, date } = uniqueBackupFileName(backupsDir, new Date(), { kind, name });
  writeFileSync(join(backupsDir, fileName), zip); // 失败抛错 → 500（不产出半截备份）
  pruneBackups(backupsDir); // 清理失败仅记日志，不阻塞备份主流程
  return {
    fileName,
    size: zip.length,
    createdAt: toIso(date), // date = 最终去重后的时间戳，与 fileName 时间戳段一致（决策 27 无状态语义）
    kind,
    ...(name !== undefined ? { name } : {}),
  };
}

/**
 * 重命名备份（POST /project/backup/rename，决策 29）：**只改名称段**，时间戳与 kind 保持。
 *
 * 契约：
 * 1. fileName 白名单校验：仅接受 parseBackupFileName 可解析的时间戳格式
 *    `<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip`（含旧格式兼容，^$ 锚定 + 名称部分拒绝 /\\，
 *    天然防路径分隔符与 `..` 穿越）→ 非法 400 VALIDATION_ERROR
 * 2. 文件不存在 → 404 VALIDATION_ERROR
 * 3. 新名称解析（决策 29）：请求未传 name → 清除名称段；传空串/纯空白 → 清除名称段；
 *    非空 → sanitizeBackupName 规范化（非法 → 400 VALIDATION_ERROR，文案同 writeBackup）
 * 4. 新文件名 = formatBackupFileName(parsed.time, { kind: parsed.kind, name: 新名称 })——
 *    kind 不随重命名改变（auto 重命名后仍落 -a- 段、manual 仍落 -m- 段）
 * 5. 幂等：新文件名 === 原文件名（如重命名为相同名称）→ 不移动文件，直接返回当前条目
 *    （重新 stat 取 size；stat 失败 → 404「备份不存在」）
 * 6. **目标冲突防御（oracle P1-1，决策 29）**：新文件名已存在（≠ 原文件）→ 409
 *    BACKUP_TARGET_EXISTS——POSIX rename 目标存在时静默替换，可达路径：旧秒级改名后毫秒补
 *    000 撞上毫秒为 0 的自动备份、同毫秒双 manual（T-m.zip + T-m-X.zip）清名覆盖；显式拒绝
 * 7. renameSync 同目录原子改名（失败向上抛 → 500）；改名后统一 stat 取 size
 *    （改名瞬间被删等竞态 → 404「备份不存在」）
 *
 * @throws HttpError 400（文件名非法/名称非法）、404（备份不存在）、409 BACKUP_TARGET_EXISTS
 */
export function renameBackup(project: ProjectContext, fileName: string, name?: string): BackupFileInfo {
  // 1. 白名单校验（assertBackupFileNameFormat：parseBackupFileName 全格式校验，防路径穿越；
  //    非法 → 400；返回解析结果直接取 time/kind）
  const parsed = assertBackupFileNameFormat(fileName);
  const backupsDir = join(project.root, BACKUPS_DIR_NAME);
  if (!existsSync(join(backupsDir, fileName))) {
    throw new HttpError(404, "VALIDATION_ERROR", `备份不存在: ${fileName}`);
  }

  // 2. 新名称解析：请求未传 name → 清除名称；传空串/纯空白 → 清除名称（sanitize null 且 trim 空）；
  //    非空 → sanitize 规范化（null 且 trim 非空 → 400，文案同 writeBackup）
  let nextName: string | undefined;
  if (name !== undefined) {
    const sanitized = sanitizeBackupName(name);
    if (sanitized === null && name.trim() !== "") {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        `备份名称非法（trim 后 1-${MAX_BACKUP_NAME_LENGTH} 字符，禁路径分隔符/保留字符/控制字符/纯点）`,
      );
    }
    if (sanitized !== null) nextName = sanitized;
  }

  // 3. 新文件名（时间戳与 kind 保持原备份——kind 不随重命名改变，决策 29）
  const newFileName = formatBackupFileName(parsed.time, { kind: parsed.kind, name: nextName });

  // 4. 幂等：名称未变 → 不移动文件，返回当前条目（重新 stat 取 size；读不到 → 404）
  if (newFileName === fileName) {
    try {
      return {
        fileName,
        size: statSync(join(backupsDir, fileName)).size,
        createdAt: toIso(parsed.time),
        kind: parsed.kind,
        ...(nextName !== undefined ? { name: nextName } : {}),
      };
    } catch {
      throw new HttpError(404, "VALIDATION_ERROR", `备份不存在: ${fileName}`);
    }
  }

  // 5. 目标冲突防御（oracle P1-1，决策 29）：POSIX rename 目标存在时静默替换（数据丢失风险）——
  //    可达路径：旧秒级改名后毫秒补 000 撞上毫秒为 0 的自动备份、同毫秒双 manual 清名覆盖等；
  //    显式 409 拒绝。幂等分支（target === fileName）已在第 4 步提前返回，此处必然 target ≠ fileName。
  if (existsSync(join(backupsDir, newFileName))) {
    throw new HttpError(409, "BACKUP_TARGET_EXISTS", `目标备份文件名已存在: ${newFileName}`);
  }

  // 6. 同目录原子改名（失败向上抛 → 500 INTERNAL_ERROR）
  renameSync(join(backupsDir, fileName), join(backupsDir, newFileName));

  // 7. 改名后统一 stat 取 size（改名瞬间文件被删等竞态 → 404「备份不存在」）
  let size: number;
  try {
    size = statSync(join(backupsDir, newFileName)).size;
  } catch {
    throw new HttpError(404, "VALIDATION_ERROR", `备份不存在: ${fileName}`);
  }
  return {
    fileName: newFileName,
    size,
    createdAt: toIso(parsed.time),
    kind: parsed.kind,
    ...(nextName !== undefined ? { name: nextName } : {}),
  };
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
    .map((f) => {
      const p = parseBackupFileName(f);
      return p === null ? null : { fileName: f, time: p.time };
    })
    .filter((x): x is { fileName: string; time: Date } => x !== null)
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
      const parsed = parseBackupFileName(f);
      if (parsed === null) return null; // 非法文件名（手工放入等）不展示
      try {
        return {
          fileName: f,
          size: statSync(join(backupsDir, f)).size,
          createdAt: toIso(parsed.time),
          kind: parsed.kind,
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        };
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
    const p = parseBackupFileName(f);
    if (p !== null && (latest === null || p.time.getTime() > latest.getTime())) latest = p.time;
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

/**
 * 启动/重启自动备份调度（open/切换项目时调用；restore 后频率可能变化也调用）：
 * 按当前项目频率 setTimeout 链——每 tick 检查「有变更才备份」后按最新频率重新排程
 * （tick 内重读 config，restore 改变频率无需显式通知）。
 * 频率关闭（null/0/非枚举）→ 不排程（等价停止）。
 */
export function startAutoBackup(project: ProjectContext): void {
  stopAutoBackup();
  scheduleNext(project);
}

/** 停止自动备份调度（close 项目/服务关闭时调用；幂等） */
export function stopAutoBackup(): void {
  if (backupTimer !== null) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }
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
  opts: { keepId?: string; name?: string; snapshotFileName?: string } = {},
): void {
  // 替换顺序：JSON 两文件在前，data.db 最后——db 替换失败时其余已替换（校验已通过，
  // 文件内容本身有效，部分替换可经重新恢复修复）；replaced 清单供失败日志使用（P1-2）
  const targetNames = [PROJECT_FILE_NAME, OUTLINE_FILE_NAME, DATA_DB_FILE_NAME];
  const replaced: string[] = [];
  try {
    const parsedProject = JSON.parse(new TextDecoder().decode(entries[PROJECT_FILE_NAME])) as Record<string, unknown>;
    const nextProject = {
      ...parsedProject,
      ...(opts.keepId !== undefined ? { id: opts.keepId } : {}),
      ...(opts.name !== undefined ? { name: opts.name } : {}),
    };
    writeFileAtomic(join(dir, PROJECT_FILE_NAME), new TextEncoder().encode(`${JSON.stringify(nextProject, null, 2)}\n`));
    replaced.push(PROJECT_FILE_NAME);
    writeFileAtomic(join(dir, OUTLINE_FILE_NAME), entries[OUTLINE_FILE_NAME]);
    replaced.push(OUTLINE_FILE_NAME);
    writeFileAtomic(join(dir, DATA_DB_FILE_NAME), entries[DATA_DB_FILE_NAME]);
    replaced.push(DATA_DB_FILE_NAME);
  } catch (err) {
    // P1-2：失败路径日志（对齐「记日志暴露部分替换」承诺）——已替换/未替换文件清单 + 覆盖前快照名
    const notReplaced = targetNames.filter((n) => !replaced.includes(n));
    console.error(
      `[backup] 覆盖文件替换失败（已替换: ${replaced.join(", ") || "无"}；未替换: ${notReplaced.join(", ") || "无"}${
        opts.snapshotFileName !== undefined ? `；覆盖前快照: ${opts.snapshotFileName}` : ""
      }）`,
      err,
    );
    throw err;
  }
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
  * 不因悬挂连接报 500「connection not open」；**重连失败时连接悬挂**——由路由层
  * （restore/import）在 catch 后检查 project.db.open 清空 currentProject 单例
  * （backup 模块不依赖 middleware，避免运行时循环依赖）。
  */
export function overwriteProjectFiles(
  project: ProjectContext,
  entries: Record<string, Uint8Array>,
  opts: { name?: string; snapshotFileName?: string } = {},
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
    writeProjectFilesFromBackup(project.root, entries, {
      keepId: project.config.id,
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      ...(opts.snapshotFileName !== undefined ? { snapshotFileName: opts.snapshotFileName } : {}),
    });
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
    // P1-2：替换/重连失败——writeProjectFilesFromBackup 已记录文件替换清单（含快照名），
    // 此处尝试恢复连接（原库可能未被替换或已替换为校验过的有效库）；重连失败时连接悬挂，
    // 记日志供排查，由路由层（restore/import）catch 后检查 db.open 清空单例
    let reopened = true;
    try {
      project.db = openDatabase(dbPath);
    } catch {
      reopened = false;
    }
    console.error(
      `[backup] 覆盖失败${opts.snapshotFileName !== undefined ? `，覆盖前快照: ${opts.snapshotFileName}` : ""}${
        reopened ? "，data.db 已恢复连接" : "，data.db 重连失败（连接悬挂，路由层将清空单例）"
      }`,
      err,
    );
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
 * 1. fileName 白名单校验：仅允许 `.backups/` 下时间戳格式（决策 28/29 兼容四类：
 *    `<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip` 毫秒级（含 kind 段）/ `<YYYYMMDD-HHmmssSSS>-<名称>.zip`
 *    旧带名称 / 旧秒级 `<YYYYMMDD-HHmmss>.zip`——shared parseBackupFileName，^$ 锚定 + 名称部分
 *    拒绝 /\\，天然防路径分隔符与 `..` 穿越）；格式合法但文件不存在 → 404
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
  // 1. 白名单校验（assertBackupFileNameFormat：parseBackupFileName 全格式校验，防路径穿越；
  //    决策 28/29 兼容毫秒级/带 kind 段/旧带名称/旧秒级文件名）
  assertBackupFileNameFormat(fileName);
  const backupPath = join(project.root, BACKUPS_DIR_NAME, fileName);
  if (!existsSync(backupPath)) {
    throw new HttpError(404, "VALIDATION_ERROR", `备份不存在: ${fileName}`);
  }

  // 2. 覆盖前自动快照（复用备份管道；误操作/选错备份永远有后悔药）
  const snapshot = writeBackup(project);

  // 3. 备份包校验（零触碰：通过前不写任何数据文件）；projectId = zip 内 project.json 的 id
  const zip = readFileSync(backupPath);
  const { entries, projectId: zipProjectId } = validateBackupPackage(zip);

  // 4. 覆盖管道（B2.3 提取，import 覆盖复用）：原子替换三文件（保留当前 id）+
  //    重连 data.db + 同步 config + 重启定时器。
  //    name 归一为当前目录名（审核裁决：与 import 覆盖一致，维持「目录名 = 书名」
  //    不变式——id 是身份、name 是展示名；改名需求走 /project/rename）
  overwriteProjectFiles(project, entries, { name: basename(project.root), snapshotFileName: snapshot.fileName });

  // 5. 会话归属迁移（B2.2 审核 P1-1，决策 18/27）：备份包内 project_id ≠ 当前项目 id
  //    （跨项目恢复，如手工放入 .backups/ 的异项目备份）→ chat_messages 旧 id 行迁移为
  //    当前 id——「保留 id 保会话」的理由在跨项目场景同样成立：不迁移则恢复后聊天面板
  //    静默为空、旧会话行成孤儿数据。同项目恢复（id 相等）跳过，不执行多余迁移。
  //    （import 覆盖无需迁移：id 匹配才走覆盖分支，zip id = 书架 id）
  if (zipProjectId !== project.config.id) {
    migrateChatMessagesProject(project.db, zipProjectId, project.config.id);
  }

  // 契约（endpoints.md）：snapshot 仅含 fileName/createdAt（size 属内部信息不暴露）
  return { snapshot: { fileName: snapshot.fileName, createdAt: snapshot.createdAt } };
}
