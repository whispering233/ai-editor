// 大纲画布卡片（画布上**唯一**的节点类型 = 章；契约：docs/ui/DESIGN.md `outline-canvas`）。
//
// 形态 = 平铺卡：`第N卷` + `第N章`（TypeChip 两档，与大纲页同源）+ 章名（truncate）+ 伏笔徽标
// （复用 `hook-mark`，可点跳伏笔详情）+ `N 场`（无场景不渲染）。
// **位置不表达结构**：卷不画成列 / 框 / 泳道，层级只由编号徽标承载；卡片尺寸来自
// `lib/outline-canvas-layout` 的常量（由页面写进 node.style，几何单源在那一处），本组件只管排内部。
// 左右两个 handle 是连线的落点（source 在右、target 在左，与卡片从左到右的网格顺向一致）：
// 尺寸 / 配色只在 canvas-theme.css 映射，本组件不写色值。
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { CanvasChapterCard } from "../../lib/outline-canvas-layout";
import type { NodeHookMark } from "../../lib/outline-hooks";
import { NodeHookMarkBadge } from "../outline/node-hook-badge";
import { TypeChip } from "../ui/tag-chip";

export type ChapterCardData = {
  card: CanvasChapterCard;
  marks: NodeHookMark[];
};

export type ChapterCardNode = Node<ChapterCardData, "chapter">;

/** 章卡片（内容只读：拖动只改坐标、不改层级；连线走两侧 handle） */
export function ChapterCard({ data }: NodeProps<ChapterCardNode>) {
  const { card, marks } = data;
  return (
    <div
      className="flex h-full w-full flex-col gap-1 rounded-md border border-border bg-card px-3 py-2"
      title={`${card.volumeLabel === "" ? "" : `${card.volumeLabel}·`}${card.chapterLabel} ${card.title}`}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <span className="flex min-w-0 items-center gap-1">
        {/* 存量直挂 root 的章没有卷号（volumeLabel 空串）⇒ 只渲染章徽标 */}
        {card.volumeLabel !== "" && (
          <TypeChip className="min-w-14 justify-center tabular-nums">{card.volumeLabel}</TypeChip>
        )}
        <TypeChip tone="soft" className="min-w-14 justify-center tabular-nums">
          {card.chapterLabel}
        </TypeChip>
        {marks.length > 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            {marks.map((mark) => (
              <NodeHookMarkBadge key={`${mark.relationType}-${mark.hookId}`} mark={mark} />
            ))}
          </span>
        )}
      </span>
      <span className="min-w-0 truncate text-sm text-foreground">{card.title}</span>
      {card.sceneCount > 0 && (
        <span className="text-xs tabular-nums text-muted-foreground">{card.sceneCount} 场</span>
      )}
    </div>
  );
}
