// 备份文件名工具（决策 27 + 决策 28 + 决策 29：.backups/ 时间戳命名 + 类型标签 + 重命名）
// 纯函数，零 Node 依赖（client 浏览器打包安全）
// 契约来源：doc/database/schema.md「自动备份目录」（时间戳命名）、doc/api/endpoints.md
//   POST /project/backup/restore（fileName 白名单校验：仅允许 .backups/ 下时间戳格式，
//   拒绝路径分隔符 / ..，防路径穿越——正则 ^...$ 只匹配纯数字时间戳，天然拒绝路径字符）
// 时区约定：文件名时间戳为本地时区（无时区后缀），format/parse 对称使用本地时间
//
// 格式（决策 29）——<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip，kind 段单字母 m/a：
//   - 自动备份/覆盖前快照（无名称）：<YYYYMMDD-HHmmssSSS>.zip，如 20260813-101530123.zip
//   - 手动备份（无名称）：<YYYYMMDD-HHmmssSSS>-m.zip
//   - 手动备份（带名称）：<YYYYMMDD-HHmmssSSS>-m-<名称>.zip，如 20260813-101530123-m-定稿.zip
//   - 自动备份重命名后：<YYYYMMDD-HHmmssSSS>-a-<名称>.zip
// 兼容解析（不迁移，历史备份不重命名）：
//   - 旧秒级（决策 27）：<YYYYMMDD-HHmmss>.zip → kind=auto（毫秒为 0）
//   - 旧带名称无 kind 段（决策 28）：<YYYYMMDD-HHmmssSSS>-<名称>.zip → kind=manual

import { MAX_BACKUP_NAME_LENGTH, type BackupKind } from "../constants/backup.js";

/** 新格式（决策 29）：<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip——组 8 = kind 段（a→auto、m→manual、
 *  无 → auto）、组 9 = 名称；名称部分 [^/\\]+ 拒绝路径分隔符（防路径穿越）；写入侧
 *  sanitizeBackupName 严格限制字符集。
 *  已知歧义（决策 29，接受）：旧「名称恰为单字母 a/m」的备份（如 <时间戳>-m.zip）按本正则
 *  解析为 kind 标记（auto/manual 无名称），不按旧带名称格式回退。 */
const BACKUP_FILE_NAME_PATTERN_MS = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(\d{3})(?:-(a|m)(?:-([^/\\]+?))?)?\.zip$/;
/** 旧带名称（无 kind 段，决策 28 格式）：<YYYYMMDD-HHmmssSSS>-<名称>.zip → 兼容为 manual + 名称 */
const BACKUP_FILE_NAME_PATTERN_LEGACY_NAMED = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(\d{3})-([^/\\]+?)\.zip$/;
/** 旧格式（秒精度，决策 27）：仅解析兼容 → kind=auto */
const BACKUP_FILE_NAME_PATTERN_LEGACY = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.zip$/;

/** 备份文件名解析结果（决策 28 + 决策 29：time + 类型 + 可选自定义名称） */
export interface ParsedBackupFileName {
  /** 本地时区时间（文件名时间戳；旧秒级格式 → 毫秒为 0） */
  time: Date;
  /** 备份类型（决策 29，由文件名 kind 段解析推断：auto / manual） */
  kind: BackupKind;
  /** 手动备份自定义名称（决策 28；自动备份/快照/旧秒级备份无此字段） */
  name?: string;
}

/**
 * 解析备份文件名 → { time, kind, name? }。
 *
 * 格式不符返回 null：非时间戳形状（含路径分隔符、`..`、空串、非数字、多后缀等）一律
 * 拒绝——白名单校验语义（endpoints.md restore 流程第 1 步）。兼容三类：
 *   新格式（带/不带 kind 段）/ 旧带名称无 kind 段 / 旧秒级格式（决策 29：历史备份不迁移）。
 * 数字合法但日期不存在（如 20261301、2 月 30 日）同样返回 null：Date 构造会对
 * 越界值滚动进位（20261301 → 2027-01-01），回读比对不一致即拒绝。
 *
 * @param fileName 备份文件名（如 "20260813-101530123.zip" / "20260813-101530123-m-定稿.zip"）
 * @returns 本地时区时间 + 类型 + 可选名称；格式不符返回 null
 */
export function parseBackupFileName(fileName: string): ParsedBackupFileName | null {
  const m =
    BACKUP_FILE_NAME_PATTERN_MS.exec(fileName) ??
    BACKUP_FILE_NAME_PATTERN_LEGACY_NAMED.exec(fileName) ??
    BACKUP_FILE_NAME_PATTERN_LEGACY.exec(fileName);
  if (m === null) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);
  // 毫秒位：新格式第 7 组捕获，旧格式无（= 0）
  const milli = m[7] !== undefined ? Number(m[7]) : 0;
  const date = new Date(y, mo - 1, d, h, mi, s, milli);
  // 越界日期回读比对（Date 滚动进位后各分量必然变化，一致性校验即拒绝）
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi ||
    date.getSeconds() !== s ||
    date.getMilliseconds() !== milli
  ) {
    return null;
  }
  const result: ParsedBackupFileName = { time: date, kind: "auto" };
  // kind/名称：新格式组 8 为 kind 段（a/m，缺省 auto）、组 9 为名称；旧带名称格式组 8 为名称
  // （无 kind 段 → 兼容为 manual，决策 29）。歧义注：旧「名称恰为单字母 a/m」的备份按新格式
  // 解析为 kind 标记（无名称），接受——见 BACKUP_FILE_NAME_PATTERN_MS 注释。
  if (m[8] === "a" || m[8] === "m") {
    result.kind = m[8] === "a" ? "auto" : "manual";
    if (m[9] !== undefined && m[9].length > 0) {
      result.name = m[9];
    }
  } else if (m[8] !== undefined && m[8].length > 0) {
    result.kind = "manual"; // 旧带名称（决策 28 格式）→ 兼容为 manual
    result.name = m[8];
  }
  return result;
}

/**
 * 生成备份文件名：Date → `<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip`（本地时区，与 parse 对称）。
 * 决策 29 四类输出：
 *   auto 无名称 → 纯时间戳；auto 带名称 → `-a-<名称>`；manual 无名称 → `-m`；manual 带名称 → `-m-<名称>`。
 * 决策 28：毫秒精度；决策 27：文件名时间戳命名，`.backups/` 内按文件名排序即时间序（保留策略依赖）。
 *
 * @param opts.kind 备份类型（缺省 "auto"）
 * @param opts.name 自定义名称——调用方保证已 sanitize（见 sanitizeBackupName）；本函数纯拼接
 */
export function formatBackupFileName(date: Date, opts?: { kind?: BackupKind; name?: string }): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const pad3 = (n: number): string => String(n).padStart(3, "0");
  const base = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${pad3(date.getMilliseconds())}`;
  const kind = opts?.kind ?? "auto";
  const name = opts?.name;
  if (kind === "auto" && (name === undefined || name.length === 0)) return `${base}.zip`;
  if (kind === "auto") return `${base}-a-${name}.zip`;
  if (name === undefined || name.length === 0) return `${base}-m.zip`;
  return `${base}-m-${name}.zip`;
}

/**
 * 备份名称规则（决策 28）：
 *   - trim 后非空，长度 ≤ MAX_BACKUP_NAME_LENGTH（constants/backup.ts）
 *   - 禁路径分隔符（/ \）与保留字符（: * ? " < > |）与控制字符
 *   - 禁纯点（. / ..）
 *   - 自动剥离尾部 .zip（用户输入习惯，如「定稿.zip」→「定稿」；**循环剥尽**——
 *     「定稿.zip.zip」→「定稿」，避免双 .zip 文件名，oracle 审核 P2-2）
 *
 * 服务端唯一执行点：writeBackup（backup.ts）；路由层 zod schema 仅做形状校验。
 * @returns 规范化后的名称；非法 → null（调用方转 400 VALIDATION_ERROR）
 */
export function sanitizeBackupName(raw: string): string | null {
  let name = raw.trim();
  if (name === "") return null;
  // 循环剥尽尾部 .zip（P2-2：「定稿.zip.zip」→「定稿」；".zip" 剥后为空 → 下方空判定拒绝）
  while (name.length >= 4 && /.zip$/i.test(name)) {
    name = name.slice(0, -4);
  }
  name = name.trim();
  if (name === "") return null;
  if (name.length > MAX_BACKUP_NAME_LENGTH) return null;
  if (/[\\/:*?"<>|\x00-\x1f\x7f]/.test(name)) return null;
  if (/^\.+$/.test(name)) return null;
  return name;
}