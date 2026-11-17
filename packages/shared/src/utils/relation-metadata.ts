// 关系 metadata 归一的**单一实现**（POST / PUT / propose_add_relation 共用；
// 口径见 docs/db/schema.md「关系说明」）。放 utils 而非 types/api.ts：后者含 zod 运行时，
// 根入口不得导出（zod 不进 client 包）；api.ts 的关系 schema 段再导出本模块。

/** 关系 metadata 约定字段（`label` = 画布连线短标签，`description` = 长说明） */
export type RelationMetadata = { label?: string; description?: string };

/**
 * 归一：非对象 → `{}`；`label` / `description` 各自 `trim`，空串与非字符串值删键；
 * **其余键原样保留**（自由袋未被收走，但 UI 与 AI 不再写）。
 */
export function normalizeRelationMetadata(input: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) return result;
  for (const [key, value] of Object.entries(input)) {
    if (key === "label" || key === "description") {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed !== "") result[key] = trimmed;
      continue;
    }
    result[key] = value;
  }
  return result;
}
