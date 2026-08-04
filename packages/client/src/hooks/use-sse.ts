// 自写 SSE 客户端（T7.2 核心；chat 端点 POST + SSE，浏览器原生 EventSource 只支持 GET，决策 20）
// 契约来源：doc/api/endpoints.md 第 738-769 行（事件流格式 + 客户端解析约束）：
//   - 跨 chunk 的 data: 行拼接、多行 data: 合并、注释行（: 开头）跳过、空行分帧、[DONE] 哨兵
//   - error 事件后流立即关闭（客户端收到即终止解析）
//   - 60s 无任何事件 → 判定连接断开（决策 20 半开连接兜底），回调 onTimeout 并中止 fetch
// 帧解析抽为纯函数（parseSSEFrames / parseSSEFrame）便于单测
import type { ErrorCode } from "@whispering233/ai-editor-shared";
import { CLIENT_NETWORK_ERROR } from "../lib/api";

/** 已解析的 SSE 消息 */
export interface SSEMessage {
  event: string;
  data: string;
}

export const SSE_DONE = "[DONE]";

/** 默认超时：60s 无任何事件即判定断开（决策 20 客户端兜底） */
export const DEFAULT_SSE_TIMEOUT_MS = 60_000;

export interface SSEOptions {
  /** 事件分发：event 名 + data（JSON 解析成功为对象/数组，解析失败按原文字符串透传） */
  onEvent: (event: string, data: unknown) => void;
  /** 无任何事件的超时阈值（默认 60s，决策 20） */
  timeoutMs?: number;
  /** 超时回调（随后自动中止 fetch） */
  onTimeout?: () => void;
  /** 流正常结束（服务端关闭 / [DONE] / error 事件终止）；手动 abort 与超时不触发 */
  onEnd?: () => void;
  /** 外部取消信号（与返回的 abort 函数等效） */
  signal?: AbortSignal;
  /** 请求体（chat 端点 POST 必需：message / session_id / context） */
  body?: unknown;
}

/**
 * 按空行（\n\n）切分帧（纯函数，可单测）
 * 输入为累积文本（已归一化 \r\n → \n），返回完整帧数组与剩余不完整文本
 */
export function parseSSEFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    frames.push(rest.slice(0, idx));
    rest = rest.slice(idx + 2);
  }
  return { frames, rest };
}

/**
 * 解析单个帧为 {event, data}（纯函数，可单测）
 * SSE 规范：注释行（: 开头）跳过、无字段行忽略；event: 行取事件名；
 *   data: 行合并（多行以 \n 拼接，仅剥离一个前导空格）；无 data 的帧返回 null
 */
export function parseSSEFrame(frame: string): SSEMessage | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line === "" || line.startsWith(":")) continue; // 注释行跳过
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      let value = line.slice("data:".length);
      if (value.startsWith(" ")) value = value.slice(1); // 仅剥离一个前导空格
      dataLines.push(value);
    }
    // id: / retry: 字段本客户端不需要，忽略
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

function isErrorPayload(v: unknown): v is { error: { code: ErrorCode; message: string } } {
  if (typeof v !== "object" || v === null) return false;
  const e = (v as { error?: unknown }).error;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { code?: unknown }).code === "string" &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

/**
 * 发起 SSE 请求（fetch + ReadableStream 逐块读取，跨 chunk 拼接后按帧分发）
 * @returns abort 函数（手动取消流：不触发 onTimeout / onEnd）
 */
export function fetchSSE(url: string, options: SSEOptions): () => void {
  const { onEvent, timeoutMs = DEFAULT_SSE_TIMEOUT_MS, onTimeout, onEnd, signal, body } = options;

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort);
  }

  let buffer = "";
  let done = false; // 任何终止路径置位（哨兵 / error / EOF / 超时 / 手动 abort）
  let timedOut = false;
  let manualAbort = false;
  let failed = false; // 请求级失败（非 2xx / 无响应体）：不触发 onEnd
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const armTimer = () => {
    clearTimer();
    timer = setTimeout(() => {
      if (done) return;
      timedOut = true;
      done = true;
      onTimeout?.();
      controller.abort(); // 超时视为连接断开，中止 fetch
    }, timeoutMs);
  };

  /** 分发一帧；返回 false 表示应终止解析（[DONE] 哨兵 / error 事件） */
  const dispatch = (msg: SSEMessage): boolean => {
    if (msg.data === SSE_DONE) return false; // 哨兵终止
    let payload: unknown = msg.data;
    try {
      payload = JSON.parse(msg.data) as unknown;
    } catch {
      // data 非 JSON：按原文字符串透传（如 text 事件异常负载）
    }
    onEvent(msg.event, payload);
    return msg.event !== "error"; // error 事件后流立即关闭（endpoints.md）
  };

  armTimer();

  void (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        // 非 2xx：尝试解析 REST 错误包裹并透传为 error 事件后结束（不视为正常结束）
        const json: unknown = await res.json().catch(() => null);
        const code = isErrorPayload(json) ? json.error.code : CLIENT_NETWORK_ERROR;
        const message = isErrorPayload(json) ? json.error.message : `SSE 请求失败（HTTP ${res.status}）`;
        done = true;
        failed = true;
        onEvent("error", { code, message });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        // 追加解码 + 归一化 CRLF（\r 可能跨 chunk 分片，整 buffer 归一化最稳）
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
        const { frames, rest } = parseSSEFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          const msg = parseSSEFrame(frame);
          if (!msg) continue;
          if (!dispatch(msg)) {
            done = true; // [DONE] / error：终止解析
            break;
          }
          armTimer(); // 有事件即重置超时（决策 20：60s 无任何事件才判定断开）
        }
      }

      // EOF 时 flush 残余 buffer（服务端可能不写结尾空行）
      if (!done && buffer.trim() !== "") {
        const msg = parseSSEFrame(buffer.trim());
        if (msg && !dispatch(msg)) done = true;
      }
    } catch {
      // 区分终止原因（S8.1 oracle S1 补丁）：
      // - timedOut / manualAbort（AbortError 已由超时/手动取消置位）→ 静默：
      //   超时走 onTimeout、手动取消由 abort 调用方感知（既有语义）
      // - 其他错误（fetch 网络层失败——服务未起/断网/DNS，或读流中途连接重置）→ 补发
      //   error 事件 + failed 置位：避免「气泡无回复无提示」静默失败；onEnd 不被误触发
      if (!timedOut && !manualAbort) {
        done = true;
        failed = true;
        onEvent("error", { code: CLIENT_NETWORK_ERROR, message: "网络请求失败" });
      }
    } finally {
      clearTimer();
      if (signal) signal.removeEventListener("abort", onExternalAbort);
      done = true;
      if (!timedOut && !manualAbort && !failed) onEnd?.();
    }
  })();

  /** 取消流（用户手动停止生成） */
  return () => {
    if (done) return;
    manualAbort = true;
    done = true;
    clearTimer();
    controller.abort();
  };
}
