// API 客户端基础封装（T7.2）
// 契约来源：doc/api/endpoints.md「通用约定」——前缀 /api/v1、请求体 snake_case、响应体 camelCase、
//   成功 {success:true,data:T} / 失败 {success:false,error:{code,message}} 包裹、ErrorCode 枚举统一
// 响应类型沿用 @ai-editor/shared 的导出类型（z.infer 的结果，仅类型、编译期消失）；
// 本文件不 import zod 运行时（校验执行边界：zod 校验仅在服务端执行，避免 50KB 级依赖进浏览器包）
import type { ErrorCode, OutlineTree, ProjectConfig, ProjectLanguage, ProjectListBook } from "@ai-editor/shared";

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

// ============ 书架（S1.5；契约：GET /api/v1/project/list，服务端扫描 books/ 子目录） ============

/** GET /api/v1/project/list 响应（books 元素类型复用 shared ProjectListBook——契约单一来源；
 * shared 未导出响应根类型命名，本地组合 ProjectList，字段契约同 projectListResSchema） */
export interface ProjectList {
  /** 创作根（启动目录）绝对路径 */
  rootPath: string;
  books: ProjectListBook[];
}

/** 列出书架书籍（扫描 创作根/books/ 下含 project.json 的子目录） */
export function listProjects(): Promise<ProjectList> {
  return apiFetch<ProjectList>("/project/list");
}

// ============ 项目开/建/关（S1.4；契约：endpoints.md「项目管理」+ S1.2 server 路由） ============

/** POST /api/v1/project/create 请求体（snake_case；config 可选） */
export interface CreateProjectBody {
  path: string;
  config?: {
    name?: string;
    language?: ProjectLanguage;
    prompt?: string;
  };
}

/** POST /api/v1/project/create 响应（endpoints.md L36-41） */
export interface CreateProjectRes {
  id: string;
  path: string;
  created: true;
}

/** 创建项目（错误：400 INVALID_PROJECT_PATH / 409 PROJECT_ALREADY_EXISTS） */
export function createProject(path: string, config?: CreateProjectBody["config"]): Promise<CreateProjectRes> {
  return apiFetch<CreateProjectRes>("/project/create", {
    method: "POST",
    body: { path, ...(config !== undefined ? { config } : {}) },
  });
}

/** POST /api/v1/project/open 响应（S1.2：openResSchema 核心字段 + rebuilt/fromVersion 附加字段） */
export interface OpenProjectRes {
  id: string;
  name: string;
  language: ProjectLanguage;
  config: ProjectConfig;
  /** schema 版本不匹配时删库重建提示（决策 13 修订，endpoints.md「向客户端提示已重建」） */
  rebuilt?: boolean;
  /** 重建前的 schema 版本号（决策 13：备份文件命名 v{n}） */
  fromVersion?: number;
}

/** 打开项目（错误：400 INVALID_PROJECT_PATH——目录不存在/不含 project.json/链接跳转） */
export function openProject(path: string): Promise<OpenProjectRes> {
  return apiFetch<OpenProjectRes>("/project/open", { method: "POST", body: { path } });
}

/** POST /api/v1/project/close 响应（无当前项目时幂等 saved:true） */
export interface CloseProjectRes {
  saved: true;
}

/** 关闭当前项目（释放数据库连接，data-flow.md 第 46 行） */
export function closeProject(): Promise<CloseProjectRes> {
  return apiFetch<CloseProjectRes>("/project/close", { method: "POST" });
}

// ============ 设置（S1.4；契约：endpoints.md「系统设置」+ S1.3 server 路由） ============

/** GET /api/v1/settings/llm 响应（决策 17：key 不回传明文，仅掩码） */
export interface SettingsLlmConfig {
  model: string;
  apiKeySet: boolean;
  apiKeyMasked?: string;
}

/** 读取 LLM 配置（默认模型 deepseek-v4-flash；key 状态与掩码） */
export function getSettingsLlm(): Promise<SettingsLlmConfig> {
  return apiFetch<SettingsLlmConfig>("/settings/llm");
}

/** PUT /api/v1/settings/llm 请求体（api_key 空字符串 = 清除已保存 key） */
export interface UpdateSettingsLlmBody {
  model?: string;
  api_key?: string;
}

/** PUT /api/v1/settings/llm 响应 */
export interface UpdateSettingsLlmRes {
  saved: true;
}

/** 更新 LLM 配置（写入 ~/.ai-editor/config.json，绝不入项目文件，决策 17） */
export function updateSettingsLlm(patch: UpdateSettingsLlmBody): Promise<UpdateSettingsLlmRes> {
  return apiFetch<UpdateSettingsLlmRes>("/settings/llm", { method: "PUT", body: patch });
}
