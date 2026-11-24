// 大纲节点详情页辅助纯函数与配置（S12.2；outline.json「节点结构化信息 data」节
// + shared OUTLINE_NODE_DATA_SCHEMAS——client 只消费常量与类型，不打包 zod 校验函数）
// 用途：详情页 data 表单按层级渲染（仿 lib/entity-detail.ts 的字段配置模式）——纯函数可单测，UI 只做编排
import type { OutlineNode } from "@whispering233/ai-editor-shared";
import {
  CHAPTER_FUNCTIONS,
  CHAPTER_FUNCTION_LABEL,
  CHAPTER_TENSIONS,
  CHAPTER_TENSION_LABEL,
  CONFLICT_LEVELS,
  OUTLINE_STATUS,
  OUTLINE_STATUS_LABEL,
} from "@whispering233/ai-editor-shared";
import type { OutlineNodeType } from "./api";
import { outlineTagsFromData } from "./outline-tags";

/** 场景冲突层次 → 中文（麦基冲突三层次；checkbox 组标签） */
export const CONFLICT_LEVEL_LABEL: Record<string, string> = {
  inner: "内心冲突",
  personal: "人际冲突",
  extra_personal: "社会冲突",
};

/** 字段控件类型：text 单行 / textarea 多行 / checkbox-group 冲突层次多选 / scene-select 场景节点选择器 /
 * select 枚举下拉 / tags 标签编辑器 */
export type NodeFieldControl = "text" | "textarea" | "checkbox-group" | "scene-select" | "select" | "tags";

/** data 字段配置（顺序 = 展示顺序；label 为字段中文名） */
export interface NodeFieldConfig {
  key: string;
  label: string;
  control: NodeFieldControl;
 /** 文本类控件的最大长度（服务端 schema 上限，maxLength 约束输入） */
  maxLength?: number;
 /** checkbox-group 用：可选项（scene.conflict_levels 枚举） */
  options?: readonly string[];
 /** checkbox-group 用：选项 → 中文标签 */
  optionsLabels?: Record<string, string>;
 /** select 用：未设置时的展示值（章 status 缺省即草稿，服务端 schema 同口径） */
  defaultValue?: string;
}

/**
 * 按节点层级的 data 字段配置（麦基字段集 + 工作面字段；root 无 data 不适用——详情页仅卷/章/场可达）：
 * scene——goal/conflict_levels/value_from/value_to；chapter——status/tags/function/tension（工作面）
 * → reversal/climax_scene（分析面）；volume——climax_scene/inciting_scene。
 * 引用字段（climax_scene/inciting_scene）用 scene-select（仅列 scene 节点，见 sceneNodeOptions）。
 */
export function detailFieldsForNodeType(type: OutlineNodeType): NodeFieldConfig[] {
  switch (type) {
    case "scene":
      return [
        { key: "goal", label: "场景目标", control: "textarea", maxLength: 1000 },
        {
          key: "conflict_levels",
          label: "冲突层次",
          control: "checkbox-group",
          options: CONFLICT_LEVELS,
          optionsLabels: CONFLICT_LEVEL_LABEL,
        },
        { key: "value_from", label: "开场价值", control: "text", maxLength: 200 },
        { key: "value_to", label: "收场价值", control: "text", maxLength: 200 },
      ];
    case "chapter":
      return [
        {
          key: "status",
          label: "状态",
          control: "select",
          options: OUTLINE_STATUS,
          optionsLabels: OUTLINE_STATUS_LABEL,
          defaultValue: "draft",
        },
        { key: "tags", label: "剧情线标签", control: "tags" },
        {
          key: "function",
          label: "叙事功能",
          control: "select",
          options: CHAPTER_FUNCTIONS,
          optionsLabels: CHAPTER_FUNCTION_LABEL,
        },
        {
          key: "tension",
          label: "张力度",
          control: "select",
          options: CHAPTER_TENSIONS,
          optionsLabels: CHAPTER_TENSION_LABEL,
        },
        { key: "reversal", label: "章末反转", control: "textarea", maxLength: 1000 },
        { key: "climax_scene", label: "章高潮场景", control: "scene-select" },
      ];
    case "volume":
      return [
        { key: "climax_scene", label: "幕高潮场景", control: "scene-select" },
        { key: "inciting_scene", label: "激励事件", control: "scene-select" },
      ];
  }
}

/**
 * 剧情线标签候选池（详情页章标签的 datalist / 快捷 chips）：遍历全书章与场景的 `data.tags`，
 * 去重计数 → 按使用次数降序、同频按字典序（中文按拼音）。
 */
export function chapterTagPool(tree: OutlineNode[]): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  const walk = (nodes: OutlineNode[]): void => {
    for (const node of nodes) {
      if (node.type === "chapter" || node.type === "scene") {
        for (const tag of outlineTagsFromData(node.data)) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
      if (node.type !== "scene" && node.children) walk(node.children);
    }
  };
  walk(tree);
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "zh"));
}

/**
 * 冲突层次多选切换（checkbox 组 ↔ conflict_levels 数组）：
 * 勾选 → 追加（保持 CONFLICT_LEVELS 声明序）；取消 → 移除。非法值（不在枚举内）忽略。
 */
export function toggleConflictLevel(current: string[], level: string): string[] {
  if (!(CONFLICT_LEVELS as readonly string[]).includes(level)) return current;
  return current.includes(level) ? current.filter((v) => v !== level) : [...current, level];
}

/** 场景节点选择器选项（树序遍历 + 仅 scene 叶子；不含卷/章——引用字段只指向场景）。
 * 深度沿用 flattenTree 语义（root=0、卷=1、章=2）用于缩进展示 */
export function sceneNodeOptions(
  nodes: OutlineNode[],
): Array<{ id: string; label: string; depth: number }> {
  const options: Array<{ id: string; label: string; depth: number }> = [];
  const walk = (children: OutlineNode[], depth: number): void => {
    for (const n of children) {
      if (n.type === "scene") {
        options.push({ id: n.id, label: n.title, depth });
      } else if (n.children) {
        walk(n.children, depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return options;
}

/**
 * data 表单归一（保存提交与 dirty 判定共用）：
 * - `tags` 为数组时逐项 trim、丢弃空串——TagsEditor 为续输故意保留末行空串（回车 / `+ 添加`），
 *   原样提交会被 `nodeTagsSchema`（trim 后 min(1)）判 400。
 * - `result_summary`（章实际摘要，textarea）trim 后为空 = **不写该键**——空表单值不是一次提交，
 *   否则「打开表单没填」也要进 patches / 判 dirty。
 * 其它 key 原样；两键都无需归一（类型不符 / 都无变化）时返回入参同一对象（不白造新对象）。
 */
export function normalizeOutlineDataForm(data: Record<string, unknown>): Record<string, unknown> {
  let form = data;
  if (Array.isArray(data.tags)) {
    const tags = data.tags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "");
    form = { ...form, tags };
  }
  if (typeof form.result_summary === "string") {
    const { result_summary: raw, ...rest } = form;
    const resultSummary = raw.trim();
    form = resultSummary === "" ? rest : { ...rest, result_summary: resultSummary };
  }
  return form;
}

/**
 * 引用字段「未设置」提交值：空串 ""（服务端 schema z.string.optional 不接受 null——
 * 部分合并传 null 会被 400 拒绝；空串合法且浅合并即覆盖清除）。表单值归一：
 * 缺失/空串 → ""（「（未设置）」选项），有值 → id。
 */
export function sceneSelectValue(raw: unknown): string {
  return typeof raw === "string" && raw !== "" ? raw : "";
}
