// 迁移 004：设定分类字段 tags 落地 + rules 恢复规则条款语义（决策 31 K2 修订，2026-08）
//
// 背景：批次五 J1 曾把 setting.data.rules 复用为分类标签（UI 显示「标签」）；用户复核
// 裁决（K2）：分类与规则条款是两种语义——**tags 承接分类（新字段 data.tags: string[]），
// rules 恢复规则条款语义**（仅设定详情页编辑）。本迁移把旧 rules 数据按用户裁决
// 「视为分类标签」复制到 data.tags 并移除 data.rules。
//
// 只动 entities.data JSON（表结构不变，无 DDL 无需换表）；规则：
// - 仅 type='setting'；data 坏 JSON → 跳过（防御，不做宽松猜测）
// - rules 为字符串数组且非空 → tags = 既有 tags（理论无）∪ rules，移除 rules 键
// - rules 空/缺失/非字符串数组 → data 原样（新语义下无规则条款即无字段）
// - 改写数据刷新 updated_at（迁移改写数据——版本戳刷新使旧提案快照自动失效，决策 14 语义）
// 幂等性：runMigrations 以 user_version 门控（版本已到 4 不再执行）。

import type { Db } from "../connection.js";
import type { Migration } from "./index.js";
import { nowIso } from "../storage/atomic.js";

/** data 字段 JSON 迁移（用户裁决：旧 rules 值 = 分类标签 → tags） */
const migration004: Migration = {
  version: 4,
  up(db: Db) {
    const rows = db
      .prepare("SELECT id, data FROM entities WHERE type = 'setting'")
      .all() as Array<{ id: string; data: string }>;
    const update = db.prepare("UPDATE entities SET data = ?, updated_at = ? WHERE id = ?");
    const stamp = nowIso();
    for (const row of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.data);
      } catch {
        continue; // 坏 JSON：不动（防御）
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      const rec = parsed as Record<string, unknown>;
      const rules = rec.rules;
      if (!Array.isArray(rules) || rules.length === 0 || !rules.every((t) => typeof t === "string")) {
        continue; // 无有效旧标签：原样保留（rules 可能是合法规则条款数据——K2 后由用户自行整理）
      }
      // 旧 rules 值视为分类标签 → 合并入 tags（防御：既有 tags 保留在前），移除 rules
      const existing = Array.isArray(rec.tags) ? (rec.tags as string[]).filter((t) => typeof t === "string") : [];
      rec.tags = [...existing, ...(rules as string[])];
      delete rec.rules;
      update.run(JSON.stringify(rec), stamp, row.id);
    }
  },
};

export default migration004;
