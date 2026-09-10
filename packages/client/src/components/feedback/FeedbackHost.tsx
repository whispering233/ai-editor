// 全局反馈宿主（通用交互 + §4.3 样式细节规范 + 组件表）：挂载 AppShell 根 div 末尾
// 职责三件：
// 1) ui store toast → antd message 桥接（`App.useApp().message`，顶部居中——DESIGN.md §Components「toast」）：
// store 的 toast 是「最近一条」快照（showToast 写入、3s 后由 store 内定时器清空），提示由此处触发；
// useRef 记录上次已处理 id——同一 toast 快照在重渲染 / StrictMode 双执行下只触发一次。
// toast 的自动消失由 store 定时器负责，这里不做任何定时逻辑（message 只给同等时长，避免 store 清空后提示残留）。
// 2) ErrorBanner 错误横幅：store error 非空时渲染红色横幅（bg-destructive/10 border-destructive/30 text-destructive，
// §4.3 全局/流错误样式），fixed 顶部居中，关闭按钮调 clearError。
// 3) ConfirmDialog 桥（删关系/删节点等破坏性操作用 ui store confirm：confirmState 非空时渲染全局确认对话框，
// 确认/取消分别调 resolveConfirm(true/false) 归还 Promise（「确认对话框（confirm/resolveConfirm，
// ConfirmDialog 实现于 components/outline/dialogs.tsx）」的渲染宿主；各页既有局部 ConfirmDialog 不受影响）。
import { useEffect, useRef } from "react";
import { App, Button } from "antd";
import { CloseOutlined, ExclamationCircleFilled } from "@ant-design/icons";
import { useUiStore, TOAST_DURATION_MS, type Toast } from "../../stores/ui";
import { ConfirmDialog } from "../outline/dialogs";

/** antd message 的 duration 单位是**秒**（antd/es/message/interface.d.ts `duration?: number`），
 * 故由 store 的单一事实源毫秒值换算；store 定时器仍负责 3s 后清空快照。*/
const TOAST_DURATION_SECONDS = TOAST_DURATION_MS / 1000;

/**
 * toast → antd message 触发判定（纯函数，可单测）：
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
      // 确认/取消：resolveConfirm 归还 confirm 的 Promise（resolve 后 confirmState 清空，
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
  const { message } = App.useApp();
  const lastHandledToastId = useRef<number | null>(null);

  // toast 桥接：新快照（新 id）触发 antd message（顶部居中），kind 映射 success/error/info
  useEffect(() => {
    if (!toastState || !shouldNotifyToast(toastState, lastHandledToastId.current)) return;
    lastHandledToastId.current = toastState.id;
    if (toastState.kind === "error") {
      message.error(toastState.text, TOAST_DURATION_SECONDS);
    } else if (toastState.kind === "info") {
      message.info(toastState.text, TOAST_DURATION_SECONDS);
    } else {
      message.success(toastState.text, TOAST_DURATION_SECONDS);
    }
  }, [toastState, message]);

  return (
    <>
      <ConfirmDialogBridge />
      {error && (
        <div
          role="alert"
          className="fixed top-4 left-1/2 z-50 flex w-[min(92vw,32rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive shadow-lg"
        >
          <ExclamationCircleFilled className="shrink-0 text-base" />
          <p className="min-w-0 flex-1">{error.message}</p>
          <Button
            color="default" variant="text"
            size="small"
            aria-label="关闭错误提示"
            onClick={clearError}
            icon={<CloseOutlined className="text-base" />}
          />
        </div>
      )}
    </>
  );
}
