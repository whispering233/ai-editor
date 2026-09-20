// 保存快捷键（B2，用户反馈 #5：Ctrl/Cmd + S 保存当前修改的内容）
// 结构：
// - isSaveShortcut：纯谓词（Ctrl/Cmd + S，不带 Shift/Alt；大小写不敏感）——主键 = SAVE_SHORTCUT_KEY
//   （设置页「快捷键」清单引用同一常量，键位改了清单跟着改，禁止两处各写一份字面量）
// - 注册栈 registerSaveHandler：后注册者优先——行内编辑组件晚于页面级保存按钮挂载，
//   编辑中按 Ctrl+S 即「提交当前编辑」；返回注销函数（hook cleanup 调用）
// - 存档动作 registerArchiveHandler：**全站唯一注册者 = AppShell**（`hooks/use-save-archive.ts`）；
//   与保存栈分开注册，因为存档必须在保存**落定之后**跑（栈语义是「只有一个生效」，合成不了两阶段）
// - 全局唯一 keydown 监听在模块加载时挂载（仅浏览器环境）；SSR/测试环境无 window 时跳过
//   keydown 顺序 = 先 await 栈顶保存动作 → **成功才**触发存档；失败（promise 拒绝 **或 handler 返回 `false`**）
//   沿用该页错误 UI、不存档。本页无保存动作时直接存档；两种情况都 preventDefault
//   （全站拦下浏览器原生「保存网页」对话框）
// - **为什么还需要 `false` 信号**：各页保存动作自己 catch 错误并给可见 UI（错误条/冲突框），
//   promise 一律 resolve ⇒ 只看 rejection 会把「保存失败」当成成功（实测：校验失败/断网/409
//   都会跟着生成一份旧内容备份 + 谎报 toast）。失败分支显式 `return false` 是各页的**契约义务**。
import { useEffect, useRef } from "react";

/** 保存快捷键主键（`KeyboardEvent.key` 小写；设置页「快捷键」清单的唯一键位来源） */
export const SAVE_SHORTCUT_KEY = "s";

/** 保存快捷键判定（Ctrl 或 Cmd + S；Shift/Alt 组合不视为保存） */
export function isSaveShortcut(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === SAVE_SHORTCUT_KEY;
}

/** 保存动作：允许返回 Promise；**`false` = 本次保存失败**（页面失败分支的契约义务——各页自己 catch 后
 * promise 会 resolve，只有这个信号能把「失败」传给快捷键流程） */
export type SaveHandler = () => void | boolean | Promise<void | boolean>;
const handlers: SaveHandler[] = [];

/** 注册保存动作（栈顶 = 当前生效）；返回注销函数 */
export function registerSaveHandler(handler: SaveHandler): () => void {
  handlers.push(handler);
  return () => {
    const i = handlers.lastIndexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

let archiveHandler: (() => void) | null = null;

/** 注册「保存后的存档动作」（全站唯一注册者 = AppShell）；返回注销函数 */
export function registerArchiveHandler(handler: () => void): () => void {
  archiveHandler = handler;
  return () => {
    if (archiveHandler === handler) archiveHandler = null;
  };
}

/** 触发当前保存动作；无注册者返回 null（调用方据此直接进入存档阶段） */
export function triggerSaveShortcut(): Promise<void | boolean> | null {
  const handler = handlers[handlers.length - 1];
  if (!handler) return null;
  return Promise.resolve(handler());
}

/** 触发存档动作；未注册返回 false（测试环境/未挂载外壳时不做事） */
export function triggerArchive(): boolean {
  if (archiveHandler === null) return false;
  archiveHandler();
  return true;
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.repeat) return; // 长按重复触发：一次按键只保存一次
  if (!isSaveShortcut(e)) return;
  e.preventDefault(); // 本页无保存动作也拦：存档仍要跑，浏览器原生保存对话框不再出现
  runSaveShortcut();
}

/**
 * 快捷键流程（keydown 调用；导出以便单测「先保存、成功才存档」的次序）：
 * 无保存动作 → 直接存档；有 → 等它落定：返回 `false` 或 promise 拒绝 ⇒ 不存档
 * （各页保存失败都有自己的可见 UI，这里不重复提示）。
 */
export function runSaveShortcut(): void {
  const save = triggerSaveShortcut();
  if (save === null) {
    triggerArchive();
    return;
  }
  void save.then(
    (result) => {
      if (result !== false) triggerArchive();
    },
    (err: unknown) => {
      // 各页保存失败都有自己的可见 UI（错误条/冲突框）；这里只防未处理的 rejection
      console.error("[save-shortcut] 保存动作失败，本次不生成存档", err);
    },
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("keydown", handleKeyDown);
  // dev HMR：模块重新求值时注销旧监听（防同一页面挂多份 → 一次 Ctrl+S 保存多次）；
  // client tsconfig 未引入 vite/client 类型，故局部窄化 import.meta.hot
  const hot = (import.meta as ImportMeta & { hot?: { dispose(cb: () => void): void } }).hot;
  hot?.dispose(() => window.removeEventListener("keydown", handleKeyDown));
}

/**
 * 页面/行内编辑注册保存快捷键。
 * handler 经 ref 转发：每次渲染刷新最新闭包，注册只随 enabled 变化（避免频繁重排注册栈顺序）。
 * enabled=false（无保存语义/未进入编辑态）时不参与，快捷键落到下层注册者或存档阶段。
 * **返回 Promise 的动作会被等待**（Ctrl+S 存档以「保存已落定」为前提）——异步保存请直接返回它，
 * 不要写成 `() => void handleSave()`（那样存档会抢在落盘前跑，备份内容陈旧）；
 * **失败分支必须 `return false`**（见 SaveHandler 注释），否则失败后仍会生成备份。
 */
export function useSaveShortcut(handler: () => void | boolean | Promise<void | boolean>, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    return registerSaveHandler(() => ref.current());
  }, [enabled]);
}
