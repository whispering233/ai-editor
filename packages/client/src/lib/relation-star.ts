// 人物关系星形图布局纯函数（卡 8.4）
// 契约：`docs/ui/DESIGN.md` §数据展示 `relation-star-graph`——「人物关系网」tab 内、分组列表**之上**的纯展示图
// （同一数据集：图 = 索引、列表 = 明细；不加 tab、不加路由、不发新请求）。中心 = 当前角色；
// 叶子 = **按对方人物去重**（同一人的多条关系合并为一叶，方向 = 任一行 both 或 out/in 并存 → both 不画箭头；
// 条数 > 1 时名字后缀 `· N`）；有向画箭头（out 朝外 / in 朝内），自环不进图；
// 叶子名 12px 截断到 8 字；阈值 = 去重后叶子数 < 4 不渲染；叶子 > 24 只画点不画名字。
// 半径随叶子数自适应，**画布高度随半径长高**（上限 `RELATION_STAR_MAX_HEIGHT`）——否则约 10 叶起半径撞上
// 扁画布的可用半径，叶子挤成一圈。
// 1 跳星形 = 极坐标，本模块只做几何与判据（无 DOM），渲染在 `components/character/relation-star-graph.tsx`。
import type { CharacterRelationEndpoint, CharacterRelationRow } from "./character-relations";

/** 判据 1：去重后叶子数（= 对方人物数）< `RELATION_STAR_MIN_LEAVES` 不渲染（零星关系零信息量） */
export const RELATION_STAR_MIN_LEAVES = 4;

/** 判据 2：叶子 > `RELATION_STAR_LABEL_MAX_LEAVES` 只画点不画名字（拥挤无解） */
export const RELATION_STAR_LABEL_MAX_LEAVES = 24;

/** 叶子名截断字数（超出加 `…`） */
export const RELATION_STAR_LABEL_MAX_CHARS = 8;

/** 画布尺寸（viewBox；渲染侧按容器宽度等比缩放）。高度是**下限**：半径变大时画布随之上长（上限见下） */
export const RELATION_STAR_WIDTH = 400;
export const RELATION_STAR_HEIGHT = 220;

/** 画布高度上限（半径可用的纵向预算；再高就不是一张卡里的「一眼看」了） */
export const RELATION_STAR_MAX_HEIGHT = 480;

/** 画布内边距（叶子标签要落在画布内） */
export const RELATION_STAR_PADDING = 26;

/** 半径下限 */
export const RELATION_STAR_MIN_RADIUS = 56;

/** 每个叶子所需的圆周弧长（叶子越多半径越大，直到撞上画布上限） */
export const RELATION_STAR_ARC_PER_LEAF = 56;

/** 标签与叶子点的间距 */
export const RELATION_STAR_LABEL_GAP = 8;

/** 标签字符预估宽度（12px 字号；中文/全角近似 1:1）——只用于判断横向余量是否够放，不参与排版度量 */
export const RELATION_STAR_LABEL_CHAR_WIDTH = 12;

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
  /** 该人物的关系条数（合并的行数；> 1 时名字带 `· N` 后缀） */
  count: number;
  /** 渲染用叶子名（已截断 + 可选条数后缀） */
  labelText: string;
  /** 箭头：`out` = 指向叶子、`in` = 指向中心、`both`（对称合并行或双向并存）= null 不画箭头 */
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
  /** 极坐标叶子（从正上方起顺时针均匀分布；已按对方人物去重） */
  leaves: RelationStarLeaf[];
}

/** 叶子名截断（> 8 字加 `…`；按码点切，不劈开代理对/代理项） */
export function truncateRelationStarName(name: string): string {
  const chars = Array.from(name);
  if (chars.length <= RELATION_STAR_LABEL_MAX_CHARS) return name;
  return `${chars.slice(0, RELATION_STAR_LABEL_MAX_CHARS).join("")}…`;
}

/** 叶子名：截断 8 字，条数 > 1 时后缀 ` · N`（一个叶子对应列表多行时的诚实标注） */
export function relationStarLeafLabel(name: string, count: number): string {
  const truncated = truncateRelationStarName(name);
  return count > 1 ? `${truncated} · ${count}` : truncated;
}

/**
 * 半径（叶子数自适应）：叶子数 × 每叶弧长 ÷ 2π，夹在 `RELATION_STAR_MIN_RADIUS` 与可用半径之间
 * （可用半径 = min(宽度预算, `RELATION_STAR_MAX_HEIGHT` 预算)，画布过小时保下限——宁可变挤也不塌成一点）。
 */
export function relationStarRadius(
  leafCount: number,
  size: { width: number; height: number } = {
    width: RELATION_STAR_WIDTH,
    height: RELATION_STAR_HEIGHT,
  },
): number {
  const available = Math.min(
    size.width / 2 - RELATION_STAR_PADDING,
    RELATION_STAR_MAX_HEIGHT / 2 - RELATION_STAR_PADDING,
  );
  const needed = (leafCount * RELATION_STAR_ARC_PER_LEAF) / (2 * Math.PI);
  return Math.min(
    Math.max(needed, RELATION_STAR_MIN_RADIUS),
    Math.max(available, RELATION_STAR_MIN_RADIUS),
  );
}

/**
 * 标签锚点：左右两侧（|cos| ≥ 0.5）默认贴圆点外侧、竖排居中；上/下半区在圆点正上/正下居中。
 * **横向余量不足时翻向内**（叶子多 + 长名字时，outside 锚点会被 SVG 视口裁掉字尾；
 * 半径公式只管纵向，横向余量 = 画布宽度 − 极值叶位置）。
 */
function starLabel(
  point: RelationStarPoint,
  cos: number,
  sin: number,
  options: { width: number; labelChars: number },
): RelationStarLeaf["label"] {
  const textWidth = options.labelChars * RELATION_STAR_LABEL_CHAR_WIDTH;
  if (cos >= 0.5) {
    const inside = point.x + RELATION_STAR_LABEL_GAP + textWidth <= options.width;
    return {
      point: {
        x: inside ? point.x + RELATION_STAR_LABEL_GAP : point.x - RELATION_STAR_LABEL_GAP,
        y: point.y + 4,
      },
      anchor: inside ? "start" : "end",
    };
  }
  if (cos <= -0.5) {
    const inside = point.x - RELATION_STAR_LABEL_GAP - textWidth >= 0;
    return {
      point: {
        x: inside ? point.x - RELATION_STAR_LABEL_GAP : point.x + RELATION_STAR_LABEL_GAP,
        y: point.y + 4,
      },
      anchor: inside ? "end" : "start",
    };
  }
  return { point: { x: point.x, y: point.y + (sin > 0 ? 16 : -8) }, anchor: "middle" };
}

/**
 * 关系网行（**已去重**的 `CharacterRelationRow[]`）→ 星形图布局。
 * 三个判据：自环行剔除；**按对方人物去重**后叶子数 < `RELATION_STAR_MIN_LEAVES` → null（不渲染）；
 * 叶子 > `RELATION_STAR_LABEL_MAX_LEAVES` → `showLabels: false`。
 * 同一人的多行合并为一叶：方向 = 任一行 `both` 或 out/in 并存 → `both`；否则取唯一那向。
 */
export function buildRelationStarLayout(
  rows: readonly CharacterRelationRow[],
  size: { width: number; height: number } = {
    width: RELATION_STAR_WIDTH,
    height: RELATION_STAR_HEIGHT,
  },
): RelationStarLayout | null {
  // 判据 3：自环剔除（类型谓词把 `direction` 收窄到 `RelationStarLeafDirection`）
  const nonSelf = rows.filter(
    (row): row is CharacterRelationRow & { direction: RelationStarLeafDirection } =>
      row.direction !== "self",
  );

  // 按对方人物合并（保持首见顺序 = 分组与行序，输出稳定）
  const grouped = new Map<string, { other: CharacterRelationEndpoint; rows: typeof nonSelf }>();
  for (const row of nonSelf) {
    const bucket = grouped.get(row.other.id);
    if (bucket === undefined) {
      grouped.set(row.other.id, { other: row.other, rows: [row] });
    } else {
      bucket.rows.push(row);
    }
  }

  const leaves = [...grouped.values()];
  if (leaves.length < RELATION_STAR_MIN_LEAVES) return null;

  const width = size.width;
  const radius = relationStarRadius(leaves.length, size);
  // 画布随半径长高（下限 = 传入高度，上限 = RELATION_STAR_MAX_HEIGHT）
  const height = Math.min(
    RELATION_STAR_MAX_HEIGHT,
    Math.max(size.height, 2 * (radius + RELATION_STAR_PADDING)),
  );
  const center: RelationStarPoint = { x: width / 2, y: height / 2 };
  const step = (2 * Math.PI) / leaves.length;

  return {
    width,
    height,
    center,
    radius,
    showLabels: leaves.length <= RELATION_STAR_LABEL_MAX_LEAVES,
    leaves: leaves.map((leaf, index) => {
      const direction = mergeLeafDirection(leaf.rows);
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
      const arrow = direction === "both" ? null : direction;
      const labelText = relationStarLeafLabel(leaf.other.name, leaf.rows.length);
      return {
        key: `star:${leaf.other.id}`,
        other: leaf.other,
        direction,
        count: leaf.rows.length,
        labelText,
        arrow,
        point,
        // in：对方 → 我，端点顺序反过来（箭头端 = 中心侧）；both/无箭头：整条中心 → 叶子点
        line:
          arrow === "in"
            ? { from: point, to: inner }
            : { from: center, to: arrow === "out" ? arrowEnd : point },
        label: starLabel(point, cos, sin, {
          width,
          labelChars: Array.from(labelText).length,
        }),
      };
    }),
  };
}

/** 同一人物的多行方向合并：任一行 `both` 或 out/in 并存 → `both`；否则取唯一那向 */
function mergeLeafDirection(
  rows: ReadonlyArray<{ direction: RelationStarLeafDirection }>,
): RelationStarLeafDirection {
  let hasOut = false;
  let hasIn = false;
  for (const row of rows) {
    if (row.direction === "both") return "both";
    if (row.direction === "out") hasOut = true;
    else hasIn = true;
  }
  return hasOut && hasIn ? "both" : hasOut ? "out" : "in";
}
