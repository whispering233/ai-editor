// 中栏 TabBar（doc/ui/layout.md §2.2）：六个 tab 药丸分段控件（概览/大纲/画布/实体关系/伏笔/回收站）
// 形态参考 inkos：容器 bg-secondary/30 rounded-lg p-1 + 激活项 bg-card shadow-sm；lucide 图标 + 中文标签
// 当前 tab 由路由首段驱动；「实体关系」在实体列表/详情路由下均保持高亮（segment=entities，layout.md §1）
import { LayoutGrid, ListTree, Network, Puzzle, Shapes, Trash2, type LucideIcon } from "lucide-react";
import type { Route } from "../../hooks/use-route";
import { cn } from "../../lib/utils";

interface TabItem {
  label: string;
  href: string;
  /** 高亮匹配的路由首段（根路由 #/ 用 null 表达） */
  segment: string | null;
  icon: LucideIcon;
}

const TABS: TabItem[] = [
  { label: "概览", href: "#/", segment: null, icon: LayoutGrid },
  { label: "大纲", href: "#/outline", segment: "outline", icon: ListTree },
  { label: "画布", href: "#/canvas", segment: "canvas", icon: Shapes },
  { label: "实体关系", href: "#/entities/character", segment: "entities", icon: Network },
  { label: "伏笔", href: "#/hooks", segment: "hooks", icon: Puzzle },
  { label: "回收站", href: "#/trash", segment: "trash", icon: Trash2 },
];

export function TabBar({ route }: { route: Route }) {
  const active = route.segments[0] ?? null;

  return (
    <nav aria-label="页面导航" className="flex items-center gap-1 rounded-lg bg-secondary/30 p-1">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.segment;
        return (
          <a
            key={tab.label}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
              isActive && "bg-card text-foreground shadow-sm",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{tab.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
