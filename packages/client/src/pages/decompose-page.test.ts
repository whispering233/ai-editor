// 拆解进度页守卫（卡 21.9）：页面形状、跳转 leg 收口、二次确认与「完成态不自动跳转」。
//
// 为什么是源码扫描而不是 SSR 断言：`Decompose` 的数据来自 zustand store + 轮询 hook，
// SSR 的 `getServerSnapshot` 只看初始 state（同 `dashboard-decompose.test.ts` 实测踩坑），
// 拿不到「有 job」的形态。于是照同款口径扫源码，钉住几件会静默丢的东西：
// ① `#/decompose` 必须已是已知路由段（卡 21.8 遗留 leg——漏了它对话框关闭后被当未知 hash 回退书架）；
// ② 页头常驻模板（section `h-full min-h-0 flex-col` + 内层滚动容器）；
// ③ antd Progress 无组件级 token 覆盖（走全局 colorInfo）；
// ④ 阶段条文案只来自常量（禁止在页面里手抄一遍）；
// ⑤ done 批重跑有二次确认且文案写明会重建归并与报告；
// ⑥ 完成态**不自动跳转**（页面内不出现 navigate）；
// ⑦ 展开区**深一层**形状守卫：章内子数组缺失不得抛（只挡顶层 `result.chapters` 不够——
//   `{chapters:[{}]}` 照样进 batchResultGroups 抛错，整页被 ErrorBoundary 换掉）；
// ⑧ 重跑入口钉的是**形态**不是字面量：条件不得再叠加 failed-only 收窄（字面量扫描会静默放过）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DecomposeBatchResult } from "@whispering233/ai-editor-shared";
import { batchResultGroups } from "../lib/decompose";
import { parseHashRoute } from "../hooks/use-route";

const page = readFileSync(new URL("./Decompose.tsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");

describe("跳转 leg 收口（卡 21.8 遗留：对话框 start 成功后 navigate('/decompose')）", () => {
  it("#/decompose 是已知段，不再被当未知 hash 回退书架", () => {
    expect(parseHashRoute("#/decompose")).toEqual({
      path: "/decompose",
      segments: ["decompose"],
      isFallback: false,
    });
  });

  it("main.tsx 有 decompose 分支并渲染进度页（更深段归一回来）", () => {
    expect(main).toContain('from "./pages/Decompose"');
    expect(main).toMatch(/case "decompose":/);
    expect(main).toContain("<Decompose />");
  });
});

describe("页头常驻模板（DESIGN.md §Layout「中栏页头结构」）", () => {
  it("section = flex h-full min-h-0 flex-col，内容进内层滚动容器", () => {
    expect(page).toContain('className="flex h-full min-h-0 flex-col"');
    expect(page).toContain('className="flex min-h-0 flex-1 flex-col overflow-y-auto"');
  });
});

describe("阶段条 / 进度条", () => {
  it("阶段文案只来自 DECOMPOSE_STAGE_LABELS（不在页面手抄第二份）", () => {
    expect(page).toContain("DECOMPOSE_STAGE_LABELS");
    expect(page).not.toContain("逐章抽取");
    expect(page).not.toContain("建档");
  });

  it("antd Progress 走全局 colorInfo：无 strokeColor / 无组件级 styles 覆盖", () => {
    expect(page).toMatch(/<Progress percent=\{batchPercent\(current\.progress\)\} showInfo=\{false\} \/>/);
    expect(page).not.toContain("strokeColor");
    expect(page).not.toMatch(/<Progress[\s\S]{0,160}styles=/);
  });
});

describe("批次列表与重跑", () => {
  it("done 批重跑需二次确认（受控 Dialog，文案写明重建归并与报告）", () => {
    expect(page).toContain("confirmRerunSeq");
    expect(page).toMatch(/<Dialog[\s\S]{0,200}open=\{confirmRerunSeq !== null\}/);
    expect(page).toContain("重建归并与报告");
  });

  it("失败批行内错误文案（不折进展开区），行内重跑直接走 runRerun", () => {
    expect(page).toMatch(/\{batch\.error !== null && \(/);
    expect(page).toContain("runRerun(batch.seq)");
  });

  it("展开区读的是分组摘要（batchResultGroups），不直接渲染原始 JSON", () => {
    expect(page).toContain("batchResultGroups(detail.result)");
    expect(page).not.toContain("JSON.stringify");
  });
});

describe("完成态总结卡", () => {
  it("三个跳转齐全（报告 / 大纲 / 人物），且页面内不自动跳转", () => {
    expect(page).toContain("#/references/${report.entityId}");
    expect(page).toContain('href="#/outline"');
    expect(page).toContain('href="#/characters"');
    expect(page).not.toContain("navigate(");
  });

  it("计数走 formatCompletionCounts（库内计数口径）", () => {
    expect(page).toContain("formatCompletionCounts");
  });

  it("完成态 = 总结卡在上 + 批列表在下（不得藏掉重跑入口）", () => {
    // done 分支必须同时给出总结卡与批列表，且批列表只有一份实现（进度态与完成态共用）
    expect(page).toMatch(
      /if \(job\.status === "done"\) \{[\s\S]{0,200}renderSummary\(job\.report\)[\s\S]{0,200}renderBatchList\(job\)/,
    );
    expect(page).not.toMatch(/job\.status === "done"\)\s*return renderSummary/);
    expect(page.match(/function renderBatchList\(/g)?.length).toBe(1);
    expect(page).toContain("{renderBatchList(current)}"); // 进度态也走同一份
    expect(page).toContain("canRerunBatch(current.status, batch.status)"); // done 批仍能重跑
    // 形态断言（oracle R2）：字面量在 ≠ 入口在——条件被收窄成 `current.status === "failed" && canRerunBatch(...)`
    // 时上面那行照样过（done 态整行不再渲染重跑按钮）。钉「开关就是 canRerunBatch 本身」+ 禁 failed-only 收窄。
    expect(page).toMatch(/\{canRerunBatch\(current\.status, batch\.status\) && \(/);
    expect(page).not.toMatch(/current\.status === "failed"\s*&&/);
  });

  it("批 result 形状守卫：脏形状降级成一行文案，不进 batchResultGroups", () => {
    // 脏 result 直接进 batchResultGroups 会抛错 → 整页（含左栏/聊天）被 ErrorBoundary 换掉
    expect(page).toContain("Array.isArray(detail.result.chapters)");
    expect(page).toContain("结果形状异常");
    expect(page.indexOf("Array.isArray(detail.result.chapters)")).toBeLessThan(
      page.indexOf("batchResultGroups(detail.result)"),
    );
  });
});

describe("展开区：章内子数组缺失不得抛（oracle R1）", () => {
  it("{chapters:[{}]} → 四组空分组（页面渲染「—」），不是抛错换整页", () => {
    // 顶层守卫（Array.isArray(result.chapters)）挡不住章内子数组缺失——这里不许抛
    const groups = batchResultGroups({ chapters: [{}] } as unknown as DecomposeBatchResult);
    expect(groups.map((group) => group.names)).toEqual([[], [], [], []]);
    // 空分组由页面渲染成「—」（不改实现：页面这一行就是「空分组」的可见形态）
    expect(page).toContain('group.names.length === 0 ? "—" : group.names.join("、")');
  });
});
