// 中栏 TabBar（doc/ui/layout.md §2.2）：七个 tab 药丸分段控件（概览/大纲/画布/实体关系/伏笔/时间轴/回收站）
// 形态参考 inkos：容器 bg-secondary/30 rounded-lg p-1 + 激活项 bg-card shadow-sm；lucide 图标 + 中文标签
// 当前 tab 由路由首段驱动；「实体关系」在实体列表/详情路由下均保持高亮（segment=entities，layout.md §1）
import {
  CalendarClock,
  LayoutGrid,
  ListTree,
  Network,
  Puzzle,
  Shapes,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { MouseEvent } from "react";
import type { Route } from "../../hooks/use-route";
import { cn } from "../../lib/utils";
import { useProjectStore } from "../../stores/project";
import { useUiStore } from "../../stores/ui";

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
  // 时间轴（C3，决策 26）：事件线性序列，layout.md §1 路由表
  { label: "时间轴", href: "#/timeline", segment: "timeline", icon: CalendarClock },
  { label: "回收站", href: "#/trash", segment: "trash", icon: Trash2 },
];

export function TabBar({ route }: { route: Route }) {
  const active = route.segments[0] ?? null;
  // 无项目引导（S1.4）：服务端 NO_PROJECT_OPEN 时业务 tab 无数据可看，
  // 点击引导回概览页开/建项目，避免 409 错误横幅（决策 26 体验修复，2026-08）
  const noProject = useProjectStore((s) => s.loadError === "NO_PROJECT_OPEN");
  const showToast = useUiStore((s) => s.showToast);

  const handleClick = (e: MouseEvent, tab: TabItem) => {
    if (!noProject || tab.segment === null) return; // 概览 tab 始终可用
    e.preventDefault();
    window.location.hash = "#/";
    showToast("请先创建或打开项目");
  };

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
            onClick={(e) => handleClick(e, tab)}
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
