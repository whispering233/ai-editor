// 应用外壳（doc/ui/layout.md §2）：顶栏（项目信息占位）+ 侧栏导航 + 页面内容区
// 数据占位说明：顶栏项目名/当前位置/语言来自 GET /api/v1/project/config，T7.2/S1.x 接入真实 API 后替换
import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import type { Route } from "../hooks/use-route";

interface NavItem {
  label: string;
  href: string;
  /** 匹配的路由首段（实体列表与详情共用「实体」高亮，layout.md §2.2） */
  segment: string;
  /** 分隔线：回收站/设置位于主区下方（layout.md §2.2） */
  divider?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "大纲", href: "#/outline", segment: "outline" },
  { label: "实体", href: "#/entities/character", segment: "entities" },
  { label: "画布", href: "#/canvas", segment: "canvas" },
  { label: "聊天", href: "#/chat", segment: "chat" },
  { label: "伏笔", href: "#/hooks", segment: "hooks" },
  { label: "回收站", href: "#/trash", segment: "trash", divider: true },
  { label: "设置", href: "#/settings", segment: "settings" },
];

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  const active = route.segments[0] ?? null;

  return (
    <div className="flex h-screen flex-col">
      {/* 顶栏（约 56px） */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-zinc-200 px-4">
        <a href="#/" className="text-base font-semibold hover:text-zinc-600">
          ◈ 我的小说
        </a>
        <span className="text-sm text-zinc-500">
          当前位置: <span className="text-zinc-700">第3章·灵根测试失败</span>（占位）
        </span>
        <span className="ml-auto text-sm text-zinc-500">语言: 中文（占位）</span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 侧栏导航 */}
        <nav className="w-44 shrink-0 overflow-y-auto border-r border-zinc-200 py-2">
          {NAV_ITEMS.map((item) => (
            <div key={item.label}>
              {item.divider && <div className="my-2 border-t border-zinc-200" />}
              <a
                href={item.href}
                className={cn(
                  "block px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                  active === item.segment && "bg-zinc-100 font-medium text-zinc-900",
                )}
              >
                {item.label}
              </a>
            </div>
          ))}
        </nav>

        {/* 页面内容区（按路由渲染） */}
        <main className="min-w-0 flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
