// 大纲节点常量（麦基《故事》字段集，2026-08 新增）
// 常量命名 UPPER_SNAKE_CASE，as const 保持字面量类型；zod schema 见 @whispering233/ai-editor-shared/schemas
// （client 只消费本常量，不打包校验函数——shared 硬约束）

/** 场景冲突层次（麦基冲突三层次，decision 23；conflict_levels 多选枚举） */
export const CONFLICT_LEVELS = ["inner", "personal", "extra_personal"] as const;

/** 冲突层次（从 CONFLICT_LEVELS 派生） */
export type ConflictLevel = (typeof CONFLICT_LEVELS)[number];

/** 章写作状态（工作面字段；缺省 = 草稿，见 docs/design/10-data-model.md §8） */
export const OUTLINE_STATUS = ["draft", "revision", "final"] as const;

/** 章写作状态（从 OUTLINE_STATUS 派生） */
export type OutlineStatus = (typeof OUTLINE_STATUS)[number];

/** 状态 → 中文标签 */
export const OUTLINE_STATUS_LABEL: Record<OutlineStatus, string> = {
  draft: "草稿",
  revision: "修正中",
  final: "定稿",
};

/** 章叙事功能（麦基故事事件的功能分类） */
export const CHAPTER_FUNCTIONS = ["setup", "advance", "turn", "resolve", "breather"] as const;

/** 叙事功能（从 CHAPTER_FUNCTIONS 派生） */
export type ChapterFunction = (typeof CHAPTER_FUNCTIONS)[number];

/** 叙事功能 → 中文标签 */
export const CHAPTER_FUNCTION_LABEL: Record<ChapterFunction, string> = {
  setup: "铺垫",
  advance: "推进",
  turn: "转折",
  resolve: "收束",
  breather: "喘息",
};

/** 章张力度（筛选面档位） */
export const CHAPTER_TENSIONS = ["low", "mid", "high"] as const;

/** 张力度（从 CHAPTER_TENSIONS 派生） */
export type ChapterTension = (typeof CHAPTER_TENSIONS)[number];

/** 张力度 → 中文标签 */
export const CHAPTER_TENSION_LABEL: Record<ChapterTension, string> = {
  low: "低",
  mid: "中",
  high: "高",
};

/**
 * 章「实际摘要」字长上限（`data.result_summary`，作者/AI 回填的本章实际发生了什么）。
 * 单源：`chapterDataSchema`（落库校验）与 `propose_update_outline_node` 的工具 schema
 * （`maxLength`）都引用本常量，不写字面量。取值对齐同层的 `reversal`（章级单文本）。
 */
export const MAX_CHAPTER_RESULT_SUMMARY_CHARS = 1000;

/** 大纲节点层级 → 中文标签（names/resolve 用；口径对齐 client outline 页面——卷/章/场景） */
export const OUTLINE_NODE_TYPE_LABELS: Record<"volume" | "chapter" | "scene", string> = {
  volume: "卷",
  chapter: "章",
  scene: "场景",
};
