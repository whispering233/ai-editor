// 章视图（大纲页第二形态，2026-09）：平铺章列表——阅读序 = 卷序 → 卷内章序，行 = `第N卷` + `第N章`
// 两枚编号徽标 + 标题 + 摘要 + 伏笔标记 + 推演节点徽标（只读）+ 正文字数 + 「写正文」入口 + 「阅读进度」徽标。
// 「写正文」= 指向 #/manuscript/:id 的**导航链接**（卡 12.5；2026-09 卡 18.2 由下划线文字改为行尾
// 图标按钮——给 antd `Button` 传 `href`，它渲染成 `<a>`：拿 `icon-button` 表皮的同时保住链接语义，
// 也不破「本视图行内无操作按钮」的收窄）。
// 交互有意收窄（契约见 `docs/ui/DESIGN.md`「大纲页双视图」）：**单击标题就地改名 + 双击行进详情**，
// 不做删除 / 新建 / 拖拽——结构编辑与排序的唯一入口仍是大纲树，且「在章视图里新建出的场景不显示」
// 会带来「建了却看不见」的困惑。**推演节点徽标也是只读 chip**（标记操作只在树视图右键菜单与
// 节点详情页——本视图「行内无操作按钮」这条收窄不变）。
// 纯 presenter：数据与副作用（提交改名 / 重拉树 / 路由）都在容器 `pages/Outline.tsx`，
// 故 SSR `renderToString` 可直接渲染（仓内无 jsdom）——行结构断言见 `chapter-view.test.tsx`。
import type { KeyboardEvent } from "react";
import { Button } from "antd";
import { EditOutlined } from "@ant-design/icons";
import type { DeductionMark, OutlineChapter } from "@whispering233/ai-editor-shared";
import { TypeChip } from "@/components/ui/tag-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { NodeHookMarkBadge } from "./node-hook-badge";
import { InlineInput } from "./inline-input";
import type { NodeHookMark } from "@/lib/outline-hooks";
import { deductionMarkTitle } from "@/lib/deduction";
import { formatTextLength } from "@/lib/manuscript";
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
  /** 推演节点标记（shared `buildDeductionMarks` 产出；行尾**只读**徽标，排在「阅读进度」左侧） */
  deductionMarks?: DeductionMark[];
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
  deductionMarks = [],
  editing = null,
  focusedNodeId = null,
  handlers,
}: ChapterViewProps) {
  /** 节点 id → 推演标记（行内查表；文案/章号由 shared 派生，本组件只拼 title） */
  const deductionByNode = new Map(deductionMarks.map((mark) => [mark.nodeId, mark]));

  // 空态：有卷无章（整树为空的情形由页面自己的空态承接——那里带「新建第一卷」入口）
  if (rows.length === 0) {
    return <EmptyState padding="sm">还没有章，去大纲树里给卷加章</EmptyState>;
  }

  return (
    <div className="rounded-md border border-border p-2">
      {rows.map((row) => {
        const node = row.chapter;
        const marks = hookMarks?.get(node.id) ?? [];
        const deductionMark = deductionByNode.get(node.id);
        const editingHere = editing?.nodeId === node.id;
        /** 本章正文字数文案（metadata.textLength；未写/0 → null 不显示） */
        const textLengthLabel = formatTextLength(node.metadata?.textLength ?? 0);
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
                <InlineInput
                  value={editing.value}
                  onChange={handlers.onChangeEditingValue}
                  onKeyDown={onEditKeyDown}
                  onBlur={() => handlers.onCommitEdit(node)}
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
              {/* 行尾区：正文字数 + 「阅读进度」徽标 + 写正文入口（图标按钮 = 导航链接，见文件头）。
                  按 `data-row` 口径：徽标排在操作位左侧、链接恒贴行尾（本视图仍无结构编辑按钮） */}
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {textLengthLabel !== null && (
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {textLengthLabel}
                  </span>
                )}
                {deductionMark !== undefined && (
                  <TypeChip
                    className="shrink-0"
                    title={deductionMarkTitle(deductionMark, deductionMarks.length)}
                  >
                    {deductionMark.label}
                  </TypeChip>
                )}
                {currentPositionId === node.id && <TypeChip className="shrink-0">阅读进度</TypeChip>}
                <Button
                  color="default"
                  variant="text"
                  size="small"
                  href={`#/manuscript/${node.id}`}
                  title="写正文"
                  aria-label="写正文"
                  icon={<EditOutlined className="text-sm" />}
                />
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
