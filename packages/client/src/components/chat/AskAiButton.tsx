// 行级「带上下文问 AI」按钮（决策 35 修订，批次九：方案 A——页面行级显式「有焦点」入口）
// 布局规划 §4.2 原始设计的落地：大纲节点/实体/伏笔/事件等行上的 Sparkles 图标按钮，
// 点击注入该对象的 focus context（右栏出现「正在讨论：…」小条）+ 聚焦输入框（可立即提问）。
// 与 InfoBar 统一「问 AI」的区分：后者是无特定对象的「纯进入聊天」；本按钮是带对象语义的
// 「带它去问」。
import type { FocusContext } from "../../lib/focus";
import { useChatStore } from "../../stores/chat";
import { Button } from "../ui/button";
import { Sparkles } from "lucide-react";

export function AskAiButton({ focus, title }: { focus: FocusContext; title?: string }) {
  const setFocusContext = useChatStore((s) => s.setFocusContext);
  const requestFocusInput = useChatStore((s) => s.requestFocusInput);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0 text-muted-foreground hover:text-primary"
      onClick={() => {
        setFocusContext(focus); // 注入该行对象的上下文（右栏聚焦小条出现）
        requestFocusInput(); // 聚焦输入框（可立即提问）
      }}
      aria-label={title ?? "带上下文问 AI"}
      title={title ?? "带上下文问 AI"}
    >
      <Sparkles className="size-3.5" />
    </Button>
  );
}
