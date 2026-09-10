// 保存快捷键（批次十八 B2，用户反馈 #5：Ctrl/Cmd + S 保存当前修改的内容）
// 结构：
// - isSaveShortcut：纯谓词（Ctrl/Cmd + S，不带 Shift/Alt；大小写不敏感）
// - 注册栈 registerSaveHandler：后注册者优先——行内编辑组件晚于页面级保存按钮挂载，
//   编辑中按 Ctrl+S 即「提交当前编辑」；返回注销函数（hook cleanup 调用）
// - triggerSaveShortcut：调用栈顶并返回是否命中（无注册者 = false，不拦截浏览器原生保存）
// - 全局唯一 keydown 监听在模块加载时挂载（仅浏览器环境）；SSR/测试环境无 window 时跳过
import { useEffect, useRef } from "react";

/** 保存快捷键判定（Ctrl 或 Cmd + S；Shift/Alt 组合不视为保存） */
export function isSaveShortcut(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s";
}

type SaveHandler = () => void;
const handlers: SaveHandler[] = [];

/** 注册保存动作（栈顶 = 当前生效）；返回注销函数 */
export function registerSaveHandler(handler: SaveHandler): () => void {
  handlers.push(handler);
  return () => {
    const i = handlers.lastIndexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

/** 触发当前保存动作；无注册者返回 false（调用方不 preventDefault） */
export function triggerSaveShortcut(): boolean {
  const handler = handlers[handlers.length - 1];
  if (!handler) return false;
  handler();
  return true;
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.repeat) return; // 长按重复触发：一次按键只保存一次
  if (!isSaveShortcut(e)) return;
  if (triggerSaveShortcut()) e.preventDefault();
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
 * enabled=false（无保存语义/未进入编辑态）时不参与，快捷键落到下层注册者或原生行为。
 */
export function useSaveShortcut(handler: () => void, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    return registerSaveHandler(() => ref.current());
  }, [enabled]);
}
