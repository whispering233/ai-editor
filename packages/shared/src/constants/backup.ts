// 自动备份常量（阶段 B2，2026-08 新增）
// 常量命名 UPPER_SNAKE_CASE，as const 保持字面量类型；前后端共用（client 直接消费）

/** 自动备份频率枚举（分钟，2026-08 修订）：null / 0 = 关闭；缺省见 DEFAULT_BACKUP_FREQUENCY_MINUTES */
export const BACKUP_FREQUENCIES = [1, 5, 10, 15, 30, 60] as const;

/** 缺省自动备份频率（分钟，新项目默认开启；project.json 字段缺失时读侧兜底） */
export const DEFAULT_BACKUP_FREQUENCY_MINUTES = 10;

/** 每项目保留最近备份份数（超出删除最旧，含覆盖前自动快照；B2.2 保留策略） */
export const MAX_BACKUPS_PER_PROJECT = 20;

/** 手动备份自定义名称最大长度（trim 后 1-30 字符；超出 → 400 VALIDATION_ERROR） */
export const MAX_BACKUP_NAME_LENGTH = 30;

/**
 * 设备名最大长度（trim 后 1-16 字符）。设备段是文件名的第 3 段，不得出现 `-`
 * （段分隔符）——主机名里的 `-` 在派生时转写为 `_`，用户手工配置时非法 → 400 VALIDATION_ERROR。
 */
export const MAX_DEVICE_NAME_LENGTH = 16;

/** 备份类型：auto = 自动（定时器/覆盖前快照）/ manual = 手动（立即备份触发）；文件名 kind 标记段来源 */
export type BackupKind = "auto" | "manual";

/**
 * 备份包内容规模快照（写入文件名的尾部三段统计，`人物N-设定N-章N`）。
 * 口径：**未软删**存量（实体表不含回收站；章 = outline.json 中未软删 `chapter` 节点）。
 */
export interface BackupStats {
  characters: number;
  settings: number;
  chapters: number;
}
