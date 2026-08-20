// 时间轴事件行（G2.3，timeline.md G2 布局线框：组内事件堆叠；F5 时间标签样式已随 G2 移除——
//   时间标签 = 组标题（时间点实体），行内不再展示；F6 行内描述展示保留；
// 决策 38：事件行对齐大纲交互模式——双击 = 详情（#/timeline/:id）、点击事件名 = 行内编辑
//   （Enter 确认 / Esc 取消 / 失焦保存）、移除「详情/编辑」按钮（只留删除；
//   决策 40：AskAiButton 已移除——右键菜单替代（注入会话上下文 + 建立关联）））
// 职责：纯展示 + 单条拖拽（G2 双轨：事件行 draggable，恢复 F3 能力）——
//   行 = 小圆点 + 内容卡（事件名 → tags → 「N 节点」→ 直接操作按钮 + 描述区）。
// 拖拽协调在容器（components/timeline/Timeline.tsx）——本行只负责 draggable 挂载与回调转发：
//   行内按钮 draggable={false} 防拖（操作按钮）；opacity-50 拖拽态；插入指示线（S13 模式）。
// 拖拽柄视觉已移除（批次八 O3）：draggable 在行根 + 悬停 title 提示，无 GripVertical 图标。
// 名称行内编辑（决策 38）：点击事件名进入（span → 输入框），Enter 提交 / Esc 取消 / 失焦保存；
//   saving 守卫防 Enter+blur 双提交（悲观提交：提交期间保持编辑态，成功后退出——同大纲 busy 守卫语义）。
// 描述区（F6）：事件名行下方全宽换行，`text-sm text-muted-foreground` 次要层级（低于事件名）；
//   两行截断（line-clamp-2）——**超过两行才显示「展开」按钮**（clamp 态 scrollHeight > clientHeight
//   运行时测量，窗口 resize 重测；**展开态跳过重测**——line-clamp 解除后无法测 clamp 溢出，
//   保留上次 clamped 测量值）；展开后 line-clamp-none 显示「收起」；空描述不渲染。
import { useLayoutEffect, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { Trash2 } from "lucide-react";
import { RowContextMenu } from "../entity/row-context-menu";
import { Button } from "@/components/ui/button";
import { eventDescription, eventTagsOf } from "../../lib/timeline";
import { cn } from "../../lib/utils";

/** 事件行拖拽回调（容器统一装配：dragstart/dragover/drop 需结合拖拽来源与落点行判定） */
export interface EventDragHandlers {
  onDragStart: (e: DragEvent<HTMLDivElement>, ev: EntitySummary) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, ev: EntitySummary) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, ev: EntitySummary) => void;
}

interface TimelineEventProps {
  ev: EntitySummary;
  /** 行内「N 节点」计数（occurs_in 关联数；锚定边拉取失败时页面传 0 + hasOccursData=false 降级隐藏） */
  occursCount: (id: string) => number;
  hasOccursData: boolean;
  /** 本行被拖拽中（opacity-50） */
  dragging: boolean;
  /** 拖拽在途（防并发；draggable 禁用） */
  busy: boolean;
  /** 插入指示线（S13 模式：行上下边缘——事件拖拽落点判定以行中点为准） */
  showInsertBefore: boolean;
  showInsertAfter: boolean;
  eventDrag: EventDragHandlers;
  /** 行操作回调（页面级动作：详情跳转 / 名称行内编辑提交 / 软删直接执行） */
  onDetail: (ev: EntitySummary) => void;
  /** 名称行内编辑提交（页面执行 PUT /entity/event/:id { name }；失败抛错——页面 toast） */
  onEditName: (id: string, name: string) => Promise<void>;
  onDelete: (ev: EntitySummary) => void;
  /** 建立关联成功后的数据刷新（页面 reloadTick+1；事件行右键菜单用） */
  onRelationCreated: () => void;
}

export function TimelineEvent({
  ev,
  occursCount,
  hasOccursData,
  dragging,
  busy,
  showInsertBefore,
  showInsertAfter,
  eventDrag,
  onDetail,
  onEditName,
  onDelete,
  onRelationCreated,
}: TimelineEventProps) {
  const tags = eventTagsOf(ev);
  const description = eventDescription(ev);
  const count = occursCount(ev.id);
  // 名称行内编辑（决策 38：点击事件名进入；Enter 提交 / Esc 取消 / 失焦保存）
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState("");
  /** 提交在途（防 Enter+blur 双提交；悲观提交：提交期间保持编辑态，成功后退出——同大纲 busy 守卫语义） */
  const [saving, setSaving] = useState(false);
  // 描述展开态（F6：事件行级独立 state；展开后 line-clamp-none）
  const [expanded, setExpanded] = useState(false);
  // 描述是否超过两行（clamp 态 scrollHeight > clientHeight → 才显示「展开」按钮）。
  // 测量时机：挂载/描述变化/窗口 resize（描述区宽度只随窗口变化——中栏 flex-basis 固定）；
  // 展开/收起切换重跑 effect（依赖含 expanded）：展开态跳过测量（clamp 解除后 scrollHeight ===
  // clientHeight 恒不溢出，照测会污染 overflowing 导致收起后「展开」按钮消失——保留上次 clamped
  // 测量值）；收起后 effect 重跑，在 clamped 态重测恢复。
  // 用 useLayoutEffect：测量在 paint 前执行，消除首帧「展开」按钮延迟与布局位移（CLS）。
  const descRef = useRef<HTMLParagraphElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const el = descRef.current;
    if (el === null) return;
    const check = () => {
      if (expanded) return; // 展开态无法测 clamp 溢出，保留上次 clamped 测量值
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [description, expanded]);

  /** 点击事件名进入行内编辑（预填当前名） */
  function startEdit() {
    setNameValue(ev.name);
    setEditing(true);
  }

  /** Enter/失焦提交：trim 后空/未变 → 退出编辑不发请求；否则交页面（PUT + toast + 刷新）；
   * saving 守卫防 Enter+blur 双提交（悲观提交：提交期间保持编辑态，成功后退出——同大纲 busy 守卫语义）；
   * 失败保持编辑态 + 保留输入值（页面已 toast，此处 catch 吞掉防 unhandled rejection）——同大纲 editFailureRecovery */
  async function commitEdit() {
    if (saving) return;
    const name = nameValue.trim();
    if (name === "" || name === ev.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onEditName(ev.id, name);
      setEditing(false);
    } catch {
      // 失败保持编辑态（setEditing(false) 未执行）+ 输入值保留，可修正后重试；页面已 toast，不重复提示
    } finally {
      setSaving(false);
    }
  }

  /** 行双击（决策 38）：双击 = 详情（#/timeline/:id）；
   * 冲突防护：双击标题 = 编辑（第一击已把 span 换成输入框，dblclick 的 target 是输入框被 closest 拦截；
   * 极端时序下 target 仍是标题 span 时由 editing 守卫拦截）；双击按钮区同样不跳详情 */
  function handleRowDoubleClick(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button, input, a")) return;
    if (editing) return;
    onDetail(ev);
  }

  // 事件行根 props（右键菜单 trigger 与普通 div 共用）
  const rowProps = {
    draggable: !busy && !editing,
    onDragStart: (e: DragEvent<HTMLDivElement>) => eventDrag.onDragStart(e, ev),
    onDragEnd: eventDrag.onDragEnd,
    onDragOver: (e: DragEvent<HTMLDivElement>) => eventDrag.onDragOver(e, ev),
    onDrop: (e: DragEvent<HTMLDivElement>) => eventDrag.onDrop(e, ev),
    onDoubleClick: handleRowDoubleClick,
    title: "拖拽调整事件顺序/挂载；双击查看详情",
    className: cn("relative flex items-start", dragging && "opacity-50"),
  };
  // 事件行内容（插入指示线 + 圆点列 + 内容卡）
  const rowChildren = (
    <>
      {/* 插入指示线（S13 模式：行上下边缘，跨圆点列与内容） */}
      {showInsertBefore && <div className="absolute inset-x-0 -top-px h-0.5 bg-primary" />}
      {showInsertAfter && <div className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
      {/* 组内小圆点（F4 保留：组内事件堆叠，小圆点 size-2 bg-primary/60 居中于轴线列——
          不再画大圆点盖线，轴线容器级贯穿；mt-[16px] = 内容中心 20px - 小圆点高 8px 中心 offset 4px） */}
      <div className="w-[22px] shrink-0">
        <span
          aria-hidden="true"
          className="mx-auto mt-[16px] block size-2 rounded-full bg-primary/60"
        />
      </div>
      {/* 内容卡（timeline.md G2 事件行：从左到右 事件名 → tags；右侧：N 节点 + 直接操作按钮；
          描述区 F6 在事件名行下方全宽换行，不挤占行内元素） */}
      <div className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2">
        <div className="flex items-center gap-2">
          {/* 事件名：点击行内编辑（决策 38，Enter 提交 / Esc 取消 / 失焦保存）；stopPropagation 隔离——
              单击标题 = 编辑而非其他行为（决策 38 冲突设计） */}
          {editing ? (
            <input
              autoComplete="off"
              autoFocus
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault(); // 对齐大纲 handleEditKeyDown：防未来被包进 form 触发提交
                  void commitEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              onBlur={() => void commitEdit()}
              maxLength={100}
              aria-label="事件名称"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          ) : (
            <span
              className="min-w-0 cursor-text truncate font-medium text-foreground hover:underline"
              title="点击编辑名称"
              onClick={(e) => {
                e.stopPropagation();
                startEdit();
              }}
            >
              {ev.name}
            </span>
          )}
          {tags.map((tag) => (
            <span
              key={tag}
              className="shrink-0 rounded bg-primary/80 px-1.5 py-0.5 text-xs text-primary-foreground"
            >
              {tag}
            </span>
          ))}
          {/* 右侧信息与操作区（H6：N 节点计数靠右，与操作按钮一起，减少左侧干扰；
              决策 38：详情/编辑按钮已移除——双击 = 详情、点击标题 = 行内编辑，只留删除；
              决策 40：AskAiButton 已移除——右键菜单替代） */}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {hasOccursData && (
              <span className="shrink-0 text-xs text-muted-foreground">{count} 节点</span>
            )}
            {/* 操作按钮全部展开（H3：禁止收进 ⋯ 二级展开；图标 + title/aria-label） */}
            <Button
              variant="ghost"
              size="icon-sm"
              draggable={false}
              className="text-muted-foreground hover:text-destructive"
              title="移入回收站"
              aria-label={`${ev.name} 移入回收站`}
              onClick={() => onDelete(ev)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </span>
        </div>
        {/* 描述区（F6）：text-sm text-muted-foreground 次要层级；两行截断 + 展开/收起；
             trim 后为空不渲染；「展开」仅在超过两行时出现（overflowing 运行时测量） */}
        {description.trim() !== "" && (
          <div className="mt-1.5">
            <p
              ref={descRef}
              className={cn(
                "text-sm leading-relaxed text-muted-foreground",
                !expanded && "line-clamp-2",
              )}
            >
              {description}
            </p>
            {(expanded || overflowing) && (
              <button
                type="button"
                draggable={false}
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-primary hover:bg-muted"
                aria-expanded={expanded}
              >
                {expanded ? "收起" : "展开"}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
  // 编辑态（事件名行内输入）不挂右键菜单：保留原生文本菜单（复制/粘贴），不干扰输入
  return editing ? (
    <div {...rowProps}>{rowChildren}</div>
  ) : (
    <RowContextMenu
      focus={{ focus_entity_type: "event", focus_entity_id: ev.id }}
      source={{ type: "event", id: ev.id, name: ev.name }}
      onCreated={onRelationCreated}
      trigger={<div {...rowProps} />}
    >
      {rowChildren}
    </RowContextMenu>
  );
}
