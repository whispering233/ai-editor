// 续拆入口 presenter + 提交动作测试（卡 22.7）：仓内无 jsdom（同 `decompose-dialog.test.tsx` /
// `decompose-log.test.tsx` 惯例）——presenter 用 react-dom/server 直渲染走查形状，交互路径
// （确认续拆 / 失败提示）直调 `submitContinueDecompose`（同 `chat-panel.test.tsx` 的 `sessionItemMenu`
// 口径），请求副作用面用 `vi.mock` 换掉 `lib/api`（`ApiError` 保持真实，失败映射走真实现）。
// 契约 = DESIGN.md §拆解小说「续拆入口」：跳过「选文件」段、已拆章带 `type-badge`、无未拆章禁用 + 说明。
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { DecomposePlanRes } from "@whispering233/ai-editor-shared";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, continueDecompose: vi.fn(), getDecomposePlan: vi.fn() };
});

import { ApiError, continueDecompose as apiContinueDecompose } from "../../lib/api";
import {
  ContinueDecomposeButton,
  DecomposeContinueDialogView,
  submitContinueDecompose,
  type DecomposeContinueViewProps,
} from "./decompose-continue";

const noop = () => {};

/** 续拆预览夹具（6 章：1–2 已拆，缺省范围 3–6） */
const PLAN: DecomposePlanRes = {
  scopeStart: 3,
  scopeEnd: 6,
  defaulted: true,
  remainingCount: 4,
  decomposedInScope: 0,
  chapters: [1, 2, 3, 4, 5, 6].map((index) => ({
    index,
    title: `标题${index}`,
    charCount: index * 1000,
    volumeIndex: 0,
    decomposed: index <= 2,
  })),
  stats: { min: 1000, median: 3500, max: 6000 },
  estimate: { batchCount: 1, llmCalls: 3, inputTokensApprox: 2000, outputTokensApprox: 1600, costApprox: 0.5 },
};

const NOOP_HANDLERS: DecomposeContinueViewProps["handlers"] = { onConfirm: noop, onClose: noop };

function renderView(overrides: Partial<DecomposeContinueViewProps> = {}): string {
  return renderToString(
    <DecomposeContinueDialogView
      plan={PLAN}
      loading={false}
      error={null}
      starting={false}
      handlers={NOOP_HANDLERS}
      {...overrides}
    />,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ContinueDecomposeButton（完成态续拆入口）", () => {
  it("还有未拆章：按钮可点，不出现禁用说明", () => {
    const html = renderToString(<ContinueDecomposeButton plan={PLAN} onOpen={noop} />);
    expect(html).toContain("继续拆解");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("没有可续拆的范围");
  });

  it("全书都已拆过：禁用 + `caption-text` 说明（不静默禁用）", () => {
    const html = renderToString(
      <ContinueDecomposeButton plan={{ ...PLAN, scopeStart: 0, scopeEnd: 0, remainingCount: 0 }} onOpen={noop} />,
    );
    expect(html).toContain("继续拆解");
    expect(html).toContain("disabled");
    expect(html).toContain("没有可续拆的范围");
  });

  it("尚未取到范围（null = 读取中 / 读取失败）：不禁用——「未知」不等于「没有」", () => {
    const html = renderToString(<ContinueDecomposeButton plan={null} onOpen={noop} />);
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("没有可续拆的范围");
  });
});

describe("DecomposeContinueDialogView（续拆对话框）", () => {
  it("跳过「选文件」段：直接统计行 + 范围 + 章列表 + 预估行", () => {
    const html = renderView();

    expect(html).not.toContain('type="file"'); // 不吃源文件：正文已在库
    expect(html).toContain("章数 6 · 未拆 4"); // 统计行
    expect(html).toContain("续拆范围 第 3–6 章 · 按未拆章自动选定（共 4 章）");
    expect(html).toContain("标题1");
    expect(html).toContain("标题6"); // 章列表全量渲染
    expect(html).toContain("预计 1 批 · 3 次调用"); // 预估行（与预览页同一 formatter）
  });

  it("已拆章带「已拆」`type-badge`，未拆章不带", () => {
    const html = renderView();
    // 徽标文本节点恰两枚（1–2 章已拆）；说明文案里的「已拆过」不算
    expect(html.match(/>已拆</g)).toHaveLength(2);
  });

  it("无未拆章：范围行说明 + 不渲染确认钮（服务端会 400 NOTHING_TO_DO）", () => {
    const html = renderView({ plan: { ...PLAN, scopeStart: 0, scopeEnd: 0, remainingCount: 0 } });

    expect(html).toContain("全书章都已拆过，没有可续拆的范围");
    expect(html).not.toContain("开始续拆");
    expect(html).not.toContain("ant-btn-primary");
  });

  it("范围拉取中 / 拿不到：一行文案（不残留空列表与主操作）", () => {
    expect(renderView({ plan: null, loading: true })).toContain("正在读取未拆章…");
    const failed = renderView({ plan: null, loading: false, error: "无法连接服务，请确认 ai-editor 服务已启动" });

    expect(failed).toContain("无法连接服务，请确认 ai-editor 服务已启动");
    expect(failed).not.toContain("开始续拆");
  });

  it("启动失败：框内文案（不另开提示）", () => {
    const html = renderView({ error: "job job-1 状态为 running，不能开新 job（先等它收尾，或对它续拆 / 重跑）" });

    expect(html).toContain("不能开新 job");
    expect(html).toContain("text-destructive");
  });
});

describe("submitContinueDecompose（确认续拆）", () => {
  it("成功：调 POST /decompose/continue（不传范围 = 服务端缺省，与框里展示的范围同源）", async () => {
    vi.mocked(apiContinueDecompose).mockResolvedValue({
      jobId: "job-2",
      scopeStart: 3,
      scopeEnd: 6,
      status: "running",
      batchCount: 1,
    });

    await expect(submitContinueDecompose()).resolves.toEqual({ ok: true });
    expect(apiContinueDecompose).toHaveBeenCalledWith();
  });

  it("失败：返回框内文案（服务端 message 透传；网络层失败走引导文案）", async () => {
    vi.mocked(apiContinueDecompose).mockRejectedValue(
      // 409 DECOMPOSE_JOB_STATE 是服务端扩展码（client 不按它分支，只透传 message）——同
      // `stores/project.test.ts` 造 NO_PROJECT_OPEN 的口径
      new ApiError("DECOMPOSE_JOB_STATE" as ApiError["code"], "job job-1 状态为 running，不能开新 job"),
    );
    expect(await submitContinueDecompose()).toEqual({
      ok: false,
      error: "job job-1 状态为 running，不能开新 job",
    });

    vi.mocked(apiContinueDecompose).mockRejectedValue(new Error("boom")); // 非 ApiError = 未知码
    expect(await submitContinueDecompose()).toEqual({
      ok: false,
      error: "无法连接服务，请确认 ai-editor 服务已启动",
    });
  });
});
