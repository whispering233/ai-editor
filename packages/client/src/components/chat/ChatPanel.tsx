// 右栏 ChatPanel（doc/ui/layout.md §2.4）：本期骨架——会话标题行占位 + 灰显内容（U5 实现消息流/提案卡/输入区）
// <1024px 折叠为抽屉（layout.md §0）：fixed + 遮罩 + 开关按钮（开关在信息条右侧，open 状态由 AppShell 持有）
// 无项目打开时整体禁用提示（layout.md §2.4：打开项目后可用）
// 待补（oracle U2 审核 M2，U5 实现真实交互时处理）：抽屉 Escape 关闭 + 焦点 trap + 开关按钮 aria-expanded/aria-controls
import { MessageSquare, X } from "lucide-react";
import { useMediaQuery } from "../../hooks/use-media-query";
import { useProjectStore } from "../../stores/project";
import { Button } from "../ui/button";

/** 面板内部内容：会话标题行 + 占位区（桌面静态栏与抽屉共用，避免双份实现） */
function ChatPanelBody({ onClose }: { onClose?: () => void }) {
  const config = useProjectStore((s) => s.config);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 会话标题行（U5 实现下拉切换同项目会话；layout.md §2.4） */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium text-muted-foreground">会话标题</span>
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto text-muted-foreground"
            onClick={onClose}
            aria-label="关闭聊天面板"
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      {/* 占位内容：U5 实现消息流/工具折叠记录/提案卡片/focus 小条/输入区 */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4">
        <MessageSquare className="size-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground/70">聊天面板（U5 实现）</p>
        {!config && <p className="text-xs text-muted-foreground/50">打开项目后可用</p>}
      </div>
    </div>
  );
}

export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // 桌面（≥1024px）：右栏 40% 静态列（1:5:4 严格比例，layout.md §0）
  if (isDesktop) {
    return (
      <aside className="flex min-w-0 flex-[4_1_40%] flex-col border-l border-border bg-card">
        <ChatPanelBody />
      </aside>
    );
  }

  // 小屏（<1024px）：fixed 抽屉 + 遮罩；关闭时不渲染
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      {/* 遮罩：点击关闭 */}
      <div className="absolute inset-0 bg-foreground/40 animate-in fade-in" onClick={onClose} />
      {/* 抽屉：右侧滑入 */}
      <div className="absolute inset-y-0 right-0 w-[85vw] max-w-md border-l border-border bg-card shadow-xl animate-in slide-in-from-right duration-300">
        <ChatPanelBody onClose={onClose} />
      </div>
    </div>
  );
}
