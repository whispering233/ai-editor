// 全局 UI 状态（doc/ui/layout.md §3.1：错误横幅 / toast / 确认对话框；§3.2 通用交互约定）
// 错误横幅：code + message，按错误码的引导文案由各页映射；toast：轻提示自动消失；
// 确认对话框：危险操作（软删、purge、删关系）必须二次确认并说明影响范围——渲染组件（ConfirmDialog）由后续切片卡实现
import { create } from "zustand";
import type { ErrorCode } from "@ai-editor/shared";
import type { ClientErrorCode } from "../lib/api";

export type ToastKind = "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

/** 错误横幅内容（layout.md §3.2：code + message） */
export interface ErrorBanner {
  code: ErrorCode | ClientErrorCode;
  message: string;
}

/** 确认对话框配置（layout.md §3.2：危险操作二次确认，说明影响范围） */
export interface ConfirmOptions {
  title: string;
  description?: string;
  /** 危险操作（软删/purge/删关系）：按钮红色警示 */
  danger?: boolean;
}

interface UiState {
  error: ErrorBanner | null;
  showError: (code: ErrorBanner["code"], message: string) => void;
  clearError: () => void;

  toast: Toast | null;
  /** 轻提示（保存成功、已移入回收站等）；3s 自动消失 */
  showToast: (text: string, kind?: ToastKind) => void;
  clearToast: () => void;

  /** 进行中的确认对话框（含 resolve）；null = 无 */
  confirmState: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;
  /** 发起二次确认，返回用户选择（Promise<boolean>） */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** 结束对话框（由 ConfirmDialog 组件调用） */
  resolveConfirm: (ok: boolean) => void;

  /**
   * 大纲定位目标节点 id（transient，U4 方案 A：跨页传参不侵入 hash 路由）：
   * InfoBar/概览页点击「当前位置」→ 设置后跳 #/outline；Outline 页消费（展开祖先 +
   * 滚动 + 临时高亮）后 clear。同一时刻仅一个定位请求，页面未消费前保留。
   */
  focusOutlineNodeId: string | null;
  setFocusOutlineNode: (id: string) => void;
  clearFocusOutlineNode: () => void;

  /**
   * 数据版本信号（交互批次，问题 1）：AI 提案确认写库后 / InfoBar 刷新按钮点击时 +1，
   * 中栏数据页面（EntityList/EntityDetail/Outline/OutlineDetail/HookPanel/Trash/Dashboard）
   * 订阅本字段变化后重拉各自数据，实现「AI 改完数据中栏同步刷新」。
   * 触发点约定（避免滥用）：
   * - chat store confirmProposal **成功后**调用（reject 不改数据不触发；hook-panel 复合写
   *   是页面本地操作，S9.1 既有 reloadTick 自带刷新，不走全局信号）；
   * - InfoBar 刷新按钮共用本信号（全中栏统一刷新入口，页面侧不再各自加刷新按钮）。
   * 页面消费用 ref 记上次版本守卫：dataVersion 初始 0，挂载时 ref 同步当前值，
   * 之后仅真实变化触发，避免首帧挂载重复拉取。
   */
  dataVersion: number;
  notifyDataChanged: () => void;
}

/** toast 快照保留时长（FeedbackHost 桥接 sonner 时同步作为视觉时长，契约见 layout.md §4.3） */
export const TOAST_DURATION_MS = 3_000;
let toastSeq = 0;

export const useUiStore = create<UiState>((set, get) => ({
  error: null,
  showError: (code, message) => set({ error: { code, message } }),
  clearError: () => set({ error: null }),

  toast: null,
  showToast: (text, kind = "success") => {
    const id = ++toastSeq;
    set({ toast: { id, kind, text } });
    // 自动消失：仅清除本次这条（新 toast 会覆盖旧定时器场景由 id 比对兜底）
    setTimeout(() => {
      set((s) => (s.toast?.id === id ? { toast: null } : {}));
    }, TOAST_DURATION_MS);
  },
  clearToast: () => set({ toast: null }),

  confirmState: null,
  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      set({ confirmState: { ...options, resolve } });
    }),
  resolveConfirm: (ok) => {
    const state = get().confirmState;
    if (!state) return;
    state.resolve(ok);
    set({ confirmState: null });
  },

  focusOutlineNodeId: null,
  setFocusOutlineNode: (id) => set({ focusOutlineNodeId: id }),
  clearFocusOutlineNode: () => set({ focusOutlineNodeId: null }),

  dataVersion: 0,
  notifyDataChanged: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
}));
