// 全局 UI 状态（doc/ui/layout.md §3.1：错误横幅 / toast / 确认对话框，确认对话框留后续切片卡）
import { create } from "zustand";

export type ToastKind = "error" | "success";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface UiState {
  /** 全局错误横幅（layout.md §3.2：code + message，各页映射引导文案；暂无数据时为 null） */
  banner: string | null;
  setBanner: (message: string | null) => void;
  /** 轻提示（保存成功、已移入回收站等）：同一时刻只保留一条 */
  toast: Toast | null;
  showToast: (kind: ToastKind, text: string) => void;
  clearToast: () => void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>((set) => ({
  banner: null,
  setBanner: (message) => set({ banner: message }),
  toast: null,
  showToast: (kind, text) => set({ toast: { id: ++toastSeq, kind, text } }),
  clearToast: () => set({ toast: null }),
}));
