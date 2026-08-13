// 备份文件名工具（决策 27：.backups/ 时间戳命名 <YYYYMMDD-HHmmss>.zip）
// 纯函数，零 Node 依赖（client 浏览器打包安全）
// 契约来源：doc/database/schema.md「自动备份目录」（时间戳命名）、doc/api/endpoints.md
//   POST /project/backup/restore（fileName 白名单校验：仅允许 <YYYYMMDD-HHmmss>.zip，
//   拒绝路径分隔符 / ..，防路径穿越——正则 ^...$ 只匹配纯数字时间戳，天然拒绝路径字符）
// 时区约定：文件名时间戳为本地时区（无时区后缀），format/parse 对称使用本地时间

/** 备份文件名格式：<YYYYMMDD-HHmmss>.zip（^$ 锚定 + 仅数字，路径分隔符/.. 天然不匹配） */
const BACKUP_FILE_NAME_PATTERN = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.zip$/;

/**
 * 解析备份文件名 → Date。
 *
 * 格式不符返回 null：非 <YYYYMMDD-HHmmss>.zip 形状（含路径分隔符、`..`、空串、
 * 非数字、多后缀等）一律拒绝——白名单校验语义（endpoints.md restore 流程第 1 步）。
 * 数字合法但日期不存在（如 20261301、2 月 30 日）同样返回 null：Date 构造会对
 * 越界值滚动进位（20261301 → 2027-01-01），回读比对不一致即拒绝。
 *
 * @param fileName 备份文件名（如 "20260813-101500.zip"）
 * @returns 本地时区 Date；格式不符返回 null
 */
export function parseBackupFileName(fileName: string): Date | null {
  const m = BACKUP_FILE_NAME_PATTERN.exec(fileName);
  if (m === null) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  // 越界日期回读比对（Date 滚动进位后各分量必然变化，一致性校验即拒绝）
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi ||
    date.getSeconds() !== s
  ) {
    return null;
  }
  return date;
}

/**
 * 生成备份文件名：Date → `<YYYYMMDD-HHmmss>.zip`（本地时区，与 parse 对称）。
 * 决策 27：文件名时间戳命名，`.backups/` 内按文件名排序即时间序（保留策略依赖）。
 */
export function formatBackupFileName(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.zip`;
}
