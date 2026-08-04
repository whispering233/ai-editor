// API 客户端基础封装（T7.2）
// 契约来源：doc/api/endpoints.md「通用约定」——前缀 /api/v1、请求体 snake_case、响应体 camelCase、
//   成功 {success:true,data:T} / 失败 {success:false,error:{code,message}} 包裹、ErrorCode 枚举统一
// 响应类型沿用 @ai-editor/shared 的导出类型（z.infer 的结果，仅类型、编译期消失）；
// 本文件不 import zod 运行时（校验执行边界：zod 校验仅在服务端执行，避免 50KB 级依赖进浏览器包）
import type {
  ChatRole,
  ChatSessionSummary,
  ComputeStateResult,
  DeltaChange,
  DeltaRecord,
  EntitySummary,
  ErrorCode,
  OutlineTree,
  ProjectConfig,
  ProjectLanguage,
  ProjectListBook,
} from "@ai-editor/shared";
import type { EntityType } from "@ai-editor/shared";

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
 * E3 扩展：body 为 FormData（导入 multipart 上传）时不 JSON 序列化、不手动设 Content-Type——
 *   浏览器自动带 multipart boundary；其余 body（JSON）语义不变
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = "GET", body, query, headers, signal } = options;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers:
        body === undefined || body instanceof FormData
          ? headers
          : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
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

// ============ 大纲操作（S2.3；契约：endpoints.md「大纲操作」L514-656，严格三层决策 19） ============

/** 大纲节点类型（严格三层：volume → chapter → scene，决策 19） */
export type OutlineNodeType = "volume" | "chapter" | "scene";

/** POST /api/v1/outline 请求体（parent_id 必填：volume→root、chapter→volume/root、scene→chapter） */
export interface CreateOutlineBody {
  type: OutlineNodeType;
  title: string; // 1-200 字符
  parent_id: string;
  summary?: string;
}

/** POST /api/v1/outline 响应（201） */
export interface CreateOutlineRes {
  id: string;
  type: string;
  title: string;
  parentId: string | null;
  updatedAt: string;
}

/** 创建大纲节点（错误：400 VALIDATION_ERROR——parent_id 缺失/层级非法） */
export function createOutlineNode(body: CreateOutlineBody): Promise<CreateOutlineRes> {
  return apiFetch<CreateOutlineRes>("/outline", { method: "POST", body });
}

/** PUT /api/v1/outline/:nodeId 请求体（标题/摘要/结构化 data 可部分更新；data 浅合并——未传字段保留，决策 23） */
export interface UpdateOutlineBody {
  title?: string;
  summary?: string;
  /** 节点结构化信息（决策 23）：按节点层级的 OUTLINE_NODE_DATA_SCHEMAS 校验（服务端），失败 400 VALIDATION_ERROR */
  data?: Record<string, unknown>;
}

/** 更新大纲节点标题/摘要 */
export function updateOutlineNode(nodeId: string, patch: UpdateOutlineBody): Promise<{ updated: true }> {
  return apiFetch<{ updated: true }>(`/outline/${nodeId}`, { method: "PUT", body: patch });
}

/** PUT /api/v1/outline/:nodeId/move 请求体（order：兄弟位置 0-based；层级约束同创建） */
export interface MoveOutlineBody {
  parent_id: string;
  order: number;
}

/** PUT /api/v1/outline/:nodeId/move 响应 */
export interface MoveOutlineRes {
  moved: true;
  previousParentId: string;
  newParentId: string;
}

/** 移动大纲节点（画布投影自动更新，决策 1；错误：404 OUTLINE_NODE_NOT_FOUND / 400 VALIDATION_ERROR） */
export function moveOutlineNode(nodeId: string, body: MoveOutlineBody): Promise<MoveOutlineRes> {
  return apiFetch<MoveOutlineRes>(`/outline/${nodeId}/move`, { method: "PUT", body });
}

/** DELETE /api/v1/outline/:nodeId 响应（软删，决策 12；cascaded = 级联移除的子节点/关系/Delta 计数） */
export interface DeleteOutlineRes {
  deleted: true;
  cascaded: {
    children: number;
    relations: number;
    deltas: number;
  };
}

/** 软删大纲节点（标记 deleted，本体保留可还原；级联子节点/关系/Delta） */
export function deleteOutlineNode(nodeId: string): Promise<DeleteOutlineRes> {
  return apiFetch<DeleteOutlineRes>(`/outline/${nodeId}`, { method: "DELETE" });
}

/** GET /api/v1/outline/:nodeId/path 响应（从根到节点的 ID 链，如 ["root","vol-1","ch-3"]） */
export interface OutlinePathRes {
  nodeId: string;
  path: string[];
}

/** 获取节点路径（从根到指定节点；404 = 节点已 purge） */
export function getOutlinePath(nodeId: string): Promise<OutlinePathRes> {
  return apiFetch<OutlinePathRes>(`/outline/${nodeId}/path`);
}

// ============ 回收站（S2.3 大纲侧 + S4.4 实体侧补齐；契约：endpoints.md「回收站」L660-736） ============

/** GET /api/v1/trash 响应（实体侧条目；type 为四类实体之一） */
export interface TrashEntity {
  id: string;
  type: EntityType;
  name: string;
  deletedAt: string;
}

/** 软删大纲节点（回收站列表条目） */
export interface TrashOutlineNode {
  id: string;
  type: OutlineNodeType;
  title: string;
  deletedAt: string;
}

export interface TrashListRes {
  entities: TrashEntity[];
  nodes: TrashOutlineNode[];
}

/** 列出回收站软删对象 */
export function getTrashList(): Promise<TrashListRes> {
  return apiFetch<TrashListRes>("/trash");
}

/** POST /api/v1/trash/entity/:type/:id/restore 响应（级联还原关系/Delta，决策 12 修订） */
export interface RestoreTrashEntityRes {
  restored: true;
  restoredRelations: number;
  restoredDeltas: number;
}

/** 还原软删实体（错误：404 ENTITY_NOT_FOUND——目标已被 purge 的残留请求） */
export function restoreTrashEntity(type: EntityType, id: string): Promise<RestoreTrashEntityRes> {
  return apiFetch<RestoreTrashEntityRes>(`/trash/entity/${type}/${id}/restore`, { method: "POST" });
}

/** 彻底删除实体（仅回收站清理用；物理清除不可恢复；错误：404 ENTITY_NOT_FOUND / 400 VALIDATION_ERROR 未软删） */
export function purgeTrashEntity(type: EntityType, id: string): Promise<PurgeOutlineRes> {
  return apiFetch<PurgeOutlineRes>(`/trash/entity/${type}/${id}`, { method: "DELETE" });
}

/** POST /api/v1/trash/outline/:nodeId/restore 响应（级联还原子节点/关系/Delta，决策 12 修订） */
export interface RestoreOutlineRes {
  restored: true;
  restoredChildren: number;
  restoredRelations: number;
  restoredDeltas: number;
}

/** 还原软删大纲节点（错误：404 OUTLINE_NODE_NOT_FOUND / 409 OUTLINE_ANCESTOR_DELETED——需先还原祖先） */
export function restoreOutlineNode(nodeId: string): Promise<RestoreOutlineRes> {
  return apiFetch<RestoreOutlineRes>(`/trash/outline/${nodeId}/restore`, { method: "POST" });
}

/** DELETE /api/v1/trash/outline/:nodeId 响应（purge：递归物理清除整棵子树，不可恢复） */
export interface PurgeOutlineRes {
  purged: true;
}

/** 彻底删除大纲节点（仅回收站清理用；物理清除不可恢复） */
export function purgeOutlineNode(nodeId: string): Promise<PurgeOutlineRes> {
  return apiFetch<PurgeOutlineRes>(`/trash/outline/${nodeId}`, { method: "DELETE" });
}

// ============ 实体 CRUD（S3.5；契约：endpoints.md「实体 CRUD」L150-283，软删过滤决策 12） ============

/** GET /api/v1/entity/:type 查询参数（snake_case；q 模糊匹配 name，limit 默认 50 最大 200） */
export interface ListEntitiesQuery {
  q?: string;
  offset?: number;
  limit?: number;
  sort?: "name" | "created_at" | "updated_at";
  order?: "asc" | "desc";
}

/** GET /api/v1/entity/:type 响应（列表摘要，不含完整 data） */
export interface EntityListRes {
  items: EntitySummary[];
  total: number;
  offset: number;
  limit: number;
}

/** 列出实体（软删对象默认过滤——决策 12 修订，回收站是唯一访问入口） */
export function listEntities(type: EntityType, query: ListEntitiesQuery = {}): Promise<EntityListRes> {
  // ListEntitiesQuery（interface）无索引签名，赋给 ApiQuery（Record）需断言——字段均为 ApiQuery 值子集
  return apiFetch<EntityListRes>(`/entity/${type}`, { query: query as ApiQuery });
}

/** GET /api/v1/entity/:type/:id 响应（详情：完整 data + 紧邻 1 跳关系 + Delta 计数；404 ENTITY_NOT_FOUND） */
export interface EntityDetailRes {
  id: string;
  type: EntityType;
  name: string;
  data: Record<string, unknown>;
  /** 双向紧邻关系（形状同 RelationSummaryItem，见关系段定义——联表填充端点名称） */
  relations: RelationSummaryItem[];
  deltaCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 获取实体详情（S3.6 详情页同样使用） */
export function getEntityDetail(type: EntityType, id: string): Promise<EntityDetailRes> {
  return apiFetch<EntityDetailRes>(`/entity/${type}/${id}`);
}

/** POST /api/v1/entity/:type 请求体（name 必填 1-100；data 按 type 的字段 schema） */
export interface CreateEntityBody {
  name: string;
  data?: Record<string, unknown>;
}

/** POST /api/v1/entity/:type 响应（201；400 VALIDATION_ERROR） */
export interface CreateEntityRes {
  id: string;
  type: EntityType;
  name: string;
  data: Record<string, unknown>;
  createdAt: string;
}

/** 创建实体 */
export function createEntity(type: EntityType, body: CreateEntityBody): Promise<CreateEntityRes> {
  return apiFetch<CreateEntityRes>(`/entity/${type}`, { method: "POST", body });
}

/** PUT /api/v1/entity/:type/:id 请求体（partial update：仅合并传入的 data 字段） */
export interface UpdateEntityBody {
  name?: string;
  data?: Record<string, unknown>;
}

/** 更新实体（404 ENTITY_NOT_FOUND） */
export function updateEntity(
  type: EntityType,
  id: string,
  patch: UpdateEntityBody,
): Promise<{ id: string; updated: true }> {
  return apiFetch<{ id: string; updated: true }>(`/entity/${type}/${id}`, { method: "PUT", body: patch });
}

/** DELETE /api/v1/entity/:type/:id 响应（软删 + 级联计数，决策 12） */
export interface DeleteEntityRes {
  deleted: true;
  cascaded: {
    relations: number;
    deltas: number;
  };
}

/** 软删实体（标记 deleted_at，本体保留可还原；级联移除关系与 Delta） */
export function deleteEntity(type: EntityType, id: string): Promise<DeleteEntityRes> {
  return apiFetch<DeleteEntityRes>(`/entity/${type}/${id}`, { method: "DELETE" });
}

// ============ 关系（S3.6；契约：endpoints.md「关系」L300-391，物理删决策 12 修订） ============

/** GET /api/v1/relation 列表项（联表填充的端点名称；depth=1 紧邻展示用） */
export interface RelationSummaryItem {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceName?: string;
  targetType: string;
  targetId: string;
  targetName?: string;
  relationType: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/** GET /api/v1/relation 查询（depth 必填 1|2|3；其余可选过滤） */
export interface ListRelationsQuery {
  source_type?: string;
  source_id?: string;
  target_type?: string;
  target_id?: string;
  relation_type?: string;
  depth: 1 | 2 | 3;
}

/** GET /api/v1/relation 响应（MVP 用 depth=1：直接关系；paths 是 depth>=2 附加） */
export interface ListRelationsRes {
  relations: RelationSummaryItem[];
  paths?: Array<{ nodes: Array<{ type: string; id: string; name: string }>; edges: Array<{ from: string; to: string; relationType: string }> }>;
}

/** 查询关系（端点过滤可选；详情页用 source 或 target = 当前实体查 1 跳）。
 * 显式构造 query 字面量：ListRelationsQuery 接口无 index signature，直接透传不满足 ApiQuery（Record） */
export function listRelations(query: ListRelationsQuery): Promise<ListRelationsRes> {
  return apiFetch<ListRelationsRes>("/relation", {
    query: {
      source_type: query.source_type,
      source_id: query.source_id,
      target_type: query.target_type,
      target_id: query.target_id,
      relation_type: query.relation_type,
      depth: query.depth,
    },
  });
}

/** POST /api/v1/relation 请求体（snake_case；metadata 可选） */
export interface CreateRelationBody {
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relation_type: string;
  metadata?: Record<string, unknown>;
}

/** POST /api/v1/relation 响应（201；409 RELATION_EXISTS——已存在） */
export interface CreateRelationRes {
  id: string;
  relation: {
    sourceType: string;
    sourceId: string;
    targetType: string;
    targetId: string;
    relationType: string;
  };
}

/** 建立关系（409 RELATION_EXISTS → 提示「这条关系已经存在」） */
export function createRelation(body: CreateRelationBody): Promise<CreateRelationRes> {
  return apiFetch<CreateRelationRes>("/relation", { method: "POST", body });
}

/** DELETE /api/v1/relation/:id 响应（物理删除，不进入回收站；404 RELATION_NOT_FOUND） */
export function deleteRelation(id: string): Promise<{ deleted: true }> {
  return apiFetch<{ deleted: true }>(`/relation/${id}`, { method: "DELETE" });
}

// ============ Delta（S5.4；契约：endpoints.md「Delta 变更追踪」L395-510 + shared delta*Schema） ============

/** GET /api/v1/delta/node/:nodeId 响应（按节点查该节点触发的全部 Delta，endpoints.md L436-462） */
export interface DeltaByNodeRes {
  nodeId: string;
  deltas: DeltaRecord[];
}

/** 获取大纲节点触发的变更记录。
 * 契约（endpoints.md L436-462）未定义该端点 404：节点缺失/软删 → 200 空数组（server 三态过滤）；
 * 调用方无需处理 OUTLINE_NODE_NOT_FOUND（node-delta-list.tsx 错误分支仅为防御） */
export function getDeltasByNode(nodeId: string): Promise<DeltaByNodeRes> {
  return apiFetch<DeltaByNodeRes>(`/delta/node/${nodeId}`);
}

/** POST /api/v1/delta/compute 请求体（snake_case；决策 9/19：服务端自动计算根 → at_node 的树路径） */
export interface ComputeDeltaBody {
  target_type: string;
  target_id: string;
  at_node_id: string;
}

/**
 * 计算实体到达指定大纲节点时的累积状态（决策 9 修订：op=update from 不匹配 → 跳过 +
 * conflicts 标注，非 409；404 OUTLINE_NODE_NOT_FOUND——at_node 已 purge）
 */
export function computeDeltaState(body: ComputeDeltaBody): Promise<ComputeStateResult> {
  return apiFetch<ComputeStateResult>("/delta/compute", { method: "POST", body });
}

/** POST /api/v1/delta 请求体（snake_case；契约 deltaCreateReqSchema：changes min 1、无 order 入参——服务端生成；
 *  per-op 必填语义：set→to、update→from+to、add→value、remove→value，缺失 400 VALIDATION_ERROR） */
export interface CreateDeltaBody {
  node_id: string; // 触发变更的大纲节点 ID
  target_type: string;
  target_id: string;
  changes: DeltaChange[];
  description: string;
}

/** POST /api/v1/delta 响应（201；404 OUTLINE_NODE_NOT_FOUND——node_id 不存在/软删） */
export interface CreateDeltaRes {
  id: string;
  applied: DeltaRecord;
}

/** 追加属性变更记录（S12.3 变更记录创建入口用） */
export function createDelta(body: CreateDeltaBody): Promise<CreateDeltaRes> {
  return apiFetch<CreateDeltaRes>("/delta", { method: "POST", body });
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

// ============ 导出/导入（E3；契约：endpoints.md「项目管理」段末尾 + shared types/api.ts
//   PROJECT_EXPORT_FILE_NAMES 注释——zip 内三文件 project.json/outline.json/data.db） ============

/**
 * 解析 Content-Disposition 的文件名（RFC 5987，服务端格式
 * `attachment; filename="book.zip"; filename*=UTF-8''<书名>.zip`）：
 * - `filename*`（percent 编码，中文书名）优先，decodeURIComponent 解码
 * - 回退 ASCII `filename="..."`；解码失败（非法 percent 序列）/无 header → "project.zip"
 * 纯函数（可单测）；endpoints.md：文件名缺失回退 "project.zip"
 */
export function parseContentDispositionFilename(header: string | null): string {
  if (header !== null) {
    const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
    if (star) {
      try {
        return decodeURIComponent(star[1]);
      } catch {
        // 非法 percent 序列 → 继续回退 ASCII filename
      }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
    if (plain) return plain[1];
  }
  return "project.zip";
}

/** GET /api/v1/project/export 响应（二进制 zip 例外：不走 apiFetch 的 JSON 解析） */
export interface ExportProjectZipRes {
  blob: Blob;
  /** 下载文件名（Content-Disposition 解析；缺失回退 "project.zip"） */
  filename: string;
}

/**
 * 导出当前项目为 zip 备份包（E1 服务端 / E3 前端；endpoints.md「GET /project/export」）。
 * **不走 apiFetch**——成功响应是 application/zip **二进制**（通用约定「成功 {success,data}
 * JSON 包裹」的显式例外），错误响应仍是 JSON 包裹（409 NO_PROJECT_OPEN / 500 INTERNAL_ERROR）。
 * 响应分流（ora-1 守卫收紧）：
 * - **白名单式判定二进制**：仅 2xx 且 Content-Type 含 zip/octet-stream 才当 zip 返回
 *   （服务端恒发 application/zip，octet-stream 为中间层改写兼容；守卫零误伤）——
 *   其余 2xx（如中间层 200 text/html）抛 CLIENT_NETWORK_ERROR，不把 HTML 当 zip 下载
 * - JSON（或非 2xx）：复用统一错误包裹解析抛 ApiError（错误码透传）
 */
export async function exportProjectZip(): Promise<ExportProjectZipRes> {
  let res: Response;
  try {
    res = await fetch(buildUrl("/project/export"));
  } catch (err) {
    throw new ApiError(CLIENT_NETWORK_ERROR, err instanceof Error ? err.message : "网络请求失败");
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (res.ok && (contentType.includes("zip") || contentType.includes("octet-stream"))) {
    const blob = await res.blob();
    return { blob, filename: parseContentDispositionFilename(res.headers.get("content-disposition")) };
  }
  if (contentType.includes("application/json")) {
    const json: unknown = await res.json().catch(() => null);
    if (isErrorEnvelope(json)) throw new ApiError(json.error.code, json.error.message);
  }
  // 非预期响应（2xx 非 zip / 非 JSON 错误响应）：不当作 zip 下载
  throw new ApiError(CLIENT_NETWORK_ERROR, `非预期响应（HTTP ${res.status}）`);
}

/** POST /api/v1/project/import 响应（契约同 shared projectImportResSchema；id 沿用 zip 内 project.json 的 id） */
export interface ImportProjectRes {
  imported: true;
  id: string;
  path: string;
  name: string;
}

/**
 * 导入备份 zip 为新书（E2 服务端 / E3 前端；endpoints.md「POST /project/import」）。
 * multipart/form-data：`file` = zip 二进制 + `name` = 新书目录名（禁路径分隔符，服务端校验；
 *   目标目录由服务端决定 创作根/books/<name>/，客户端不可指定路径防越权）。
 * 走 apiFetch（E3 扩展：body 为 FormData 时保持原样 + 浏览器自动带 boundary）；
 * 错误码：400 VALIDATION_ERROR（坏包/缺文件/书名非法/超限）、409 SCHEMA_VERSION_MISMATCH
 * （版本不兼容，文案区分更高/旧版本程序）、409 PROJECT_ALREADY_EXISTS（同名书已存在）——
 * ApiError.code 透传；成功不自动打开（与 create 一致），前端刷新书架
 */
export async function importProjectZip(file: File, name: string): Promise<ImportProjectRes> {
  const form = new FormData();
  form.append("file", file, "backup.zip");
  form.append("name", name);
  return apiFetch<ImportProjectRes>("/project/import", { method: "POST", body: form });
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

// ============ 会话（U3；契约：endpoints.md「chat/sessions」L795-834，决策 18 按项目隔离） ============

/** GET /api/v1/chat/sessions 响应（契约：{sessions: ChatSessionSummary[]}，按最后活动倒序、仅当前项目） */
export interface ChatSessionListRes {
  sessions: ChatSessionSummary[];
}

/** 列出当前项目会话（无项目打开时 409 NO_PROJECT_OPEN） */
export function listSessions(): Promise<ChatSessionSummary[]> {
  return apiFetch<ChatSessionListRes>("/chat/sessions").then((res) => res.sessions);
}

/**
 * GET /api/v1/chat/sessions/:id/messages 消息条目（契约：chatMessagesResSchema.messages 元素，
 * endpoints.md L813-834——响应不含 sessionId；shared 未导出该元素类型，本地组合，参照 ProjectList 先例）
 */
export interface ChatSessionMessage {
  id: string;
  role: ChatRole;
  content?: string | null;
  /** assistant 消息的工具调用数组 */
  toolCalls?: unknown[];
  /** tool 消息关联的 assistant 工具调用 id（决策 18 修订） */
  toolCallId?: string | null;
  createdAt: string;
}

/** GET /api/v1/chat/sessions/:id/messages 响应（U5 恢复聊天记录用） */
export interface ChatSessionMessagesRes {
  sessionId: string;
  messages: ChatSessionMessage[];
}

/** 获取会话消息历史（按 created_at 升序；仅当前项目会话） */
export function getSessionMessages(sessionId: string): Promise<ChatSessionMessagesRes> {
  return apiFetch<ChatSessionMessagesRes>(`/chat/sessions/${sessionId}/messages`);
}

// ============ 发送消息（U5；契约：chatSendReqSchema，endpoints.md「POST /api/v1/chat」L742-793） ============

/**
 * POST /api/v1/chat 请求体（snake_case；message 必填，session_id 不传则创建新会话）。
 * 注意：实际发送由 use-sse 的 fetchSSE 承担（chat store 内联调用 fetchSSE("/api/v1/chat", …)，
 * 返回 SSE 事件流，不走 apiFetch 的 JSON 包裹）——本文件只保留请求体契约（事实来源），
 * 不再提供发送函数；请求体契约已与 S7.6 实现对齐（endpoints.md L742-793），以本契约为准
 */
export interface SendChatMessageBody {
  message: string;
  session_id?: string;
  /** focus 上下文（layout.md §4.2：跨页「问 AI」注入；仅 focus 小条存在时携带） */
  context?: {
    focus_entity_type?: string;
    focus_entity_id?: string;
    focus_node_id?: string;
  };
}

// ============ 提案确认/拒绝（S8.2；契约：endpoints.md「提案确认」L848-888 + shared proposalConfirmResSchema/proposalRejectResSchema） ============

/** POST /api/v1/proposal/:proposalId/confirm 响应（字段契约同 shared proposalConfirmResSchema） */
export interface ConfirmProposalRes {
  confirmed: true;
  /** 执行结果（如新创建的 entity id） */
  result: unknown;
}

/**
 * 确认提案（一次性消费，决策 14：确认动作即终态，服务端处理完立即移除）。
 * 错误码语义（endpoints.md L864-874，ApiError.code 透传）：
 * - 409 PROPOSAL_STALE——确认时快照重校验失败（引用实体/节点已变化或删除）→ 前端提示重新生成提案
 * - 404 PROPOSAL_NOT_FOUND——proposal_id 不存在（已过期清除 / SSE 断开作废）
 * - 409 PROPOSAL_PROJECT_MISMATCH——提案所属项目 ≠ 当前项目（防御性，切换项目时提案已清空）
 */
export function confirmProposal(proposalId: string): Promise<ConfirmProposalRes> {
  return apiFetch<ConfirmProposalRes>(`/proposal/${proposalId}/confirm`, { method: "POST" });
}

/** POST /api/v1/proposal/:proposalId/reject 响应（字段契约同 shared proposalRejectResSchema） */
export interface RejectProposalRes {
  rejected: true;
}

/** 拒绝提案（错误码语义同 confirm；拒绝同样是不可逆消费动作，跨项目拒绝不消费他项目提案） */
export function rejectProposal(proposalId: string): Promise<RejectProposalRes> {
  return apiFetch<RejectProposalRes>(`/proposal/${proposalId}/reject`, { method: "POST" });
}
