// 中栏信息条（doc/ui/layout.md §2.1）：项目名（点击回 #/）+ 当前位置（outline 树映射，点击跳 #/outline）+ 语言
// 数据源 stores/project.ts（GET /api/v1/project/config）；加载失败保持 null 显示「书架」不阻塞；
// 当前位置标题由 outline 树 id→title 映射（findOutlineNodeTitle）
// <1024px 时右栏为抽屉：信息条右侧显示聊天开关（layout.md §0）
import { MessageSquare } from "lucide-react";
import { useMediaQuery } from "../../hooks/use-media-query";
import { findOutlineNodeTitle, useProjectStore } from "../../stores/project";
import { Button } from "../ui/button";

export function InfoBar({ chatOpen, onToggleChat }: { chatOpen: boolean; onToggleChat: () => void }) {
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const outline = useProjectStore((s) => s.outline);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // 当前位置：null → 「未设置」；有 id 时优先 outline 树映射标题，未加载 outline 则显示 id 占位
  const positionTitle =
    config?.currentPosition != null
      ? (findOutlineNodeTitle(outline, config.currentPosition) ?? config.currentPosition)
      : null;

  // 项目名：加载中 → 「加载中…」；未打开/加载失败 → 「书架」（layout.md §2.1：无项目时所在即书架形态）
  const projectTitle = configLoading ? "加载中…" : (config?.name ?? "书架");

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
      {/* 项目名：点击回 #/ */}
      <a
        href="#/"
        className="flex min-w-0 items-center gap-1.5 font-serif text-base font-medium text-foreground hover:text-primary"
      >
        <span className="text-primary">◈</span>
        <span className="truncate">{projectTitle}</span>
      </a>

      {/* 当前位置：点击跳 #/outline（定位节点由 Outline 页后续实现） */}
      <a
        href="#/outline"
        className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="shrink-0">当前位置:</span>
        <span className="truncate text-foreground">{positionTitle ?? "未设置"}</span>
      </a>

      {/* 右侧：语言 + 小屏聊天开关 */}
      <span className="ml-auto shrink-0 text-sm text-muted-foreground">语言: {config?.language ?? "—"}</span>
      {!isDesktop && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={chatOpen ? "bg-secondary text-foreground" : "text-muted-foreground"}
          onClick={onToggleChat}
          aria-label={chatOpen ? "关闭聊天面板" : "打开聊天面板"}
        >
          <MessageSquare className="size-4" />
        </Button>
      )}
    </div>
  );
}
