// 实体路由一级化映射（批次十七 1-1）：实体类型 → 一级 hash 路由段，唯一事实源。
// 泛型列表宿主仅 character/setting/location 存在（relations 为关联总览，不属实体类型）；
// hook/event/timepoint/reference 的详情由各自宿主段承载（hooks/:id、timeline/:id、
// timepoints/:id、references/:id）——「无导航列表 ≠ 无详情路由」（详情不经列表）。
// 旧 #/entities/* 由 main.tsx 重定向（见 main.tsx 路由表），本模块只产新段路径。
import type { EntityType } from "@whispering233/ai-editor-shared";

/** 泛型列表宿主类型（一级导航存在列表页的实体类型） */
export type ListableEntityType = "character" | "setting" | "location";

const LIST_SEGMENTS: Record<ListableEntityType, string> = {
  character: "characters",
  setting: "setting",
  location: "locations",
};

/** 实体类型 → 详情/宿主路由首段（event → timeline 详情页、reference → 参考资料详情页为宿主页） */
const DETAIL_SEGMENTS: Record<EntityType, string> = {
  character: "characters",
  setting: "setting",
  location: "locations",
  hook: "hooks",
  event: "timeline",
  timepoint: "timepoints",
  reference: "references",
};

/** 泛型列表路由（仅 ListableEntityType 有列表） */
export function entityListPath(type: ListableEntityType): string {
  return `/${LIST_SEGMENTS[type]}`;
}

/** 实体详情路由（按类型落各宿主段；详情页组件随宿主段路由决定，见 main.tsx） */
export function entityDetailPath(type: EntityType, id: string): string {
  return `/${DETAIL_SEGMENTS[type]}/${id}`;
}

/** 返回宿主列表/富页路由（详情页「返回」目标：列表存在 → 列表；无列表 → 富页宿主） */
export function entityListHost(type: EntityType): string {
  return type === "character" || type === "setting" || type === "location"
    ? `/${LIST_SEGMENTS[type]}`
    : type === "hook"
      ? "/hooks"
      : "/timeline"; // event/timepoint 宿主 = 时间轴富页（reference 走独立 references 页，不经本函数）
}
