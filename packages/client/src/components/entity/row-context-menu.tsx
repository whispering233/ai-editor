// 行级右键菜单（替代行级 AskAiButton）
// 触发 = 行级 onContextMenu（ContextMenuTrigger 内建 preventDefault + 右键/长按打开，菜单弹出在指针位置）；
// 菜单项：
// - 「注入会话上下文」：复用 chat store focusContext 机制——写入 focusContext
// （右栏 focus 小条出现）+ 聚焦输入框（可立即提问），继续当前会话
// - 「建立关联」：打开共用 CreateRelationDialog（通用关系表；源端点按行对象预填，
// 类型/端点按行实体类型——大纲节点 outline_node / 实体 focus_entity_type）
// - extraItems：**页面级附加项**（如大纲页「设为当前位置」——仅章节点行传入，不传就不出现）——
// 本组件保持通用：附加项的可见性/禁用态/处理逻辑均由页面决定（各页语义不同，不在此内建）
// 中栏右下「问 AI」悬浮按钮（C1）为全局统一入口——右键菜单是行级快捷入口的替代形态。
// 不违反 H3 红线：右键菜单是「需要时出现」的上下文交互（桌面通用心智），非「操作按钮收进 ⋯ 二级展开」。
// 用法：<RowContextMenu focus={...} source={...} onCreated={...} trigger={<tr ...行根元素... />}>
// 行内容（渲染在 trigger 元素内部）
// </RowContextMenu>
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { CommentOutlined, LinkOutlined } from "@ant-design/icons";
import type { FocusContext } from "../../lib/focus";
import { useChatStore } from "../../stores/chat";
import { CreateRelationDialog, type RelationSource } from "./create-relation-dialog";
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";

export function RowContextMenu({
  focus,
  source,
  onCreated,
  extraItems,
  trigger,
  children,
}: {
  /** 注入会话上下文（按行对象构造：大纲节点 focus_node_id、实体 focus_entity_type/id） */
  focus: FocusContext;
  /** 建立关联源端点（类型/端点按行实体类型预填；大纲节点 type=outline_node） */
  source: RelationSource;
  /** 建立关联成功后的数据刷新回调（页面级 reloadTick+1 / notifyDataChanged） */
  onCreated?: () => void;
  /** 页面级附加菜单项（渲染在「建立关联」之后的另一组——分隔线隔开；不传 = 不出现） */
  extraItems?: ReactNode;
  /** 行根元素（成为右键菜单触发区；行级 onContextMenu 由 ContextMenuTrigger 内建处理） */
  trigger: ReactElement;
  /** 行内容（渲染在 trigger 元素内部） */
  children: ReactNode;
}) {
  const setFocusContext = useChatStore((s) => s.setFocusContext);
  const requestFocusInput = useChatStore((s) => s.requestFocusInput);
  /** 建立关联对话框打开态（行级状态；打开后按行对象预填源端点） */
  const [relationOpen, setRelationOpen] = useState(false);

  /** 注入会话上下文：写入 focusContext（右栏 focus 小条出现）+ 聚焦输入框（可立即提问） */
  function handleInjectFocus() {
    setFocusContext(focus);
    requestFocusInput();
  }

  return (
    <ContextMenuRoot>
      <ContextMenuTrigger render={trigger}>{children}</ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent className="w-44">
          <ContextMenuGroup>
            <ContextMenuLabel className="max-w-40 truncate">{source.name}</ContextMenuLabel>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleInjectFocus}>
            <CommentOutlined className="text-sm" />
            注入会话上下文
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setRelationOpen(true)}>
            <LinkOutlined className="text-sm" />
            建立关联
          </ContextMenuItem>
          {extraItems !== undefined && (
            <>
              <ContextMenuSeparator />
              {extraItems}
            </>
          )}
        </ContextMenuContent>
      </ContextMenuPortal>
      {/* 建立关联对话框（源端点预填；成功 → 页面刷新回调 + 关闭） */}
      {relationOpen && (
        <CreateRelationDialog
          source={source}
          onCreated={() => onCreated?.()}
          onClose={() => setRelationOpen(false)}
        />
      )}
    </ContextMenuRoot>
  );
}
