// 设置页「高级 → 联网搜索」表单的 SSR 走查（仓内无 jsdom，用 react-dom/server 直渲染展示层；
// 请求与 state 由容器 `SearchKeyPanel` 承担，这里只断言 `SearchKeyForm` 各态）。
// 契约依据 = docs/ui/DESIGN.md `tab-advanced` → `search-key`：
// 回显当前 key（密码框 + 眼睛切换）、有改动才可保存、解析失败时输入与保存都禁用并指路 JSON 编辑器。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchKeyForm, type SearchKeyState } from "./search-key-panel";

/** SSR 在相邻文本节点之间插 `<!-- -->`（文案 + 插值拼起来的行）——断言前归一掉 */
function render(state: SearchKeyState, draft: string, saveError: string | null = null): string {
  return renderToString(
    <SearchKeyForm
      state={state}
      draft={draft}
      saving={false}
      saveError={saveError}
      onDraftChange={() => {}}
      onSave={() => {}}
      onReload={() => {}}
    />,
  ).replace(/<!--[^>]*-->/g, "");
}

/** 含「保存」的那个 button 起始标签（antd 两字按钮会插空格：`保 存`） */
function saveButtonTag(html: string): string {
  const index = html.search(/保\s*存/);
  expect(index).toBeGreaterThan(-1);
  return html.slice(0, index).split("<button").pop() ?? "";
}

/** 那个密码框的 `<input` 标签（`disabled` 落在这里） */
function keyInputTag(html: string): string {
  const match = /<input[^>]*aria-label="联网搜索 API key"[^>]*>/.exec(html);
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

const READY: SearchKeyState = { status: "ready", loadedKey: "sk-deepseek" };

describe("SearchKeyForm · 读取态", () => {
  it("加载中：占位符「读取中…」、输入与保存都禁用、不给「重新读取」", () => {
    const html = render({ status: "loading" }, "");

    expect(html).toContain("读取中…");
    expect(keyInputTag(html)).toContain('disabled=""');
    expect(saveButtonTag(html)).toContain("disabled");
    expect(html).not.toContain("重新读取");
  });

  it("已就绪：回显已存 key（密码框 + 眼睛切换），未改动时「保存」禁用", () => {
    const html = render(READY, "sk-deepseek");

    expect(keyInputTag(html)).toContain('type="password"');
    expect(keyInputTag(html)).toContain('value="sk-deepseek"');
    expect(keyInputTag(html)).not.toContain("disabled");
    expect(html).toContain("ant-input-password-icon"); // 眼睛切换按钮（visibilityToggle 缺省开）
    expect(saveButtonTag(html)).toContain("disabled");
  });

  it("改过值：「保存」可点；只差首尾空白不算改动（提交会 trim）", () => {
    expect(saveButtonTag(render(READY, "sk-other"))).not.toContain("disabled");
    expect(saveButtonTag(render(READY, "  sk-deepseek \n"))).toContain("disabled");
  });

  it("读取失败：行内原因 + 「重新读取」，输入与保存禁用", () => {
    const html = render({ status: "load-failed", reason: "无法连接服务" }, "");

    expect(html).toContain("读取 search.json 失败：无法连接服务");
    expect(html).toContain("重新读取");
    expect(keyInputTag(html)).toContain('disabled=""');
    expect(saveButtonTag(html)).toContain("disabled");
  });

  it("解析失败：禁用输入并指路下方 JSON 编辑器（不覆盖用户文件）", () => {
    const html = render({ status: "parse-failed", reason: "顶层必须是 JSON 对象" }, "");

    expect(html).toContain("顶层必须是 JSON 对象");
    expect(html).toContain("本机配置文件 → 搜索凭据");
    expect(html).toContain("重新读取");
    expect(keyInputTag(html)).toContain('disabled=""');
    expect(saveButtonTag(html)).toContain("disabled");
  });

  it("保存失败：内联服务端文案且输入保留", () => {
    const html = render(READY, "sk-other", "search.json 含未知键");

    expect(html).toContain("search.json 含未知键");
    expect(keyInputTag(html)).toContain('value="sk-other"');
  });

  it("说明行写明存放位置、计费口径与未配置时的报错指路", () => {
    const html = render(READY, "sk-deepseek");

    expect(html).toContain("~/.ai-editor/search.json");
    expect(html).toContain("按次计费");
    expect(html).toContain("与对话用的模型 key 是两份独立配置");
    expect(html).toContain("未配置时联网搜索工具会报错并指回这里");
  });
});