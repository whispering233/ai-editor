// 备份展示纯函数与频率选项常量（B2.4）
// 零副作用纯函数 + 常量，可单测；client 只消费 shared 常量/类型（BACKUP_FREQUENCIES、BackupKind），不引 zod 运行时
import { BACKUP_FREQUENCIES, type BackupKind } from "@whispering233/ai-editor-shared";

/**
 * 备份时间展示（线框「08-13 10:15:30」；补秒——同分钟内多次备份
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
 * 备份大小人类可读（线框「1.2 MB」「986 KB」）：
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
 * 备份频率下拉选项（关闭 / 每 5 / 10 / 15 / 30 / 60 分钟）：
 * value 与 shared BACKUP_FREQUENCIES 对齐（null = 关闭），label 为展示文案；
 * 下拉/select 的 option value 用 String(opt.value)（"null" / "5" / "10" …）
 */
export const BACKUP_FREQUENCY_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: "关闭" },
  ...BACKUP_FREQUENCIES.map((v) => ({ value: v, label: `每 ${v} 分钟` })),
];

/**
 * 备份类型标签文案（B2.6）：列表行徽标与恢复 Dialog 描述共用；
 * auto = 自动（按频率/覆盖前快照），manual = 手动（立即备份/带自定义名称）；
 * 键类型与 shared BackupKind（constants/backup.ts）对齐，防漂移
 */
export const BACKUP_KIND_LABELS: Record<BackupKind, string> = {
  auto: "自动",
  manual: "手动",
};

/**
 * 备份行的元信息行（来源设备与内容规模）：`苹果本 · 人物32 · 设定58 · 章120`。
 * 字段均来自 API（`device` / `stats`）——**UI 不自行解析文件名**；
 * 唯一命名格式保证两项恒存在（旧命名不再被解析/列出），故恒返回非空文案。
 */
export function formatBackupMeta(entry: {
  device: string;
  stats: { characters: number; settings: number; chapters: number };
}): string {
  return [entry.device, `人物${entry.stats.characters}`, `设定${entry.stats.settings}`, `章${entry.stats.chapters}`].join(
    " · ",
  );
}

/** 云端那份 / 本机那份的**新旧判定**（同步状态区用；按 `createdAt` 比，不看文件名时间戳） */
export type BackupFreshness = "remote" | "local" | "same";

/**
 * 比较两份备份的新旧：任一侧缺失（云端还没有备份 / 本机没有备份）→ `null`（无从比较，不显示判定）；
 * 时间戳相等 → `"same"`。用途：同步状态区行尾的「云端更新 / 本机更新 / 相同」——用户不必自己比时间。
 */
export function compareBackupTime(
  remote: { createdAt: string } | null,
  local: { createdAt: string } | null,
): BackupFreshness | null {
  if (remote === null || local === null) return null;
  const r = Date.parse(remote.createdAt);
  const l = Date.parse(local.createdAt);
  if (Number.isNaN(r) || Number.isNaN(l)) return null;
  if (r === l) return "same";
  return r > l ? "remote" : "local";
}

/** 新旧判定的展示文案（两处入口共用同一套措辞） */
export const BACKUP_FRESHNESS_LABELS: Record<BackupFreshness, string> = {
  remote: "云端更新",
  local: "本机更新",
  same: "相同",
};

/**
 * 同步状态区一行备份的**统一文案**（三行同字段同顺序）：
 * `<时间> · <类型>[ · <标签>] · <设备> · 人物N · 设定N · 章N · <大小>`。
 * 缺项**不省略**（除可选标签）——用户要能把两行逐项对齐着看。
 */
export function formatSyncRow(entry: {
  createdAt: string;
  kind: BackupKind;
  name?: string;
  device: string;
  stats: { characters: number; settings: number; chapters: number };
  size: number;
}): string {
  const parts = [formatBackupTime(entry.createdAt), BACKUP_KIND_LABELS[entry.kind]];
  if (entry.name !== undefined && entry.name !== "") parts.push(entry.name);
  parts.push(entry.device, `人物${entry.stats.characters}`, `设定${entry.stats.settings}`, `章${entry.stats.chapters}`);
  parts.push(formatBytes(entry.size));
  return parts.join(" · ");
}
