// 项目状态（doc/ui/layout.md §3.1：config + outline 树——顶栏标题映射、多页共用，避免重复请求）
// S1.4 扩展：loadError（区分「未打开项目」与网络失败）、openProjectAt/createProjectAt/closeProject
import { create } from "zustand";
import type { OutlineNode, OutlineTree, ProjectConfig, ProjectLanguage } from "@whispering233/ai-editor-shared";
import {
  ApiError,
  closeProject as apiCloseProject,
  createProject as apiCreateProject,
  getOutline,
  getProjectConfig,
  listProjects,
  openProject as apiOpenProject,
  updateProjectConfig as apiUpdateConfig,
  type ProjectList,
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
  /** 书架（GET /project/list）；null = 未加载/加载失败 */
  bookshelf: ProjectList | null;
  bookshelfLoading: boolean;
  /** 书架加载失败的错误码（CLIENT_NETWORK_ERROR 等；null = 无错误/未加载） */
  bookshelfError: string | null;
  loadConfig: () => Promise<void>;
  /** 更新配置（PUT /project/config，请求体 snake_case）；成功后重新拉取最新配置 */
  updateConfig: (patch: UpdateProjectConfigBody) => Promise<void>;
  loadOutline: () => Promise<void>;
  /** 刷新书架（GET /project/list）；失败记录 bookshelfError */
  loadBookshelf: () => Promise<void>;
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
  bookshelf: null,
  bookshelfLoading: false,
  bookshelfError: null,

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

  loadBookshelf: async () => {
    if (get().bookshelfLoading) return;
    set({ bookshelfLoading: true });
    try {
      const bookshelf = await listProjects();
      set({ bookshelf, bookshelfError: null });
    } catch (err) {
      // list 失败（网络等）：记录错误码，书架区显示重试
      const code = err instanceof ApiError ? err.code : "CLIENT_NETWORK_ERROR";
      set({ bookshelf: null, bookshelfError: code });
    } finally {
      set({ bookshelfLoading: false });
    }
  },

  openProjectAt: async (path) => {
    const res = await apiOpenProject(path);
    // open 响应含完整 config（S1.2），直接用省一次请求；outline 需重新拉取（新项目树不同）
    set({ config: res.config, loadError: null });
    // L3（oracle U4 审核）：切项目后清除未消费的大纲定位目标（旧 id 对新树无意义，防残留）
    useUiStore.getState().clearFocusOutlineNode();
    if (res.rebuilt) {
      // 删库重建提示（决策 13 修订 + endpoints.md「向客户端提示已重建」）
      useUiStore
        .getState()
        .showToast(`项目已按新版本重建${res.fromVersion !== undefined ? `（v${res.fromVersion}）` : ""}，备份已保留`);
    } else if (res.migrated) {
      // 前向迁移提示（E5：旧版本经增量迁移自动升级，数据保全；与 rebuilt 互斥）
      useUiStore
        .getState()
        .showToast(`项目数据已自动升级${res.fromVersion !== undefined ? `（v${res.fromVersion} → 当前版本）` : ""}，快照已保留`);
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
    // L3（oracle U4 审核）：关闭项目同样清除未消费的大纲定位目标
    useUiStore.getState().clearFocusOutlineNode();
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

/**
 * 书籍目录路径：{rootPath}/books/{书名}（S1.5 书架约定：每本书 = 创作根/books/<书名>/）
 * 书名去首尾空白后直接作为目录名（中文/空格均可，服务端 create 支持任意目录名）；
 * rootPath 尾斜杠归一化
 */
export function buildBookPath(rootPath: string, name: string): string {
  return `${rootPath.replace(/\/+$/, "")}/books/${name.trim()}`;
}
