// 全局反馈宿主（doc/ui/layout.md §3.1 通用交互 + §4.3 样式细节规范 + 组件表）：挂载 AppShell 根 div 末尾
// 职责四件套：
// 1) 挂载 sonner <Toaster />（components/ui/sonner.tsx，主题随 useTheme 适配，见 layout.md §3.4）
// 2) ui store toast → sonner 桥接：store 的 toast 是「最近一条」快照（showToast 写入、3s 后由 store 内定时器清空），
//    sonner 通知由此处触发；useRef 记录上次已处理 id——同一 toast 快照在重渲染 / StrictMode 双执行下只触发一次。
//    toast 的自动消失由 store 定时器负责，这里不做任何定时逻辑。
// 3) ErrorBanner 错误横幅：store error 非空时渲染红色横幅（bg-destructive/10 border-destructive/30 text-destructive，
//    §4.3 全局/流错误样式），fixed 顶部居中，关闭按钮调 clearError()。
// 4) ConfirmDialog 桥（S10.1 画布删连线用 ui store confirm()）：store confirmState 非空时渲染全局确认对话框，
//    确认/取消分别调 resolveConfirm(true/false) 归还 Promise（layout.md §4.1「确认对话框（confirm/resolveConfirm，
//    ConfirmDialog 实现于 components/outline/dialogs.tsx）」的渲染宿主；各页既有局部 ConfirmDialog 不受影响）。
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { CircleAlert, X } from "lucide-react";
import { useUiStore, TOAST_DURATION_MS, type Toast } from "../../stores/ui";
import { ConfirmDialog } from "../outline/dialogs";
import { Toaster } from "../ui/sonner";

/**
 * toast → sonner 触发判定（纯函数，可单测）：
 * toast 为 null（无新 toast）或 id 与上次已处理相同（同一快照的重渲染 / StrictMode 双执行）时不触发。
 * 注意 store 的 toast id 严格递增（toastSeq），新 toast 必然携带新 id，因此无需在 toast 清空后重置上次 id。
 */
export function shouldNotifyToast(toast: Toast | null, lastHandledToastId: number | null): boolean {
  return toast !== null && toast.id !== lastHandledToastId;
}

/** ui store confirm() 的渲染桥：confirmState 非空时渲染全局确认对话框（S10.1） */
function ConfirmDialogBridge() {
  const confirmState = useUiStore((s) => s.confirmState);
  const resolveConfirm = useUiStore((s) => s.resolveConfirm);
  if (confirmState === null) return null;
  return (
    <ConfirmDialog
      title={confirmState.title}
      description={confirmState.description ?? ""}
      confirmLabel="确认"
      danger={confirmState.danger}
      // 确认/取消：resolveConfirm 归还 confirm() 的 Promise（resolve 后 confirmState 清空，
      // ConfirmDialog 的 onClose 二次调用 resolveConfirm 会因 state 为 null 提前返回，幂等安全）
      onConfirm={async () => resolveConfirm(true)}
      onClose={() => resolveConfirm(false)}
    />
  );
}

export function FeedbackHost() {
  const toastState = useUiStore((s) => s.toast);
  const error = useUiStore((s) => s.error);
  const clearError = useUiStore((s) => s.clearError);
  const lastHandledToastId = useRef<number | null>(null);

  // toast 桥接：新快照（新 id）触发 sonner 展示，kind 映射 success/error
  useEffect(() => {
    if (!toastState || !shouldNotifyToast(toastState, lastHandledToastId.current)) return;
    lastHandledToastId.current = toastState.id;
    if (toastState.kind === "error") {
      toast.error(toastState.text, { duration: TOAST_DURATION_MS });
    } else {
      toast.success(toastState.text, { duration: TOAST_DURATION_MS });
    }
  }, [toastState]);

  return (
    <>
      <Toaster />
      <ConfirmDialogBridge />
      {error && (
        <div
          role="alert"
          className="fixed top-4 left-1/2 z-50 flex w-[min(92vw,32rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive shadow-lg"
        >
          <CircleAlert className="size-4 shrink-0" />
          <p className="min-w-0 flex-1">{error.message}</p>
          <button
            type="button"
            aria-label="关闭错误提示"
            onClick={clearError}
            className="shrink-0 rounded p-0.5 hover:bg-destructive/15"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </>
  );
}
