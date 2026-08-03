// 服务端调试日志层（AI_EDITOR_DEBUG=1 显式开关）
//
// 背景：Node 侧 console.debug 无条件打印（无 NODE_DEBUG 类通道区分），必须显式开关防刷屏。
// 用途：
//   - [chat] 对话链路事件日志（packages/server/src/routes/chat.ts 的 onEvent 转发，createChatEventLogger）
//   - 请求日志开关（packages/server/src/index.ts 按本开关挂载 hono/logger）
// 开关语义：AI_EDITOR_DEBUG === "1" 开启；其他值/未设置 = 关闭。
// 关闭时零开销：debugLog 短路由早退（不拼接参数、不调用 console.debug）——调用方无需
// 额外 if 守卫（调用方只在 onEvent 高频路径无条件调用，本层内部承担开销控制）。

/** 调试开关环境变量名（AI_EDITOR_DEBUG=1 开启；默认关） */
export const DEBUG_ENV_NAME = "AI_EDITOR_DEBUG";

/**
 * 调试开关判定（每次调用读环境变量——测试经 vi.stubEnv / 直接改 process.env 即时生效，
 * 无需模块重载；env 读取开销可忽略，无需缓存）。
 */
export function isDebugEnabled(): boolean {
  return process.env[DEBUG_ENV_NAME] === "1";
}

/**
 * 调试日志输出（前缀加 [ ] 包裹，如 debugLog("chat", "text delta=+12") → "[chat] text delta=+12"）。
 * 开关关闭时**零开销早退**：不拼接参数、不调用 console.debug。
 * 输出走 console.debug（stderr 通道；hono/logger 走 console.log stdout——两类日志分通道，
 * 便于 shell 按需过滤）。
 */
export function debugLog(prefix: string, ...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  console.debug(`[${prefix}]`, ...args);
}
