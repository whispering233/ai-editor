// 增量迁移脚本目录（E5：release-review §一 建议动作 2）
//
// **形态**：每个迁移一个 TS 文件（001_xxx.ts → version 1、002_xxx.ts → version 2...），
// 文件内 `export default { version, up }` 形态的 Migration 对象；本目录 index.ts 按
// version 升序聚合导出 MIGRATIONS（tsc 编译进 dist 随包分发，无运行时目录读取——
// 迁移集在构建期冻结，避免「读目录顺序不稳定/漏文件」的运行时不确定性）。
//
// **version 语义**：迁移完成后 data.db 的 user_version（`setUserVersion(m.version)`）。
// 从 v=N 库升级到 v=N+1 的迁移条目 version = N+1（SCHEMA_VERSION 即目标版本）。
//
// **写法示例**：见 002_event_timeline.ts（首个真实迁移：建新表拷贝改 CHECK，四步换表）。
//
// **执行语义**（runMigrations，见 queries/migration.ts）：
// - 按 version 升序逐个执行，每个迁移一个事务（up + setUserVersion 原子提交）
// - 整批迁移前自动快照 data.db（`data.db.v{n}.{时间戳}.bak`，不覆盖旧备份）
// - 失败 → 该迁移回滚 + 版本停在前一迁移后，下次 open 重试
// - 无迁移路径的旧版本（如 v0 且无 0→1 条目）保持删库重建兜底（决策 13）
//
// **当前状态**：SCHEMA_VERSION = 3；真实迁移 002（v1→v2：entities 表 CHECK 扩为 5 种 +
// sort_order 列，决策 26 时间轴）、003（v2→v3：entities CHECK 扩 6 种含 timepoint +
// event.data.time_label 迁移为 timepoint 实体 + occurs_at 挂载关系，G2 决策 26 修订）。
// v0 库无 0→1 迁移条目，仍走删库重建兜底（决策 13）。

import type { Db } from "../connection.js";
import migration002 from "./002_event_timeline.js";
import migration003 from "./003_timepoint.js";
import migration004 from "./004_setting_tags.js";

/** 单条增量迁移（version = 迁移完成后 data.db 的 user_version） */
export interface Migration {
  version: number;
  /** 迁移逻辑（DDL/数据变更）；抛错 → 该迁移事务整体回滚，版本号不变 */
  up: (db: Db) => void;
}

/** 全量迁移集（按 version 升序：002 时间轴事件（决策 26）、003 时间标签点实体化（G2）、
 *  004 设定分类字段 tags（决策 31 K2 修订）） */
export const MIGRATIONS: readonly Migration[] = [migration002, migration003, migration004];
