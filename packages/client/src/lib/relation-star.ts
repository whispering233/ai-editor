// 人物关系星形图布局纯函数（卡 8.4）
// 契约：`docs/ui/DESIGN.md` §数据展示 `relation-star-graph`——「人物关系网」tab 内、分组列表**之上**的纯展示图
// （同一数据集：图 = 索引、列表 = 明细；不加 tab、不加路由、不发新请求）。中心 = 当前角色，叶子 = 关系网**去重后**的
// 对方节点（半径随叶子数自适应），有向画箭头（out 朝外 / in 朝内），对称合并行与自环不画箭头（自环不进图）；
// 叶子名 12px 截断到 8 字；阈值 = 去重后行数 < 4 不渲染；叶子 > 24 只画点不画名字。
// 1 跳星形 = 极坐标，本模块只做几何与判据（无 DOM），渲染在 `components/character/relation-star-graph.tsx`。
import type { CharacterRelationEndpoint, CharacterRelationRow } from "./character-relations";

/** 判据 1：去重后行数 < `RELATION_STAR_MIN_ROWS` 不渲染（零星关系零信息量 → `buildRelationStarLayout` 返回 null） */
export const RELATION_STAR_MIN_ROWS = 4;

/** 判据 2：叶子 > `RELATION_STAR_LABEL_MAX_LEAVES` 只画点不画名字（拥挤无解） */
export const RELATION_STAR_LABEL_MAX_LEAVES = 24;

/** 叶子名截断字数（超出加 `…`） */
export const RELATION_STAR_LABEL_MAX_CHARS = 8;

/** 画布尺寸（viewBox；渲染侧按容器宽度等比缩放） */
export const RELATION_STAR_WIDTH = 400;
export const RELATION_STAR_HEIGHT = 220;

/** 画布内边距（叶子标签要落在画布内） */
export const RELATION_STAR_PADDING = 26;

/** 半径下限 */
export const RELATION_STAR_MIN_RADIUS = 56;

/** 每个叶子所需的圆周弧长（叶子越多半径越大，直到撞上画布上限） */
export const RELATION_STAR_ARC_PER_LEAF = 56;

/** 标签与叶子点的间距 */
export const RELATION_STAR_LABEL_GAP = 8;

/** 箭头端内缩量（箭尖不压在端点圆上） */
export const RELATION_STAR_ARROW_GAP = 8;

export interface RelationStarPoint {
  x: number;
  y: number;
}

/** 叶子方向（自环已被剔除） */
export type RelationStarLeafDirection = "out" | "in" | "both";

export interface RelationStarLeaf {
  key: string;
  other: CharacterRelationEndpoint;
  direction: RelationStarLeafDirection;
  /** 箭头：`out` = 指向叶子、`in` = 指向中心、`both`（对称合并行）= null 不画箭头 */
  arrow: "out" | "in" | null;
  /** 叶子点（圆点 + 可点热区） */
  point: RelationStarPoint;
  /** 连线（画箭头的这端已按 `RELATION_STAR_ARROW_GAP` 内缩；无箭头时 = 中心 → 叶子点） */
  line: { from: RelationStarPoint; to: RelationStarPoint };
  /** 标签位置与锚点（`anchor` 直接传给 SVG `text-anchor`） */
  label: { point: RelationStarPoint; anchor: "start" | "middle" | "end" };
}

export interface RelationStarLayout {
  width: number;
  height: number;
  center: RelationStarPoint;
  radius: number;
  /** 判据 2：叶子 > `RELATION_STAR_LABEL_MAX_LEAVES` → false（只画点） */
  showLabels: boolean;
  /** 极坐标叶子（从正上方起顺时针均匀分布） */
  leaves: RelationStarLeaf[];
}

/** 叶子名截断（> 8 字加 `…`；按码点切，不劈开代理对/代理项） */
export function truncateRelationStarName(name: string): string {
  const chars = Array.from(name);
  if (chars.length <= RELATION_STAR_LABEL_MAX_CHARS) return name;
  return `${chars.slice(0, RELATION_STAR_LABEL_MAX_CHARS).join("")}…`;
}

/**
 * 半径（叶子数自适应）：叶子数 × 每叶弧长 ÷ 2π，夹在 `RELATION_STAR_MIN_RADIUS` 与画布可用半径之间
 * （画布过小时保下限——宁可变挤也不塌成一点）。
 */
export function relationStarRadius(
  leafCount: number,
  size: { width: number; height: number } = {
    width: RELATION_STAR_WIDTH,
    height: RELATION_STAR_HEIGHT,
  },
): number {
  const available = Math.min(size.width, size.height) / 2 - RELATION_STAR_PADDING;
  const needed = (leafCount * RELATION_STAR_ARC_PER_LEAF) / (2 * Math.PI);
  return Math.min(
    Math.max(needed, RELATION_STAR_MIN_RADIUS),
    Math.max(available, RELATION_STAR_MIN_RADIUS),
  );
}

/** 标签锚点：左右两侧（|cos| ≥ 0.5）贴圆点外侧、竖排居中；上/下半区在圆点正上/正下居中 */
function starLabel(point: RelationStarPoint, cos: number, sin: number): RelationStarLeaf["label"] {
  if (cos >= 0.5) {
    return { point: { x: point.x + RELATION_STAR_LABEL_GAP, y: point.y + 4 }, anchor: "start" };
  }
  if (cos <= -0.5) {
    return { point: { x: point.x - RELATION_STAR_LABEL_GAP, y: point.y + 4 }, anchor: "end" };
  }
  return { point: { x: point.x, y: point.y + (sin > 0 ? 16 : -8) }, anchor: "middle" };
}

/**
 * 关系网行（**已去重**的 `CharacterRelationRow[]`）→ 星形图布局。
 * 三个判据：行数 < `RELATION_STAR_MIN_ROWS` → null（不渲染，自环行也计入行数）；叶子 > `RELATION_STAR_LABEL_MAX_LEAVES`
 * → `showLabels: false`；`direction === "self"` 剔除（剔除后无叶子的退化情形同样返回 null——只剩中心点无信息量）。
 */
export function buildRelationStarLayout(
  rows: readonly CharacterRelationRow[],
  size: { width: number; height: number } = {
    width: RELATION_STAR_WIDTH,
    height: RELATION_STAR_HEIGHT,
  },
): RelationStarLayout | null {
  if (rows.length < RELATION_STAR_MIN_ROWS) return null;
  // 判据 3：自环剔除（类型谓词把 `direction` 收窄到 `RelationStarLeafDirection`）
  const leaves = rows.filter(
    (row): row is CharacterRelationRow & { direction: RelationStarLeafDirection } =>
      row.direction !== "self",
  );
  if (leaves.length === 0) return null;

  const center: RelationStarPoint = { x: size.width / 2, y: size.height / 2 };
  const radius = relationStarRadius(leaves.length, size);
  const step = (2 * Math.PI) / leaves.length;

  return {
    width: size.width,
    height: size.height,
    center,
    radius,
    showLabels: leaves.length <= RELATION_STAR_LABEL_MAX_LEAVES,
    leaves: leaves.map((row, index) => {
      const angle = -Math.PI / 2 + index * step; // 正上方起，顺时针均匀
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const point: RelationStarPoint = { x: center.x + radius * cos, y: center.y + radius * sin };
      const arrowEnd: RelationStarPoint = {
        x: point.x - cos * RELATION_STAR_ARROW_GAP,
        y: point.y - sin * RELATION_STAR_ARROW_GAP,
      };
      const inner: RelationStarPoint = {
        x: center.x + cos * RELATION_STAR_ARROW_GAP,
        y: center.y + sin * RELATION_STAR_ARROW_GAP,
      };
      const arrow = row.direction === "both" ? null : row.direction;
      return {
        key: row.key,
        other: row.other,
        direction: row.direction,
        arrow,
        point,
        // in：对方 → 我，端点顺序反过来（箭头端 = 中心侧）；both/无箭头：整条中心 → 叶子点
        line:
          arrow === "in"
            ? { from: point, to: inner }
            : { from: center, to: arrow === "out" ? arrowEnd : point },
        label: starLabel(point, cos, sin),
      };
    }),
  };
}
