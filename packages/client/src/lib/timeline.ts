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

/** 时间轴分组（F4，决策 26）：同 time_label 事件聚为一组（novu 模式：分组纯函数与 UI 分离） */
export interface TimelineGroup {
  /** 分组键（折叠状态用）：time_label trim 后非空 → 标签文本；空/缺失 → 统一 ""（兜底组） */
  key: string;
  /** 展示文本：正常组 = trim 后标签；兜底组 = ""（UI 占位「未标注时间」，timeline.md F4 线框） */
  label: string;
  /** 组内事件（保持原列表相对序） */
  events: EntitySummary[];
}

/**
 * 按 time_label 分组（F4，timeline.md「时间点分组」线框）：
 * - 同标签（trim 后非空）聚为一组；组序 = 组内最早事件在列表中的 index 序
 *   （列表即 sort_order 线性投影——组序随拖拽自然迁移，组是派生视图、无独立持久化）
 * - 标签为空/缺失（eventTimeLabel 提取后 trim 为空，含纯空白字符串）→ 兜底组
 *   （key = ""、label = ""），放在组序末尾；无空标签事件 → 不产生兜底组
 * - 组内 events 保持原列表相对序
 */
export function groupEventsByTimeLabel(items: EntitySummary[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  const byKey = new Map<string, TimelineGroup>();
  // 兜底组延迟入列：正常组收集完后若非空再追加（组序末尾）
  const fallback: TimelineGroup = { key: "", label: "", events: [] };
  for (const item of items) {
    const label = eventTimeLabel(item).trim();
    if (label === "") {
      fallback.events.push(item);
      continue;
    }
    let group = byKey.get(label);
    if (group === undefined) {
      group = { key: label, label, events: [] };
      byKey.set(label, group);
      groups.push(group);
    }
    group.events.push(item);
  }
  if (fallback.events.length > 0) groups.push(fallback);
  return groups;
}

/**
 * 组块拖拽 → 组内各事件 move order 序列（F4，决策 26）：
 * - ids 为拖拽前的完整事件 id 序（sort_order 线性投影）；dragIds 为被拖组块的事件 id（组内序），
 *   返回值与 dragIds 一一对应（第 i 个 order 供 dragIds[i] 的 PUT /move 调用，逐次顺序执行）
 * - insert 为插入位：锚点 id 取目标组**首/末事件**（before → 首事件、after → 末事件）——
 *   锚点属于目标组，必不在被拖组块内；kind="end" 为防御分支（拖到列表末尾）
 * - 语义（单事件组退化为 F3 eventDropOrder 的单次调用，行为完全一致）：
 *   服务端 moveEvent 先剔除自身再按 order splice 插入并整体重排（db/src/queries/entity.ts）；
 *   多事件组按组内序逐事件移动——首个事件锚定插入位，后续事件**依次跟随上一已移动事件**
 *   （以其为锚插到之后），最终组块保持原相对序整体落在插入位；order 每次基于当前列表
 *   模拟计算（与服务端同式），避免先前移动导致锚点坐标漂移。
 */
export function groupDropOrders(ids: string[], insert: TimelineDropInsert, dragIds: string[]): number[] {
  const orders: number[] = [];
  if (dragIds.length === 0) return orders;
  // 模拟服务端 moveEvent：剔除当前事件 → 按 order 插入 → 整体重排（cur 即服务端逐次 move 后的列表）
  let cur = [...ids];
  let prevId: string | undefined;
  for (const id of dragIds) {
    const rest = cur.filter((x) => x !== id);
    let order: number;
    if (prevId === undefined) {
      // 首个事件：锚定插入位（before → 锚前、after → 锚后、end → 末尾；锚缺失防御 → 末尾）
      if (insert.kind === "end") {
        order = rest.length;
      } else {
        const idx = rest.indexOf(insert.id);
        order = idx === -1 ? rest.length : insert.kind === "after" ? idx + 1 : idx;
      }
    } else {
      // 后续事件：紧跟上一已移动事件之后（prevId 必在当前列表中，防御 → 末尾）
      const idx = rest.indexOf(prevId);
      order = idx === -1 ? rest.length : idx + 1;
    }
    orders.push(order);
    rest.splice(order, 0, id);
    cur = rest;
    prevId = id;
  }
  return orders;
}

/** 事件的 tags 摘要字段（非数组/非字符串成员防御——与 db matchDataFilters 同风格）；标签聚合/行渲染共用 */
export function eventTagsOf(item: EntitySummary): string[] {
  const tags = (item.summary as Record<string, unknown>).tags;
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
}

/** 事件的 time_label 摘要字段（非字符串防御 → 空串 = 行内「未标注时间」，timeline.md 信息层级）；F3 时间轴行渲染 */
export function eventTimeLabel(item: EntitySummary): string {
  const label = (item.summary as Record<string, unknown>).time_label;
  return typeof label === "string" ? label : "";
}

/** 收集全部事件的标签去重（稳定序：按列表序首次出现；空串忽略——筛选器选项） */
export function collectEventTags(items: EntitySummary[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    for (const tag of eventTagsOf(item)) {
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
  return items.filter((item) => eventTagsOf(item).includes(tag));
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
