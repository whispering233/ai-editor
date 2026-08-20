// project store 测试（S1.4：openProjectAt 的 rebuilt toast、loadConfig 的 loadError 区分）
// + S1.5：书架 loadBookshelf 成功/失败、buildBookPath 路径拼接
// + 决策 41：loadAgents/saveAgents（AGENTS.md 加载/保存 + 外部修改检测）
// mock lib/api 模块（保留 ApiError 类真实实现）
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "@whispering233/ai-editor-shared";
import { ApiError } from "../lib/api";

// 部分 mock：端点函数全部替换，ApiError 类保持真实
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    getProjectConfig: vi.fn(),
    openProject: vi.fn(),
    createProject: vi.fn(),
    closeProject: vi.fn(),
    getOutline: vi.fn(),
    updateProjectConfig: vi.fn(),
    listProjects: vi.fn(),
    getProjectAgents: vi.fn(),
    saveProjectAgents: vi.fn(),
  };
});

import {
  closeProject as apiCloseProject,
  createProject as apiCreateProject,
  getOutline as apiGetOutline,
  getProjectAgents as apiGetProjectAgents,
  getProjectConfig as apiGetProjectConfig,
  listProjects as apiListProjects,
  openProject as apiOpenProject,
  saveProjectAgents as apiSaveProjectAgents,
} from "../lib/api";
import { buildBookPath, useProjectStore } from "./project";
import { useUiStore } from "./ui";

const mocked = {
  getProjectConfig: vi.mocked(apiGetProjectConfig),
  openProject: vi.mocked(apiOpenProject),
  createProject: vi.mocked(apiCreateProject),
  closeProject: vi.mocked(apiCloseProject),
  getOutline: vi.mocked(apiGetOutline),
  listProjects: vi.mocked(apiListProjects),
  getProjectAgents: vi.mocked(apiGetProjectAgents),
  saveProjectAgents: vi.mocked(apiSaveProjectAgents),
};

const sampleConfig: ProjectConfig = {
  id: "proj-1",
  name: "我的小说",
  language: "zh",
  schemaVersion: 1,
  currentPosition: null,
  backupFrequencyMinutes: 10, // 决策 27（B2.1 新增字段）
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z",
};

afterEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({
    config: null,
    loadError: null,
    outline: null,
    configLoading: false,
    outlineLoading: false,
    bookshelf: null,
    bookshelfLoading: false,
    bookshelfError: null,
    agents: null,
    agentsProjectId: null,
    agentsLoading: false,
    agentsError: null,
    agentsExternalModified: false,
  });
  useUiStore.setState({ toast: null, error: null });
});

describe("loadConfig 的错误区分（无项目 vs 网络失败）", () => {
  it("NO_PROJECT_OPEN → config=null + loadError=NO_PROJECT_OPEN", async () => {
    // NO_PROJECT_OPEN 为 server 侧自定义码（不在 shared ErrorCode 枚举），运行时按字符串处理
    mocked.getProjectConfig.mockRejectedValue(
      new ApiError("NO_PROJECT_OPEN" as ApiError["code"], "未打开项目"),
    );
    await useProjectStore.getState().loadConfig();
    const s = useProjectStore.getState();
    expect(s.config).toBeNull();
    expect(s.loadError).toBe("NO_PROJECT_OPEN");
  });

  it("网络失败 → loadError=CLIENT_NETWORK_ERROR", async () => {
    mocked.getProjectConfig.mockRejectedValue(new ApiError("CLIENT_NETWORK_ERROR", "网络请求失败"));
    await useProjectStore.getState().loadConfig();
    expect(useProjectStore.getState().loadError).toBe("CLIENT_NETWORK_ERROR");
  });

  it("成功 → config 设置 + loadError 清空", async () => {
    mocked.getProjectConfig.mockResolvedValue(sampleConfig);
    await useProjectStore.getState().loadConfig();
    const s = useProjectStore.getState();
    expect(s.config).toEqual(sampleConfig);
    expect(s.loadError).toBeNull();
  });
});

describe("openProjectAt（打开项目 + rebuilt 提示）", () => {
  it("成功 → config 更新 + loadOutline 拉取", async () => {
    mocked.openProject.mockResolvedValue({
      id: "proj-1",
      name: "我的小说",
      language: "zh",
      config: sampleConfig,
    });
    mocked.getOutline.mockResolvedValue({
      id: "root",
      type: "root",
      schemaVersion: 1,
      children: [],
    });
    await useProjectStore.getState().openProjectAt("/tmp/p");
    expect(useProjectStore.getState().config).toEqual(sampleConfig);
    expect(mocked.getOutline).toHaveBeenCalledTimes(1);
  });

  it("rebuilt=true → toast 提示（含 fromVersion）", async () => {
    mocked.openProject.mockResolvedValue({
      id: "proj-1",
      name: "我的小说",
      language: "zh",
      config: sampleConfig,
      rebuilt: true,
      fromVersion: 0,
    });
    await useProjectStore.getState().openProjectAt("/tmp/p");
    expect(useUiStore.getState().toast?.text).toContain("已按新版本重建");
    expect(useUiStore.getState().toast?.text).toContain("v0");
  });

  it("migrated=true → toast 提示（E5：前向迁移自动升级，含 fromVersion；与 rebuilt 互斥）", async () => {
    mocked.openProject.mockResolvedValue({
      id: "proj-1",
      name: "我的小说",
      language: "zh",
      config: sampleConfig,
      migrated: true,
      fromVersion: 0,
    });
    await useProjectStore.getState().openProjectAt("/tmp/p");
    expect(useUiStore.getState().toast?.text).toContain("已自动升级");
    expect(useUiStore.getState().toast?.text).toContain("v0");
    expect(useUiStore.getState().toast?.text).not.toContain("重建");
  });

  it("rebuilt 未返回 → 无 toast", async () => {
    mocked.openProject.mockResolvedValue({
      id: "proj-1",
      name: "我的小说",
      language: "zh",
      config: sampleConfig,
    });
    await useProjectStore.getState().openProjectAt("/tmp/p");
    expect(useUiStore.getState().toast).toBeNull();
  });
});

describe("createProjectAt / closeProject", () => {
  it("create → open 顺序调用（create 不打开项目，S1.2 语义）", async () => {
    mocked.createProject.mockResolvedValue({ id: "proj-1", path: "/tmp/p", created: true });
    mocked.openProject.mockResolvedValue({
      id: "proj-1",
      name: "我的小说",
      language: "zh",
      config: sampleConfig,
    });
    mocked.getOutline.mockResolvedValue({
      id: "root",
      type: "root",
      schemaVersion: 1,
      children: [],
    });
    await useProjectStore
      .getState()
      .createProjectAt("/tmp/p", { name: "我的小说", language: "zh" });
    expect(mocked.createProject).toHaveBeenCalledWith("/tmp/p", {
      name: "我的小说",
      language: "zh",
    });
    expect(mocked.openProject).toHaveBeenCalledWith("/tmp/p");
    expect(useProjectStore.getState().config).toEqual(sampleConfig);
  });

  it("close → 清空 config/outline", async () => {
    useProjectStore.setState({
      config: sampleConfig,
      outline: { id: "root", type: "root", schemaVersion: 1, children: [] },
    });
    mocked.closeProject.mockResolvedValue({ saved: true });
    await useProjectStore.getState().closeProject();
    const s = useProjectStore.getState();
    expect(s.config).toBeNull();
    expect(s.outline).toBeNull();
    expect(s.loadError).toBeNull();
  });
});

describe("书架 loadBookshelf（S1.5）", () => {
  it("成功 → bookshelf 设置 + bookshelfError 清空", async () => {
    mocked.listProjects.mockResolvedValue({
      rootPath: "/home/me/novels",
      books: [
        {
          name: "我的小说",
          path: "/home/me/novels/books/我的小说",
          updatedAt: "2026-08-01T22:30:00Z",
        },
      ],
    });
    await useProjectStore.getState().loadBookshelf();
    const s = useProjectStore.getState();
    expect(s.bookshelf?.rootPath).toBe("/home/me/novels");
    expect(s.bookshelf?.books).toHaveLength(1);
    expect(s.bookshelfError).toBeNull();
  });

  it("失败（网络）→ bookshelf=null + bookshelfError=CLIENT_NETWORK_ERROR", async () => {
    mocked.listProjects.mockRejectedValue(new ApiError("CLIENT_NETWORK_ERROR", "网络请求失败"));
    await useProjectStore.getState().loadBookshelf();
    const s = useProjectStore.getState();
    expect(s.bookshelf).toBeNull();
    expect(s.bookshelfError).toBe("CLIENT_NETWORK_ERROR");
  });
});

describe("AGENTS.md loadAgents/saveAgents（决策 41）", () => {
  it("loadAgents 成功 → agents 设置 + agentsProjectId 绑定当前项目 + 无外部修改标记", async () => {
    useProjectStore.setState({ config: sampleConfig });
    mocked.getProjectAgents.mockResolvedValue({
      content: "力量体系：练气→筑基",
      exists: true,
      updatedAt: "2026-08-01T10:00:00Z",
    });
    await useProjectStore.getState().loadAgents();
    const s = useProjectStore.getState();
    expect(s.agents).toEqual({ content: "力量体系：练气→筑基", exists: true, updatedAt: "2026-08-01T10:00:00Z" });
    expect(s.agentsProjectId).toBe("proj-1");
    expect(s.agentsExternalModified).toBe(false);
    expect(s.agentsError).toBeNull();
  });

  it("loadAgents 文件不存在 → content 空串 + exists:false + updatedAt:null（不报错）", async () => {
    useProjectStore.setState({ config: sampleConfig });
    mocked.getProjectAgents.mockResolvedValue({ content: "", exists: false, updatedAt: null });
    await useProjectStore.getState().loadAgents();
    const s = useProjectStore.getState();
    expect(s.agents).toEqual({ content: "", exists: false, updatedAt: null });
    expect(s.agentsError).toBeNull();
  });

  it("loadAgents 外部修改检测：上次读取后 mtime 变化 → agentsExternalModified=true（决策 41）", async () => {
    useProjectStore.setState({ config: sampleConfig });
    // 首次加载（基线 mtime A）
    mocked.getProjectAgents.mockResolvedValueOnce({
      content: "旧规则",
      exists: true,
      updatedAt: "2026-08-01T10:00:00Z",
    });
    await useProjectStore.getState().loadAgents();
    expect(useProjectStore.getState().agentsExternalModified).toBe(false);
    // 外部修改后重新加载（mtime 变化）→ 标记
    mocked.getProjectAgents.mockResolvedValueOnce({
      content: "外部改的规则",
      exists: true,
      updatedAt: "2026-08-01T11:00:00Z",
    });
    await useProjectStore.getState().loadAgents();
    expect(useProjectStore.getState().agentsExternalModified).toBe(true);
  });

  it("loadAgents 失败 → agents=null + agentsError 记录", async () => {
    useProjectStore.setState({ config: sampleConfig });
    mocked.getProjectAgents.mockRejectedValue(new ApiError("CLIENT_NETWORK_ERROR", "网络请求失败"));
    await useProjectStore.getState().loadAgents();
    const s = useProjectStore.getState();
    expect(s.agents).toBeNull();
    expect(s.agentsError).toBe("CLIENT_NETWORK_ERROR");
  });

  it("saveAgents 成功 → 更新本地基线（新 mtime）+ 清空外部修改标记", async () => {
    useProjectStore.setState({ config: sampleConfig, agentsExternalModified: true });
    mocked.saveProjectAgents.mockResolvedValue({ saved: true, updatedAt: "2026-08-01T12:00:00Z" });
    await useProjectStore.getState().saveAgents("新规则");
    const s = useProjectStore.getState();
    expect(mocked.saveProjectAgents).toHaveBeenCalledWith("新规则");
    expect(s.agents).toEqual({ content: "新规则", exists: true, updatedAt: "2026-08-01T12:00:00Z" });
    expect(s.agentsExternalModified).toBe(false);
  });

  it("closeProject 清空 agents 状态（决策 41：切换/关闭项目不串数据）", async () => {
    useProjectStore.setState({
      config: sampleConfig,
      agents: { content: "规则", exists: true, updatedAt: "2026-08-01T10:00:00Z" },
      agentsProjectId: "proj-1",
      agentsExternalModified: true,
    });
    mocked.closeProject.mockResolvedValue({ saved: true });
    await useProjectStore.getState().closeProject();
    const s = useProjectStore.getState();
    expect(s.agents).toBeNull();
    expect(s.agentsProjectId).toBeNull();
    expect(s.agentsExternalModified).toBe(false);
  });
});

describe("buildBookPath（S1.5 书架路径拼接）", () => {
  it("{rootPath}/books/{书名}（中文书名原样）", () => {
    expect(buildBookPath("/home/me/novels", "我的小说")).toBe("/home/me/novels/books/我的小说");
  });

  it("rootPath 尾斜杠归一化", () => {
    expect(buildBookPath("/home/me/novels/", "修仙")).toBe("/home/me/novels/books/修仙");
    expect(buildBookPath("/home/me/novels///", "修仙")).toBe("/home/me/novels/books/修仙");
  });

  it("书名去首尾空白", () => {
    expect(buildBookPath("/home/me/novels", "  我的小说  ")).toBe("/home/me/novels/books/我的小说");
  });
});
