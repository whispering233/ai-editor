// 大纲画布卡片（画布上**唯一**的节点类型 = 章；契约：docs/ui/DESIGN.md `outline-canvas`）。
//
// 形态 = 平铺卡、三行：① `第N章`（`TypeChip` `tone="soft"`，**画布上唯一徽标**）+ 状态标记
// （在读 = 左侧 2px 内嵌条；推演 = 4px 圆点）+ 伏笔徽标（复用 `hook-mark`，可点跳伏笔详情，右对齐）；
// ② 章名（14px 单行 truncate）；③ 元信息（卷号 / 字数 / 场数 / 更新时间，段间 ` · `，空段不产出）。
// **卷号不单独占一枚徽标**：同卷每张卡重复「第1卷」是纯噪声，降级为元信息段。
// **位置不表达结构**：卷不画成列 / 框 / 泳道，层级只由编号徽标承载；卡片尺寸来自
// `lib/outline-canvas-layout` 的常量（由页面写进 node.style，几何单源在那一处），本组件只管排内部。
// 在读 / 推演只读节点 data（页面从 `config.currentPosition` / `config.deductionNodes` 派生），
// 卡片不碰项目配置。
// 左右两个 handle 是连线的落点（source 在右、target 在左，与卡片从左到右的网格顺向一致）：
// 尺寸 / 配色只在 canvas-theme.css 映射，本组件不写色值。
// 选中态只换描边：选中 / 聚焦 = primary，否则 hairline + hover hairline-strong（不填充、不加阴影）。
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { canvasChapterMeta, type CanvasChapterCard } from "../../lib/outline-canvas-layout";
import type { NodeHookMark } from "../../lib/outline-hooks";
import { cn } from "../../lib/utils";
import { NodeHookMarkBadge } from "../outline/node-hook-badge";
import { TypeChip } from "../ui/tag-chip";

export type ChapterCardData = {
  card: CanvasChapterCard;
  marks: NodeHookMark[];
  /** 在读（= `config.currentPosition` 命中本章）：卡片左侧 2px 内嵌条 */
  reading: boolean;
  /** 推演节点（= `config.deductionNodes` 命中本章）：章徽标旁的圆点 */
  deduction: boolean;
};

export type ChapterCardNode = Node<ChapterCardData, "chapter">;

/** 章卡片（内容只读：拖动只改坐标、不改层级；连线走两侧 handle） */
export function ChapterCard({ data, selected }: NodeProps<ChapterCardNode>) {
  const { card, marks, reading, deduction } = data;
  const meta = canvasChapterMeta(card).join(" · ");
  return (
    <div
      data-written={card.textLength > 0 ? "true" : "false"}
      className={cn(
        "relative flex h-full w-full flex-col gap-1 rounded-md border bg-card px-3 py-2",
        // 选中 / 聚焦 = primary 描边；hover = hairline-strong（不填充、不加阴影）
        selected ? "border-primary" : "border-border hover:border-input",
      )}
      title={`${card.volumeLabel === "" ? "" : `${card.volumeLabel}·`}${card.chapterLabel} ${card.title}`}
    >
      {/* 在读条：绝对定位（不占布局）、左侧圆角跟卡片一致（不把外框角磨方） */}
      {reading && (
        <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 rounded-l-md bg-primary" />
      )}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <span data-lod="head" className="flex min-w-0 items-center gap-1">
        <TypeChip tone="soft" className="min-w-14 justify-center tabular-nums">
          {card.chapterLabel}
        </TypeChip>
        {/* 推演标记：4px 圆点（同类型徽标边框色），语义在 title 里 */}
        {deduction && (
          <span title="推演节点" className="size-1 shrink-0 rounded-full bg-type-badge-border" />
        )}
        {marks.length > 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            {marks.map((mark) => (
              <NodeHookMarkBadge key={`${mark.relationType}-${mark.hookId}`} mark={mark} />
            ))}
          </span>
        )}
      </span>
      <span data-lod="title" className="min-w-0 truncate text-sm text-foreground">
        {card.title}
      </span>
      <span
        data-lod="meta"
        className="min-w-0 truncate text-xs tabular-nums text-muted-foreground"
        title={meta}
      >
        {meta}
      </span>
      {/* far 档的大章号（非 far 档由 CSS 隐藏）：缩到很小后唯一可读的信息 */}
      <span data-lod="far-label">{card.chapterLabel}</span>
    </div>
  );
}
