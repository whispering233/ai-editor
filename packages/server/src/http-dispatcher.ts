// 出站 HTTP dispatcher（嵌入 pi 运行时必需的一环）
//
// 为什么需要它：pi CLI 启动时会安装自己的 undici dispatcher（`pi-coding-agent` 的
// `core/http-dispatcher.ts`，未从包根导出），其中两项对本机/弱网环境是必需的：
// 1. `connect.autoSelectFamilyAttemptTimeout = 2000`——Node 默认 250ms 会让
//    「IPv6 可达性黑洞」的链路上快速放弃、整连接 ETIMEDOUT（实测：不装 dispatcher 时
//    对 opencode.ai 的 fetch 稳定 1.4s 超时，装了即 200）；
// 2. 环境代理支持（`EnvHttpProxyAgent`，配合 `httpProxy` 设置/`HTTP(S)_PROXY`）。
// 不装 dispatcher 时 pi 的 SDK 走 Node 自带 fetch/连接策略，于是「pi CLI 能连、本仓不能连」。
//
// 实现与 pi 0.87.1 的同名模块保持同构（pi-web 也以拷贝方式复用该模块），差异仅：
// 不做一次性守卫（允许设置热更新后重新安装），注释指向本仓语境。

import { EventEmitter } from "node:events";
import * as undici from "undici";

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;

/** Node 默认 250ms 在高延迟/黑洞链路上会过早终止连接尝试（见文件头注释） */
const DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 2_000;

/** HTTP 空闲超时可选项（设置页/文档用；0 = 关闭超时） */
export const HTTP_IDLE_TIMEOUT_CHOICES = [
  { label: "30 sec", timeoutMs: 30_000 },
  { label: "1 min", timeoutMs: 60_000 },
  { label: "2 min", timeoutMs: 120_000 },
  { label: "5 min", timeoutMs: 300_000 },
  { label: "disabled", timeoutMs: 0 },
] as const;

const originalGlobalFetch = globalThis.fetch;
const ignoreUndiciDispatcherError = (): void => {};

/** 解析空闲超时配置：字符串（"disabled" / 数字串）/ 数字；非法 → undefined */
export function parseHttpIdleTimeoutMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === "disabled") return 0;
    if (trimmed.length === 0) return undefined;
    return parseHttpIdleTimeoutMs(Number(trimmed));
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

/** 空闲超时的人类可读标签（非法值 → "<n> sec" 形态） */
export function formatHttpIdleTimeoutMs(timeoutMs: number): string {
  return HTTP_IDLE_TIMEOUT_CHOICES.find((item) => item.timeoutMs === timeoutMs)?.label ?? `${timeoutMs / 1000} sec`;
}

/** 把 `httpProxy` 设置写入环境（仅在未设置时；供 EnvHttpProxyAgent 读取） */
export function applyHttpProxySettings(httpProxy: string | undefined): void {
  const proxy = httpProxy?.trim();
  if (!proxy) return;
  process.env.HTTP_PROXY ??= proxy;
  process.env.HTTPS_PROXY ??= proxy;
}

/** undici 在终止响应体时可能发出 Client 级 error：挂空监听防 EventEmitter 未处理错误打挂进程 */
function withUndiciErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
  }
  return dispatcher;
}

function createUndiciClient(origin: string | URL, options: object): undici.Dispatcher {
  return withUndiciErrorListener(new undici.Client(origin, options as undici.Client.Options));
}

function createUndiciOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
  const dispatcherOptions = options as undici.Pool.Options;
  if (dispatcherOptions.connections === 1) return createUndiciClient(origin, dispatcherOptions);
  return withUndiciErrorListener(
    new undici.Pool(origin, {
      ...dispatcherOptions,
      factory: createUndiciClient,
    }),
  );
}

/**
 * 安装全局 undici dispatcher（启动时调用一次；设置变更后可再次调用覆盖）。
 * @param timeoutMs 空闲超时（`bodyTimeout`/`headersTimeout`），缺省 5 分钟
 */
export function configureHttpDispatcher(timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS): void {
  const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === undefined) {
    throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
  }
  const dispatcher = withUndiciErrorListener(
    new undici.EnvHttpProxyAgent({
      allowH2: false,
      // HTTP origin 仍走 CONNECT 隧道（与 pi 行为一致）
      proxyTunnel: true,
      bodyTimeout: normalizedTimeoutMs,
      headersTimeout: normalizedTimeoutMs,
      connect: {
        autoSelectFamilyAttemptTimeout: DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS,
      },
      clientFactory: createUndiciClient,
      factory: createUndiciOriginDispatcher,
    }),
  );
  undici.setGlobalDispatcher(dispatcher);
  // fetch 与 dispatcher 用同一 undici 实现（否则 Node 自带 fetch 可能读到未解压响应）；
  // 若调用方在模块加载后主动替换过 fetch，则尊重该覆盖。
  if (globalThis.fetch === originalGlobalFetch) {
    undici.install?.();
  }
}
