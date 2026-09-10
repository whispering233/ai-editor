// 行级右键菜单（自绘换芯：Base UI ContextMenu → 原生实现，API 面不变）
// 触发 = 行元素 onContextMenu（ContextMenuTrigger 内建 preventDefault + 打开于指针位置）；
// 行内容经 cloneElement 注入 trigger 元素内部（render={行元素} + children）。
// 菜单浮层 = portal fixed（指针坐标 + 视口 clamp）；Esc / 外部 pointerdown / 滚动关闭。
// 注：旧 Base UI error #31（Label 必须 Group 包裹）契约随换芯退役——自绘无 Group 上下文依赖。
import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

interface MenuState {
  open: boolean;
  x: number;
  y: number;
}
interface MenuApi {
  state: MenuState;
  openAt: (x: number, y: number) => void;
  close: () => void;
}
const MenuContext = React.createContext<MenuApi | null>(null);

/** 根：菜单开关状态（不渲染 DOM；Esc/外部 pointerdown/滚动关闭监听） */
function ContextMenuRoot({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<MenuState>({ open: false, x: 0, y: 0 });
  const openAt = React.useCallback((x: number, y: number) => setState({ open: true, x, y }), []);
  const close = React.useCallback(() => setState((s) => (s.open ? { ...s, open: false } : s)), []);
  const api = React.useMemo(() => ({ state, openAt, close }), [state, openAt, close]);

  React.useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onOutside = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("[data-slot=context-menu-content]")) return;
      close();
    };
    const onScroll = () => close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [state.open, close]);

  return <MenuContext.Provider value={api}>{children}</MenuContext.Provider>;
}

/** 弹出区域：render 行元素 + children 注入其内部；右键打开于指针位置 */
function ContextMenuTrigger({
  render,
  children,
}: {
  render: React.ReactElement;
  children?: React.ReactNode;
}) {
  const menu = React.useContext(MenuContext);
  if (!menu) return render; // 无 Root 包裹（结构测试路径）：原样渲染
  // createElement 手工合并（cloneElement 传 undefined children 会清空 render 自带 children）
  const el = render as React.ReactElement<Record<string, unknown>>;
  const props = {
    ...el.props,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      menu.openAt(e.clientX, e.clientY);
    },
  };
  const rowChildren = el.props.children as React.ReactNode | undefined;
  return React.createElement(el.type, props, children === undefined ? rowChildren : children);
}

/** Portal 容器（保持导出兼容；Content 自身 createPortal） */
function ContextMenuPortal({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** 菜单浮层：打开时 portal fixed 于指针坐标（视口 clamp 保守 192×128） */
function ContextMenuContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { className?: string }) {
  const menu = React.useContext(MenuContext);
  if (!menu || !menu.state.open) return null;
  const maxX = typeof window !== "undefined" ? window.innerWidth - 192 : 0;
  const maxY = typeof window !== "undefined" ? window.innerHeight - 128 : 0;
  const x = Math.max(0, Math.min(menu.state.x, maxX));
  const y = Math.max(0, Math.min(menu.state.y, maxY));
  return createPortal(
    <div
      data-slot="context-menu-content"
      role="menu"
      className={cn(
        "fixed z-50 w-auto min-w-40 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10",
        className,
      )}
      style={{ left: x, top: y }}
      {...props}
    >
      {children}
    </div>,
    document.body,
  );
}

function ContextMenuGroup({ ...props }: React.ComponentProps<"div">) {
  return <div data-slot="context-menu-group" {...props} />;
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      data-slot="context-menu-label"
      className={cn(
        "px-1.5 py-1 text-xs font-medium text-muted-foreground",
        inset && "pl-7",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  onClick,
  ...props
}: React.ComponentProps<"button"> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  const menu = React.useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      data-slot="context-menu-item"
      className={cn(
        "flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
        inset && "pl-7",
        variant === "destructive" &&
          "text-destructive hover:bg-destructive/10 hover:text-destructive",
        className,
      )}
      onClick={(e) => {
        menu?.close();
        onClick?.(e);
      }}
      {...props}
    />
  );
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuPortal,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuItem,
  ContextMenuSeparator,
};
