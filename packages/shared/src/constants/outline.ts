// 大纲节点常量（决策 23：麦基《故事》字段集，2026-08 新增）
// 契约来源：doc/design/decisions.md 决策 23、doc/database/schema.md outline.json「节点结构化信息 data」节
// 常量命名 UPPER_SNAKE_CASE，as const 保持字面量类型；zod schema 见 @whispering233/ai-editor-shared/schemas
// （client 只消费本常量，不打包校验函数——shared 硬约束）

/** 场景冲突层次（麦基冲突三层次，decision 23；conflict_levels 多选枚举） */
export const CONFLICT_LEVELS = ["inner", "personal", "extra_personal"] as const;

/** 冲突层次（从 CONFLICT_LEVELS 派生） */
export type ConflictLevel = (typeof CONFLICT_LEVELS)[number];

/** 大纲节点层级 → 中文标签（决策 47 names/resolve 用；口径对齐 client outline 页面——卷/章/场景） */
export const OUTLINE_NODE_TYPE_LABELS: Record<"volume" | "chapter" | "scene", string> = {
  volume: "卷",
  chapter: "章",
  scene: "场景",
};
