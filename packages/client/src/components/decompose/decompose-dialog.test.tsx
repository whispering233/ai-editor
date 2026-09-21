// 拆解对话框 presenter 渲染走查（卡 21.8）：仓内无 jsdom，用 react-dom/server 直渲染 presenter
// （状态机与 analyze/start 请求副作用在容器 `DecomposeDialog` 里 → 交互走浏览器走查）。
// 覆盖：三态入口形状（选文件 accept=".txt" / 解析中 / 预览）、统计行只出现 totalChars、
// 警告行、章列表列、范围输入、预估行、书名默认值与校验复用、错误文案落框内。
//
// + 卡 23.1：start 成功后的**项目镜像收敛**——容器交互同样无 jsdom，故该动作抽成
// `enterStartedProject` 直调（同 `decompose-continue.test.tsx` 的 `submitContinueDecompose` 惯例）；
// mock 面 = `lib/api`（三个刷新端点各发一次 = 收敛的证据）+ `hooks/use-route` 的 `navigate`（跳转时机）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { DecomposeAnalyzeRes, OutlineTree, ProjectConfig } from "@whispering233/ai-editor-shared";

// 部分 mock：拆解端点 + 三个刷新端点替换，ApiError 类保持真实
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getProjectConfig: vi.fn(),
    getOutline: vi.fn(),
    listProjects: vi.fn(),
  };
});

vi.mock("../../hooks/use-route", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/use-route")>();
  return { ...actual, navigate: vi.fn() };
});

import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  getOutline as apiGetOutline,
  getProjectConfig as apiGetProjectConfig,
  listProjects as apiListProjects,
} from "../../lib/api";
import { navigate } from "../../hooks/use-route";
import { useProjectStore } from "../../stores/project";
import { DecomposeDialogView, enterStartedProject, type DecomposeViewProps } from "./decompose-dialog";

/** 章字数之和（6,000）刻意不等于 totalChars（10,000）：统计行只许出现后者 */
const PREVIEW: DecomposeAnalyzeRes = {
  encoding: "utf-8",
  totalChars: 10000,
  chapters: [
    { index: 1, title: "雪夜出走", charCount: 1000, volumeIndex: 0 },
    { index: 2, title: "旧盟友", charCount: 2000, volumeIndex: 0 },
    { index: 3, title: "长夜", charCount: 3000, volumeIndex: 0 },
  ],
  volumes: [{ index: 0, title: "全书" }],
  stats: { min: 1000, median: 2000, max: 3000 },
  warnings: [{ code: "TOC_DROPPED", message: "已丢弃卷首目录页 2 段" }],
  estimate: {
    batchCount: 3,
    llmCalls: 5,
    inputTokensApprox: 8000,
    outputTokensApprox: 1200,
    costApprox: 0.5,
  },
  defaultName: "斗破苍穹",
};

const NOOP_HANDLERS: DecomposeViewProps["handlers"] = {
  onPickFile: () => {},
  onScopeStartChange: () => {},
  onScopeEndChange: () => {},
  onScopeCommit: () => {},
  onNameChange: () => {},
  onStart: () => {},
  onClose: () => {},
};

function render(overrides: Partial<DecomposeViewProps> = {}): string {
  return renderToString(
    <DecomposeDialogView
      preview={null}
      analyzing={false}
      scopeStart=""
      scopeEnd=""
      name=""
      nameError={null}
      error={null}
      starting={false}
      handlers={NOOP_HANDLERS}
      {...overrides}
    />,
  );
}

describe("拆解对话框 presenter：选文件态（preview = null）", () => {
  it("文件框只收 .txt（浏览器/桌面同一路径，无 preload 能力）", () => {
    const html = render();
    expect(html).toContain('accept=".txt"');
    expect(html).toContain('type="file"');
  });

  it("未出预览时不渲染预览字段与主操作（「开始拆解」只属预览态）", () => {
    const html = render();
    expect(html).not.toContain("总字数");
    expect(html).not.toContain("拆解范围");
    expect(html).not.toContain("ant-btn-primary"); // 主色确认钮不在选文件态
    expect(html).toMatch(/取\s?消/); // antd 会给两字中文按钮插空格，故不成文匹配
  });

  it("解析中 → 框内「正在解析文件…」（不另开提示）", () => {
    expect(render({ analyzing: true })).toContain("正在解析文件…");
  });
});

describe("拆解对话框 presenter：预览 + 填名开始态", () => {
  const html = render({ preview: PREVIEW, name: "斗破苍穹" });

  it("统计行：编码 / 总字数 / 章数 / 卷数 / 单章字数分布，且不出现章字数和", () => {
    expect(html).toContain("编码 UTF-8");
    expect(html).toContain("总字数 10,000");
    expect(html).toContain("章数 3");
    expect(html).toContain("卷数 1");
    expect(html).toContain("单章字数 最少 1,000 / 中位 2,000 / 最多 3,000");
    expect(html).not.toContain("6,000");
  });

  it("警告行用服务端 message（客户端不映射 warning code）", () => {
    expect(html).toContain("已丢弃卷首目录页 2 段");
  });

  it("章列表：序号 / 标题 / 字数三列全量渲染", () => {
    expect(html).toContain("雪夜出走");
    expect(html).toContain("旧盟友");
    expect(html).toContain("长夜");
    expect(html).toContain("2,000");
    expect(html).toContain('title="雪夜出走"');
  });

  it("范围输入：起始 / 结束两个数字框 + 留空 = 全书说明", () => {
    expect(html).toContain('aria-label="起始章"');
    expect(html).toContain('aria-label="结束章"');
    expect(html).toContain("留空 = 全书");
  });

  it("预估行：批次数 / 调用次数 / 粗估费用", () => {
    expect(html).toContain("预计 3 批 · 5 次调用 · 粗估费用 ≈ $0.50");
  });

  it("书名输入默认填好，主操作 =「开始拆解」（主色确认钮）", () => {
    expect(html).toContain('aria-label="书名"');
    expect(html).toContain("斗破苍穹");
    expect(html).toContain("ant-btn-primary");
    expect(html).toContain("开始拆解");
  });

  it("书名非法时显示 validateBookName 文案（校验复用，不手抄规则）", () => {
    const invalid = render({ preview: PREVIEW, name: "", nameError: "请输入书名" });
    expect(invalid).toContain("请输入书名");
  });

  it("错误文案落框内（analyze / start 失败同一位置）", () => {
    const failed = render({
      preview: PREVIEW,
      name: "斗破苍穹",
      error: "同名书籍已存在，请换一个书名",
    });
    expect(failed).toContain("同名书籍已存在，请换一个书名");
  });
});

/** 拆解后的新书 config（与旧书同名不同 id：镜像收敛的判据只能是 id，不是 name） */
const NEW_BOOK_CONFIG: ProjectConfig = {
  id: "proj-new",
  name: "斗破苍穹",
  language: "zh",
  schemaVersion: 1,
  currentPosition: null,
  backupFrequencyMinutes: 10,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
};

const NEW_BOOK_OUTLINE: OutlineTree = {
  id: "root",
  type: "root",
  schemaVersion: 1,
  children: [],
};

const NEW_BOOK_SHELF = {
  rootPath: "/root",
  books: [{ name: "斗破苍穹", path: "/root/books/斗破苍穹", updatedAt: "2026-09-01T10:00:00Z" }],
};

afterEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({ config: null, loadError: null, outline: null, bookshelf: null, bookshelfError: null });
});

describe("enterStartedProject（start 成功后的项目镜像收敛）", () => {
  it("config / outline / 书架各刷一次，且都在跳 `#/decompose` 之前", async () => {
    vi.mocked(apiGetProjectConfig).mockResolvedValue(NEW_BOOK_CONFIG);
    vi.mocked(apiGetOutline).mockResolvedValue(NEW_BOOK_OUTLINE);
    vi.mocked(apiListProjects).mockResolvedValue(NEW_BOOK_SHELF);

    await enterStartedProject();

    expect(apiGetProjectConfig).toHaveBeenCalledTimes(1);
    expect(apiGetOutline).toHaveBeenCalledTimes(1);
    expect(apiListProjects).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/decompose");

    // 顺序 = 契约：镜像先收敛、路由后走（反向会出现「书架高亮旧书、点开是新项目数据」）
    const navOrder = vi.mocked(navigate).mock.invocationCallOrder[0];
    for (const spy of [apiGetProjectConfig, apiGetOutline, apiListProjects]) {
      expect(vi.mocked(spy).mock.invocationCallOrder[0]).toBeLessThan(navOrder);
    }
    // 不只是发了请求：镜像确实换成了新书
    expect(useProjectStore.getState().config).toEqual(NEW_BOOK_CONFIG);
    expect(useProjectStore.getState().bookshelf).toEqual(NEW_BOOK_SHELF);
  });

  it("刷新失败不阻断跳转（三个 loader 各自 catch，失败只落 store 的 error 态）", async () => {
    vi.mocked(apiGetProjectConfig).mockRejectedValue(new ApiError(CLIENT_NETWORK_ERROR, "boom"));
    vi.mocked(apiGetOutline).mockRejectedValue(new Error("boom"));
    vi.mocked(apiListProjects).mockRejectedValue(new ApiError(CLIENT_NETWORK_ERROR, "boom"));

    await expect(enterStartedProject()).resolves.toBeUndefined();

    expect(navigate).toHaveBeenCalledWith("/decompose");
    expect(useProjectStore.getState().loadError).toBe(CLIENT_NETWORK_ERROR);
  });
});
