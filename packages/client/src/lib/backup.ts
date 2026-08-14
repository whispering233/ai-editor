// 备份展示纯函数与频率选项常量（B2.4，决策 27）
// 契约来源：doc/ui/pages/settings.md「自动备份（B2，决策 27）」区（信息层级表 + 线框——
//   列表行 = 时间（当年 MM-DD HH:mm、跨年 YY-MM-DD HH:mm）+ 大小（KB/MB 人类可读）+ [加载]）；
//   doc/design/decisions.md 决策 27（频率选项固定：关闭 / 5 / 10 / 15 / 30 / 60 分钟）
// 零副作用纯函数 + 常量，可单测；client 只消费 shared 常量/类型（BACKUP_FREQUENCIES、BackupKind），不引 zod 运行时
import { BACKUP_FREQUENCIES, type BackupKind } from "@whispering233/ai-editor-shared";

/**
 * 备份时间展示（settings.md 线框「08-13 10:15:30」；决策 28 补秒——同分钟内多次备份
 * 在界面上可区分，与毫秒级文件名配套）：
 * 当年 → `MM-DD HH:mm:ss`；跨年 → `YY-MM-DD HH:mm:ss`；非法输入原样返回
 * @param iso ISO 8601 时间（GET /project/backups → createdAt）
 * @param now 基准「当前时间」（测试注入用；缺省取真实当前时间）
 */
export function formatBackupTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  const hhmmss = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  if (sameYear) return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hhmmss}`;
  return `${String(date.getFullYear()).slice(-2)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hhmmss}`;
}

/**
 * 备份大小人类可读（settings.md 线框「1.2 MB」「986 KB」）：
 * < 1 KB → `N B`；< 1 MB → `N KB`（整数）；≥ 1 MB → `N.N MB`（一位小数）；
 * 非有限/负数输入防御为 "0 B"
 */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 备份频率下拉选项（决策 27：关闭 / 每 5 / 10 / 15 / 30 / 60 分钟）：
 * value 与 shared BACKUP_FREQUENCIES 对齐（null = 关闭），label 为展示文案；
 * 下拉/select 的 option value 用 String(opt.value)（"null" / "5" / "10" …）
 */
export const BACKUP_FREQUENCY_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: "关闭" },
  ...BACKUP_FREQUENCIES.map((v) => ({ value: v, label: `每 ${v} 分钟` })),
];

/**
 * 备份类型标签文案（决策 29，B2.6）：列表行徽标与恢复 Dialog 描述共用；
 * auto = 自动（按频率/覆盖前快照/旧秒级），manual = 手动（立即备份/带自定义名称）；
 * 键类型与 shared BackupKind（constants/backup.ts）对齐，防契约漂移
 */
export const BACKUP_KIND_LABELS: Record<BackupKind, string> = {
  auto: "自动",
  manual: "手动",
};