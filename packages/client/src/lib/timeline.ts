// 时间轴列表页 + 事件表单辅助纯函数（C3，决策 26；G2.3 修订：双实体模型）
// 契约：doc/ui/pages/timeline.md（G2 布局线框：时间点组块 + 事件挂载 + 未挂载兜底区、标签筛选、
//   拖拽插入位、标签输入解析、详情页字段编辑）、endpoints.md（event/timepoint 列表 EntitySummary、
//   occurs_at 关系挂载，G2 修订）
// G2 模型（决策 26 G2 修订）：时间轴数据项 = 时间点实体（timepoint，name = 时间标签文本）+ 事件实体
//   （event，经 occurs_at 挂载到时间点，1:n）；渲染 = buildTimelineModel 按 timepoint.sort_order
//   组块序 + 事件 sort_order 组内投影 + 未挂载兜底区。F4 的 groupEventsByTimeLabel 分组（time_label
//   派生组）已随 G2 废弃——分组 = 真实时间点实体 + occurs_at 关系。
// 风格：与 outline-tree.ts（dropInsertOrder）同构——拖拽插入位剔除拖拽项后计算；
//       与 entity-list.ts 同构——summary 稀疏字段防御（非字符串数组成员过滤）。
// 事件表单共享（C3 列表页编辑对话框 / C4 详情页共用，单一实现消除同步风险）：
//   EventDetailForm / eventFormFromDetail / buildEventDetailPatch 原属 lib/timeline-detail.ts（C4），
//   为按卡拆分 commit 而迁入本文件——Timeline.tsx 只依赖本文件（C3 产物），详情页单向依赖本文件。
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import type { RelationSummaryItem } from "./api";

/** 拖拽插入目标（事件列表无层级——outline-tree.ts DragTarget 的扁平化版本） */
export type TimelineDropInsert =
  { kind: "before"; id: string } | { kind: "after"; id: string } | { kind: "end" };

/**
 * 拖拽插入位 → order（0-based 全局线性序，决策 26/G2）：
 * **剔除拖拽节点后计算**（同 dropInsertOrder 第三参语义）——服务端 move（event/timepoint 同款）
 * 先移除自身再按 order 插入；同列表重排时锚点在拖拽项下方会出现 1 位错位，须先剔除。
 * 锚点不存在 → 末尾（防御；列表与拖拽态同源，理论不可达）。
 * G2 双实体共用：时间点序（组间）与事件序（组内排序键）各自独立调用。
 */
export function eventDropOrder(
  ids: string[],
  insert: TimelineDropInsert,
  excludeId?: string,
): number {
  const siblings = excludeId === undefined ? ids : ids.filter((id) => id !== excludeId);
  if (insert.kind === "end") return siblings.length;
  const idx = siblings.indexOf(insert.id);
  if (idx === -1) return siblings.length;
  return insert.kind === "before" ? idx : idx + 1;
}

// ============ G2 双实体模型（时间点组块 + 事件挂载 + 未挂载兜底区） ============

/** 时间点组块（G2）：时间点实体 + 组内事件（组内序 = 事件全局 sort_order 投影——events 入参已按序） */
export interface TimepointGroup {
  /** 时间点实体（name = 时间标签文本，可重命名） */
  timepoint: EntitySummary;
  /** 组内事件（保持传入列表相对序——列表即 sort_order 线性投影） */
  events: EntitySummary[];
}

/** 时间轴渲染模型（G2，timeline.md 布局线框）：组块序 + 未挂载兜底区 */
export interface TimelineModel {
  /** 时间点组块（按 timepoints 传入序 = timepoint.sort_order 线性投影；空组保留——时间点是真实实体） */
  groups: TimepointGroup[];
  /** 未挂载事件（无 occurs_at 或挂载点不在时间点列表——防御；按事件 sort_order 平铺） */
  ungrouped: EntitySummary[];
}

/**
 * 构建时间轴渲染模型（G2，timeline.md「数据源重构」）：
 * - groups：按时间点列表序（sort_order 投影）分组；事件经 occursAtEdges 的挂载映射归组
 * - ungrouped：无挂载 / 挂载点缺失（occursAtEdges 引用了时间点列表之外的时间点——防御，
 *   正常不可达：服务端级联软删保证 occurs_at 端点存活）的事件
 * - 挂载映射构建：relation_type === "occurs_at" 且 sourceType === "timepoint" 的边，
 *   targetId（事件）→ sourceId（时间点）；单事件多条挂载边（服务端 1:n 校验，理论不可达）→
 *   首次出现者胜（防御）
 * - 组内/未挂载区事件均保持 events 传入相对序（列表即 sort_order 线性投影，决策 26）
 */
export function buildTimelineModel(
  timepoints: readonly EntitySummary[],
  events: readonly EntitySummary[],
  occursAtEdges: readonly RelationSummaryItem[],
): TimelineModel {
  const groups: TimepointGroup[] = timepoints.map((timepoint) => ({ timepoint, events: [] }));
  const groupById = new Map(groups.map((g) => [g.timepoint.id, g]));
  // 挂载映射（事件 → 时间点；1:n 由服务端保证，防御性首次胜出）
  const mountOf = new Map<string, string>();
  for (const edge of occursAtEdges) {
    if (edge.relationType !== "occurs_at" || edge.sourceType !== "timepoint") continue;
    if (mountOf.has(edge.targetId)) continue;
    mountOf.set(edge.targetId, edge.sourceId);
  }
  const ungrouped: EntitySummary[] = [];
  for (const ev of events) {
    const tpId = mountOf.get(ev.id);
    const group = tpId === undefined ? undefined : groupById.get(tpId);
    if (group === undefined) ungrouped.push(ev);
    else group.events.push(ev);
  }
  return { groups, ungrouped };
}

/**
 * 事件拖入组块（时间点组 / 未挂载区）的插入位 order（G2 双轨拖拽）：
 * - targetIndex：groups 下标（-1 = 未挂载兜底区）
 * - side：before → 组内首事件前；after → 组内末事件后
 * - **空组**（时间点无事件）：before → 其后最近非空组的首事件前（再无 → 列表末尾）；
 *   after → 其前最近非空组的末事件后（再无 → 组首位置 0）——空组无锚点事件，
 *   以相邻有事件组的边界事件为锚（视觉等价：事件落在空组所在区间）
 * - 未挂载区：before → 未挂载首事件前；after → 未挂载末事件后；区空 → 列表末尾
 * - order = 全部事件投影序（组块序 + 未挂载区序）**剔除拖拽事件后**的插入位（eventDropOrder 语义）
 */
export function eventOrderIntoGroup(
  groups: readonly TimepointGroup[],
  ungrouped: readonly EntitySummary[],
  targetIndex: number,
  side: "before" | "after",
  draggedId: string,
): number {
  const allIds = [
    ...groups.flatMap((g) => g.events.map((e) => e.id)),
    ...ungrouped.map((e) => e.id),
  ];
  let anchor: EntitySummary | undefined;
  if (targetIndex === -1) {
    anchor = side === "before" ? ungrouped[0] : ungrouped[ungrouped.length - 1];
  } else {
    const group = groups[targetIndex];
    if (group !== undefined) {
      if (side === "before") {
        anchor = group.events[0];
        if (anchor === undefined) {
          // 空组：向后找最近非空组的首事件
          for (let i = targetIndex + 1; i < groups.length; i++) {
            const first = groups[i].events[0];
            if (first !== undefined) {
              anchor = first;
              break;
            }
          }
        }
      } else {
        anchor = group.events[group.events.length - 1];
        if (anchor === undefined) {
          // 空组：向前找最近非空组的末事件
          for (let i = targetIndex - 1; i >= 0; i--) {
            const last = groups[i].events[groups[i].events.length - 1];
            if (last !== undefined) {
              anchor = last;
              break;
            }
          }
        }
      }
    }
  }
  if (anchor !== undefined) {
    return eventDropOrder(allIds, { kind: side, id: anchor.id }, draggedId);
  }
  // 无任何锚点（空组且前后均无事件 / 防御）：全部事件剔除拖拽项后的首事件前（= 0）或末尾
  const first = allIds.find((id) => id !== draggedId);
  return first === undefined ? 0 : eventDropOrder(allIds, { kind: "before", id: first }, draggedId);
}

// ============ 事件摘要字段与标签（F6 描述 / F8 标签建议） ============

/** 事件的 tags 摘要字段（非数组/非字符串成员防御——与 db matchDataFilters 同风格）；标签聚合/行渲染共用 */
export function eventTagsOf(item: EntitySummary): string[] {
  const tags = (item.summary as Record<string, unknown>).tags;
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
}

/** 事件的 description 摘要字段（非字符串防御 → 空串 = 行内不渲染描述区，timeline.md 信息层级）；F6 行内描述展示 */
export function eventDescription(item: EntitySummary): string {
  const desc = (item.summary as Record<string, unknown>).description;
  return typeof desc === "string" ? desc : "";
}

/**
 * 标签输入建议（F8，timeline.md 标签输入建议节）：
 * 按输入**最后一段**（逗号/顿号/换行分隔，trim 后）匹配已存在标签：
 * - 最后一段为空（含整串为空/以分隔符结尾）→ 无建议（[]）——只在正在输入新标签时提示
 * - 包含匹配（大小写不敏感）；排除已选标签（前面各段 trim 后已含的）；去重（防御 allTags 重复）
 * - 稳定序（按 allTags 顺序）；limit 默认 5
 */
export function suggestTags(input: string, allTags: string[], limit = 5): string[] {
  const segments = input.split(/[,，、\n]/);
  const last = segments[segments.length - 1].trim();
  if (last === "") return [];
  const selected = new Set(
    segments
      .slice(0, -1)
      .map((s) => s.trim())
      .filter((s) => s !== ""),
  );
  const needle = last.toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>(); // 去重：防御 allTags 含重复项（collectEventTags 已去重，理论不可达）
  for (const tag of allTags) {
    if (out.length >= limit) break;
    if (selected.has(tag) || seen.has(tag)) continue;
    if (tag.toLowerCase().includes(needle)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/**
 * 点选建议填入（F8）：把输入**最后一段替换为所选标签**并追加逗号——
 * 保持逗号分隔输入兼容（parseTagsInput 多分隔符解析，统一收敛为中文逗号，同 tagsToInput 风格）；
 * 替换后最后一段为空 → 建议区自然消失（suggestTags 空段不匹配）。
 */
export function applyTagSuggestion(input: string, tag: string): string {
  const segments = input.split(/[,，、\n]/);
  segments[segments.length - 1] = tag;
  return segments.join("，") + "，";
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
  return Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === "string").join("，")
    : "";
}

// ============ 事件表单（C3 编辑对话框与 C4 详情页共用） ============

/** 事件表单值（name + data 两字段；tags 为输入框字符串，提交前 parseTagsInput 收敛）。
 * G2 修订：time_label 已移除——时间标签 = 时间点挂载（occurs_at），由挂载选择器/拖拽表达 */
export interface EventDetailForm {
  name: string;
  description: string;
  tagsInput: string;
}

/** 详情响应 → 表单初始值（data 两字段防御提取；tags 数组 → 逗号输入串）——C3 编辑预填与 C4 详情页共用 */
export function eventFormFromDetail(detail: {
  name: string;
  data: Record<string, unknown>;
}): EventDetailForm {
  const data = detail.data;
  return {
    name: detail.name,
    description: typeof data.description === "string" ? data.description : "",
    tagsInput: tagsToInput(data.tags),
  };
}

/**
 * 表单 → PUT /entity/event/:id partial patch（C3 编辑对话框与 C4 详情页共用同一稀疏提交语义，
 * timeline.md 详情页字段编辑；G2 修订：仅 description/tags——time_label 已移除）：
 * - name：trim 后与原名不同才提交
 * - data 两字段：清空语义——表单有值 → 提交 trim 后值；表单空但原值非空 → 提交空值
 *   （description 空串 ""、tags 空数组 []）显式清除；原值本就空 → 不提交。
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
  const tags = parseTagsInput(form.tagsInput);
  // tags 同款：空数组 [] 清除原值（原值本就空 → 不提交）
  if (tags.length > 0 || original.data.tags !== undefined) nextData.tags = tags;
  const changed: Record<string, unknown> = {};
  for (const key of ["description", "tags"] as const) {
    if (JSON.stringify(nextData[key]) !== JSON.stringify(original.data[key])) {
      changed[key] = nextData[key];
    }
  }
  if (Object.keys(changed).length > 0) patch.data = changed;
  return patch.name === undefined && patch.data === undefined ? null : patch;
}
