// server：对话运行时池 + 在途流登记
//
// 两件事只在这里做（session 文件的读写细节全在 agent 包 runtime/sessions.ts）：
// 1. **每项目一个 ProjectRuntime**：懒创建；切换项目/关闭项目或切换会话时释放
//    （dispose 会话 + 中止在途流 + 清空提案仓）。
// 2. **单项目单在途流 + 会话级在途登记**：CHAT_BUSY / SESSION_BUSY 两个 409 的判定依据。
//
// 路径安全：session_id → 文件路径只经 agent 包的磁盘发现（SessionManager.list）映射，
// 客户端传入值**永不参与路径拼接**（docs/db/schema.md「本仓依赖的契约面」）。

import {
  createProjectRuntime,
  defaultProposalStore,
  openProjectSessionManager,
  type ProjectRuntime,
  type ProjectRuntimeInput,
} from "@whispering233/ai-editor-agent";
import type { Db } from "@whispering233/ai-editor-db";

/** 对话链路需要的最小项目上下文（不依赖 middleware，避免与 project.ts 形成运行时环） */
export interface ChatProjectTarget {
  root: string;
  projectId: string;
  db: Db;
}

// ============ 运行时池 ============

export type RuntimeFactory = (request: { target: ChatProjectTarget; sessionFile?: string }) => Promise<ProjectRuntime>;

/** 缺省工厂：项目 sessions/ 目录 + 项目根 AGENTS.md 的 pi 运行时（装配细节见 agent 包 runtime/） */
export const defaultRuntimeFactory: RuntimeFactory = ({ target, sessionFile }) => {
  const input: ProjectRuntimeInput = {
    projectRoot: target.root,
    toolContext: { db: target.db, outlineDir: target.root, projectId: target.projectId },
    sessionManager: openProjectSessionManager(target.root, sessionFile),
  };
  return createProjectRuntime(input);
};

interface ActiveRuntime {
  projectRoot: string;
  sessionFile: string | undefined;
  runtime: ProjectRuntime;
}

let active: ActiveRuntime | null = null;

/**
 * 取当前项目的运行时：同项目同会话复用，否则释放旧的再建。
 * 抛出（如 NoModelConfiguredError）时调用方在开流前转 HTTP 错误。
 */
export async function acquireProjectRuntime(
  target: ChatProjectTarget,
  sessionFile: string | undefined,
  factory: RuntimeFactory = defaultRuntimeFactory,
): Promise<ProjectRuntime> {
  if (active !== null) {
    const sameProject = active.projectRoot === target.root;
    const sameSession = sessionFile !== undefined && active.sessionFile === sessionFile;
    if (sameProject && sameSession) return active.runtime;
    disposeProjectRuntime(); // 换项目/换会话：旧运行时连同其在途流一起退休
  }
  const runtime = await factory({ target, sessionFile });
  active = { projectRoot: target.root, sessionFile: runtime.session.sessionFile, runtime };
  return runtime;
}

/**
 * 释放运行时：中止在途流 → dispose 会话订阅 → 清空提案仓。
 * 项目切换/关闭时由 middleware/project.ts 的 setCurrentProject 单点调用。
 */
export function disposeProjectRuntime(): void {
  abortActiveChats();
  const previous = active;
  active = null;
  previous?.runtime.dispose();
  // 未确认提案随项目/会话切换作废（docs/design/30-agent-loop.md §2）
  defaultProposalStore.clear();
}

// ============ 在途流登记（单项目单流 + 项目切换可中止） ============

interface ActiveChat {
  projectRoot: string;
  abort: (() => void) | null;
}

const activeChats = new Set<ActiveChat>();

export interface ActiveChatHandle {
  /** 运行时就绪后登记中止回调（`() => session.abort()`） */
  setAbort(abort: () => void): void;
  /** 流结束（任何退出路径）时释放占位 */
  release(): void;
}

/** 该项目的在途流是否已存在（重复进入 → 409 CHAT_BUSY） */
export function hasActiveChat(projectRoot: string): boolean {
  for (const chat of activeChats) {
    if (chat.projectRoot === projectRoot) return true;
  }
  return false;
}

/** 占用「本项目在途流」名额（**同步**：与 hasActiveChat 相邻调用即可避免竞态窗口） */
export function beginActiveChat(projectRoot: string): ActiveChatHandle {
  const chat: ActiveChat = { projectRoot, abort: null };
  activeChats.add(chat);
  return {
    setAbort: (abort) => {
      chat.abort = abort;
    },
    release: () => {
      activeChats.delete(chat);
    },
  };
}

/** 中止全部在途流（项目切换/关闭时；未就绪的占位跳过） */
export function abortActiveChats(): void {
  for (const chat of [...activeChats]) chat.abort?.();
}

// ============ 会话级在途登记（DELETE 的并发防线） ============

const inFlightSessions = new Map<string, number>();

/** 登记会话在途（同一会话并发流可重复登记） */
export function enterInFlightSession(sessionId: string): void {
  inFlightSessions.set(sessionId, (inFlightSessions.get(sessionId) ?? 0) + 1);
}

/** 注销会话在途（归零即删条目） */
export function leaveInFlightSession(sessionId: string): void {
  const next = (inFlightSessions.get(sessionId) ?? 1) - 1;
  if (next <= 0) inFlightSessions.delete(sessionId);
  else inFlightSessions.set(sessionId, next);
}

/** 该会话是否有在途流（删除端点用：拒删在途会话，防流把文件原地重建） */
export function isSessionInFlight(sessionId: string): boolean {
  return (inFlightSessions.get(sessionId) ?? 0) > 0;
}
