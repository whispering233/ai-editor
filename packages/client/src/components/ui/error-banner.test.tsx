// 错误条唯一实现（DESIGN.md §Components `error-banner`）的渲染契约。
// 收口前 14 个文件 18 处各自拼几何：「有没有重试按钮」「按钮在消息前还是后」「gap 是 2 还是 3」逐页不同。
// 本文件锁四条：按钮存在性、按钮位于消息之后、actions 插槽、stack 的 block 按钮。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { ErrorBanner } from "./error-banner";

describe("ErrorBanner", () => {
  it("row：有 onRetry 时渲染重试按钮，且排在消息之后", () => {
    const html = renderToString(<ErrorBanner message="保存失败" onRetry={() => {}} />);
    expect(html).toContain("保存失败");
    // antd Button 会在两个中文字之间自动插一个空格（「重试」→「重 试」，全站既有行为），不能字面对比
    expect(html).toMatch(/重\s?试/);
    expect(html.indexOf("保存失败")).toBeLessThan(html.search(/<button/));
  });

  it("row：无 onRetry 时不渲染按钮", () => {
    const html = renderToString(<ErrorBanner message="只读错误" />);
    expect(html).toContain("只读错误");
    expect(html).not.toContain("<button");
  });

  it("actions 插槽按调用点给的节点渲染", () => {
    const html = renderToString(
      <ErrorBanner message="章节不存在" actions={<a href="#/writing">返回章节目录</a>} />,
    );
    expect(html).toContain("返回章节目录");
    expect(html).toContain('href="#/writing"');
  });

  it("stack：按钮走 block（竖排整宽）", () => {
    const html = renderToString(
      <ErrorBanner layout="stack" message="加载失败" onRetry={() => {}} />,
    );
    expect(html).toContain("加载失败");
    expect(html).toContain("ant-btn-block");
  });

  it("壳类串只有一个来源；className 只追加外边距", () => {
    const html = renderToString(<ErrorBanner className="mb-3" message="x" />);
    expect(html).toContain("mb-3");
    expect(html.match(/border-destructive\/30/g)).toHaveLength(1);
  });

  it("row 的几何：消息可伸缩 + gap-3（不允许各调用点再拼 gap-2）", () => {
    const html = renderToString(<ErrorBanner message="x" onRetry={() => {}} />);
    expect(html).toContain("gap-3");
    expect(html).not.toContain("gap-2");
    expect(html).toContain("min-w-0 flex-1");
  });

  it("组件内不含外边距（外边距由调用点给）", () => {
    const html = renderToString(<ErrorBanner message="x" />);
    expect(html).not.toMatch(/\b(?:m|mb|mt|ml|mr|mx|my)-[0-9.]/);
  });

  it("stack 的几何：竖排 + gap-2，消息不伸缩", () => {
    const html = renderToString(
      <ErrorBanner layout="stack" message="x" onRetry={() => {}} />,
    );
    expect(html).toContain("flex-col");
    expect(html).toContain("gap-2");
    expect(html).not.toContain("min-w-0 flex-1");
  });
});
