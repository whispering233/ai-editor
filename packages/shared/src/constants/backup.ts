// 自动备份常量（决策 27：阶段 B2，2026-08 新增）
// 契约来源：doc/design/decisions.md 决策 27、doc/database/schema.md project.json 契约
//   （backup_frequency_minutes 可选字段：仅枚举 5/10/15/30/60；null/0 = 关闭；缺省 = 10）
// 常量命名 UPPER_SNAKE_CASE，as const 保持字面量类型；前后端共用（client 直接消费）

/** 自动备份频率枚举（分钟，决策 27）：null / 0 = 关闭；缺省见 DEFAULT_BACKUP_FREQUENCY_MINUTES */
export const BACKUP_FREQUENCIES = [5, 10, 15, 30, 60] as const;

/** 备份频率类型（从 BACKUP_FREQUENCIES 派生） */
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];

/** 缺省自动备份频率（分钟，决策 27：新项目默认开启；project.json 字段缺失时读侧兜底） */
export const DEFAULT_BACKUP_FREQUENCY_MINUTES = 10;

/** 每项目保留最近备份份数（决策 27：超出删除最旧，含覆盖前自动快照；B2.2 保留策略） */
export const MAX_BACKUPS_PER_PROJECT = 20;

/** 手动备份自定义名称最大长度（决策 28：trim 后 1-30 字符；超出 → 400 VALIDATION_ERROR） */
export const MAX_BACKUP_NAME_LENGTH = 30;

/** 备份类型（决策 29）：auto = 自动（定时器/覆盖前快照）/ manual = 手动（立即备份触发）；文件名 kind 标记段来源 */
export const BACKUP_KINDS = ["auto", "manual"] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];
