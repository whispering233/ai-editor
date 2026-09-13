// 人物关系星形图（卡 8.4）：纯展示手写 SVG（零依赖——1 跳星形 = 极坐标，引入布局库无收益；
// 见 `docs/ui/DESIGN.md` §数据展示 `relation-star-graph`）。几何与三个判据全在 `lib/relation-star.ts`（纯函数，单测覆盖）
// ——本文件只管把布局画成 SVG。
// 色纪律：SVG 内一律 `currentColor` + 既有语义类（无硬编码色值）。连线/箭头 = 描边档 `{colors.hairline-strong}`
//   （Tailwind 侧即 `--input`，与 thinking-block 左侧竖线同档）；中心 = `{colors.primary}`；
//   叶子 = `{colors.secondary}`（Tailwind 主题未暴露该档，取 DESIGN.md 登记的 `colorText` 80% 近似值）。
// 叶子点击 = 与关系列表行同行为（`relationEndpointHref` 的 hash 路由锚点，非可点类型渲染纯文本）。
// marker 的色不继承引用它的连线（SVG marker 以自身所在上下文取色）→ 箭头自带色彩类。
import { useId } from "react";
import { relationEndpointHref, type CharacterRelationRow } from "../../lib/character-relations";
import {
  buildRelationStarLayout,
  RELATION_STAR_HEIGHT,
  RELATION_STAR_WIDTH,
} from "../../lib/relation-star";

/** 中心圆点半径（当前角色） */
const CENTER_DOT_RADIUS = 6;
/** 叶子圆点半径 */
const LEAF_DOT_RADIUS = 3;
/** 中心姓名基线偏移（圆点下方一行） */
const CENTER_LABEL_OFFSET = 20;
/** 箭头（marker）视图盒边长，箭尖取 `refX = ARROW_SIZE - 1` */
const ARROW_SIZE = 8;

/**
 * 星形图（纯展示）。`rows` = 关系网**去重后**的行（`buildCharacterRelationGroups` 的展平结果）；
 * 自环剔除 + **按对方人物合并**后叶子数不足阈值时布局为 null → 不渲染任何东西。
 */
export function RelationStarGraph({
  rows,
  selfName,
}: {
  rows: readonly CharacterRelationRow[];
  selfName: string;
}) {
  const markerId = useId();
  const layout = buildRelationStarLayout(rows, {
    width: RELATION_STAR_WIDTH,
    height: RELATION_STAR_HEIGHT,
  });
  if (layout === null) return null;

  return (
    <svg
      role="img"
      aria-label={`人物关系图：本角色与 ${layout.leaves.length} 位人物的关系`}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="mx-auto mb-2 block w-full max-w-100"
    >
      <defs>
        <marker
          id={markerId}
          viewBox={`0 0 ${ARROW_SIZE} ${ARROW_SIZE}`}
          refX={ARROW_SIZE - 1}
          refY={ARROW_SIZE / 2}
          markerWidth={ARROW_SIZE}
          markerHeight={ARROW_SIZE}
          orient="auto"
          className="text-input"
        >
          <path
            d={`M0 0 L${ARROW_SIZE} ${ARROW_SIZE / 2} L0 ${ARROW_SIZE} Z`}
            fill="currentColor"
          />
        </marker>
      </defs>

      {/* 连线：1px `{colors.hairline-strong}`；有向才挂箭头（out 朝外 / in 朝内，端点顺序已在布局里定好） */}
      <g className="text-input" stroke="currentColor" strokeWidth={1}>
        {layout.leaves.map((leaf) => (
          <line
            key={leaf.key}
            x1={leaf.line.from.x}
            y1={leaf.line.from.y}
            x2={leaf.line.to.x}
            y2={leaf.line.to.y}
            markerEnd={leaf.arrow === null ? undefined : `url(#${markerId})`}
          />
        ))}
      </g>

      {/* 中心 = 当前角色：实心点 + 姓名（在点下方） */}
      <g className="text-primary" fill="currentColor">
        <circle cx={layout.center.x} cy={layout.center.y} r={CENTER_DOT_RADIUS} />
        <text
          x={layout.center.x}
          y={layout.center.y + CENTER_LABEL_OFFSET}
          textAnchor="middle"
          className="text-sm font-medium"
        >
          {selfName}
        </text>
      </g>

      {/* 叶子 = **按对方人物去重**后的叶子（同一人多类型合并一叶）：可点 = 切到该角色（未知类型不可点，渲染纯文本）；
          叶子 > 24 只画点；名字已带可选条数后缀（`· N`） */}
      {layout.leaves.map((leaf) => {
        const href = relationEndpointHref(leaf.other.type, leaf.other.id);
        const content = (
          <>
            <circle cx={leaf.point.x} cy={leaf.point.y} r={LEAF_DOT_RADIUS} fill="currentColor" />
            {layout.showLabels && (
              <text
                x={leaf.label.point.x}
                y={leaf.label.point.y}
                textAnchor={leaf.label.anchor}
                fill="currentColor"
                className="text-xs"
              >
                {leaf.labelText}
              </text>
            )}
          </>
        );
        if (href === null) {
          return (
            <g key={leaf.key} className="text-foreground/80">
              {content}
            </g>
          );
        }
        return (
          <a
            key={leaf.key}
            href={href}
            title={`打开「${leaf.other.name}」`}
            className="text-foreground/80 hover:text-primary"
          >
            {content}
          </a>
        );
      })}
    </svg>
  );
}
