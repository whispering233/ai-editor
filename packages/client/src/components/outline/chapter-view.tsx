// 章视图（大纲页第二形态，2026-09）：平铺章列表——阅读序 = 卷序 → 卷内章序，行 = `第N卷` + `第N章`
// 两枚编号徽标 + 标题 + 摘要 + 伏笔标记 + 「阅读进度」徽标。
// 交互有意收窄（契约见 `docs/ui/DESIGN.md`「大纲页双视图」）：**单击标题就地改名 + 双击行进详情**，
// 不做删除 / 新建 / 拖拽——结构编辑与排序的唯一入口仍是大纲树，且「在章视图里新建出的场景不显示」
// 会带来「建了却看不见」的困惑。
// 纯 presenter：数据与副作用（提交改名 / 重拉树 / 路由）都在容器 `pages/Outline.tsx`，
// 故 SSR `renderToString` 可直接渲染（仓内无 jsdom）——行结构断言见 `chapter-view.test.tsx`。
import { Input } from "antd";
import type { KeyboardEvent } from "react";
import type { OutlineChapter } from "@whispering233/ai-editor-shared";
import { TypeChip } from "@/components/ui/tag-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { NodeHookMarkBadge } from "./node-hook-badge";
import type { NodeHookMark } from "@/lib/outline-hooks";
import type { OutlineChapterRow } from "@/lib/outline-tree";
import { cn } from "@/lib/utils";

/** 编号徽标几何：与树视图同款（`min-w-14` + 居中 + 等宽数字）——两视图的标题左缘口径一致 */
const NUMBER_CHIP_CLASS = "min-w-14 shrink-0 justify-center tabular-nums";

/** 交给容器的行级动作（组件不碰 store / 路由 / 请求） */
export interface ChapterViewHandlers {
  /** 单击标题：进入就地改名（容器决定走哪个提交管道） */
  onStartEdit: (node: OutlineChapter) => void;
  /** 输入值变化（值由容器持有） */
  onChangeEditingValue: (value: string) => void;
  /** Enter / 失焦：提交改名 */
  onCommitEdit: (node: OutlineChapter) => void;
  /** Esc：放弃改名 */
  onCancelEdit: () => void;
  /** 双击行：进章详情页 */
  onOpenDetail: (nodeId: string) => void;
}

export interface ChapterViewProps {
  /** 章视图行（阅读序；`numberOutline` 产出） */
  rows: OutlineChapterRow[];
  /** 阅读进度节点 id（行尾徽标）；null / 未设置 → 不渲染 */
  currentPositionId?: string | null;
  /** 伏笔标记（null = 未加载 / 加载失败 → 标记列隐藏，不阻塞列表） */
  hookMarks?: Map<string, NodeHookMark[]> | null;
  /** 正在改名的章（**只含标题编辑**；null = 无） */
  editing?: { nodeId: string; value: string } | null;
  /** 临时聚焦高亮节点 id（跨页定位/新建聚焦用，同树视图） */
  focusedNodeId?: string | null;
  handlers: ChapterViewHandlers;
}

export function ChapterView({
  rows,
  currentPositionId = null,
  hookMarks = null,
  editing = null,
  focusedNodeId = null,
  handlers,
}: ChapterViewProps) {
  // 空态：有卷无章（整树为空的情形由页面自己的空态承接——那里带「新建第一卷」入口）
  if (rows.length === 0) {
    return <EmptyState padding="sm">还没有章，去大纲树里给卷加章</EmptyState>;
  }

  return (
    <div className="rounded-md border border-border p-2">
      {rows.map((row) => {
        const node = row.chapter;
        const marks = hookMarks?.get(node.id) ?? [];
        const editingHere = editing?.nodeId === node.id;
        const onEditKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handlers.onCommitEdit(node);
          } else if (e.key === "Escape") {
            handlers.onCancelEdit();
          }
        };
        return (
          <div
            key={node.id}
            /* data-node-id / tabIndex：跨页定位（U4）的滚动与聚焦锚点，与树视图同约定 */
            data-node-id={node.id}
            tabIndex={-1}
            className={cn(
              "rounded-md px-2 py-1 transition-colors hover:bg-muted/60",
              focusedNodeId === node.id && "bg-primary/10 ring-1 ring-primary/30 ring-inset",
            )}
            /* 双击进详情；与树视图同守卫（oracle P2-1）：
               ① 双击标题时第一击已把标题换成输入框，第二击的 target = input（且 input 的 blur 已把
                  编辑态清掉）⇒ 必须看 **事件 target** 而不只看 editingHere，否则「双击标题」会变成跳详情；
               ② 改名态中不跳（丢弃未提交输入无意义） */
            onDoubleClick={(e) => {
              if ((e.target as HTMLElement).closest("button, input, a")) return;
              if (editingHere) return;
              handlers.onOpenDetail(node.id);
            }}
          >
            <div className="flex items-center gap-2">
              {/* 卷号徽标：存量直挂 root 的章无卷号 → 留同宽占位，保各行标题列对齐 */}
              {row.volumeLabel !== "" ? (
                <TypeChip className={NUMBER_CHIP_CLASS}>{row.volumeLabel}</TypeChip>
              ) : (
                <span className="min-w-14 shrink-0" />
              )}
              <TypeChip className={NUMBER_CHIP_CLASS}>{row.chapterLabel}</TypeChip>
              {editingHere ? (
                <Input
                  size="small"
                  className="min-w-0 flex-1"
                  autoComplete="off"
                  autoFocus
                  value={editing.value}
                  onChange={(e) => handlers.onChangeEditingValue(e.target.value)}
                  onKeyDown={onEditKeyDown}
                  onBlur={() => handlers.onCommitEdit(node)}
                  maxLength={200}
                  placeholder="标题"
                />
              ) : (
                <span
                  className="min-w-0 cursor-text truncate text-sm text-foreground hover:underline"
                  title="点击编辑标题"
                  onClick={() => handlers.onStartEdit(node)}
                >
                  {node.title}
                </span>
              )}
              {marks.length > 0 && (
                <span className="flex shrink-0 items-center gap-0.5">
                  {marks.map((mark) => (
                    <NodeHookMarkBadge
                      key={`${mark.relationType}-${mark.hookId}`}
                      mark={mark}
                    />
                  ))}
                </span>
              )}
              {/* 行尾徽标区：与树视图同约定——徽标在右、不占操作按钮位（本视图无操作按钮） */}
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {currentPositionId === node.id && <TypeChip className="shrink-0">阅读进度</TypeChip>}
              </span>
            </div>
            {/* 摘要（空不渲染）：缩进 = 两枚编号徽标占位，左右 gap 与首行同（标题左缘对齐） */}
            {node.summary ? (
              <div className="mt-0.5 flex items-center gap-2">
                <span className="min-w-14 shrink-0" />
                <span className="min-w-14 shrink-0" />
                <span className="min-w-0 truncate text-xs text-muted-foreground">{node.summary}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
