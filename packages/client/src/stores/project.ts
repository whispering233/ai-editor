// 项目状态（doc/ui/layout.md §3.1：config + outline 树——顶栏标题映射、多页共用，避免重复请求）
// S1.4 扩展：loadError（区分「未打开项目」与网络失败）、openProjectAt/createProjectAt/closeProject
import { create } from "zustand";
import type { OutlineNode, OutlineTree, ProjectConfig, ProjectLanguage } from "@ai-editor/shared";
import {
  ApiError,
  closeProject as apiCloseProject,
  createProject as apiCreateProject,
  getOutline,
  getProjectConfig,
  openProject as apiOpenProject,
  updateProjectConfig as apiUpdateConfig,
  type UpdateProjectConfigBody,
} from "../lib/api";
import { useUiStore } from "./ui";

interface ProjectState {
  /** 项目配置（GET /project/config）；null = 未加载/加载失败 */
  config: ProjectConfig | null;
  configLoading: boolean;
  /** 配置加载失败的错误码（"NO_PROJECT_OPEN" / CLIENT_NETWORK_ERROR 等；null = 无错误/未加载） */
  loadError: string | null;
  /** 大纲树（GET /outline）；null = 未加载/加载失败 */
  outline: OutlineTree | null;
  outlineLoading: boolean;
  loadConfig: () => Promise<void>;
  /** 更新配置（PUT /project/config，请求体 snake_case）；成功后重新拉取最新配置 */
  updateConfig: (patch: UpdateProjectConfigBody) => Promise<void>;
  loadOutline: () => Promise<void>;
  /** 打开项目（POST /project/open）：成功刷新 config/outline；rebuilt 时 toast 提示（决策 13） */
  openProjectAt: (path: string) => Promise<void>;
  /** 创建项目（POST /project/create）后打开；config 可选（名称/语言/提示词） */
  createProjectAt: (path: string, config?: { name?: string; language?: ProjectLanguage; prompt?: string }) => Promise<void>;
  /** 关闭当前项目（POST /project/close）：清空本地 config/outline */
  closeProject: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  config: null,
  configLoading: false,
  loadError: null,
  outline: null,
  outlineLoading: false,

  loadConfig: async () => {
    // 并发防抖：已在加载中则跳过
    if (get().configLoading) return;
    set({ configLoading: true });
    try {
      const config = await getProjectConfig();
      set({ config, loadError: null });
    } catch (err) {
      // 区分「未打开项目」（NO_PROJECT_OPEN，页面显示开/建引导）与网络/其他失败
      const code = err instanceof ApiError ? err.code : "CLIENT_NETWORK_ERROR";
      set({ config: null, loadError: code });
    } finally {
      set({ configLoading: false });
    }
  },

  updateConfig: async (patch) => {
    await apiUpdateConfig(patch);
    // 服务端仅返回 {updated:true}，重新拉取保证本地一致（currentPosition 变更后同步刷新，layout.md §3.1）
    await get().loadConfig();
  },

  loadOutline: async () => {
    if (get().outlineLoading) return;
    set({ outlineLoading: true });
    try {
      const outline = await getOutline();
      set({ outline });
    } catch {
      set({ outline: null });
    } finally {
      set({ outlineLoading: false });
    }
  },

  openProjectAt: async (path) => {
    const res = await apiOpenProject(path);
    // open 响应含完整 config（S1.2），直接用省一次请求；outline 需重新拉取（新项目树不同）
    set({ config: res.config, loadError: null });
    if (res.rebuilt) {
      // 删库重建提示（决策 13 修订 + endpoints.md「向客户端提示已重建」）
      useUiStore
        .getState()
        .showToast(`项目已按新版本重建${res.fromVersion !== undefined ? `（v${res.fromVersion}）` : ""}，备份已保留`);
    }
    await get().loadOutline();
  },

  createProjectAt: async (path, config) => {
    // create 不打开项目（S1.2：open 才打开）；创建成功 → open 进入项目
    await apiCreateProject(path, config);
    await get().openProjectAt(path);
  },

  closeProject: async () => {
    await apiCloseProject();
    set({ config: null, loadError: null, outline: null });
  },
}));

/** 在大纲树中按 id 递归查找节点（null = 未找到） */
function findNodeInTree(node: OutlineNode, id: string): OutlineNode | null {
  if (node.id === id) return node;
  if ("children" in node && node.children) {
    for (const child of node.children) {
      const found = findNodeInTree(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** 按 id 查找节点标题（顶栏「当前位置」展示用，layout.md §2.1：从本地 outline 树映射 id→title） */
export function findOutlineNodeTitle(tree: OutlineTree | null, id: string | null): string | null {
  if (!tree || !id) return null;
  for (const child of tree.children) {
    const found = findNodeInTree(child, id);
    if (found) return found.title;
  }
  return null;
}
