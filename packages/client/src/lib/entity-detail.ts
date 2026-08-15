// 实体详情页辅助纯函数与配置（S3.6）
// 契约来源：doc/ui/pages/entity-detail.md「data 表单按类型差异化」（schema.md entities 表 data 字段清单：
//   character→role/gender/age/personality/motivation/abilities/status/custom_fields、
//   setting→category/parent_id/description/rules、location→type/parent_id/description、
//   hook→status/category/expected_payoff/payoff_timing/half_life/is_core/notes/expected_resolve_node_id）
import type { EntityType } from "@whispering233/ai-editor-shared";
import { HOOK_STATUS_LABEL, HOOK_TIMING_LABEL } from "./entity-list";

/** 字段控件类型：text 单行 / textarea 多行 / number 数字 / tags 标签列表 / select 枚举下拉 /
 *  toggle 开关 / outline-node 大纲节点选择器 */
export type DetailFieldControl =
  | "text"
  | "textarea"
  | "number"
  | "tags"
  | "select"
  | "toggle"
  | "outline-node";

/** data 表单字段配置（字段出现与否由响应 data 决定——「未出现的字段不渲染」） */
export interface DetailFieldConfig {
  key: string;
  label: string;
  control: DetailFieldControl;
  /** select 用：可选值（受控枚举——hook status/payoff_timing，doc/database/hooks.md） */
  options?: string[];
  /** select 用：枚举值 → 中文标签（缺省显示原值） */
  optionsLabels?: Record<string, string>;
}

/** 按类型的 data 字段配置（详情页表单渲染驱动；顺序 = 展示顺序） */
export function detailFieldsForType(type: EntityType): DetailFieldConfig[] {
  switch (type) {
    case "character":
      return [
        { key: "role", label: "角色定位", control: "text" },
        { key: "gender", label: "性别", control: "text" },
        { key: "age", label: "年龄", control: "number" },
        { key: "personality", label: "性格", control: "tags" },
        { key: "motivation", label: "动机", control: "textarea" },
        { key: "abilities", label: "能力", control: "tags" },
        { key: "status", label: "状态", control: "text" },
      ];
    case "setting":
      return [
        { key: "category", label: "类别", control: "text" },
        { key: "parent_id", label: "上级设定", control: "text" },
        { key: "description", label: "描述", control: "textarea" },
        { key: "rules", label: "规则", control: "tags" },
      ];
    case "location":
      return [
        { key: "type", label: "地点类型", control: "text" },
        { key: "parent_id", label: "上级地点", control: "text" },
        { key: "description", label: "描述", control: "textarea" },
      ];
    case "hook":
      return [
        {
          key: "status",
          label: "状态",
          control: "select",
          options: ["planted", "progressing", "resolved", "abandoned"],
          optionsLabels: HOOK_STATUS_LABEL,
        },
        { key: "category", label: "类别", control: "text" },
        { key: "expected_payoff", label: "预期回收", control: "textarea" },
        {
          key: "payoff_timing",
          label: "回收时机",
          control: "select",
          options: ["immediate", "near_term", "mid_arc", "slow_burn", "endgame"],
          optionsLabels: HOOK_TIMING_LABEL,
        },
        { key: "half_life", label: "半衰期（章数）", control: "number" },
        { key: "is_core", label: "主线伏笔", control: "toggle" },
        { key: "notes", label: "备注", control: "textarea" },
        { key: "expected_resolve_node_id", label: "预计回收节点", control: "outline-node" },
      ];
    // C1 类型补全（决策 26 event 时间轴事件：data 契约字段 description/tags[]——time_label
    //   已随 G2 移除（时间标签 = 时间点挂载）；时间轴专属 UI 由 C2 实现，本分支为数据驱动表单的字段配置）
    case "event":
      return [
        { key: "description", label: "描述", control: "textarea" },
        { key: "tags", label: "标签", control: "tags" },
      ];
    // G2.3 类型补全（G2 时间标签点：data 空——时间标签文本 = name，仅名称可编辑，
    // 无 data 字段区；详情页表单按「未出现的字段不渲染」自然退化为纯名称表单）
    case "timepoint":
      return [];
  }
}

/** 关系类型 → 中文（16 种预定义，schema.md；未收录原样显示） */
const RELATION_TYPE_LABEL: Record<string, string> = {
  belongs_to: "所属",
  owns: "拥有",
  masters: "掌握",
  ally: "盟友",
  rival: "对手",
  mentor: "师徒",
  family: "家族",
  kills: "击杀",
  appears_in: "出现于",
  occurs_at: "发生于",
  plot_edge: "剧情连线",
  plants: "埋设",
  advances: "推进",
  resolves: "回收",
  depends_on: "依赖",
  involves: "涉及",
};

export function relationTypeLabel(t: string): string {
  return RELATION_TYPE_LABEL[t] ?? t;
}

/**
 * 表单 diff：相对原始 data 返回变更字段（PUT partial 浅合并——「未改字段不提交」）；
 * 无变更返回 null。值比较用 JSON 序列化（字段值均为 JSON 类型：字符串/数字/数组/对象/布尔/null）；
 * 空值统一规约为 null 比较（空串/空数组视为与缺失等价——避免无意义提交）。
 * **undefined 语义（oracle 修复）**：form 值为 undefined 的键直接跳过——数字控件清空（age/half_life）
 *   产生 undefined，提交 null 会被服务端 schema 拒绝（z.number()），且「清空数字」无删除语义，
 *   跳过 = 保留服务端原值。null 则正常提交（expected_resolve_node_id 清空用 null，
 *   服务端 z.string().nullable() 接受）。
 */
export function diffData(
  original: Record<string, unknown>,
  form: Record<string, unknown>,
): Record<string, unknown> | null {
  const changed: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(original), ...Object.keys(form)])) {
    const formVal = form[key];
    if (formVal === undefined) continue; // 清空数字等场景：跳过不提交（保留原值）
    const a = normalizeEmpty(original[key]);
    const b = normalizeEmpty(formVal);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changed[key] = formVal;
    }
  }
  return Object.keys(changed).length > 0 ? changed : null;
}

/** 空值规约：undefined/null/空串/空数组 → null（diff 比较基准） */
function normalizeEmpty(v: unknown): unknown {
  if (v === undefined || v === null || v === "") return null;
  if (Array.isArray(v) && v.length === 0) return null;
  return v;
}
