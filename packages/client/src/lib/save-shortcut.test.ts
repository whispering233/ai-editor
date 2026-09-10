// 保存快捷键契约测试（批次十八 B2）：谓词判定 + 注册栈后进先出 + 空栈不拦截。
import { afterEach, describe, expect, it } from "vitest";
import { isSaveShortcut, registerSaveHandler, triggerSaveShortcut } from "./save-shortcut";

const key = (over: Partial<Parameters<typeof isSaveShortcut>[0]> = {}) => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  key: "s",
  ...over,
});

/** 注册栈为模块级状态：用例注册的 handler 逐个在 afterEach 注销，用例间互不污染 */
const disposers: Array<() => void> = [];
function register(handler: () => void): () => void {
  const dispose = registerSaveHandler(handler);
  disposers.push(dispose);
  return dispose;
}
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe("isSaveShortcut", () => {
  it("Ctrl+S / Cmd+S / 大写 S 命中；单键、Shift、Alt、其他键不命中", () => {
    expect(isSaveShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isSaveShortcut(key({ metaKey: true }))).toBe(true);
    expect(isSaveShortcut(key({ ctrlKey: true, key: "S" }))).toBe(true);
    expect(isSaveShortcut(key())).toBe(false);
    expect(isSaveShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSaveShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isSaveShortcut(key({ ctrlKey: true, key: "k" }))).toBe(false);
  });
});

describe("保存注册栈", () => {
  it("后注册者优先；注销后回落到前一个；空栈返回 false", () => {
    const calls: string[] = [];
    const unregisterPage = register(() => calls.push("page"));
    const unregisterInline = register(() => calls.push("inline"));

    expect(triggerSaveShortcut()).toBe(true);
    expect(calls).toEqual(["inline"]); // 行内编辑晚于页面注册 → 优先

    unregisterInline();
    expect(triggerSaveShortcut()).toBe(true);
    expect(calls).toEqual(["inline", "page"]); // 编辑退出 → 回落页面保存

    unregisterPage();
    expect(triggerSaveShortcut()).toBe(false); // 无注册者：不拦截原生 Ctrl+S
    expect(calls).toEqual(["inline", "page"]);
  });

  it("重复注销幂等（cleanup 双调用不误删其他注册者）", () => {
    const calls: string[] = [];
    const unregister = register(() => calls.push("a"));
    unregister();
    unregister();
    expect(triggerSaveShortcut()).toBe(false);
    expect(calls).toEqual([]);
  });
});

// hook 层（useSaveShortcut 的 ref 转发 + enabled 门禁）依赖 React 运行时，由上述纯函数层契约
// + 各页面 typecheck 覆盖；vitest 未引入 @testing-library，不做 renderHook。
