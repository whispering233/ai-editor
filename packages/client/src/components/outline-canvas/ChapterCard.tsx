// 大纲画布卡片（画布上**唯一**的节点类型 = 章；契约：docs/ui/DESIGN.md `outline-canvas`）。
//
// 形态 = 平铺卡、三行：① `第N章`（`TypeChip` `tone="soft"`，**画布上唯一徽标**）+ 状态标记
// （在读 = 左侧 2px 内嵌条；推演 = 4px 圆点）+ 伏笔徽标（复用 `hook-mark`，可点跳伏笔详情，右对齐）；
// ② 章名（14px 单行 truncate）；③ 写作状态（`draft` = 不显示、`revision` = 修正中、`final` = 定稿
// + primary 圆点）+ 剧情线标签（`#标签` ≤ 2 个、超出 `+N`，色相复用 `tagTintClass`）——
// 状态与标签皆空则整行不渲染。**卷号 / 场数 / 完整标签列表进 `title`**，字数与更新时间不上卡面。
// **位置不表达结构**：卷不画成列 / 框 / 泳道，层级只由编号徽标承载；卡片尺寸来自
// `lib/outline-canvas-layout` 的常量（由页面写进 node.style，几何单源在那一处），本组件只管排内部。
// 在读 / 推演只读节点 data（页面从 `config.currentPosition` / `config.deductionNodes` 派生），
// 卡片不碰项目配置。
// 左右两个 handle 是连线的落点（source 在右、target 在左，与卡片从左到右的网格顺向一致）：
// 尺寸 / 配色只在 canvas-theme.css 映射，本组件不写色值。
// 选中态只换描边：选中 / 聚焦 = primary，否则 hairline + hover hairline-strong（不填充、不加阴影）。
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { OUTLINE_STATUS_LABEL } from "@whispering233/ai-editor-shared";
import type { CanvasChapterCard } from "../../lib/outline-canvas-layout";
import type { NodeHookMark } from "../../lib/outline-hooks";
import { tagTintClass } from "../../lib/tag-tint";
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
  const title = [
    `${card.volumeLabel === "" ? "" : `${card.volumeLabel}·`}${card.chapterLabel} ${card.title}`,
    card.sceneCount > 0 ? `${card.sceneCount} 场` : "",
    card.tags.map((tag) => `#${tag}`).join(" "),
  ]
    .filter((part) => part !== "")
    .join(" · ");
  // 草稿是默认值：24 张卡全挂「草稿」是噪声，故缺省状态不占位
  const statusLabel =
    card.status === "revision" || card.status === "final"
      ? OUTLINE_STATUS_LABEL[card.status]
      : null;
  const visibleTags = card.tags.slice(0, 2);
  const tagOverflow = card.tags.length - visibleTags.length;
  return (
    <div
      data-written={card.written ? "true" : "false"}
      className={cn(
        "relative flex h-full w-full flex-col gap-1 rounded-md border bg-card px-3 py-2",
        // 选中 / 聚焦 = primary 描边；hover = hairline-strong（不填充、不加阴影）
        selected ? "border-primary" : "border-border hover:border-input",
      )}
      title={title}
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
      {/* 第三行：状态 + 标签；两者皆空则整行不渲染（不留空行） */}
      {(statusLabel !== null || visibleTags.length > 0) && (
        <span
          data-lod="status"
          className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
        >
          {statusLabel !== null && (
            <span className="flex shrink-0 items-center gap-1">
              {card.status === "final" && <span aria-hidden className="size-1 rounded-full bg-primary" />}
              {statusLabel}
            </span>
          )}
          {visibleTags.map((tag) => (
            <span
              key={tag}
              className={cn("min-w-0 truncate rounded-sm px-1 text-foreground", tagTintClass(tag))}
            >
              #{tag}
            </span>
          ))}
          {tagOverflow > 0 && <span className="shrink-0">+{tagOverflow}</span>}
        </span>
      )}
      {/* far 档的大章号（非 far 档由 CSS 隐藏）：缩到很小后唯一可读的信息 */}
      <span data-lod="far-label">{card.chapterLabel}</span>
    </div>
  );
}
