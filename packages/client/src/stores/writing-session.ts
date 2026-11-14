// 当日码字悬浮面板的会话状态（zustand；DESIGN.md「当日码字悬浮面板」）。
// 只存内存：不落 localStorage（位置另有 lib/stats-hud）、不发请求、不进项目文件。
// 会话范围 = 同一本书内跨页 / 跨章保留到应用退出；换书 / 关闭项目立即归零。
import { create } from "zustand";
import { applyActivity, type WritingSessionNumbers } from "../lib/writing-session";

interface WritingSessionState extends WritingSessionNumbers {
  /** 数字所属项目（null = 无项目；变化即归零） */
  projectId: string | null;
  /** 面板可见（自动打开或用户点入口） */
  visible: boolean;
  /** 用户点 X 关闭：本次运行不再自动弹（追踪继续，入口可重开） */
  dismissed: boolean;
  /** 本次会话是否已自动弹过（自动只弹一次） */
  hasAutoOpened: boolean;
  syncProject: (projectId: string | null) => void;
  recordDelta: (projectId: string, delta: number, now: number) => void;
  open: () => void;
  dismiss: () => void;
}

/** 归零态：换书 / 关闭项目 / 新会话共用（数字与自动弹出许可一起重置） */
const EMPTY_SESSION = {
  chars: 0,
  typingMs: 0,
  lastEditAt: null,
  visible: false,
  dismissed: false,
  hasAutoOpened: false,
} as const;

export const useWritingSessionStore = create<WritingSessionState>((set, get) => ({
  ...EMPTY_SESSION,
  projectId: null,

  syncProject: (projectId) => {
    // 相同项目不动（面板不闪、不重查）；不同项目立即归零，不等下一次增量
    if (get().projectId === projectId) return;
    set({ ...EMPTY_SESSION, projectId });
  },

  recordDelta: (projectId, delta, now) => {
    const state = get();
    const sameProject = state.projectId === projectId;
    const numbers = applyActivity(
      sameProject
        ? { chars: state.chars, typingMs: state.typingMs, lastEditAt: state.lastEditAt }
        : { chars: 0, typingMs: 0, lastEditAt: null },
      delta,
      now,
    );
    // 换书 = 新会话：dismissed / hasAutoOpened 按归零后看待，重新允许自动弹一次
    const autoOpen =
      delta > 0 && !(sameProject && state.dismissed) && !(sameProject && state.hasAutoOpened);
    set({
      projectId,
      ...numbers,
      // 负增量只更新空闲基准（重置空闲时间），不自动开面板、不扣字数
      visible: autoOpen || (sameProject ? state.visible : false),
      dismissed: sameProject ? state.dismissed : false,
      hasAutoOpened: (sameProject && state.hasAutoOpened) || delta > 0,
    });
  },

  open: () => set({ visible: true }),

  dismiss: () => set({ visible: false, dismissed: true }),
}));