// project store 测试（S1.4：openProjectAt 的 rebuilt toast、loadConfig 的 loadError 区分）
// + S1.5：书架 loadBookshelf 成功/失败、buildBookPath 路径拼接
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
  };
});

import {
  closeProject as apiCloseProject,
  createProject as apiCreateProject,
  getOutline as apiGetOutline,
  getProjectConfig as apiGetProjectConfig,
  listProjects as apiListProjects,
  openProject as apiOpenProject,
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
};

const sampleConfig: ProjectConfig = {
  id: "proj-1",
  name: "我的小说",
  language: "zh",
  prompt: "",
  schemaVersion: 1,
  currentPosition: null,
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
  });
  useUiStore.setState({ toast: null, error: null });
});

describe("loadConfig 的错误区分（无项目 vs 网络失败）", () => {
  it("NO_PROJECT_OPEN → config=null + loadError=NO_PROJECT_OPEN", async () => {
    // NO_PROJECT_OPEN 为 server 侧自定义码（不在 shared ErrorCode 枚举），运行时按字符串处理
    mocked.getProjectConfig.mockRejectedValue(new ApiError("NO_PROJECT_OPEN" as ApiError["code"], "未打开项目"));
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
    mocked.openProject.mockResolvedValue({ id: "proj-1", name: "我的小说", language: "zh", config: sampleConfig });
    mocked.getOutline.mockResolvedValue({ id: "root", type: "root", schemaVersion: 1, children: [] });
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
    mocked.openProject.mockResolvedValue({ id: "proj-1", name: "我的小说", language: "zh", config: sampleConfig });
    await useProjectStore.getState().openProjectAt("/tmp/p");
    expect(useUiStore.getState().toast).toBeNull();
  });
});

describe("createProjectAt / closeProject", () => {
  it("create → open 顺序调用（create 不打开项目，S1.2 语义）", async () => {
    mocked.createProject.mockResolvedValue({ id: "proj-1", path: "/tmp/p", created: true });
    mocked.openProject.mockResolvedValue({ id: "proj-1", name: "我的小说", language: "zh", config: sampleConfig });
    mocked.getOutline.mockResolvedValue({ id: "root", type: "root", schemaVersion: 1, children: [] });
    await useProjectStore.getState().createProjectAt("/tmp/p", { name: "我的小说", language: "zh" });
    expect(mocked.createProject).toHaveBeenCalledWith("/tmp/p", { name: "我的小说", language: "zh" });
    expect(mocked.openProject).toHaveBeenCalledWith("/tmp/p");
    expect(useProjectStore.getState().config).toEqual(sampleConfig);
  });

  it("close → 清空 config/outline", async () => {
    useProjectStore.setState({ config: sampleConfig, outline: { id: "root", type: "root", schemaVersion: 1, children: [] } });
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
      books: [{ name: "我的小说", path: "/home/me/novels/books/我的小说", updatedAt: "2026-08-01T22:30:00Z" }],
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
