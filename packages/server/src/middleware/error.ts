// 统一错误处理（T6.1 + S1.2）
//
// 契约来源：doc/api/endpoints.md「通用约定」——
//   成功响应 { success: true, data: T }；错误响应 { success: false, error: { code, message } }。
// ErrorCode 单一来源为 @ai-editor/shared（types/api.ts）；本文件补充服务端侧错误码
// （不在 shared 枚举内，与 client 的 CLIENT_NETWORK_ERROR 同类做法）：
//   INTERNAL_ERROR（未处理异常 500）、FORBIDDEN（来源校验拒绝 403）、NOT_FOUND（未知端点 404）、
//   NO_PROJECT_OPEN（S1.2：无当前项目时业务操作 409）、PROJECT_ALREADY_EXISTS（S1.2：create 目录已是项目 409）
// 记录：错误码分散（shared 枚举 + 服务端补充 + client 补充）为已知技术债，MVP 不收敛
import { ZodError } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorHandler } from "hono";
import type { ErrorCode } from "@ai-editor/shared";

/** 服务端补充错误码（不在 shared ErrorCode 枚举内） */
export const SERVER_ERROR_CODES = [
  "INTERNAL_ERROR",
  "FORBIDDEN",
  "NOT_FOUND",
  "NO_PROJECT_OPEN",
  "PROJECT_ALREADY_EXISTS",
  "LLM_API_KEY_MISSING", // S7.6：POST /chat 未配置 DeepSeek key（决策 17）——400
] as const;
export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

export type ApiErrorCode = ErrorCode | ServerErrorCode;

/** 成功响应包裹（endpoints.md） */
export function ok<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}

/** 错误响应包裹（endpoints.md）；fields 仅 VALIDATION_ERROR 附带（校验失败字段路径） */
export function fail(
  code: ApiErrorCode,
  message: string,
  fields?: string[],
): { success: false; error: { code: ApiErrorCode; message: string; fields?: string[] } } {
  return { success: false, error: { code, message, ...(fields ? { fields } : {}) } };
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
 * HttpError → 按 status/code 透传；ZodError（路由内 schema.parse 抛出）→ 400 VALIDATION_ERROR（含 fields）；
 * 未处理异常 → 500 包裹。
 * 说明：Hono 4 的 compose 在 dispatch 内部捕获路由错误并直接调用 onError，
 *   错误不会沿 next() 链传播——middleware 内的 try/catch 捕获不到下游错误
 *   （实测 hono@4.12 compose.js），因此本处理器以 ErrorHandler 形式导出。
 */
export function errorHandler(): ErrorHandler {
  return (err, c) => {
    if (err instanceof HttpError) {
      return c.json(fail(err.code, err.message), err.status);
    }
    if (err instanceof ZodError) {
      // 路由层 schema 校验失败（S1.3 settings PUT 等）→ 400 VALIDATION_ERROR，fields 为出错字段路径
      const fields = err.issues.map((issue) => issue.path.join("."));
      return c.json(
        fail("VALIDATION_ERROR", err.issues[0]?.message ?? "参数校验失败", fields),
        400,
      );
    }
    console.error("[server] 未处理异常:", err);
    return c.json(fail("INTERNAL_ERROR", err instanceof Error ? err.message : "服务器内部错误"), 500);
  };
}
