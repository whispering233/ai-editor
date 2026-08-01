// 统一错误处理（T6.1）
//
// 契约来源：doc/api/endpoints.md「通用约定」——
//   成功响应 { success: true, data: T }；错误响应 { success: false, error: { code, message } }。
// ErrorCode 单一来源为 @ai-editor/shared（types/api.ts）；本文件补充三个服务端侧错误码
// （不在 shared 枚举内，与 client 的 CLIENT_NETWORK_ERROR 同类做法）：
//   INTERNAL_ERROR（未处理异常 500）、FORBIDDEN（来源校验拒绝 403）、NOT_FOUND（未知端点 404）
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorHandler } from "hono";
import type { ErrorCode } from "@ai-editor/shared";

/** 服务端补充错误码（不在 shared ErrorCode 枚举内） */
export const SERVER_ERROR_CODES = ["INTERNAL_ERROR", "FORBIDDEN", "NOT_FOUND"] as const;
export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

export type ApiErrorCode = ErrorCode | ServerErrorCode;

/** 成功响应包裹（endpoints.md） */
export function ok<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}

/** 错误响应包裹（endpoints.md） */
export function fail(
  code: ApiErrorCode,
  message: string,
): { success: false; error: { code: ApiErrorCode; message: string } } {
  return { success: false, error: { code, message } };
}

/**
 * 业务错误：路由内 throw new HttpError(status, code, message)，
 * 由 errorHandler 统一转成错误响应包裹（切片 1 起使用；本卡先定义）
 */
export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ApiErrorCode;
  constructor(status: ContentfulStatusCode, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/**
 * 统一错误处理（Hono 4 onError 处理器，**必须注册为 app.onError 而非 app.use**）：
 * 捕获未处理异常 → 500 包裹；HttpError → 按 status/code 透传。
 * 说明：Hono 4 的 compose 在 dispatch 内部捕获路由错误并直接调用 onError，
 *   错误不会沿 next() 链传播——middleware 内的 try/catch 捕获不到下游错误
 *   （实测 hono@4.12 compose.js），因此本处理器以 ErrorHandler 形式导出。
 */
export function errorHandler(): ErrorHandler {
  return (err, c) => {
    if (err instanceof HttpError) {
      return c.json(fail(err.code, err.message), err.status);
    }
    console.error("[server] 未处理异常:", err);
    return c.json(fail("INTERNAL_ERROR", err instanceof Error ? err.message : "服务器内部错误"), 500);
  };
}
