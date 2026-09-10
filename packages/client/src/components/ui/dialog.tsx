// 受控模态对话框（自绘换芯：Base UI Dialog → createPortal 原生实现）
// API 面不变：<Dialog open onOpenChange> <DialogContent …> <DialogHeader/> <DialogTitle/>
// <DialogDescription/> … <DialogFooter/> </DialogContent> </Dialog>
// 行为：Esc 关闭 / 遮罩点击关闭 / body 滚动锁定 / aria-modal 语义；关闭按钮可选（showCloseButton）
import * as React from "react";
import { createPortal } from "react-dom";
import { CloseOutlined } from "@ant-design/icons";

import { cn } from "@/lib/utils";

interface DialogContextValue {
  open: boolean;
  close: () => void;
}
const DialogContext = React.createContext<DialogContextValue | null>(null);

/** 受控根（不渲染 DOM；提供 close 上下文） */
function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const value = React.useMemo<DialogContextValue>(
    () => ({ open, close: () => onOpenChange(false) }),
    [open, onOpenChange],
  );
  // 打开时锁定 body 滚动（遮罩滚动穿透防御）
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

function DialogTrigger({ ...props }: React.ComponentProps<"button">) {
  return <button type="button" data-slot="dialog-trigger" {...props} />;
}

/** portal 容器（保持导出兼容；Content 内部即 portal） */
function DialogPortal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body);
}

/** 关闭按钮（Content 内/Footer 用；点击回调上下文 close） */
function DialogClose({
  children,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const ctx = React.useContext(DialogContext);
  return (
    <button type="button" data-slot="dialog-close" onClick={() => ctx?.close()} {...props}>
      {children}
    </button>
  );
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<"div"> & { className?: string }) {
  const ctx = React.useContext(DialogContext);
  if (ctx && !ctx.open) return null;
  return (
    <div
      data-slot="dialog-overlay"
      aria-hidden
      onClick={() => ctx?.close()}
      className={cn("fixed inset-0 z-50 bg-black/10 backdrop-blur-[2px]", className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
  className?: string;
}) {
  const ctx = React.useContext(DialogContext);
  // Esc 关闭（面板挂载期监听；关闭态 close 为 no-op）
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") ctx?.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctx]);
  // 关闭态不渲染（受控守卫：取消/Esc/遮罩关闭 = set open false → 卸载 portal）
  if (ctx === null || !ctx.open) return null;

  return createPortal(
    <div role="dialog" aria-modal="true" data-slot="dialog-root">
      <DialogOverlay />
      <div
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100vh-4rem)] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg bg-popover p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogClose
            className="absolute top-2 right-2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="关闭"
          >
            <CloseOutlined className="text-base" />
          </DialogClose>
        )}
      </div>
    </div>,
    document.body,
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pr-6", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 mt-2 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogClose className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
          关闭
        </DialogClose>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="dialog-title"
      className={cn("text-base leading-snug font-medium", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
