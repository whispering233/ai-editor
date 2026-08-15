// 时间轴事件行（F4，timeline.md 时间点分组线框：组内事件堆叠；F5 时间标签样式提升）
// 职责：纯展示——组内事件行 = 小圆点 + 内容卡（事件名 → 时间标签 → tags → 「N 节点」→ ⋯ 菜单）。
// 拖拽归组块级（TimelineGroup 根 draggable），本行**不 draggable 防误拖**（F4 线框），故无拖拽柄。
// 行内时间标签（F5）：有值 → 主题色点缀 `text-sm font-medium text-primary`（第二信息层级，仅次于
//   事件名；与 tags 胶囊 bg-muted 灰、组标题 text-foreground 实色均区分）；空 → 「未标注时间」占位
//   弱化样式（text-xs italic text-muted-foreground）——已标注/未标注一眼可辨。
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { eventTagsOf, eventTimeLabel } from "../../lib/timeline";

interface TimelineEventProps {
  ev: EntitySummary;
  /** 行内「N 节点」计数（occurs_in 关联数；锚定边拉取失败时页面传 0 + hasOccursData=false 降级隐藏） */
  occursCount: (id: string) => number;
  hasOccursData: boolean;
  /** 行 ⋯ 菜单回调（页面级动作：详情跳转 / 编辑对话框 / 软删确认） */
  onDetail: (ev: EntitySummary) => void;
  onEdit: (ev: EntitySummary) => void;
  onDelete: (ev: EntitySummary) => void;
}

export function TimelineEvent({ ev, occursCount, hasOccursData, onDetail, onEdit, onDelete }: TimelineEventProps) {
  const timeLabel = eventTimeLabel(ev);
  const tags = eventTagsOf(ev);
  const count = occursCount(ev.id);
  return (
    <div className="flex items-start">
      {/* 组内小圆点（F4：组内事件堆叠，小圆点 size-2 bg-primary/60 居中于轴线列——
          不再画大圆点盖线，轴线容器级贯穿；mt-[16px] = 内容中心 20px - 小圆点高 8px 中心 offset 4px） */}
      <div className="w-[22px] shrink-0">
        <span aria-hidden="true" className="mx-auto mt-[16px] block size-2 rounded-full bg-primary/60" />
      </div>
      {/* 内容卡（F3 行渲染迁移：事件名 → 时间标签 → tags → 计数 → ⋯ 菜单） */}
      <div className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate font-medium text-foreground" title={ev.name}>
            {ev.name}
          </span>
          {/* 时间标签（F5 提升）：有值 → 主题色点缀（text-sm font-medium text-primary）；
              空 → 弱化占位（text-xs italic text-muted-foreground）——层级对比见文件头注释 */}
          {timeLabel !== "" ? (
            <span className="shrink-0 text-sm font-medium text-primary">{timeLabel}</span>
          ) : (
            <span className="shrink-0 text-xs italic text-muted-foreground">未标注时间</span>
          )}
          {tags.map((tag) => (
            <span key={tag} className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {tag}
            </span>
          ))}
          {hasOccursData && <span className="shrink-0 text-xs text-muted-foreground">{count} 节点</span>}
          <span className="ml-auto shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`${ev.name} 操作`}>
                    <MoreHorizontal />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {/* 详情页 #/timeline/:id（C4 启用） */}
                <DropdownMenuItem onClick={() => onDetail(ev)}>详情</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEdit(ev)}>编辑</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(ev)}>
                  移入回收站
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>
      </div>
    </div>
  );
}
