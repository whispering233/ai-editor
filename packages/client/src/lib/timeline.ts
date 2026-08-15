// 时间轴列表页 + 事件表单辅助纯函数（C3，决策 26）
// 契约：doc/ui/pages/timeline.md（标签筛选/拖拽插入位/标签输入解析、详情页字段编辑）、
//   endpoints.md（event 列表 EntitySummary：summary 含 description/time_label/tags）
// 风格：与 outline-tree.ts（dropInsertOrder）同构——拖拽插入位剔除拖拽项后计算；
//       与 entity-list.ts 同构——summary 稀疏字段防御（非字符串数组成员过滤）。
// 事件表单共享（C3 列表页编辑对话框 / C4 详情页共用，单一实现消除同步风险）：
//   EventDetailForm / eventFormFromDetail / buildEventDetailPatch 原属 lib/timeline-detail.ts（C4），
//   为按卡拆分 commit 而迁入本文件——Timeline.tsx 只依赖本文件（C3 产物），详情页单向依赖本文件。
import type { EntitySummary } from "@whispering233/ai-editor-shared";

/** 拖拽插入目标（事件列表无层级——outline-tree.ts DragTarget 的扁平化版本） */
export type TimelineDropInsert =
  | { kind: "before"; id: string }
  | { kind: "after"; id: string }
  | { kind: "end" };

/**
 * 拖拽插入位 → order（0-based 全局事件线性序，决策 26）：
 * **剔除拖拽节点后计算**（同 dropInsertOrder 第三参语义）——服务端 moveEvent 先移除
 * 自身再按 order 插入；同列表重排时锚点在拖拽项下方会出现 1 位错位，须先剔除。
 * 锚点不存在 → 末尾（防御；列表与拖拽态同源，理论不可达）。
 */
export function eventDropOrder(ids: string[], insert: TimelineDropInsert, excludeId?: string): number {
  const siblings = excludeId === undefined ? ids : ids.filter((id) => id !== excludeId);
  if (insert.kind === "end") return siblings.length;
  const idx = siblings.indexOf(insert.id);
  if (idx === -1) return siblings.length;
  return insert.kind === "before" ? idx : idx + 1;
}

/** 事件的 tags 摘要字段（非数组/非字符串成员防御——与 db matchDataFilters 同风格） */
function tagsOf(item: EntitySummary): string[] {
  const tags = (item.summary as Record<string, unknown>).tags;
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
}

/** 收集全部事件的标签去重（稳定序：按列表序首次出现；空串忽略——筛选器选项） */
export function collectEventTags(items: EntitySummary[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    for (const tag of tagsOf(item)) {
      if (tag !== "" && !seen.has(tag)) {
        seen.add(tag);
        out.push(tag);
      }
    }
  }
  return out;
}

/** 按标签过滤（null/空串 = 全部）；tag 无匹配事件 → 空数组（「没有匹配」态） */
export function filterEventsByTag(items: EntitySummary[], tag: string | null): EntitySummary[] {
  if (tag === null || tag === "") return items;
  return items.filter((item) => tagsOf(item).includes(tag));
}

/**
 * 标签输入解析：逗号（中英文）/顿号/换行分隔，trim + 去重 + 过滤空串（新建/编辑表单共用）。
 * 分隔符集与 db tags 数组语义对齐（tags 为字符串数组，无内部格式约定——解析层收敛输入形态）。
 */
export function parseTagsInput(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,，、\n]/)) {
    const tag = part.trim();
    if (tag !== "" && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/** tags 数组 → 输入框展示字符串（与 parseTagsInput 互逆的展示侧；非数组防御） */
export function tagsToInput(tags: unknown): string {
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string").join("，") : "";
}

/** 事件表单值（name + data 三字段；tags 为输入框字符串，提交前 parseTagsInput 收敛）——C3 编辑对话框与 C4 详情页共用 */
export interface EventDetailForm {
  name: string;
  description: string;
  timeLabel: string;
  tagsInput: string;
}

/** 详情响应 → 表单初始值（data 三字段防御提取；tags 数组 → 逗号输入串）——C3 编辑预填与 C4 详情页共用 */
export function eventFormFromDetail(detail: { name: string; data: Record<string, unknown> }): EventDetailForm {
  const data = detail.data;
  return {
    name: detail.name,
    description: typeof data.description === "string" ? data.description : "",
    timeLabel: typeof data.time_label === "string" ? data.time_label : "",
    tagsInput: tagsToInput(data.tags),
  };
}

/**
 * 表单 → PUT /entity/event/:id partial patch（C3 编辑对话框与 C4 详情页共用同一稀疏提交语义，
 * timeline.md 详情页字段编辑）：
 * - name：trim 后与原名不同才提交
 * - data 三字段：清空语义——表单有值 → 提交 trim 后值；表单空但原值非空 → 提交空值
 *   （description/time_label 空串 ""、tags 空数组 []）显式清除；原值本就空 → 不提交。
 *   tags 经 parseTagsInput 收敛为数组后进 nextData
 * - nextData 与原 data 逐键 JSON 序列化比对，有变化的键才提交
 * - 全部无变化 → null（「没有变更」提示）
 * 边界：原值空/不存在时空值提交会被判为无变更，天然满足「原值本就空 → 不提交」。
 */
export function buildEventDetailPatch(
  original: { name: string; data: Record<string, unknown> },
  form: EventDetailForm,
): { name?: string; data?: Record<string, unknown> } | null {
  const patch: { name?: string; data?: Record<string, unknown> } = {};
  if (form.name.trim() !== original.name) patch.name = form.name.trim();
  const nextData: Record<string, unknown> = {};
  // 清空语义：表单空但原值非空 → 提交空串 "" 显式清除（服务端浅合并可正常写入覆盖）
  if (form.description.trim() !== "" || original.data.description !== undefined) {
    nextData.description = form.description.trim();
  }
  if (form.timeLabel.trim() !== "" || original.data.time_label !== undefined) {
    nextData.time_label = form.timeLabel.trim();
  }
  const tags = parseTagsInput(form.tagsInput);
  // tags 同款：空数组 [] 清除原值（原值本就空 → 不提交）
  if (tags.length > 0 || original.data.tags !== undefined) nextData.tags = tags;
  const changed: Record<string, unknown> = {};
  for (const key of ["description", "time_label", "tags"] as const) {
    if (JSON.stringify(nextData[key]) !== JSON.stringify(original.data[key])) {
      changed[key] = nextData[key];
    }
  }
  if (Object.keys(changed).length > 0) patch.data = changed;
  return patch.name === undefined && patch.data === undefined ? null : patch;
}
