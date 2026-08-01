// project store 测试（S1.4）：openProjectAt 的 rebuilt toast、loadConfig 的 loadError 区分
// mock lib/api 模块（保留 ApiError 类真实实现）
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "@ai-editor/shared";
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
  };
});

import {
  closeProject as apiCloseProject,
  createProject as apiCreateProject,
  getOutline as apiGetOutline,
  getProjectConfig as apiGetProjectConfig,
  openProject as apiOpenProject,
} from "../lib/api";
import { useProjectStore } from "./project";
import { useUiStore } from "./ui";

const mocked = {
  getProjectConfig: vi.mocked(apiGetProjectConfig),
  openProject: vi.mocked(apiOpenProject),
  createProject: vi.mocked(apiCreateProject),
  closeProject: vi.mocked(apiCloseProject),
  getOutline: vi.mocked(apiGetOutline),
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
  useProjectStore.setState({ config: null, loadError: null, outline: null, configLoading: false, outlineLoading: false });
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
