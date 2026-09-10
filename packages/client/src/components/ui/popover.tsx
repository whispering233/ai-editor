// 轻量非模态弹层（批次十七 3-7 自绘换芯：Base UI Popover → 原生，API 面不变）
// 受控模式：<Popover open onOpenChange><PopoverTrigger render={<按钮/>}/><PopoverContent>…</PopoverContent></Popover>
// 锚定 trigger 底部（左对齐 + 视口右缘 clamp）；点击外部 / Esc 关闭。
import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

interface PopupApi {
  open: boolean;
  anchorEl: HTMLElement | null;
  setAnchor: (el: HTMLElement | null) => void;
  toggle: () => void;
  close: () => void;
}
const PopupContext = React.createContext<PopupApi | null>(null);

/** 受控根：持有 trigger 元素引用 + close（不渲染 DOM） */
function Popover({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [anchorEl, setAnchor] = React.useState<HTMLElement | null>(null);
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const toggle = React.useCallback(() => onOpenChange(!open), [onOpenChange, open]);
  const api = React.useMemo(
    () => ({ open, anchorEl, setAnchor, toggle, close }),
    [open, anchorEl, close, toggle],
  );

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onOutside = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (anchorEl && anchorEl.contains(t)) return;
      if (t.closest("[data-slot=popover-content]")) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onOutside, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onOutside, true);
    };
  }, [open, close, anchorEl]);

  return <PopupContext.Provider value={api}>{children}</PopupContext.Provider>;
}

/** 触发元素：render 元素克隆注入 onClick/ref；缺省 = 按钮 */
function PopoverTrigger({
  render,
  ...props
}: React.ComponentProps<"button"> & { render?: React.ReactElement }) {
  const menu = React.useContext(PopupContext);
  const base =
    render !== undefined
      ? (render as React.ReactElement<Record<string, unknown>>)
      : (React.createElement("button", { type: "button", ...props }) as React.ReactElement<
          Record<string, unknown>
        >);
  if (!menu) return base;
  const el = base;
  const merged: Record<string, unknown> = {
    ...el.props,
    onClick: (e: React.MouseEvent) => {
      (el.props.onClick as ((e: React.MouseEvent) => void) | undefined)?.(e);
      menu.toggle();
    },
    ref: (node: HTMLElement | null) => {
      menu.setAnchor(node);
      const prev = (el.props as { ref?: unknown }).ref;
      if (typeof prev === "function") (prev as (n: HTMLElement | null) => void)(node);
    },
  };
  const inner = el.props.children as React.ReactNode | undefined;
  return React.createElement(el.type, merged, inner);
}

/** Portal 容器（兼容导出） */
function PopoverPortal({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** 浮层：open 时 portal fixed 于 trigger 下方（左对齐 + 视口右缘 clamp 320px 估算） */
function PopoverContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { className?: string }) {
  const menu = React.useContext(PopupContext);
  const open = menu?.open ?? false;
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  React.useLayoutEffect(() => {
    if (!menu?.anchorEl) {
      setRect(null);
      return;
    }
    const measure = () => setRect(menu.anchorEl!.getBoundingClientRect());
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [menu, open]);

  if (!menu || !menu.open || rect === null) return null;
  const estimateW = 320;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - estimateW - 8));
  const top = rect.bottom + 6;
  return createPortal(
    <div
      data-slot="popover-content"
      className={cn(
        "fixed z-50 rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10",
        className,
      )}
      style={{ left, top, maxWidth: Math.min(estimateW, window.innerWidth - 16) }}
      {...props}
    >
      {children}
    </div>,
    document.body,
  );
}

export { Popover, PopoverContent, PopoverTrigger, PopoverPortal };
