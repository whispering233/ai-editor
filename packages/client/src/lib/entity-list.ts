// 实体列表页辅助纯函数与配置（S3.5）
// 契约来源：doc/ui/pages/entity-list.md「信息层级」——各类型摘要列（character→role/status、
//   setting→category、location→type、hook→status/payoff_timing）+ 分页（limit 固定 20、total 驱动）
import type { EntityType } from "@whispering233/ai-editor-shared";

/** 实体二级 tab 可列表类型（批次十二 T3：参考资料已有独立中栏 tab #/references，实体页泛型表格不再渲染） */
export type ListableEntityType = Exclude<EntityType, "reference">;

/** MVP 每页条数（原型：limit 固定 20；服务端默认 50 最大 200） */
export const PAGE_LIMIT = 20;

/** 分页辅助：总页数（至少 1 页——total 为 0 时显示「第 1 / 1 页」） */
export function pageCount(total: number, limit: number): number {
  return Math.max(1, Math.ceil(total / limit));
}

/** 摘要列配置（列表表格列；key = EntitySummary.summary 字段名；key2/key3 可选——部分类型只有一列摘要） */
export interface SummaryColumnConfig {
  key1: string;
  label1: string;
  key2?: string;
  label2?: string;
  key3?: string;
  label3?: string;
}

export const SUMMARY_COLUMNS: Record<ListableEntityType, SummaryColumnConfig> = {
  // 决策 45（2026-08 批次十三）：状态列移除——character.status 无定义且存量恒空致困惑，
  // 列表不再展示（data.status 详情页保留可编辑，AI 工具 filters.status 语义不变）
  character: { key1: "role", label1: "角色" },
  // 决策 31（2026-08）：设定分类由 rules 标签承接，摘要列从「类别」改为「标签」
  // 决策 42（2026-08 批次十）：设定 tab 改为树形视图（不走表格），「上级设定」特殊列
  // （key2="parent"，M2）随表格移除；「描述」列保留配置（树形视图不渲染表格，无实际作用）
  setting: {
    key1: "tags",
    label1: "标签",
    key3: "description",
    label3: "描述",
  },
  location: { key1: "type", label1: "类型" },
  hook: { key1: "status", label1: "状态", key2: "payoff_timing", label2: "回收时机" },
  // C1 类型补全（决策 26 event 时间轴事件；服务端 event 摘要为空对象，时间轴专属 UI 由 C2 实现）
  event: { key1: "description", label1: "描述" },
  // G2.3 类型补全（G2 时间标签点：data 空、无专属摘要字段——endpoints.md「timepoint → 无专属摘要字段」，
  // 空 key = 摘要列渲染「—」占位，与 event 摘要缺失同款防御）
  timepoint: { key1: "", label1: "" },
};
// 注：reference 列配置已随批次十二 T3 移除——参考资料已有独立中栏 tab（#/references），
// 实体二级 tab 不再渲染泛型表格（旧路由重定向），此处无 reference 分支。

/** 人物行两行式行布局数据提取（决策 45，2026-08 批次十三）：
 * 第一行 = 名称 + 角色徽标（summary.role）；第二行 = 动机摘要 + 性格/能力标签 chips。
 * 服务端摘要已截断（motivation 40 / personality·abilities 各前 2），此处防御性再截断；
 * 空值一律归一为空串/空数组（行内不渲染空段）。 */
export function characterRowInfo(summary: Record<string, unknown>): {
  role: string;
  motivation: string;
  chips: string[];
} {
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const tagList = (v: unknown, cap: number): string[] =>
    Array.isArray(v)
      ? (v as unknown[])
          .filter((t): t is string => typeof t === "string" && t !== "")
          .slice(0, cap)
      : [];
  const chips = [...tagList(summary.personality, 2), ...tagList(summary.abilities, 2)];
  return {
    role: str(summary.role),
    motivation: str(summary.motivation).slice(0, 40),
    chips,
  };
}

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
  if (type === "hook" && key === "payoff_timing")
    return HOOK_TIMING_LABEL[String(value)] ?? String(value);
  // 标签数组（setting.tags / event.tags）：join 展示（摘要仅前 3 个，服务端已截断）
  if (key === "tags" && Array.isArray(value)) {
    const tags = (value as string[]).filter((t) => typeof t === "string" && t !== "");
    return tags.length > 0 ? tags.join("、") : "—";
  }
  return String(value);
}

/** 创建行首字段配置（原型「name 必填 + 该类型首字段，如 character 的 role」） */
export interface CreateFirstFieldConfig {
  key: string;
  label: string;
  /** text = 自由输入；select = 枚举下拉（options 给出）；tags = 逗号分隔多值标签（K1，决策 31） */
  input: "text" | "select" | "tags";
  options?: string[];
}

export const CREATE_FIRST_FIELD: Record<ListableEntityType, CreateFirstFieldConfig> = {
  character: { key: "role", label: "角色定位", input: "text" },
  // K2（2026-08 用户复核，决策 31）：设定分类统一字段 tags——新建行直接打标签（逗号分隔多值）
  setting: { key: "tags", label: "标签", input: "tags" },
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
  // G2.3 类型补全（G2 时间标签点：data 空——name = 时间标签文本即全部字段；
  // 空 key = 行内新建仅 name 输入，EntityList 对空 key 跳过 data 字段与首字段输入）
  timepoint: { key: "", label: "", input: "text" },
};
// 注：reference 首字段配置已随批次十二 T3 移除——参考资料已有独立中栏 tab（#/references），
// 实体二级 tab 不再渲染泛型表格（旧路由重定向），此处无 reference 分支（含决策 44 过时枚举）。
