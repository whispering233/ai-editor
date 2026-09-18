// 参考资料页共享的纯逻辑（卡 12.8）：来源取值、实体 PUT 的 data 载荷、「导入 md 新建」分派。
// 页面组件不参与单测（仓内无 jsdom，块编辑器内部不测，由浏览器走查承担）⇒ 有分支的判断放这里。
// 契约：docs/api/30-api-entity.md（reference 特例 / 导入导出）。
import type { DocumentImportPlan } from "./document-io";
import { planDocumentImport } from "./document-io";
import { parseReferenceFrontmatter } from "./reference-frontmatter";
import { parseTagsInput } from "./timeline";

/**
 * 参考资料分类中文名映射（**仅存量回显**——`material` 等旧枚举值回显中文名，非可选建议；
 * 新自定义分类无映射原样显示）。**单一来源**：列表分类列 / 详情页头 / 两处筛选与建议下拉都读这里，
 * 不要再在页面里各手抄一份。
 */
export const TYPE_LABELS: Record<string, string> = {
  material: "素材摘抄",
  inspiration: "灵感记录",
  theory: "写作理论",
  reference: "设定参考",
};

/** 分类展示文案：有映射用中文名，自定义分类原样（空串 → 空串，调用点据此不渲染徽标） */
export function referenceTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/**
 * 来源取值（列表「来源」列与详情元信息行共用）：**只认 `url`**。
 * `kind` / `file_name` / `source` 是文件机制遗留字段（2026-10 起已废弃，读侧不认——旧值不迁移）。
 */
export function referenceSource(data: Record<string, unknown> | undefined): string {
  const url = data?.url;
  return typeof url === "string" ? url : "";
}

/**
 * 实体 PUT / POST 的 `data` 载荷（手动保存：名称/分类/标签/URL 与正文一起提交）。
 * - `content` = 块数组 JSON 字符串；**空串（编辑器还没产出内容 = 服务端「从未写过」）不发送**——
 *   服务端对 `data.content` 做块数组浅校验，空串会 400；「不携带 = 正文保持不动」正好是未写过的语义
 * - `url` / 标签为空同样不发：partial update 里「不发 = 保持不动」，与其它实体一致
 * - `type` 恒发（页面自带缺省 `material`——REST 不兜底，见 docs/api/30-api-entity.md「reference 特例」）
 */
export function referenceSaveData(
  form: { type: string; tagsInput: string; url: string },
  content: string,
): Record<string, unknown> {
  const tags = parseTagsInput(form.tagsInput);
  const url = form.url.trim();
  return {
    type: form.type,
    ...(url === "" ? {} : { url }),
    ...(tags.length === 0 ? {} : { tags }),
    ...(content === "" ? {} : { content }),
  };
}

/** 「导入 md 新建」判定结果（列表页按 action 分派：直接建条目 / 先弹有损确认 / 报可见错误） */
export type ReferenceImportPlan =
  | { action: "apply"; name: string; content: string }
  | { action: "confirm-lossy"; name: string; content: string; unsupportedCount: number }
  | { action: "error"; message: string };

/**
 * 「导入 md 新建」分派：条目名取 frontmatter `title`（无则文件名去扩展名），**其余正文**走既有导入分派
 * （md → 块 + 往返比对，有损必须由用户确认）。frontmatter 段不进正文，避免 `---` / `title:` 被当成正文块。
 */
export function planReferenceImport(
  fileName: string,
  text: string,
  parseMarkdown: (markdown: string) => { content: string; roundTripped: string },
): ReferenceImportPlan {
  const { name, body } = parseReferenceFrontmatter(fileName, text);
  const plan: DocumentImportPlan = planDocumentImport(fileName, body, parseMarkdown);
  return plan.action === "error" ? plan : { ...plan, name };
}
