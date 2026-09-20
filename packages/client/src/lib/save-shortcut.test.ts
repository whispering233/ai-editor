// 保存快捷键契约测试（B2 + 存档阶段）：谓词判定 + 注册栈后进先出 + 「先保存、成功才存档」次序。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSaveShortcut,
  registerArchiveHandler,
  registerSaveHandler,
  runSaveShortcut,
  SAVE_SHORTCUT_KEY,
  triggerArchive,
  triggerSaveShortcut,
} from "./save-shortcut";

const key = (over: Partial<Parameters<typeof isSaveShortcut>[0]> = {}) => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  key: "s",
  ...over,
});

/** 注册栈/存档槽为模块级状态：用例注册的 handler 逐个在 afterEach 注销，用例间互不污染 */
const disposers: Array<() => void> = [];
function register(handler: () => void | Promise<void>): () => void {
  const dispose = registerSaveHandler(handler);
  disposers.push(dispose);
  return dispose;
}
function registerArchive(handler: () => void): () => void {
  const dispose = registerArchiveHandler(handler);
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

  it("判定用的主键 = 导出的 SAVE_SHORTCUT_KEY（设置页清单引用同一常量）", () => {
    expect(isSaveShortcut(key({ ctrlKey: true, key: SAVE_SHORTCUT_KEY }))).toBe(true);
    expect(isSaveShortcut(key({ ctrlKey: true, key: SAVE_SHORTCUT_KEY.toUpperCase() }))).toBe(true);
  });
});

describe("保存注册栈", () => {
  it("后注册者优先；注销后回落到前一个；空栈返回 null", async () => {
    const calls: string[] = [];
    const unregisterPage = register(() => calls.push("page"));
    const unregisterInline = register(() => calls.push("inline"));

    const first = triggerSaveShortcut();
    expect(first).not.toBeNull();
    await first;
    expect(calls).toEqual(["inline"]); // 行内编辑晚于页面注册 → 优先

    unregisterInline();
    await triggerSaveShortcut();
    expect(calls).toEqual(["inline", "page"]); // 编辑退出 → 回落页面保存

    unregisterPage();
    expect(triggerSaveShortcut()).toBeNull(); // 无注册者：调用方直接进入存档阶段
    expect(calls).toEqual(["inline", "page"]);
  });

  it("异步保存动作被等待（返回值即 handler 的 Promise）", async () => {
    let done = false;
    register(async () => {
      await Promise.resolve();
      done = true;
    });
    const pending = triggerSaveShortcut();
    expect(done).toBe(false);
    await pending;
    expect(done).toBe(true);
  });

  it("重复注销幂等（cleanup 双调用不误删其他注册者）", () => {
    const calls: string[] = [];
    const unregister = register(() => calls.push("a"));
    unregister();
    unregister();
    expect(triggerSaveShortcut()).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("存档动作槽（全站唯一注册者 = AppShell）", () => {
  it("注册后可触发；注销后返回 false", () => {
    const calls: number[] = [];
    const dispose = registerArchive(() => calls.push(1));
    expect(triggerArchive()).toBe(true);
    dispose();
    expect(triggerArchive()).toBe(false);
    expect(calls).toEqual([1]);
  });
});

describe("runSaveShortcut（keydown 的流程）", () => {
  it("无保存动作：直接存档", () => {
    const order: string[] = [];
    registerArchive(() => order.push("archive"));
    runSaveShortcut();
    expect(order).toEqual(["archive"]);
  });

  it("有保存动作：保存落定后才存档（顺序可见）", async () => {
    const order: string[] = [];
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    register(async () => {
      await gate;
      order.push("save");
    });
    registerArchive(() => order.push("archive"));

    runSaveShortcut();
    expect(order).toEqual([]); // 保存未落定 → 还没存档（备份必须含本次改动）
    release();
    await vi.waitFor(() => expect(order).toEqual(["save", "archive"]));
  });

  it("保存失败：不存档，只记日志（错误 UI 归各页）", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const order: string[] = [];
    register(async () => {
      throw new Error("boom");
    });
    registerArchive(() => order.push("archive"));

    runSaveShortcut();
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(order).toEqual([]);
    spy.mockRestore();
  });
});

// hook 层（useSaveShortcut 的 ref 转发 + enabled 门禁）与存档 toast 文案依赖 React/浏览器运行时，
// 由纯函数层契约 + 各页面 typecheck 覆盖；vitest 未引入 @testing-library，不做 renderHook。
