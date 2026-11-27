// 受控弹窗（DESIGN.md §Components `dialog`）。**换芯 antd Modal（2026-11）**，API 面不变：
// <Dialog open onOpenChange> <DialogContent …> <DialogHeader/> <DialogTitle/> <DialogDescription/> <DialogFooter/>
//
// 为什么换：自绘实现里焦点管理一样都没有——无初始聚焦、无 Tab 陷阱、关闭后焦点回 body；
// 且 dialog / popover / context-menu 三处各挂一个 window keydown，叠层按一次 Esc 会全关。
// antd Modal（rc-dialog）的 portal 栈天然「只关最顶层」，并自带 focusable.trap / focusTriggerAfterClose。
//
// 几何钉子（不钉就是静默错位，改之前先看 DESIGN.md `dialog`）：
// - container 的 padding 必须是 16：DialogFooter 用 `-mx-4 -mb-4` 抵到这个内边距；antd 默认 contentPadding
//   是 20/24（`antd/es/modal/style/index.js`）⇒ 不钉会让页脚缩进 4~8px。
// - 原来 DialogContent 那串 `grid gap-4` 是所有弹窗的槽间距来源（全局确认框的三段靠它），antd 的 body
//   没有 gap ⇒ 搬到 styles.body，否则标题与说明贴死。
// - 色值一律走 index.css 的变量（`--modal-mask` / `--float-shadow`）：design-discipline 的 hardcoded-color
//   守卫只放行 AntdProvider，写在 tsx 里必红。
// - 宽度只能用 `width` prop（档位见 DIALOG_WIDTHS），Tailwind `max-w-*` 会被 `.ant-modal` 的无层
//   `max-width: calc(100vw - 32px)` 压掉。
import * as React from "react";
import { Modal } from "antd";
import { CloseOutlined } from "@ant-design/icons";

import { cn } from "@/lib/utils";

/** 弹窗宽度档位（唯一来源）；调用点只给档位名，不给像素 */
export const DIALOG_WIDTHS = {
  sm: 384,
  md: 448,
  lg: 512,
  xl: 576,
  "2xl": 672,
} as const;

type DialogWidth = keyof typeof DIALOG_WIDTHS;

interface DialogContextValue {
  open: boolean;
  close: () => void;
}
const DialogContext = React.createContext<DialogContextValue | null>(null);

/** 受控根（不渲染 DOM；提供 open / close 上下文） */
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
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

// 关闭后焦点归还：antd 的 `focusTriggerAfterClose` 在本仓实测拿不到触发器——模态内容在它的
// effect 跑之前就已获得焦点，它存进 ref 的是模态内元素，关闭后焦点落回 body。这里改记
// 「最后一个在弹窗外获得焦点的元素」（document 级 focusin，一次注册，与弹窗数量无关）。
let lastFocusOutsideDialog: HTMLElement | null = null;
// 单例注册：Vite HMR 每次重载本模块都会再执行一遍顶层代码，没有这道闸会累积监听
const FOCUS_TRACKER_KEY = "__aiEditorDialogFocusTracker";
const globals = globalThis as typeof globalThis & { [FOCUS_TRACKER_KEY]?: boolean };
if (typeof document !== "undefined" && globals[FOCUS_TRACKER_KEY] !== true) {
  globals[FOCUS_TRACKER_KEY] = true;
  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(".ant-modal")) return; // 弹窗内部（含 close 钮）不算触发器
      lastFocusOutsideDialog = target;
    },
    true,
  );
}

function restoreFocusOutsideDialog() {
  const target = lastFocusOutsideDialog;
  if (target !== null && target.isConnected) target.focus({ preventScroll: true });
}

/** 关闭钮（内部用：Content 右上 + Footer 的 showCloseButton；不对外导出） */
function DialogClose({ children, ...props }: React.ComponentProps<"button">) {
  const ctx = React.useContext(DialogContext);
  return (
    <button type="button" data-slot="dialog-close" onClick={() => ctx?.close()} {...props}>
      {children}
    </button>
  );
}

// 模块级常量：styles 对象每渲染都新建会让 antd 反复算样式
const CONTAINER_STYLE: React.CSSProperties = {
  padding: 16,
  border: "1px solid var(--ant-color-border-secondary)",
  boxShadow: "var(--float-shadow)",
  // 滚动放在容器上而不是 body：body 一旦是滚动容器，页脚的 `-mx-4 -mb-4` 只能抵到内容盒，
  // 底部会多出一条 16px 白边（实测），换芯前那条通栏页脚就没了
  maxHeight: "calc(100vh - 4rem)",
  overflowY: "auto",
};
const BODY_STYLE: React.CSSProperties = {
  display: "grid",
  gap: 16,
  padding: 0,
};
const MASK_STYLE: React.CSSProperties = {
  backgroundColor: "var(--modal-mask)",
  backdropFilter: "blur(2px)",
};

function DialogContent({
  children,
  showCloseButton = true,
  width = "md",
}: {
  children?: React.ReactNode;
  showCloseButton?: boolean;
  width?: DialogWidth;
}) {
  const ctx = React.useContext(DialogContext);
  const open = ctx?.open ?? false;
  // 调用点有两种形态：`<Dialog open>` 常挂（关闭走 open=false）与 `{open && <Dialog open>}`
  // （关闭=整棵子树卸载）。后者不会触发 Modal 的 afterClose ⇒ 卸载也要归还一次焦点。
  // `wasOpenRef` 是必要条件：常挂形态在 `<StrictMode>` 下会被挂载→卸载→再挂载跑一遍，
  // 不加这道闸会在 dev 里每次挂载都抢一次焦点（生产下页面卸载也会把焦点挪回壳里的导航）。
  const wasOpenRef = React.useRef(false);
  React.useEffect(() => {
    if (open) wasOpenRef.current = true;
  }, [open]);
  React.useEffect(
    () => () => {
      if (wasOpenRef.current) restoreFocusOutsideDialog();
    },
    [],
  );
  if (ctx === null) return null;
  return (
    <Modal
      open={ctx.open}
      onCancel={ctx.close}
      afterClose={restoreFocusOutsideDialog}
      footer={null}
      closable={false}
      centered
      // 关闭即卸载子树：与换芯前「关闭态不渲染」同语义。
      // 注意它**不**负责页面级 state 里的草稿复位（HookPanel 的 createName 那样，关窗只置 open=false）
      destroyOnHidden
      keyboard
      // v6：maskClosable 已弃用，遮罩行为走 mask 配置
      mask={{ closable: true }}
            focusable={{ trap: true, focusTriggerAfterClose: false }}
      width={DIALOG_WIDTHS[width]}
      styles={{ container: CONTAINER_STYLE, body: BODY_STYLE, mask: MASK_STYLE }}
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
    </Modal>
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
  className?: string;
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

export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle };
