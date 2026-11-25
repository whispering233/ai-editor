// 设置页「高级 → 自定义模型」列表的 SSR 走查（仓内无 jsdom，用 react-dom/server 直渲染展示层；
// 请求与 state 由容器 `ModelsProvidersPanel` 承担，这里只断言 `ModelsProvidersCard` 各态）。
// 契约依据 = docs/ui/DESIGN.md `tab-advanced` → `models-providers`：只列自定义 provider（名称 + id + N 个模型）、
// 标题行 = 「添加」primary + icon-button「重新读取」、空列表 empty-state、读取 / 解析失败禁用编辑。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyProviderForm, type CustomProviderForm } from "../../lib/models-config";
import { ModelsProvidersCard, type ModelsProvidersState } from "./models-providers-panel";

/** SSR 在相邻文本节点之间插 `<!-- -->`（文案 + 插值拼起来的行）——断言前归一掉 */
function render(state: ModelsProvidersState, providers: CustomProviderForm[] = []): string {
  return renderToString(
    <ModelsProvidersCard
      state={state}
      providers={providers}
      onAdd={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      onReload={() => {}}
    />,
  ).replace(/<!--[^>]*-->/g, "");
}

/** 含「添加」的那个 button 起始标签（antd 两字按钮会插空格：`添 加`） */
function addButtonTag(html: string): string {
  const index = html.search(/添\s*加/);
  expect(index).toBeGreaterThan(-1);
  return html.slice(0, index).split("<button").pop() ?? "";
}

const READY: ModelsProvidersState = { status: "ready" };

const PROVIDERS: CustomProviderForm[] = [
  {
    ...emptyProviderForm(),
    id: "my-gateway",
    name: "我的网关",
    baseUrl: "https://api.example.com/v1",
    models: [
      { id: "m1", name: "", contextWindow: "", maxTokens: "", reasoning: false, extra: {} },
      { id: "m2", name: "", contextWindow: "", maxTokens: "", reasoning: false, extra: {} },
    ],
  },
];

describe("ModelsProvidersCard · 列表与读取态", () => {
  it("加载中：读取中文案 + 「添加」禁用（编辑无目标可点）", () => {
    const html = render({ status: "loading" });

    expect(html).toContain("读取中…");
    expect(addButtonTag(html)).toContain('disabled=""');
    expect(html).toContain('aria-label="重新读取"');
  });

  it("空列表：empty-state 文案 + 「添加」可点", () => {
    const html = render(READY);

    expect(html).toContain("还没有自定义模型服务");
    expect(addButtonTag(html)).not.toContain("disabled");
    expect(html).not.toContain('aria-label="编辑');
  });

  it("有 provider：名称 + provider id（font-mono）+ N 个模型 + 编辑 / 删除按钮", () => {
    const html = render(READY, PROVIDERS);

    expect(html).toContain("我的网关");
    expect(html).toContain("my-gateway");
    expect(html).toContain("font-mono");
    expect(html).toContain("2 个模型");
    expect(html).toContain('aria-label="编辑 my-gateway"');
    expect(html).toContain('aria-label="删除 my-gateway"');
    expect(html).not.toContain("还没有自定义模型服务");
  });

  it("没填名称时用 provider id 当行标题", () => {
    const html = render(READY, [{ ...emptyProviderForm(), id: "my-gateway" }]);

    expect(html).toContain(">my-gateway</span>");
    expect(html).toContain("0 个模型");
  });

  it("读取失败：行内原因 + 「添加」禁用（重新读取仍在标题行）", () => {
    const html = render({ status: "load-failed", reason: "无法连接服务" });

    expect(html).toContain("读取 models.json 失败：无法连接服务");
    expect(addButtonTag(html)).toContain('disabled=""');
    expect(html).toContain('aria-label="重新读取"');
  });

  it("解析失败：禁用编辑并指路下方 JSON 编辑器", () => {
    const html = render({ status: "parse-failed", reason: "不是合法 JSON（Unexpected token）" });

    expect(html).toContain("models.json 无法读取：不是合法 JSON");
    expect(html).toContain("本机配置文件 → 自定义模型");
    expect(addButtonTag(html)).toContain('disabled=""');
    expect(html).toContain('aria-label="重新读取"');
  });

  it("说明行写明两个入口写同一份文件与注释口径", () => {
    const html = render(READY, PROVIDERS);

    expect(html).toContain("先保存 JSON 再回来用表单");
    expect(html).toContain("models.json.bak");
  });
});