// 自由练习两页的**容器接线**守卫（卡 8 补缺口：卡 5 oracle 指出「让 AI 出题」链路 / 新建题目提交 /
// `PRACTICE_NOT_FOUND` → 404 态 / `canReview` 接线四处无测试）。
//
// 为什么用源码扫描：这几条断言全在**容器**里（`Free.tsx` / `FreeDetail.tsx` 的请求、跳转与分流），
// 仓内无 jsdom（既有纪律：不引新依赖）⇒ 容器渲不出来、点击也发不出去。与 `practice-pages.test.ts`
// 同一手法：断言用**整句表达式 + 出现次序**（不是随处命中的短语），改坏任一处即红。
// 纯函数口径（四态徽标 / 触发文案 / 保存动作 / 帧守卫）在 `lib/free-practice.test.ts`；展示层在
// `pages/free.test.tsx` / `pages/free-detail.test.tsx`。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const free = readFileSync(new URL("./Free.tsx", import.meta.url), "utf8");
const freeDetail = readFileSync(new URL("./FreeDetail.tsx", import.meta.url), "utf8");
const createPieceDialog = readFileSync(
  new URL("../components/practice/create-piece-dialog.tsx", import.meta.url),
  "utf8",
);

/** 各片段在源码里的出现位置（任一缺失即 -1，下面的断言会指名失败的那一段） */
function positions(source: string, fragments: string[]): number[] {
  return fragments.map((fragment) => {
    const index = source.indexOf(fragment);
    expect(index, fragment).toBeGreaterThan(-1);
    return index;
  });
}

describe("「让 AI 出题」链路（#/free 页头按钮，卡 5）", () => {
  it("建空题行 → 发触发消息（带篇 id）→ 落点该篇详情：三步齐备且顺序不得颠倒", () => {
    const order = positions(free, [
      'createPracticePiece({ topic_source: "ai" })',
      "sendMessage(FREE_TOPIC_MESSAGE, { practice_free_piece_id: piece.id })",
      "navigate(`/free/${piece.id}`)",
    ]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("建行成功即跳详情（题目由 `tool_execution_end` 帧驱动重拉，列表页不订阅帧）；失败只提示不跳", () => {
    // 跳转在 try 里、提示在 catch 里：失败路径不会把用户丢进不存在的篇
    const order = positions(free, [
      "navigate(`/free/${piece.id}`)",
      'showToast(err instanceof ApiError ? err.message : "创建失败，请重试", "error")',
    ]);
    expect(order[0]).toBeLessThan(order[1]);
  });
});

describe("新建题目提交（自拟题弹窗 → 重拉列表）", () => {
  it("提交走 `topic_source: \"user\"` 且题目 trim 非空（空题在框内拦下，不发请求）", () => {
    const order = positions(createPieceDialog, [
      'if (trimmedTopic === "") {',
      "setTopicError(\"请填写题目\");",
      "await createPracticePiece({",
      'topic_source: "user",',
    ]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("创建成功后关窗 + 回调调用方重拉（不做乐观更新）", () => {
    expect(createPieceDialog).toContain("onCreated();");
    expect(free).toContain("onCreated={reload}");
  });
});

describe("`PRACTICE_NOT_FOUND` → 整页 404 态（读失败与写失败两条路径）", () => {
  it("详情加载失败：`PRACTICE_NOT_FOUND` 走 `FreePieceMissing`，其余走错误条 + 重试", () => {
    const order = positions(freeDetail, [
      'const missing = loadError?.code === "PRACTICE_NOT_FOUND";',
      "if (missing) return <FreePieceMissing />;",
      "<FreeLoadFailure message={loadError.message}",
    ]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("保存失败（篇被别处删掉）：同样落到 404 态——清详情 + 置 loadError，不留错误条", () => {
    const order = positions(freeDetail, [
      'if (failure.code === "PRACTICE_NOT_FOUND") {',
      "setDetail(null);",
      "setLoadError(failure);",
      "setSaveError(failure.message);",
    ]);
    expect(order[0]).toBeLessThan(order[3]); // 404 分支在前；其余码才走错误条
  });
});

describe("「让 AI 点评」的 canReview 接线（FreeDetail 容器 → 展示层）", () => {
  it("可点性取共用谓词 `canRequestPracticeReview(detail, draft)`（不另写一份判定）", () => {
    expect(freeDetail).toContain("canReview={canRequestPracticeReview(detail, draft)}");
    expect(freeDetail).toContain("canRequestPracticeReview");
  });

  it("点评与出题都发**普通用户消息**（带 `practice_free_piece_id`），文案取常量", () => {
    expect(freeDetail).toContain("{ practice_free_piece_id: pieceId }");
    expect(freeDetail).toContain("onRequestReview={() => request(FREE_REVIEW_MESSAGE)}");
    expect(freeDetail).toContain("onRequestTopic={() => request(FREE_TOPIC_MESSAGE)}");
  });
});
