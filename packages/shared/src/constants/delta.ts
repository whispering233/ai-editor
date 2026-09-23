// Delta（变更记录）字段约束常量
//
// **单一定义**：client（`lib/delta-create`：字段下拉 / op 选项）与 tools（`proposal/delta`、
// `executor/delta`：写入守卫）双向消费——client 不能 import tools，各手抄一份必然漂移。
// 纯常量（无 schema / TypeBox），可安全进客户端包。
//
// 依据：`docs/design/10-data-model.md` §4「物化事实字段不用 CAS」与 §14 不变式 1、
// `docs/db/schema.md`「人物 data 分层」。

/**
 * 事实字段（写路径已把当前值同步进 `data`）→ 变更记录**只能用 `op=set`**。
 *
 * `hook.status` 由复合写（推进/回收/废弃）同步为最新值：终态守卫、列表分组、AI 统计都直接读它，
 * 因此用 `op=update` + `from` 重放必然假冲突（重放基座即最新值，`from` 永远对不上）。
 */
export const SET_ONLY_FIELDS: Record<string, readonly string[]> = {
  hook: ["status"],
};

/**
 * character 不可变字段（**不参与 Delta**——人工经 `PUT` 直接编辑）：按实体类型。
 *
 * `role`/`description` 同时是列表摘要与 AI 检索的依据，允许 Delta 改会与 `entities.name`/
 * 摘要其它读取面产生“同一人物两个值”的语义裂缝（见 `docs/db/schema.md`「人物 data 分层」/
 * `docs/design/10-data-model.md` §14 不变式 1）。
 * `priority` 是**作者视角**的档位分类（谁是主角不随阅读进度变化），故同归不可变层。
 *
 * 消费方：client（`lib/delta-create` 字段下拉排除、`lib/character-detail` 基础信息区字段集）
 * 与 tools（`proposal/delta` 提案层守卫）。
 */
export const IMMUTABLE_FIELDS: Record<string, readonly string[]> = {
  character: ["role", "description", "priority"],
};

/**
 * character 已移除字段（schema 已删——`status` 无展示面、`abilities` 经 007 迁移为 `ability_panel`）：
 * 写入只会留下脏键（不参与展示与状态累积），故提案层与 executor 均拒绝；
 * 旧项目的存量脏值由 `.passthrough()` 容错，不迁移。
 */
export const REMOVED_CHARACTER_FIELDS: readonly string[] = ["status", "abilities"];
