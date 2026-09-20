// 拆解小说展示口径测试（卡 21.8 预览 + 卡 21.9 进度面）：书名派生 / 统计行 / 预估行 / 范围解析 /
// 阶段映射 / 进度文案 / 批状态 / 状态一行 / 终态判定 / 重跑条件 / 完成总结计数。
// 为什么单测这些：对话框三态与请求副作用在组件里（仓内无 jsdom），而「文案里出现哪个数」的口径是
// 会静默漂移的那类——统计行两项总数并排（误读成丢字）、费用算不出时显示 $0（误读成免费）都发生过。
import { describe, expect, it } from "vitest";
import type {
  DecomposeAnalyzeRes,
  DecomposeBatchResult,
  DecomposeEstimate,
  DecomposeJobRes,
} from "@whispering233/ai-editor-shared";
import { validateBookName } from "./book-name";
import {
  DECOMPOSE_STAGE_LABELS,
  activeModelLabel,
  batchPercent,
  batchResultGroups,
  batchStatusLabel,
  canRerunBatch,
  defaultBookNameFromFileName,
  describeJobStatus,
  formatBatchChapters,
  formatBatchProgress,
  formatCharCount,
  formatCompletionCounts,
  formatEstimate,
  formatJobMeta,
  formatJobScope,
  formatPreviewStats,
  formatShelfBadge,
  isTerminalJobStatus,
  jobActionFor,
  parseScopeInput,
  stageProgress,
  type DecomposeBatchStatus,
} from "./decompose";

/** 造预览：章字数之和（6,000）刻意不等于 totalChars（10,000）——统计行只许出现后者 */
const PREVIEW: DecomposeAnalyzeRes = {
  encoding: "gb18030",
  totalChars: 10000,
  chapters: [
    { index: 1, title: "雪夜出走", charCount: 1000, volumeIndex: 0 },
    { index: 2, title: "旧盟友", charCount: 2000, volumeIndex: 0 },
    { index: 3, title: "长夜", charCount: 3000, volumeIndex: 0 },
  ],
  volumes: [{ index: 0, title: "全书" }],
  stats: { min: 800, median: 1500.5, max: 4200 },
  warnings: [],
  estimate: {
    batchCount: 12,
    llmCalls: 14,
    inputTokensApprox: 8000,
    outputTokensApprox: 1200,
    costApprox: 1.234,
  },
  defaultName: "斗破苍穹",
};

const ESTIMATE = (costApprox: number | null): DecomposeEstimate => ({
  batchCount: 12,
  llmCalls: 14,
  inputTokensApprox: 8000,
  outputTokensApprox: 1200,
  costApprox,
});

describe("defaultBookNameFromFileName（书名派生）", () => {
  it("去目录 + 去最后一个扩展名（Windows / POSIX 路径、大写扩展名同口径）", () => {
    expect(defaultBookNameFromFileName("C:\\novels\\斗破苍穹.txt")).toBe("斗破苍穹");
    expect(defaultBookNameFromFileName("/tmp/upload/雪中悍刀行.TXT")).toBe("雪中悍刀行");
    expect(defaultBookNameFromFileName("第一卷.上.txt")).toBe("第一卷.上");
  });

  it("无扩展名 / 纯点段保持原名（服务端 defaultBookName 同口径）", () => {
    expect(defaultBookNameFromFileName("无名")).toBe("无名");
    expect(defaultBookNameFromFileName(".txt")).toBe(".txt");
    expect(defaultBookNameFromFileName("第 1 卷 .txt")).toBe("第 1 卷");
  });

  it("派生结果直接喂客户端书名校验（validateBookName 单一来源）恒合法", () => {
    for (const fileName of ["斗破苍穹.txt", "my novel.txt", "带/危险目录/书.txt", "a.b.c"]) {
      expect(validateBookName(defaultBookNameFromFileName(fileName))).toBeNull();
    }
    // 校验本身仍会拦下非法书名（对话框停止按钮的判据）
    expect(validateBookName("  ")).toBe("请输入书名");
    expect(validateBookName("a/b")).not.toBeNull();
  });
});

describe("formatPreviewStats（统计行）", () => {
  it("编码 / 总字数 / 章数 / 卷数 / 单章字数分布五项齐全", () => {
    const line = formatPreviewStats(PREVIEW);
    expect(line).toContain("编码 GB18030");
    expect(line).toContain("总字数 10,000");
    expect(line).toContain("章数 3");
    expect(line).toContain("卷数 1");
    expect(line).toContain("单章字数 最少 800 / 中位 1,500.5 / 最多 4,200");
  });

  it("不展示章字数和（6,000）——两个总数并排会被读成丢字", () => {
    expect(formatPreviewStats(PREVIEW)).not.toContain("6,000");
  });

  it("编码标签覆盖全部探测结果（探测在服务端，客户端只展示）", () => {
    const lineFor = (encoding: DecomposeAnalyzeRes["encoding"]) =>
      formatPreviewStats({ ...PREVIEW, encoding });
    expect(lineFor("utf-8")).toContain("编码 UTF-8 ·");
    expect(lineFor("utf-8-bom")).toContain("编码 UTF-8 (BOM)");
    expect(lineFor("utf-16le")).toContain("编码 UTF-16 LE");
    expect(lineFor("utf-16be")).toContain("编码 UTF-16 BE");
  });
});

describe("formatEstimate（预估行）", () => {
  it("批次数 / 调用次数 / 费用（费率取整到分）", () => {
    expect(formatEstimate(ESTIMATE(1.234))).toBe("预计 12 批 · 14 次调用 · 粗估费用 ≈ $1.23");
  });

  it("costApprox = null（未配模型/凭据）→ 明说未知，不显示 $0", () => {
    const line = formatEstimate(ESTIMATE(null));
    expect(line).toContain("粗估费用未知");
    expect(line).toContain("未配置模型或凭据");
    expect(line).not.toContain("$");
  });

  it("分以下费用不显示 $0.00（会被读成免费）", () => {
    const line = formatEstimate(ESTIMATE(0.004));
    expect(line).toContain("小于 $0.01");
    expect(line).not.toContain("0.00");
  });
});

describe("formatCharCount（千分位）", () => {
  it("整数与 x.5 中位数都按千分位分组", () => {
    expect(formatCharCount(0)).toBe("0");
    expect(formatCharCount(999)).toBe("999");
    expect(formatCharCount(1234567)).toBe("1,234,567");
    expect(formatCharCount(1500.5)).toBe("1,500.5");
  });
});

describe("parseScopeInput（范围输入 → query 参数）", () => {
  it("正整数解析；空串 / 非法 / 0 / 负数一律当未填（缺省 = 全书，越界由服务端夹取）", () => {
    expect(parseScopeInput("3", "9")).toEqual({ scopeStart: 3, scopeEnd: 9 });
    expect(parseScopeInput("", "")).toEqual({});
    expect(parseScopeInput("  ", "abc")).toEqual({});
    expect(parseScopeInput("0", "-2")).toEqual({});
    expect(parseScopeInput("7", "")).toEqual({ scopeStart: 7 });
  });
});

// ============ 进度面（卡 21.9） ============
//
// 覆盖：阶段映射 / 进度文案 / 批状态徽标 / 覆盖章范围 / 页头元信息行 / 状态一行 / 书架徽标 /
// 终态判定（轮询停止条件）/ 重跑出现条件 / 批结果分组摘要 / 完成总结计数。

/** 批行（`GET /decompose/job` 的 batches[] 元素） */
function batch(
  seq: number,
  status: DecomposeBatchStatus,
  overrides: Partial<DecomposeJobRes["batches"][number]> = {},
): DecomposeJobRes["batches"][number] {
  return {
    seq,
    chapterIndexes: [seq * 2 - 1, seq * 2],
    chapterTitles: [`第${seq * 2 - 1}章标题`, `第${seq * 2}章标题`],
    charCount: 1000 * seq,
    status,
    attempts: 1,
    error: null,
    ...overrides,
  };
}

function job(overrides: Partial<DecomposeJobRes> = {}): DecomposeJobRes {
  return {
    jobId: "job-1",
    status: "running",
    stage: "extract",
    scopeStart: 1,
    scopeEnd: 44,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:05:00.000Z",
    progress: { done: 3, failed: 1, total: 10 },
    batches: [batch(1, "done"), batch(2, "done"), batch(3, "done"), batch(4, "failed")],
    error: null,
    report: null,
    ...overrides,
  };
}

describe("stageProgress（服务端 stage → 阶段条 5 段）", () => {
  it("五个取值逐个可映射，进度单调不回退", () => {
    expect(stageProgress("ingest")).toEqual({ completed: 1, current: 1 });
    expect(stageProgress("extract")).toEqual({ completed: 2, current: 2 });
    expect(stageProgress("merge")).toEqual({ completed: 3, current: 3 });
    expect(stageProgress("report")).toEqual({ completed: 4, current: 4 });
    expect(stageProgress("done")).toEqual({ completed: 5, current: null });
    const completed = (["ingest", "extract", "merge", "report", "done"] as const).map(
      (stage) => stageProgress(stage).completed,
    );
    expect(completed).toEqual([...completed].sort((a, b) => a - b));
  });

  it("阶段条 5 段文案与设计文档同序（解析 / 建档 / 逐章抽取 / 归并 / 报告）", () => {
    expect([...DECOMPOSE_STAGE_LABELS]).toEqual(["解析", "建档", "逐章抽取", "归并", "报告"]);
  });
});

describe("batchPercent / formatBatchProgress（进度条与文案）", () => {
  it("百分比取整；total = 0（范围为空）→ 0 而不是 NaN", () => {
    expect(batchPercent({ done: 3, total: 10 })).toBe(30);
    expect(batchPercent({ done: 1, total: 3 })).toBe(33);
    expect(batchPercent({ done: 0, total: 0 })).toBe(0);
    expect(Number.isNaN(batchPercent({ done: 0, total: 0 }))).toBe(false);
  });

  it("批进度文案 = 已完成 N/M 批（N 只计 done，不含 failed）", () => {
    expect(formatBatchProgress({ done: 3, total: 10 })).toBe("已完成 3/10 批");
    expect(formatBatchProgress({ done: 0, total: 0 })).toBe("已完成 0/0 批");
  });
});

describe("batchStatusLabel（批状态徽标映射）", () => {
  it("四态各有中文文案（中性 type-badge，不参与 tint）", () => {
    expect(batchStatusLabel("pending")).toBe("待抽取");
    expect(batchStatusLabel("running")).toBe("抽取中");
    expect(batchStatusLabel("done")).toBe("已完成");
    expect(batchStatusLabel("failed")).toBe("失败");
  });
});

describe("formatBatchChapters / formatJobScope（范围文案）", () => {
  it("批覆盖章范围：单章 / 多章 / 空（章被物理删）", () => {
    expect(formatBatchChapters([3])).toBe("第 3 章");
    expect(formatBatchChapters([1, 2, 3, 4, 5])).toBe("第 1–5 章");
    expect(formatBatchChapters([])).toBe("—");
  });

  it("拆解范围：start > end = 范围为空（服务端照样起 job，不假装有范围）", () => {
    expect(formatJobScope(1, 44)).toBe("第 1–44 章");
    expect(formatJobScope(7, 7)).toBe("第 7 章");
    expect(formatJobScope(5, 3)).toBe("范围为空");
  });
});

describe("formatJobMeta（页头元信息行：书名 · 范围 · 当前模型）", () => {
  it("三段齐全", () => {
    expect(
      formatJobMeta({ name: "三少爷的剑", scopeStart: 1, scopeEnd: 44, model: "deepseek/v4" }),
    ).toBe("三少爷的剑 · 第 1–44 章 · 当前模型 deepseek/v4");
  });

  it("取不到模型 → 该段不渲染（不留空占位、不显示「未配置」）", () => {
    expect(formatJobMeta({ name: "三少爷的剑", scopeStart: 1, scopeEnd: 44, model: null })).toBe(
      "三少爷的剑 · 第 1–44 章",
    );
    expect(formatJobMeta({ name: null, scopeStart: 1, scopeEnd: 44, model: null })).not.toContain("· ");
  });
});

describe("activeModelLabel（GET /settings/llm → 当前模型段）", () => {
  it("provider / model 都非空才出标签", () => {
    expect(activeModelLabel({ provider: "deepseek", model: "deepseek-v4-flash" })).toBe(
      "deepseek/deepseek-v4-flash",
    );
  });

  it("未配置（空串任一侧）→ null（该段整段不显示）", () => {
    expect(activeModelLabel({ provider: "", model: "" })).toBeNull();
    expect(activeModelLabel({ provider: "deepseek", model: "" })).toBeNull();
    expect(activeModelLabel({ provider: "", model: "x" })).toBeNull();
  });
});

describe("describeJobStatus（状态一行：进度页与概览卡片同源）", () => {
  it("running / pending → 运行中 N/M 批", () => {
    expect(describeJobStatus(job())).toBe("运行中 3/10 批");
    expect(describeJobStatus(job({ status: "pending", stage: "ingest" }))).toBe("运行中 3/10 批");
  });

  it("paused 且批全部收口 → 已暂停 · 可续拆", () => {
    expect(describeJobStatus(job({ status: "paused", batches: [batch(1, "done")] }))).toBe(
      "已暂停 · 可续拆",
    );
  });

  it("paused 且残留 running 批 → 上次拆解中断，可续拆（只归一 job 行，批由续拆承接）", () => {
    expect(describeJobStatus(job({ status: "paused", batches: [batch(1, "done"), batch(2, "running")] }))).toBe(
      "上次拆解中断，可续拆",
    );
  });

  it("done / failed 各有文案（failed 不假装完成）", () => {
    expect(describeJobStatus(job({ status: "done", stage: "done" }))).toBe("拆解完成");
    expect(describeJobStatus(job({ status: "failed" }))).toBe("拆解失败");
  });
});

describe("isTerminalJobStatus（轮询停止条件 + 书架徽标显示口径）", () => {
  it("done / failed 是终态；paused 不是（可续拆，还要继续轮询）", () => {
    expect(isTerminalJobStatus("done")).toBe(true);
    expect(isTerminalJobStatus("failed")).toBe(true);
    expect(isTerminalJobStatus("paused")).toBe(false);
    expect(isTerminalJobStatus("running")).toBe(false);
    expect(isTerminalJobStatus("pending")).toBe(false);
  });
});

describe("formatShelfBadge（书架当前书行徽标）", () => {
  it("拆解中 N/M（只给当前书那一行；非终态才显示）", () => {
    expect(formatShelfBadge({ done: 3, total: 10 })).toBe("拆解中 3/10");
    expect(isTerminalJobStatus("done")).toBe(true); // 终态无徽标可言
  });
});

describe("canRerunBatch（重跑按钮出现条件）", () => {
  it("仅 done / failed job 上的 done / failed 批可重跑（其余组合服务端 409）", () => {
    expect(canRerunBatch("done", "done")).toBe(true);
    expect(canRerunBatch("done", "failed")).toBe(true);
    expect(canRerunBatch("failed", "failed")).toBe(true);
    expect(canRerunBatch("failed", "done")).toBe(true);
  });

  it("running / paused job、pending / running 批都不给重跑入口", () => {
    expect(canRerunBatch("running", "done")).toBe(false);
    expect(canRerunBatch("paused", "failed")).toBe(false);
    expect(canRerunBatch("done", "pending")).toBe(false);
    expect(canRerunBatch("failed", "running")).toBe(false);
  });
});

describe("batchResultGroups（展开区分组摘要：只出名字，不倾倒原始 JSON）", () => {
  const RESULT: DecomposeBatchResult = {
    chapters: [
      {
        chapterIndex: 1,
        chapterTitle: "雪夜出走",
        summary: "……",
        characters: [
          { name: "张三", role: "主角" },
          { name: "李四" },
        ],
        settings: [{ name: "九阳功" }],
        locations: [{ name: "雪原" }],
        relations: [{ source: "张三", target: "李四", type: "ally" }],
      },
      {
        chapterIndex: 2,
        chapterTitle: "旧盟友",
        summary: "……",
        characters: [{ name: "张三" }], // 跨章同名 → 去重
        settings: [],
        locations: [{ name: "雪原" }],
        relations: [{ source: "张三", target: "李四", type: "ally" }],
      },
    ],
  };

  it("四个分组恒在，跨章同名去重，关系类型走中文标签", () => {
    const groups = batchResultGroups(RESULT);
    expect(groups.map((g) => g.label)).toEqual(["人物", "设定", "地点", "关系"]);
    expect(groups[0].names).toEqual(["张三", "李四"]);
    expect(groups[1].names).toEqual(["九阳功"]);
    expect(groups[2].names).toEqual(["雪原"]);
    expect(groups[3].names).toEqual(["张三 → 李四（盟友）"]);
  });

  it("未抽到内容的分组是空数组（由调用方渲染占位），不是 undefined", () => {
    const groups = batchResultGroups({ chapters: [] });
    expect(groups).toHaveLength(4);
    for (const group of groups) expect(group.names).toEqual([]);
  });
});

describe("formatCompletionCounts（完成总结计数）", () => {
  it("四项计数并排（口径 = 库内当前计数）", () => {
    expect(
      formatCompletionCounts({ character: 32, setting: 58, location: 12, relation: 21 }),
    ).toBe("人物 32 · 设定 58 · 地点 12 · 关系 21");
  });

  it("取数失败显示占位「–」而不是 0（0 是「真的没有」）", () => {
    expect(formatCompletionCounts({ character: null, setting: 0, location: null, relation: 3 })).toBe(
      "人物 – · 设定 0 · 地点 – · 关系 3",
    );
  });
});

describe("jobActionFor（页头操作：按状态显示其一）", () => {
  it("paused → 续拆；running / pending → 中止", () => {
    expect(jobActionFor("paused")).toBe("resume");
    expect(jobActionFor("running")).toBe("pause");
    expect(jobActionFor("pending")).toBe("pause");
  });

  it("终态无操作（done 没得可做；failed 的补救是逐批重跑而不是续拆）", () => {
    expect(jobActionFor("done")).toBeNull();
    expect(jobActionFor("failed")).toBeNull();
  });
});
