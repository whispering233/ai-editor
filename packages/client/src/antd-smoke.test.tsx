// antd 基座接入冒烟（批次十七 0-1）：antd v6 + @ant-design/x 与 React 19 / 构建链兼容性走查。
// 仓库无 jsdom/@testing-library 纪律（chat-panel.test 注释），用 react-dom/server renderToString（既有依赖）。
// 注：@ant-design/x-markdown 的 CJS lib 内 require("./*.css")，node 直跑/渲染路径会抛语法错——
// 其兼容性由 vite build 管线验证（浏览器真实路径走 ESM），不做 node 侧导入。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { Bubble, Sender } from "@ant-design/x";
import { AntdProvider } from "./components/AntdProvider";

describe("antd 基座冒烟", () => {
  it("AntdProvider（根接线：zhCN + Notion 暖灰 token 覆盖 + App 上下文 + 主题跟随）包裹可渲染", () => {
    // node 环境无 document：useThemeMode 守卫回落 light 算法（暗色算法渲染由下方用例覆盖）
    const html = renderToString(
      <AntdProvider>
        <span>根接线正常</span>
      </AntdProvider>,
    );
    expect(html).toContain("根接线正常");
  });

  it("ConfigProvider（zhCN + antd 暗色算法）包裹可渲染", () => {
    // 保留用例：验证「一次性传入 locale + algorithm」也能正常渲染（不依赖 AntdProvider 的 token 覆盖）。
    const html = renderToString(
      <ConfigProvider locale={zhCN} theme={{ algorithm: theme.darkAlgorithm }}>
        <span>基座正常</span>
      </ConfigProvider>,
    );
    expect(html).toContain("基座正常");
  });

  it("@ant-design/x Bubble/Sender 可渲染", () => {
    const html = renderToString(<Bubble role="assistant" content={<span>**粗体**纯文本</span>} />);
    expect(html).toContain("纯文本");
    expect(renderToString(<Sender placeholder="输入…" />)).toContain("输入");
  });
});
