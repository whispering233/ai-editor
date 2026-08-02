// 左栏 Sidebar（doc/ui/layout.md §2.3）：本期骨架——产品标识 + 书架占位 + 底部设置入口/主题切换
// 书架树（项目→会话二级树）U3 实现；主题切换用 use-theme hook（layout.md §3.4 Sun/Moon，localStorage 持久化）
import { Moon, Settings, Sun } from "lucide-react";
import { useTheme } from "../../hooks/use-theme";
import { Button } from "../ui/button";

export function Sidebar() {
  const { theme, toggleTheme } = useTheme();

  return (
    <aside className="flex min-w-0 flex-[1_1_10%] flex-col border-r border-border bg-sidebar">
      {/* 产品标识：衬线斜体（layout.md §3.3），点击回 #/ */}
      <a
        href="#/"
        className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-3 font-serif text-base italic text-foreground hover:text-primary"
      >
        <span className="text-primary">◈</span>
        <span className="truncate">我的小说</span>
      </a>

      {/* 书架占位区（U3 实现：项目→会话二级树 + 新建项目） */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-3">
        <span className="text-xs text-muted-foreground/60">书架</span>
        <span className="text-xs text-muted-foreground/40">U3 实现</span>
      </div>

      {/* 底部区：设置入口 + 主题切换（layout.md §2.3） */}
      <div className="flex shrink-0 flex-col gap-1 border-t border-border p-2">
        <a
          href="#/settings"
          className="flex h-8 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings className="size-4 shrink-0" />
          <span className="truncate">设置</span>
        </a>
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-muted-foreground"
          onClick={toggleTheme}
          aria-label="切换主题"
        >
          {theme === "dark" ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
          <span className="truncate">{theme === "dark" ? "浅色模式" : "深色模式"}</span>
        </Button>
      </div>
    </aside>
  );
}
