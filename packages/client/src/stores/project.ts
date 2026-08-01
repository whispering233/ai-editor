// 项目状态（doc/ui/layout.md §3.1：config + outline 树——顶栏标题映射、多页共用，避免重复请求）
import { create } from "zustand";
import type { OutlineNode, OutlineTree, ProjectConfig } from "@ai-editor/shared";
import {
  getOutline,
  getProjectConfig,
  updateProjectConfig as apiUpdateConfig,
  type UpdateProjectConfigBody,
} from "../lib/api";

interface ProjectState {
  /** 项目配置（GET /project/config）；null = 未加载/加载失败 */
  config: ProjectConfig | null;
  configLoading: boolean;
  /** 大纲树（GET /outline）；null = 未加载/加载失败 */
  outline: OutlineTree | null;
  outlineLoading: boolean;
  loadConfig: () => Promise<void>;
  /** 更新配置（PUT /project/config，请求体 snake_case）；成功后重新拉取最新配置 */
  updateConfig: (patch: UpdateProjectConfigBody) => Promise<void>;
  loadOutline: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  config: null,
  configLoading: false,
  outline: null,
  outlineLoading: false,

  loadConfig: async () => {
    // 并发防抖：已在加载中则跳过
    if (get().configLoading) return;
    set({ configLoading: true });
    try {
      const config = await getProjectConfig();
      set({ config });
    } catch {
      // 加载失败保持 null（顶栏显示「未加载」，不阻塞 UI）
      set({ config: null });
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
