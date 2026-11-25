// 设置页「高级 → 运行参数」的 SSR 走查（仓内无 jsdom，用 react-dom/server 直渲染展示层；
// 请求与 state 由容器 `RuntimeParamsPanel` 承担，这里只断言 `RuntimeParamsForm` 各态）。
// 契约依据 = docs/ui/DESIGN.md `tab-advanced` → `runtime-params`：
// 标题行 = 「保存」primary（仅 dirty 时可点）+ icon-button「重新读取」、两个三态 Select + InputNumber、
// 未改动不可保存、解析 / 读取失败时控件禁用并指路下方 JSON 编辑器。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HTTP_IDLE_TIMEOUT_MIN_MS, type RuntimeParams } from "../../lib/runtime-params";
import { RuntimeParamsForm, type RuntimeParamsDraft, type RuntimeParamsState } from "./runtime-params-panel";
import { PiConfigSection } from "./pi-config-section";

/** SSR 在相邻文本节点之间插 `<!-- -->`（文案 + 插值拼起来的行）——断言前归一掉 */
function render(state: RuntimeParamsState, draft: RuntimeParamsDraft, extra: Partial<{ validationError: string; saveError: string }> = {}): string {
  return renderToString(
    <RuntimeParamsForm
      state={state}
      draft={draft}
      saving={false}
      saveError={extra.saveError ?? null}
      validationError={extra.validationError ?? null}
      onDraftChange={() => {}}
      onSave={() => {}}
      onReload={() => {}}
    />,
  ).replace(/<!--[^>]*-->/g, "");
}

function draftOf(params: RuntimeParams): RuntimeParamsDraft {
  return {
    retryEnabled: params.retryEnabled,
    compactionEnabled: params.compactionEnabled,
    httpIdleTimeoutMs: params.httpIdleTimeoutMs ?? null,
  };
}

/** 含「保存」的那个 button 起始标签（antd 两字按钮会插空格：`保 存`） */
function saveButtonTag(html: string): string {
  const index = html.search(/保\s*存/);
  expect(index).toBeGreaterThan(-1);
  return html.slice(0, index).split("<button").pop() ?? "";
}

/** 禁用态的控件计数（antd 把 `disabled` 翻成根元素上的 `ant-*-disabled` 类） */
function disabledControls(html: string): { selects: number; numbers: number } {
  return {
    selects: (html.match(/ant-select-disabled/g) ?? []).length,
    numbers: (html.match(/ant-input-number-disabled/g) ?? []).length,
  };
}

const LOADED: RuntimeParams = { retryEnabled: false, compactionEnabled: undefined, httpIdleTimeoutMs: 60_000 };
const READY: RuntimeParamsState = { status: "ready", params: LOADED, original: {} };

describe("RuntimeParamsForm · 读取态与控件", () => {
  it("加载中：读取中文案、三个控件禁用、保存禁用（「重新读取」常备）", () => {
    const html = render({ status: "loading" }, draftOf(LOADED));

    expect(html).toContain("读取中…");
    expect(disabledControls(html)).toEqual({ selects: 2, numbers: 1 });
    expect(saveButtonTag(html)).toContain("disabled");
    expect(html).toContain('aria-label="重新读取"');
  });

  it("已就绪：回显三项当前值（关闭 / 默认 / 60000），未改动时「保存」禁用", () => {
    const html = render(READY, draftOf(LOADED));

    expect(html).toContain('title="关闭"'); // retry.enabled = false
    expect(html).toContain("默认（跟随 pi）"); // compaction 缺省
    expect(html).toContain("60000");
    expect(disabledControls(html)).toEqual({ selects: 0, numbers: 0 });
    expect(saveButtonTag(html)).toContain("disabled");
    expect(html).toContain('aria-label="重新读取"');
  });

  it("改过值：「保存」可点", () => {
    const html = render(READY, { retryEnabled: undefined, compactionEnabled: undefined, httpIdleTimeoutMs: null });

    expect(saveButtonTag(html)).not.toContain("disabled");
  });

  it("空闲超时 = 0：回显 0（不是空），且 0 是「有值」——同值不 dirty、不同于加载值才可保存", () => {
    // 下界就是 0（pi schema），`0 → undefined` 的 `||` 写法会把它误当成「留空 = 删键」
    const zero: RuntimeParams = { ...LOADED, httpIdleTimeoutMs: 0 };
    const same = render({ status: "ready", params: zero, original: {} }, draftOf(zero));

    expect(same).toContain('aria-label="出站空闲超时（毫秒）" value="0"');
    expect(same).not.toContain('aria-label="出站空闲超时（毫秒）" value=""');
    expect(saveButtonTag(same)).toContain("disabled"); // 0 与加载值相同 ⇒ 不算改动

    // 加载值非 0、草稿改成 0 ⇒ 是改动（0 没被当成「空」抹掉）
    expect(saveButtonTag(render(READY, draftOf(zero)))).not.toContain("disabled");
    // 加载值 0、草稿改成留空 ⇒ 也是改动（删键）
    expect(saveButtonTag(render({ status: "ready", params: zero, original: {} }, draftOf(LOADED)))).not.toContain("disabled");
  });

  it("读取失败：行内原因 + 控件与保存禁用（可「重新读取」）", () => {
    const html = render({ status: "load-failed", reason: "无法连接服务" }, draftOf(LOADED));

    expect(html).toContain("读取 settings.json 失败：无法连接服务");
    expect(html).toContain("重新读取");
    expect(disabledControls(html)).toEqual({ selects: 2, numbers: 1 });
    expect(saveButtonTag(html)).toContain("disabled");
  });

  it("解析失败：禁用控件并指路下方「本机配置文件 → 运行参数」", () => {
    const html = render({ status: "parse-failed", reason: "顶层必须是 JSON 对象" }, draftOf(LOADED));

    expect(html).toContain("顶层必须是 JSON 对象");
    expect(html).toContain("本机配置文件 → 运行参数");
    expect(disabledControls(html)).toEqual({ selects: 2, numbers: 1 });
    expect(saveButtonTag(html)).toContain("disabled");
  });

  it("本地校验 / 服务端保存失败都行内展示，且草稿不被覆盖", () => {
    const validation = render(READY, { ...draftOf(LOADED), httpIdleTimeoutMs: -1 }, { validationError: "空闲超时必须是不小于 0 的整数毫秒" });
    expect(validation).toContain("空闲超时必须是不小于 0 的整数毫秒");
    expect(validation).toContain("value=\"-1\"");

    const failed = render(READY, { ...draftOf(LOADED), retryEnabled: true }, { saveError: "settings.json 校验失败" });
    expect(failed).toContain("settings.json 校验失败");
  });

  it("说明行：只覆盖这三个键、其余留在下方 JSON、下界由常量插值、保存后立即生效", () => {
    const html = render(READY, draftOf(LOADED));

    expect(html).toContain("只覆盖这三个键");
    expect(html).toContain("本机配置文件 → 运行参数");
    expect(html).toContain(`下界 ${HTTP_IDLE_TIMEOUT_MIN_MS}（`);
    expect(html).toContain("保存后立即生效");
  });
});

describe("PiConfigSection · 五张卡的顺序", () => {
  it("pi 目录 → 联网搜索 → 自定义模型 → 运行参数 → 本机配置文件", () => {
    const html = renderToString(<PiConfigSection />).replace(/<!--[^>]*-->/g, "");
    // 卡片标题 = `SectionCard` 的 `Typography.Title level={5}`（正文里也可能出现同名短语，故只数标题）
    const titles = [...html.matchAll(/<h5[^>]*>([^<]*)<\/h5>/g)].map((match) => match[1]);

    expect(titles).toEqual(["pi 配置目录", "联网搜索", "自定义模型", "运行参数", "本机配置文件"]);
  });
});