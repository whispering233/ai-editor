// Canvas 页面渲染冒烟测试（S10.1）：仓库无 jsdom/@testing-library（FeedbackHost.test.tsx 注释：
// 避免引入新依赖），沿用 chat-panel.test.tsx 先例用 react-dom/server renderToString 走查。
// SSR 限制：zustand v5 的 getServerSnapshot = 创建时初始态，renderToString 只能渲染初始态——
// 画布初始态为「未打开项目」（config=null），故本测试覆盖该分支的渲染不崩溃；
// 画布数据编排/布局/交互逻辑由 lib/canvas.test.ts 纯函数测试 + 接口走查 + 手工走查承担。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import Canvas from "./Canvas";

describe("Canvas 页面渲染冒烟", () => {
  it("初始态（未打开项目）渲染不崩溃，呈现引导分支", () => {
    const html = renderToString(<Canvas />);
    expect(html).toContain("未打开项目");
    expect(html).toContain("画布");
  });
});
