// API 客户端基础封装（T7.2）
// 契约来源：doc/api/endpoints.md「通用约定」——前缀 /api/v1、请求体 snake_case、响应体 camelCase、
//   成功 {success:true,data:T} / 失败 {success:false,error:{code,message}} 包裹、ErrorCode 枚举统一
// 响应类型沿用 @ai-editor/shared 的导出类型（z.infer 的结果，仅类型、编译期消失）；
// 本文件不 import zod 运行时（校验执行边界：zod 校验仅在服务端执行，避免 50KB 级依赖进浏览器包）
import type { ErrorCode, OutlineTree, ProjectConfig, ProjectLanguage } from "@ai-editor/shared";

const API_BASE = "/api/v1";

/** 客户端侧错误码补充（不在服务端 ErrorCode 枚举内）：网络层 / 响应解析失败 */
export const CLIENT_NETWORK_ERROR = "CLIENT_NETWORK_ERROR" as const;
export type ClientErrorCode = typeof CLIENT_NETWORK_ERROR;

/** API 错误：服务端 {success:false,error} 包裹或客户端网络层失败 */
export class ApiError extends Error {
  readonly code: ErrorCode | ClientErrorCode;
  constructor(code: ErrorCode | ClientErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

/** 查询参数（snake_case，endpoints.md 命名约定）；undefined / null 自动跳过 */
export type ApiQuery = Record<string, string | number | boolean | undefined | null>;

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** 请求体：自动 JSON 序列化（请求契约字段 snake_case） */
  body?: unknown;
  query?: ApiQuery;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

function buildQueryString(query: ApiQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

function buildUrl(path: string, query?: ApiQuery): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${p}${buildQueryString(query ?? {})}`;
}

function isSuccessEnvelope(v: unknown): v is { success: true; data: unknown } {
  return typeof v === "object" && v !== null && (v as { success?: unknown }).success === true;
}

function isErrorEnvelope(
  v: unknown,
): v is { success: false; error: { code: ErrorCode; message: string } } {
  if (typeof v !== "object" || v === null) return false;
  const e = (v as { error?: unknown }).error;
  return (
    (v as { success?: unknown }).success === false &&
    typeof e === "object" &&
    e !== null &&
    typeof (e as { code?: unknown }).code === "string" &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

/**
 * 通用 fetch 封装：拼 /api/v1 前缀、JSON 序列化、解析统一响应包裹（endpoints.md）
 * 成功返回 data；失败抛 ApiError（code 为服务端 ErrorCode；网络层/解析失败为 CLIENT_NETWORK_ERROR）
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = "GET", body, query, headers, signal } = options;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // 网络层失败（断网 / 代理不可达 / 被 abort）
    throw new ApiError(CLIENT_NETWORK_ERROR, err instanceof Error ? err.message : "网络请求失败");
  }

  const json: unknown = await res.json().catch(() => null);
  if (isSuccessEnvelope(json)) return json.data as T;
  if (isErrorEnvelope(json)) throw new ApiError(json.error.code, json.error.message);
  throw new ApiError(CLIENT_NETWORK_ERROR, `非预期响应（HTTP ${res.status}）`);
}

// ============ 端点函数（本卡 3 个示例验证封装；完整端点按各切片卡需求补充） ============

/** GET /api/v1/project/config（契约：shared types/api.ts projectConfigResSchema） */
export function getProjectConfig(): Promise<ProjectConfig> {
  return apiFetch<ProjectConfig>("/project/config");
}

/** PUT /api/v1/project/config 请求体（契约：projectConfigUpdateReqSchema，snake_case） */
export interface UpdateProjectConfigBody {
  name?: string;
  language?: ProjectLanguage;
  prompt?: string;
  current_position?: string | null; // 须指向存在的非软删大纲节点（服务端校验）
}

export interface UpdateProjectConfigRes {
  updated: true;
}

/** PUT /api/v1/project/config */
export function updateProjectConfig(patch: UpdateProjectConfigBody): Promise<UpdateProjectConfigRes> {
  return apiFetch<UpdateProjectConfigRes>("/project/config", { method: "PUT", body: patch });
}

/** GET /api/v1/outline（契约：shared types/api.ts outlineTreeSchema） */
export function getOutline(): Promise<OutlineTree> {
  return apiFetch<OutlineTree>("/outline");
}
