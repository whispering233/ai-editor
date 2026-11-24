// 「高级 → 配置文件」每份文件的草稿状态（纯函数：与渲染分离，便于测「切换不打乱草稿」）
//
// 口径：草稿只在本文件的 state 里活着——切 tab 不丢、保存失败不丢、保存成功才把 saved 推到 draft。
import type { ConfigFileName } from "@whispering233/ai-editor-shared/schemas";

export interface FileState {
  /** loading = 首次拉取中；ready = 可编辑；error = 拉取失败（只能重试） */
  status: "idle" | "loading" | "ready" | "error";
  /** 服务端是否存在该文件（false 时页面提示「保存即创建」） */
  exists: boolean;
  /** 服务端已落盘的文本（脏判定基准） */
  saved: string;
  /** 编辑中的文本 */
  draft: string;
  /** 保存失败 / 拉取失败的文案（不覆盖 draft） */
  error: string | null;
}

export const initialFileState: FileState = {
  status: "idle",
  exists: false,
  saved: "",
  draft: "",
  error: null,
};

/** 开始拉取（保留已有草稿：重复点同一个 tab 不该清空用户输入） */
export function fileLoading(state: FileState): FileState {
  return state.status === "idle" || state.status === "error"
    ? { ...state, status: "loading", error: null }
    : state;
}

/** 拉取成功：已有草稿（用户已经改过）不被覆盖 */
export function fileLoaded(state: FileState, res: { exists: boolean; content: string }): FileState {
  const keepDraft = state.status === "ready";
  return {
    status: "ready",
    exists: res.exists,
    saved: res.content,
    draft: keepDraft ? state.draft : res.content,
    error: null,
  };
}

/** 拉取失败 */
export function fileFailed(state: FileState, message: string): FileState {
  return { ...state, status: "error", error: message };
}

/** 用户编辑：只动 draft */
export function fileEdited(state: FileState, draft: string): FileState {
  return { ...state, draft };
}

/** 保存成功：draft 成为新的基准（并把刚创建的文件视为存在） */
export function fileSaved(state: FileState): FileState {
  return { ...state, exists: true, saved: state.draft, error: null };
}

/** 保存失败：保留 draft，只写错误文案 */
export function fileSaveFailed(state: FileState, message: string): FileState {
  return { ...state, error: message };
}

/** 脏判定（有未保存改动） */
export function fileDirty(state: FileState): boolean {
  return state.status === "ready" && state.draft !== state.saved;
}

/** 按文件名分槽的状态表（切 tab 用同一张表，因此互不串草稿） */
export type FileStateMap = Partial<Record<ConfigFileName, FileState>>;

export function stateOf(map: FileStateMap, name: ConfigFileName): FileState {
  return map[name] ?? initialFileState;
}