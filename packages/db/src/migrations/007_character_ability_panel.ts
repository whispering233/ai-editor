// 迁移 007：角色旧 abilities[] → ability_panel（能力面板，2026-09）
//
// 背景：角色能力从「标签数组」升级为「用户自定义字段树」（能力面板，结构契约见
// docs/db/schema.md「人物 data 分层」）。本迁移把旧标签迁成**顶层分组「能力」下的叶子**
// （保留"这个人会什么"的信息），`value` 留空——面板叶子值由 Delta 累积或用户手填。
//
// 只动 entities.data JSON（表结构不变，无 DDL 无需换表）；规则：
// - 仅 type='character'（其余类型的同名残留不动）；data 坏 JSON / 非对象 → 跳过（防御）
// - 仅处理「含 abilities（字符串数组）且**无** ability_panel」的行——**不覆盖**用户已手建的面板：
//   这类行原样保留（旧 abilities 作为残留交给 `.passthrough()` 容错）
// - 标签去空白、丢弃非字符串与空串；有有效标签 → 建 `[{ name: "能力", children: 叶子 }]`；
//   空数组 / 全空白标签 → **只删键、不建面板**
// - 改写数据刷新 updated_at（版本戳刷新使旧提案快照自动失效，同 004）
// 幂等性：双重保证——runMigrations 以 user_version 门控；且迁移本身幂等
// （abilities 键已删除 → 再执行无操作）。
import type { AbilityPanelNode } from "@whispering233/ai-editor-shared";
import { ABILITY_PANEL_DATA_KEY } from "@whispering233/ai-editor-shared";
import type { Db } from "../connection.js";
import type { Migration } from "./index.js";
import { nowIso } from "../storage/atomic.js";

/** 旧标签数组字段名（迁移后不再读写） */
const LEGACY_ABILITIES_KEY = "abilities";

/** 迁移产出的顶层分组名（旧标签一律归入此分组） */
const PANEL_ROOT_GROUP_NAME = "能力";

/** data 字段 JSON 迁移（旧 abilities 标签 → 能力面板「能力」分组叶子） */
const migration007: Migration = {
  version: 7,
  up(db: Db) {
    const rows = db
      .prepare("SELECT id, data FROM entities WHERE type = 'character'")
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
      const legacy = rec[LEGACY_ABILITIES_KEY];
      if (!Array.isArray(legacy)) continue; // 无旧字段（或非数组——不做宽松猜测）：原样保留
      if (rec[ABILITY_PANEL_DATA_KEY] !== undefined) continue; // 已有面板：不覆盖
 // 有效标签 = 字符串 → trim → 丢弃空串（旧数组里的非字符串项静默丢弃）
      const labels = legacy
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter((t) => t !== "");
      delete rec[LEGACY_ABILITIES_KEY];
      if (labels.length > 0) {
        const panel: AbilityPanelNode[] = [
          { name: PANEL_ROOT_GROUP_NAME, children: labels.map((name) => ({ name })) },
        ];
        rec[ABILITY_PANEL_DATA_KEY] = panel;
      }
      update.run(JSON.stringify(rec), stamp, row.id);
    }
  },
};

export default migration007;
