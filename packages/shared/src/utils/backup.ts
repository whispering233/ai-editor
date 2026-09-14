// 备份文件名工具（.backups/ 时间戳命名 + 类型/设备标签 + 尾部统计段 + 重命名）
// 纯函数，零 Node 依赖（client 浏览器打包安全）
// 时区约定：文件名时间戳为本地时区（无时区后缀），format/parse 对称使用本地时间
//
// **唯一格式（写入 = 解析）**——<YYYYMMDD-HHmmssSSS>-<自动|手动>-<设备>[-<标签>]-人物N-设定N-章N.zip：
// - 自动备份/覆盖前快照：<时间戳>-自动-苹果本-人物32-设定58-章120.zip
// - 手动备份（带标签）：<时间戳>-手动-苹果本-定稿-人物32-设定58-章120.zip
// 段序固定：尾部三段统计可**从尾部倒切**，故设备/标签里出现类似字样也不歧义；
// 设备段禁 `-`（见 sanitizeDeviceName），标签为自由文本（1-30 字符）。
//
// 早期开发期的三类旧命名（秒级 <YYYYMMDD-HHmmss>.zip、带名称无类型段 <YYYYMMDD-HHmmssSSS>-<名称>.zip、
// 单字母 `-m`/`-a` 段）**不再解析**：文件留在磁盘但不识别（不出现在列表、不可恢复、不参与保留策略），
// 也不做重命名迁移（旧份没有设备/统计信息，硬补会谎报——统计必须描述该备份的内容）。
// 升级兜底（只剩旧命名时立即生成一份新格式备份）见 server 侧 `ensureParseableBackup`。

import { MAX_BACKUP_NAME_LENGTH, MAX_DEVICE_NAME_LENGTH, type BackupKind, type BackupStats } from "../constants/backup.js";

/**
 * 唯一格式（设备段 + 尾部三段统计）：<时间戳>-<自动|手动>-<设备>[-<标签>]-人物N-设定N-章N.zip。
 * 设备与标签两组均排除路径分隔符（`/` 与 `\\`）——解析结果是 restore/rename 的文件名白名单，
 * 含分隔符即路径穿越。设备段另禁 `-`（与写入侧 sanitizeDeviceName 同口径）；标签自由文本
 * （可含 `-`，故统计段从尾部固定倒切）。
 */
const BACKUP_FILE_NAME_PATTERN =
  /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(\d{3})-(手动|自动)-([^-/\\]+?)(?:-([^/\\]+?))?-人物(\d+)-设定(\d+)-章(\d+)\.zip$/;

/** 备份文件名解析结果（time + 类型 + 可选标签 + 设备 + 统计） */
export interface ParsedBackupFileName {
 /** 本地时区时间（文件名时间戳，毫秒精度） */
  time: Date;
 /** 备份类型（由类型段解析：自动/手动） */
  kind: BackupKind;
 /** 用户自定义标签（自动备份/覆盖前快照无此字段） */
  name?: string;
 /** 来源设备（唯一格式恒有此段） */
  device: string;
 /** 尾部三段统计（唯一格式恒有此段） */
  stats: BackupStats;
}

/**
 * 解析备份文件名 → { time, kind, name?, device, stats }；不符唯一格式一律 null。
 *
 * 格式不符返回 null：非时间戳形状（含路径分隔符、`..`、空串、非数字、多后缀等）一律
 * 拒绝——白名单校验语义（restore 流程第 1 步）。**只认唯一格式**：三类旧命名（秒级 /
 * 带名称无类型段 / 单字母 `-m`/`-a` 段）同样返回 null——文件留盘但不识别。
 * 数字合法但日期不存在（如 20261301、2 月 30 日）同样返回 null：Date 构造会对
 * 越界值滚动进位（20261301 → 2027-01-01），回读比对不一致即拒绝。
 *
 * @param fileName 备份文件名（如 "20260813-101530123-自动-苹果本-人物32-设定58-章120.zip"）
 * @returns 本地时区时间 + 类型 + 可选标签 + 设备 + 统计；格式不符返回 null
 */
export function parseBackupFileName(fileName: string): ParsedBackupFileName | null {
  const m = BACKUP_FILE_NAME_PATTERN.exec(fileName);
  if (m === null) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);
  const milli = Number(m[7]); // 唯一格式恒捕获毫秒段
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
 // 组序：8 = 类型段（手动/自动）、9 = 设备、10 = 标签（可选）、11-13 = 尾部三段统计
  const result: ParsedBackupFileName = {
    time: date,
    kind: m[8] === "手动" ? "manual" : "auto",
    device: m[9],
    stats: { characters: Number(m[11]), settings: Number(m[12]), chapters: Number(m[13]) },
  };
  if (m[10] !== undefined) result.name = m[10];
  return result;
}

/**
 * 生成备份文件名（**唯一格式**）：`<时间戳>-<自动|手动>-<设备>[-<标签>]-人物N-设定N-章N.zip`。
 *
 * `device` 与 `stats` 必填（写入侧只有这一种形态，调用方保证：device 已 sanitize 且非空、
 * stats 描述该备份的内容）——与 parseBackupFileName 互为逆运算；类型系统即约束，无运行时兜底分支。
 *
 * 毫秒精度；本地时区；`.backups/` 内按文件名排序即时间序（保留策略依赖）。
 *
 * @param opts.device 来源设备名（已 sanitize；禁 `-`）
 * @param opts.stats 备份内容的未软删存量快照
 * @param opts.kind 备份类型（缺省 "auto"）
 * @param opts.name 用户标签——调用方保证已 sanitize（见 sanitizeBackupName）；本函数纯拼接
 */
export function formatBackupFileName(
  date: Date,
  opts: { kind?: BackupKind; name?: string; device: string; stats: BackupStats },
): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const pad3 = (n: number): string => String(n).padStart(3, "0");
  const base = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${pad3(date.getMilliseconds())}`;
  const typeSegment = (opts.kind ?? "auto") === "auto" ? "自动" : "手动";
  const tag = opts.name !== undefined && opts.name.length > 0 ? `-${opts.name}` : "";
  return `${base}-${typeSegment}-${opts.device}${tag}-人物${opts.stats.characters}-设定${opts.stats.settings}-章${opts.stats.chapters}.zip`;
}

/**
 * 备份名称规则：
 * - trim 后非空，长度 ≤ MAX_BACKUP_NAME_LENGTH（constants/backup.ts）
 * - 禁路径分隔符（/ \）与保留字符（* ? " < > |）与控制字符
 * - 禁纯点（. / ..）
 * - 自动剥离尾部 .zip（用户输入习惯，如「定稿.zip」→「定稿」；**循环剥尽**——
 * 「定稿.zip.zip」→「定稿」，避免双 .zip 文件名，oracle 审核 P2-2）
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

/**
 * 设备名规则（文件名的第 3 段）：
 * - trim 后非空，长度 ≤ MAX_DEVICE_NAME_LENGTH（constants/backup.ts）
 * - **禁 `-`**——段分隔符：设备段含 `-` 时与标签段不可区分（解析无法定位段边界）
 * - 禁路径分隔符（/ \）与保留字符（: * ? " < > |）与控制字符
 * - 禁纯点（. / ..）
 *
 * 服务端唯一执行点：云端配置写入（`PUT /api/v1/cloud/config`）；缺省设备名派生自 hostname
 * （见 deviceNameFromHostname，结果必然合法）。
 * @returns 规范化后的设备名；非法 → null（调用方转 400 VALIDATION_ERROR）
 */
export function sanitizeDeviceName(raw: string): string | null {
  const name = raw.trim();
  if (name === "") return null;
  if (name.length > MAX_DEVICE_NAME_LENGTH) return null;
  if (/[\\/:*?"<>|\x00-\x1f\x7f-]/.test(name)) return null;
  if (/^\.+$/.test(name)) return null;
  return name;
}

/**
 * 主机名 → 缺省设备名（纯函数，os.hostname() 的读取在服务端）：
 * ① trim → 取第一个 `.` 之前的部分（`MacBook-Pro.local` → `MacBook-Pro`）→ ② 非法字符（含 `-`，
 * Windows 主机名常见）替换为 `_` 并折叠连续 `_` → ③ **剥首尾空白与 `_`**（必须在截断前做，
 * 否则 `"__abc__"` 类会残留）→ ④ 截到 16 字符 → ⑤ **再去尾空白与 `_`**（截断可能切出新的尾部）
 * → ⑥ 空（含纯空白 / 纯点）兜底 `"unknown"`。
 *
 * **不变式**：对任意输入，`sanitizeDeviceName(deviceNameFromHostname(h)) === deviceNameFromHostname(h)`
 * 且恒非 null（单测以样本矩阵钤住：`"_ _:>"`、`" ? 99|"`、`"   "`、`"---"`、
 * `"a".repeat(15) + " "`、`"aaaaaaaaaaaaaaa bcdef"` 等）。
 */
export function deviceNameFromHostname(hostname: string): string {
 // ① 取第一个 `.` 之前的部分（域名后缀丢弃；`.local` 即在此步消失）
  const first = hostname.trim().split(".")[0] ?? "";
 // ② 非法字符 → `_`，并折叠连续 `_`
  const mapped = first.replace(/[\\/:*?"<>|\x00-\x1f\x7f-]/g, "_").replace(/_+/g, "_");
 // ③ 剥首尾空白与 `_`（截断前；空白同属非规范字符——否则会产出 sanitizeDeviceName 拒绝的值）
  const trimmed = mapped.replace(/^[\s_]+|[\s_]+$/g, "");
 // ④⑤ 截断后再去尾（截断可能把空白/`_` 切到末尾）
  const cut = trimmed.slice(0, MAX_DEVICE_NAME_LENGTH).replace(/[\s_]+$/, "");
  return cut === "" ? "unknown" : cut;
}