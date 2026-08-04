// 大纲节点详情页辅助纯函数与配置（S12.2；契约：决策 23 + schema.md outline.json「节点结构化信息 data」节
//   + shared OUTLINE_NODE_DATA_SCHEMAS——client 只消费常量与类型，不打包 zod 校验函数）
// 用途：详情页 data 表单按层级渲染（仿 lib/entity-detail.ts 的字段配置模式）——纯函数可单测，UI 只做编排
import type { OutlineNode } from "@whispering233/ai-editor-shared";
import { CONFLICT_LEVELS } from "@whispering233/ai-editor-shared";
import type { OutlineNodeType } from "./api";

/** 场景冲突层次 → 中文（麦基冲突三层次，决策 23；checkbox 组标签） */
export const CONFLICT_LEVEL_LABEL: Record<string, string> = {
  inner: "内心冲突",
  personal: "人际冲突",
  extra_personal: "社会冲突",
};

/** 字段控件类型：text 单行 / textarea 多行 / checkbox-group 冲突层次多选 / scene-select 场景节点选择器 */
export type NodeFieldControl = "text" | "textarea" | "checkbox-group" | "scene-select";

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
}

/**
 * 按节点层级的 data 字段配置（决策 23 麦基字段集；root 无 data 不适用——详情页仅卷/章/场可达）：
 * scene——goal/conflict_levels/value_from/value_to；chapter——reversal/climax_scene；
 * volume——climax_scene/inciting_scene。
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
 * 冲突层次多选切换（checkbox 组 ↔ conflict_levels 数组）：
 * 勾选 → 追加（保持 CONFLICT_LEVELS 声明序）；取消 → 移除。非法值（不在枚举内）忽略。
 */
export function toggleConflictLevel(current: string[], level: string): string[] {
  if (!(CONFLICT_LEVELS as readonly string[]).includes(level)) return current;
  return current.includes(level) ? current.filter((v) => v !== level) : [...current, level];
}

/** 场景节点选择器选项（树序遍历 + 仅 scene 叶子；不含卷/章——引用字段只指向场景，决策 23）。
 * 深度沿用 flattenTree 语义（root=0、卷=1、章=2）用于缩进展示 */
export function sceneNodeOptions(nodes: OutlineNode[]): Array<{ id: string; label: string; depth: number }> {
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
 * 引用字段「未设置」提交值：空串 ""（服务端 schema z.string().optional() 不接受 null——
 * 部分合并传 null 会被 400 拒绝；空串合法且浅合并即覆盖清除）。表单值归一：
 * 缺失/空串 → ""（「（未设置）」选项），有值 → id。
 */
export function sceneSelectValue(raw: unknown): string {
  return typeof raw === "string" && raw !== "" ? raw : "";
}
