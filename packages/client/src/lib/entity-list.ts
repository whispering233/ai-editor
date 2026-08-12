// 实体列表页辅助纯函数与配置（S3.5）
// 契约来源：doc/ui/pages/entity-list.md「信息层级」——各类型摘要列（character→role/status、
//   setting→category、location→type、hook→status/payoff_timing）+ 分页（limit 固定 20、total 驱动）
import type { EntityType } from "@whispering233/ai-editor-shared";

/** MVP 每页条数（原型：limit 固定 20；服务端默认 50 最大 200） */
export const PAGE_LIMIT = 20;

/** 分页辅助：总页数（至少 1 页——total 为 0 时显示「第 1 / 1 页」） */
export function pageCount(total: number, limit: number): number {
  return Math.max(1, Math.ceil(total / limit));
}

/** 摘要列配置（列表表格列；key = EntitySummary.summary 字段名；key2 可选——部分类型只有一列摘要） */
export interface SummaryColumnConfig {
  key1: string;
  label1: string;
  key2?: string;
  label2?: string;
}

export const SUMMARY_COLUMNS: Record<EntityType, SummaryColumnConfig> = {
  character: { key1: "role", label1: "角色", key2: "status", label2: "状态" },
  setting: { key1: "category", label1: "类别" },
  location: { key1: "type", label1: "类型" },
  hook: { key1: "status", label1: "状态", key2: "payoff_timing", label2: "回收时机" },
  // C1 类型补全（决策 26 event 时间轴事件；服务端 event 摘要为空对象，时间轴专属 UI 由 C2 实现）
  event: { key1: "description", label1: "描述" },
};

/** hook 枚举值 → 中文（展示映射；未收录的原样显示）；详情页表单下拉复用（S3.6） */
export const HOOK_STATUS_LABEL: Record<string, string> = {
  planted: "已埋设",
  progressing: "推进中",
  resolved: "已回收",
  abandoned: "已弃用",
};

export const HOOK_TIMING_LABEL: Record<string, string> = {
  immediate: "立即",
  near_term: "近期",
  mid_arc: "中段",
  slow_burn: "慢热",
  endgame: "终局",
};

/**
 * 摘要单元格文案：hook 的 status/payoff_timing 走枚举映射（planted → 「已埋设」），
 * 其余类型字符串原样；缺失/空值 → "—"（表格占位）
 */
export function summaryCellText(type: EntityType, key: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (type === "hook" && key === "status") return HOOK_STATUS_LABEL[String(value)] ?? String(value);
  if (type === "hook" && key === "payoff_timing") return HOOK_TIMING_LABEL[String(value)] ?? String(value);
  return String(value);
}

/** 创建对话框首字段配置（原型「name 必填 + 该类型首字段，如 character 的 role」） */
export interface CreateFirstFieldConfig {
  key: string;
  label: string;
  /** text = 自由输入；select = 枚举下拉（options 给出） */
  input: "text" | "select";
  options?: string[];
}

export const CREATE_FIRST_FIELD: Record<EntityType, CreateFirstFieldConfig> = {
  character: { key: "role", label: "角色定位", input: "text" },
  setting: { key: "category", label: "类别", input: "text" },
  location: { key: "type", label: "地点类型", input: "text" },
  // hook.status 是受控枚举（planted → progressing → resolved / abandoned，doc/database/hooks.md）
  hook: {
    key: "status",
    label: "状态",
    input: "select",
    options: ["planted", "progressing", "resolved", "abandoned"],
  },
  // C1 类型补全（决策 26 event 时间轴事件；时间轴专属创建 UI 由 C2 实现）
  event: { key: "description", label: "描述", input: "text" },
};
