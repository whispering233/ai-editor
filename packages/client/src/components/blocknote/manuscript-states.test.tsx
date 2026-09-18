// 章正文页两个整页状态的渲染走查（卡 12.5）：仓内无 jsdom，用 react-dom/server `renderToString`
// 直渲染 presenter（数据与副作用在容器 pages/Manuscript.tsx）——覆盖「404 态」与「加载失败 + 重试」。
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { ManuscriptLoadFailure, ManuscriptMissing } from "./manuscript-states";

describe("ManuscriptMissing（404 态：章不存在 / 已软删）", () => {
  const html = renderToString(<ManuscriptMissing />);

  it("给出「不存在」文案 + 回收站与返回大纲两条出口", () => {
    expect(html).toContain("该章不存在或已被删除");
    expect(html).toContain('href="#/trash"');
    expect(html).toContain("返回大纲");
  });
});

describe("ManuscriptLoadFailure（加载失败态）", () => {
  it("展示服务端文案 + 重试按钮（点击回调透传）", () => {
    const onRetry = vi.fn();
    const html = renderToString(
      <ManuscriptLoadFailure message="正文只能挂在章节点上: vol-1" onRetry={onRetry} />,
    );
    expect(html).toContain("正文加载失败");
    expect(html).toContain("正文只能挂在章节点上: vol-1");
    expect(html).toMatch(/重\s试/); // antd 会在两个中文字之间插空格（autoInsertSpace）
  });
});
