// 极简 Modal 对话框基座（S2.3 大纲页对话框共用；ConfirmDialog 全局组件由后续卡实现）
// 无动画/无 portal——fixed 覆盖层直接渲染；点击遮罩或 ESC 关闭（对话框内容区 stopPropagation）
// MVP 边界：不做焦点管理/aria 完善（标题 aria-label 已给），后续卡全局对话框组件统一升级
import { useEffect } from "react";
import type { ReactNode } from "react";

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 底部操作区（按钮组）；不传则只有内容 */
  footer?: ReactNode;
}

export function Modal({ title, onClose, children, footer }: ModalProps) {
  // ESC 关闭（oracle 建议：补键盘退出路径；onClose 变化时重绑）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-1.5 text-sm text-zinc-400 hover:text-zinc-600"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div>{children}</div>
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
