// API 契约 Zod schema（@whispering233/ai-editor-shared/types/api.ts，单一事实来源）
// 契约来源：doc/api/endpoints.md（全部端点 Req/Res 与错误码）、doc/api/tools.md（决策 15 agent 终止语义）、
//   doc/database/schema.md（entity data 字段）、doc/database/hooks.md（hook data 字段）
// 命名约定（endpoints.md）：请求体/查询参数 snake_case，响应体 camelCase；
//   嵌套 data 对象内部字段原样透传（snake_case，如 expected_payoff）。
// **校验执行边界（2026-08 修订）**：schema 定义于此，但**校验仅在服务端执行**——
//   client 只消费推断出的类型与常量，不打包校验函数（避免 50KB 级依赖进浏览器包）。
// zod 版本：^4（注意 v4 API：z.record 必须两参、z.enum 接受 readonly 数组）

import { z } from "zod";
import { ENTITY_TYPES, RELATION_TYPES } from "../constants/entity.js";
import { HOOK_STATUSES, PAYOFF_TIMING } from "../constants/hook.js";
import { CONFLICT_LEVELS } from "../constants/outline.js";
import type { ComputeStateResult, DeltaRecord, EntitySummary, ProjectConfig, RelationRecord } from "./index.js";

// ============ 基础 schema ============

/** 实体类型（schema.md entities 表 CHECK 约束；与 ENTITY_TYPES 常量对齐） */
export const entityTypeSchema = z.enum(ENTITY_TYPES);

/** 项目语言（schema.md project.json 契约） */
export const projectLanguageSchema = z.enum(["zh", "en"]);

// ============ ErrorCode（单一来源：REST / SSE / 工具共用，endpoints.md「错误码」） ============

/**
 * 错误码全量枚举
 * 文档出处：endpoints.md 各端点错误响应；DELTA_CONFLICT 为 2026-08 修订废弃码
 * （computeState 改为 skipped/conflicts 字段呈现，不再返回 409——保留枚举兼容历史引用）；
 * 末尾四个为 tools.md 决策 15/16 补充命名（文档未给具体码名，按语义命名，供 SSE error 事件使用）
 */
export const ERROR_CODES = [
  // ---- endpoints.md 提取（现行）----
  "VALIDATION_ERROR", // 400 参数校验失败（entity/delta/outline 创建等）
  "ENTITY_NOT_FOUND", // 404 实体不存在（详情/更新/删除/restore）
  "RELATION_EXISTS", // 409 关系已存在
  "RELATION_NOT_FOUND", // 404 关系不存在
  "OUTLINE_NODE_NOT_FOUND", // 404 大纲节点不存在（compute / path / restore / purge）
  "OUTLINE_ANCESTOR_DELETED", // 409 restore 时存在软删祖先（决策 12 修订）
  "INVALID_PROJECT_PATH", // 400 create/open 路径校验失败（决策 17）
  "PROPOSAL_STALE", // 409 确认时引用快照不一致（决策 14）
  "PROPOSAL_NOT_FOUND", // 404 proposal_id 不存在（决策 14）
  "PROPOSAL_PROJECT_MISMATCH", // 409 提案所属项目 ≠ 当前项目（决策 14 修订）
  "SCHEMA_VERSION_MISMATCH", // 409 导入 zip 的 data.db user_version 与当前程序版本不匹配（E2；拒绝导入，不静默重建，release-review §二）
  "PROJECT_VERSION_NEWER", // 409 open 时项目 data.db user_version 高于当前程序版本（E4；拒绝打开并提示升级程序，堵降级数据丢失，release-review §一）
  // ---- 废弃（保留兼容）----
  "DELTA_CONFLICT", // 已废弃（2026-08 修订：computeState 以 conflicts 字段替代 409）
  // ---- tools.md 决策 15/16 补充命名（SSE error 事件用）----
  "TOOL_RESULT_TOO_LARGE", // 工具结果 token 预算超限：截断/拒绝该工具结果（决策 15）
  "AGENT_DISPATCH_ERROR", // 工具调度器缺陷（S7.3 防御：结果条数不符 / id 错位 / 调度器抛错），终止循环（决策 15）
  "AGENT_INTERNAL_ERROR", // agent 循环内部未知异常（S7.3 防御路径——chatStream 契约不 throw，理论不可达）
  "AGENT_MAX_ITERATIONS", // agent 循环超 8 轮上限，发 error 事件终止（决策 15）
  "AGENT_TIMEOUT", // 单轮 120s 超时终止（决策 15）
  "AGENT_TOKEN_BUDGET", // 上下文 token 预算超限终止（决策 15）
] as const;

/** ErrorCode 枚举 schema */
export const errorCodeSchema = z.enum(ERROR_CODES);

/** 错误码类型（REST 响应 / SSE error 事件 / 工具结果共用） */
export type ErrorCode = z.infer<typeof errorCodeSchema>;

// ============ 通用响应包裹（endpoints.md「通用约定」） ============

/** 成功响应包裹：{ success: true, data: T } */
export function apiSuccessSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
  });
}

/** 错误响应包裹：{ success: false, error: { code, message, fields? } } */
export const apiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    fields: z.array(z.string()).optional(), // 校验失败时指出具体字段（VALIDATION_ERROR）
  }),
});

/** 错误响应类型 */
export type ApiError = z.infer<typeof apiErrorSchema>;

// ============ 实体 data 字段 schema（endpoints.md 创建接口 + schema.md + hooks.md） ============

/**
 * character 专属字段（schema.md：role/gender/age/personality[]/motivation/abilities[]/status/custom_fields）
 * 注意：data 嵌套对象内部字段原样透传（snake_case，如 custom_fields），顶层契约字段才是 camelCase
 */
export const characterDataSchema = z
  .object({
    role: z.string().optional(),
    gender: z.string().optional(),
    age: z.union([z.string(), z.number()]).optional(), // 年龄文本或数字皆可（schema.md 未定死类型）
    personality: z.array(z.string()).optional(),
    motivation: z.string().optional(),
    abilities: z.array(z.string()).optional(),
    status: z.string().optional(),
    custom_fields: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough(); // 允许未知字段（创作工具，用户自定义字段自由）

/** setting 专属字段（schema.md：category/parent_id/description/rules[]/custom_fields） */
export const settingDataSchema = z
  .object({
    category: z.string().optional(),
    parent_id: z.string().optional(),
    description: z.string().optional(),
    rules: z.array(z.string()).optional(),
    custom_fields: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** location 专属字段（schema.md：type/parent_id/description/custom_fields） */
export const locationDataSchema = z
  .object({
    type: z.string().optional(),
    parent_id: z.string().optional(),
    description: z.string().optional(),
    custom_fields: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** hook 专属字段（hooks.md 第 30-56 行：status/category/expected_payoff/payoff_timing/half_life/is_core/notes/expected_resolve_node_id） */
export const hookDataSchema = z
  .object({
    status: z.enum(HOOK_STATUSES).optional(),
    category: z.string().optional(), // 自由填（HOOK_CATEGORIES 仅为前端建议值）
    expected_payoff: z.string().optional(),
    payoff_timing: z.enum(PAYOFF_TIMING).optional(),
    half_life: z.number().int().positive().optional(), // 章数；缺省映射见决策 21
    is_core: z.boolean().optional(),
    notes: z.string().optional(),
    expected_resolve_node_id: z.string().nullable().optional(), // 决策 21 ready_to_resolve 依据
  })
  .passthrough();

/** event 专属字段（决策 26 时间轴事件：description/time_label/tags[]；字段名 snake_case） */
export const eventDataSchema = z
  .object({
    description: z.string().optional(),
    time_label: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough(); // 允许未知字段（创作工具，用户自定义字段自由）

/**
 * 各类型 data schema 注册表（服务端按实体 type 选用精确 schema 校验）
 * 创建/更新请求中的 data 本体使用宽松 record（entityCreateReqSchema），
 * 精确校验在服务端 route 层按 type 调用对应 schema
 */
export const ENTITY_DATA_SCHEMAS = {
  character: characterDataSchema,
  setting: settingDataSchema,
  location: locationDataSchema,
  hook: hookDataSchema,
  event: eventDataSchema,
} as const;

// ============ project 端点（endpoints.md「项目管理」） ============

/** ProjectConfig 响应（GET /api/v1/project/config；与 types/project.ts 的 ProjectConfig 对齐） */
export const projectConfigSchema: z.ZodType<ProjectConfig> = z.object({
  id: z.string(),
  name: z.string(),
  language: projectLanguageSchema,
  prompt: z.string(), // 项目级提示词（决策 7）
  schemaVersion: z.number().int(), // 决策 13
  currentPosition: z.string().nullable(), // 「当前位置」节点 id；null = 未设置（决策 21）
  createdAt: z.string(),
  updatedAt: z.string(),
});

// POST /api/v1/project/create
export const projectCreateReqSchema = z
  .object({
    path: z.string(), // 项目目录绝对路径（决策 17 校验）
    config: z
      .object({
        name: z.string().optional(),
        language: projectLanguageSchema.optional(),
        prompt: z.string().optional(),
      })
      .optional(),
  })
  .strict();

export const projectCreateResSchema = z.object({
  id: z.string(),
  path: z.string(),
  created: z.literal(true),
});

// POST /api/v1/project/open
export const projectOpenReqSchema = z
  .object({
    path: z.string(), // 必须包含 project.json
  })
  .strict();

export const projectOpenResSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: projectLanguageSchema,
  config: projectConfigSchema,
});

// POST /api/v1/project/close
export const projectCloseResSchema = z.object({
  saved: z.literal(true),
});

// GET /api/v1/project/list（书架模式 S1.5：列出创作根 books/ 下的书，供 Dashboard 书架展示）
export const projectListResSchema = z.object({
  /** 创作根（server 启动参数 projectRoot） */
  rootPath: z.string(),
  /** books/ 下含 project.json 的书，按 updatedAt 倒序（最近更新在前） */
  books: z.array(
    z.object({
      /** 目录名（书名） */
      name: z.string(),
      /** 书目录绝对路径（books/<name>） */
      path: z.string(),
      /** project.json 的 updated_at（ISO 8601，应用层写入） */
      updatedAt: z.string(),
    }),
  ),
});
export type ProjectListBook = z.infer<typeof projectListResSchema>["books"][number];

// GET /api/v1/project/config
export const projectConfigResSchema = projectConfigSchema;

// PUT /api/v1/project/config
export const projectConfigUpdateReqSchema = z
  .object({
    name: z.string().optional(),
    language: projectLanguageSchema.optional(),
    prompt: z.string().optional(),
    current_position: z.string().nullable().optional(), // 须指向存在的非软删大纲节点（服务端校验）
  })
  .strict();

export const projectConfigUpdateResSchema = z.object({
  updated: z.literal(true),
});

// ============ 导出/导入端点（E1/E2：release-review §二，产品承诺「数据主权归用户」） ============

/**
 * 导出 zip 内固定三文件名（E1：GET /api/v1/project/export 的 zip 条目名与数据文件
 * 原名一致——import 侧按此固定名校验，缺失即坏包）
 */
export const PROJECT_EXPORT_FILE_NAMES = ["project.json", "outline.json", "data.db"] as const;

/**
 * GET /api/v1/project/export（E1 实现，E2 依赖）：
 * - **响应为二进制 zip（application/zip），非 JSON 包裹**——endpoints.md「成功响应
 *   {success,data}」通用约定的显式例外；Content-Disposition: attachment;
 *   filename*=UTF-8''<书名>.zip（RFC 5987）
 * - zip 内三文件：project.json + outline.json + data.db（导出前 wal_checkpoint(TRUNCATE)
 *   保证 data.db 主文件完整快照；决策 17 key 存用户级配置，天然不入包）
 * - 错误：无当前项目 → 409 NO_PROJECT_OPEN（服务端补充码，与 /config 一致）；
 *   三文件缺失任一 → 500 INTERNAL_ERROR（打开的项目三文件必然齐全，缺失即损坏）
 * - 二进制响应不走 Zod parse——契约以本注释 + PROJECT_EXPORT_FILE_NAMES 常量表达
 */

// POST /api/v1/project/import（E2 实现；E1 已落契约）
// - 请求：multipart/form-data 文件上传——field "file"（zip 备份包）+ field "name"（书名，
//   必填；禁路径分隔符/纯点/控制字符，与 client 新建项目同规则）——目标目录为
//   服务端决定的 创作根/books/<name>/（客户端不可指定路径，防越权）
// - 服务端流程（E2）：解压到临时目录 → 校验（条目白名单 = PROJECT_EXPORT_FILE_NAMES
//   三文件名 + project.json/outline.json 顶层契约 + data.db user_version 匹配）→
//   原子搬入新书目录（新建，不覆盖现有项目）→ 返回 200
// - 错误码：坏包/缺文件/未知条目/契约不符 → 400 VALIDATION_ERROR；data.db user_version
//   与当前程序版本不匹配 → 409 SCHEMA_VERSION_MISMATCH（拒绝导入，不静默重建）；
//   目标书名已存在 → 409 PROJECT_ALREADY_EXISTS（服务端补充码，与 create 同语义）
export const projectImportResSchema = z.object({
  imported: z.literal(true),
  id: z.string(), // 导入项目的 project_id（沿用 zip 内 project.json 的 id，数据原样恢复）
  path: z.string(), // 新书目录绝对路径（创作根/books/<name>/）
  name: z.string(), // 书名（即新书目录名 books/<name>/；project.json 内部 name 保持原样）
});

// ============ entity 端点（endpoints.md「实体 CRUD」） ============

/**
 * 关系（GET /api/v1/relation depth=1 项；与 types/entity.ts RelationRecord 对齐）
 * 定义于此处供 entity 详情响应（relations: RelationSummary[]，形状同 RelationRecord，
 * endpoints.md L187 未单独列字段）与 relation 查询共用，避免同结构两处定义漂移
 */
export const relationRecordSchema: z.ZodType<RelationRecord> = z.object({
  id: z.string(),
  sourceType: z.string(),
  sourceId: z.string(),
  sourceName: z.string().optional(), // 联表填充
  targetType: z.string(),
  targetId: z.string(),
  targetName: z.string().optional(),
  relationType: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
});

/** EntitySummary（GET /api/v1/entity/:type 列表项；与 types/entity.ts 对齐） */
export const entitySummarySchema: z.ZodType<EntitySummary> = z.object({
  id: z.string(),
  type: entityTypeSchema,
  name: z.string(),
  summary: z.record(z.string(), z.unknown()), // 从 data 提取的关键摘要字段
  createdAt: z.string(),
  updatedAt: z.string(),
});

// GET /api/v1/entity/:type（Query：snake_case）
export const entityListQuerySchema = z.object({
  q: z.string().optional(), // 模糊匹配 name
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["name", "created_at", "updated_at"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export const entityListResSchema = z.object({
  items: z.array(entitySummarySchema),
  total: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
});

// GET /api/v1/entity/:type/:id（详情：含紧邻 1 跳关系与 Delta 计数）
export const entityDetailResSchema = z.object({
  id: z.string(),
  type: entityTypeSchema,
  name: z.string(),
  data: z.record(z.string(), z.unknown()), // 完整字段（嵌套 snake_case 原样透传）
  relations: z.array(relationRecordSchema), // RelationSummary（形状同 RelationRecord，endpoints.md L187）
  deltaCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// POST /api/v1/entity/:type（Req：name 必填 1-100；data 宽松 record，按 type 的精确 schema 见 ENTITY_DATA_SCHEMAS）
export const entityCreateReqSchema = z
  .object({
    name: z.string().min(1).max(100),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const entityCreateResSchema = z.object({
  id: z.string(),
  type: entityTypeSchema,
  name: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

// PUT /api/v1/entity/:type/:id（partial update：仅合并传入的 data 字段）
export const entityUpdateReqSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const entityUpdateResSchema = z.object({
  id: z.string(),
  updated: z.literal(true),
});

// DELETE /api/v1/entity/:type/:id（软删 + 级联计数，决策 12）
export const entityDeleteResSchema = z.object({
  deleted: z.literal(true),
  cascaded: z.object({
    relations: z.number().int(),
    deltas: z.number().int(),
  }),
});

// ============ relation 端点（endpoints.md「关系管理」） ============

// relationRecordSchema 定义于 entity 区（entity 详情 relations 与 relation 查询共用，避免重复定义）

/** 路径结构（depth>=2，endpoints.md） */
export const relationPathSchema = z.object({
  nodes: z.array(z.object({ type: z.string(), id: z.string(), name: z.string() })),
  edges: z.array(z.object({ from: z.string(), to: z.string(), relationType: z.string() })),
});

// GET /api/v1/relation（Query：depth 必填 1|2|3）
export const relationQuerySchema = z.object({
  source_type: z.string().optional(),
  source_id: z.string().optional(),
  target_type: z.string().optional(),
  target_id: z.string().optional(),
  relation_type: z.string().optional(),
  depth: z.coerce.number().int().min(1).max(3), // 1=紧邻, 2=k跳, 3=全量遍历
});

export const relationQueryResSchema = z.object({
  relations: z.array(relationRecordSchema),
  paths: z.array(relationPathSchema).optional(), // depth>=2 时返回
});

// POST /api/v1/relation（relation_type 限定 schema.md 预定义 16 种）
export const relationCreateReqSchema = z
  .object({
    source_type: z.string(),
    source_id: z.string(),
    target_type: z.string(),
    target_id: z.string(),
    relation_type: z.enum(RELATION_TYPES),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const relationCreateResSchema = z.object({
  id: z.string(),
  relation: z.object({
    sourceType: z.string(),
    sourceId: z.string(),
    targetType: z.string(),
    targetId: z.string(),
    relationType: z.string(),
  }),
});

// DELETE /api/v1/relation/:id（物理删除，不进回收站，决策 12 修订）
export const relationDeleteResSchema = z.object({
  deleted: z.literal(true),
});

// ============ delta 端点（endpoints.md「Delta 变更追踪」） ============

/** 变更操作类型（2026-08 修订语义：set/update/add/remove，见 endpoints.md） */
export const deltaOpSchema = z.enum(["set", "update", "add", "remove"]);

/** 单条属性变更 */
export const deltaChangeSchema = z.object({
  field: z.string(),
  op: deltaOpSchema,
  from: z.union([z.string(), z.number()]).nullable().optional(), // op=update 时服务端要求必填
  to: z.union([z.string(), z.number()]).nullable().optional(), // op=set/update 时服务端要求必填；add/remove 用 value
  value: z.union([z.string(), z.number()]).optional(), // op=add/remove 时使用
});

/** DeltaRecord（响应；与 types/entity.ts 对齐） */
export const deltaRecordSchema: z.ZodType<DeltaRecord> = z.object({
  id: z.string(),
  nodeId: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  targetName: z.string().optional(), // 联表填充
  changes: z.array(deltaChangeSchema),
  description: z.string(),
  order: z.number().int(), // 服务端生成，全局单调递增
  createdAt: z.string(),
});

// POST /api/v1/delta（Req：无 order 入参——服务端生成）
export const deltaCreateReqSchema = z
  .object({
    node_id: z.string(),
    target_type: z.string(),
    target_id: z.string(),
    changes: z.array(deltaChangeSchema).min(1),
    description: z.string(),
  })
  .strict();

export const deltaCreateResSchema = z.object({
  id: z.string(),
  applied: deltaRecordSchema,
});

// GET /api/v1/delta/node/:nodeId
export const deltaByNodeResSchema = z.object({
  nodeId: z.string(),
  deltas: z.array(deltaRecordSchema),
});

// POST /api/v1/delta/compute（决策 9/19：只沿大纲树父链累积）
export const deltaComputeReqSchema = z
  .object({
    target_type: z.string(),
    target_id: z.string(),
    at_node_id: z.string(), // 服务端自动计算根 → at_node 的树路径
  })
  .strict();

export const deltaComputeResSchema: z.ZodType<ComputeStateResult> = z.object({
  targetType: z.string(),
  targetId: z.string(),
  atNodeId: z.string(),
  state: z.record(z.string(), z.unknown()), // 初始 data + 路径上所有 Delta 累积
  appliedDeltas: z.array(
    z.object({
      nodeId: z.string(),
      description: z.string(),
      changes: z.array(z.unknown()),
      skipped: z
        .array(
          z.object({
            index: z.number().int(), // 在 changes 数组中的下标
            field: z.string(),
            expected: z.unknown(),
            actual: z.unknown(),
          }),
        )
        .optional(), // 决策 9 修订：op=update 且当前值 ≠ from 时跳过该 change
    }),
  ),
  conflicts: z.array(
    z.object({
      deltaId: z.string(),
      field: z.string(),
      expected: z.unknown(),
      actual: z.unknown(),
    }),
  ),
});

// ============ outline 端点（endpoints.md「大纲操作」，严格三层决策 19） ============

/**
 * 大纲节点 data 字段 schema（决策 23，麦基《故事》字段集，schema.md outline.json「节点结构化信息」节）：
 * scene——goal/conflict_levels/value_from/value_to；chapter——reversal/climax_scene；
 * volume——climax_scene/inciting_scene。
 * 宽松语义与 ENTITY_DATA_SCHEMAS 一致：
 * - `.passthrough()` 允许未知字段（创作工具，用户自定义字段自由，未知字段原样保留透传）
 * - 引用字段（climax_scene/inciting_scene）仅类型校验（字符串），不校验存在性/范围（决策 23：MVP 宽松）
 * 请求体 data 本体使用宽松 record（outlineCreateReqSchema），精确校验在服务端 route 层按层级选用
 */
export const sceneDataSchema = z
  .object({
    goal: z.string().max(1000).optional(), // 场景目标/欲望（麦基 Scene）
    conflict_levels: z.array(z.enum(CONFLICT_LEVELS)).optional(), // 冲突三层次多选
    value_from: z.string().max(200).optional(), // 开场价值
    value_to: z.string().max(200).optional(), // 收场价值（「No scene that doesn't turn」）
  })
  .passthrough();

export const chapterDataSchema = z
  .object({
    reversal: z.string().max(1000).optional(), // 章末反转（单文本）
    climax_scene: z.string().optional(), // 章高潮场景引用（宽松：仅字符串，MVP 不校验引用范围）
  })
  .passthrough();

export const volumeDataSchema = z
  .object({
    climax_scene: z.string().optional(), // 幕高潮场景引用（宽松）
    inciting_scene: z.string().optional(), // 激励事件落位（宽松）
  })
  .passthrough();

/**
 * 各层级 data schema 注册表（服务端按节点 type 选用精确 schema 校验，
 * 与 ENTITY_DATA_SCHEMAS 同构；type 三选一 scene/chapter/volume，root 无 data）
 */
export const OUTLINE_NODE_DATA_SCHEMAS = {
  scene: sceneDataSchema,
  chapter: chapterDataSchema,
  volume: volumeDataSchema,
} as const;

/** 大纲节点（递归 schema；type 三选一 + children 可选，比 T1.1 的判别联合宽松——
 * 严格三层（卷→章→场景、scene 无 children）的类型约束由 types/outline.ts 承担，服务端负责层级校验，
 * 故此处不做 z.ZodType<OutlineNode> 标注（宽松 infer 无法赋给判别联合））
 */
export const outlineNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.enum(["volume", "chapter", "scene"]),
    title: z.string(),
    summary: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(), // 节点结构化信息（决策 23；内部字段原样透传）
    updatedAt: z.string(), // 节点版本戳（决策 19）
    deleted: z.boolean().optional(), // 软删标记（决策 12，管理视图）
    deletedAt: z.string().optional(),
    children: z.array(outlineNodeSchema).optional(),
    metadata: z
      .object({
        hookCount: z.number().int().optional(),
        charCount: z.number().int().optional(),
        deltaCount: z.number().int().optional(),
      })
      .optional(), // 仅 with_metadata=true 时返回
  }),
);

/** 完整大纲树（GET /api/v1/outline） */
export const outlineTreeSchema = z.object({
  id: z.literal("root"),
  type: z.literal("root"),
  schemaVersion: z.number().int(), // outline.json 顶层 schema_version（决策 13）
  children: z.array(outlineNodeSchema),
});

// GET /api/v1/outline（Query）
export const outlineGetQuerySchema = z.object({
  // 显式字符串布尔：z.coerce.boolean() 会把 "false" 解析为 true（反向问题），
  // 改为枚举 + transform：显式传 false → false；不传 → undefined（默认关闭 metadata 统计）
  with_metadata: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(), // 跨 outline.json × data.db 联查统计
});

// POST /api/v1/outline（parent_id 必填，无默认值，决策 19）
export const outlineCreateReqSchema = z
  .object({
    type: z.enum(["volume", "chapter", "scene"]),
    title: z.string().min(1).max(200),
    parent_id: z.string(), // volume→root；chapter→volume 或 root；scene→必须 chapter
    summary: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(), // 节点结构化信息（决策 23，宽松 record，按层级 schema 精校验）
  })
  .strict();

export const outlineCreateResSchema = z.object({
  id: z.string(),
  type: z.enum(["volume", "chapter", "scene"]),
  title: z.string(),
  parentId: z.string().nullable(),
  updatedAt: z.string(),
});

// PUT /api/v1/outline/:nodeId
export const outlineUpdateReqSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    summary: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(), // 部分合并（决策 23；按层级 schema 精校验）
  })
  .strict();

export const outlineUpdateResSchema = z.object({
  updated: z.literal(true),
});

// PUT /api/v1/outline/:nodeId/move（拖拽重排，严格三层约束同创建）
export const outlineMoveReqSchema = z
  .object({
    parent_id: z.string(),
    order: z.number().int().min(0), // 兄弟节点中的位置（0-based）
  })
  .strict();

export const outlineMoveResSchema = z.object({
  moved: z.literal(true),
  previousParentId: z.string(),
  newParentId: z.string(),
});

// PUT /api/v1/entity/event/:id/move（时间轴事件重排，决策 26；命名风格同 outlineMoveReqSchema）
export const entityMoveReqSchema = z
  .object({
    // 0-based 全局事件线性序（endpoints.md）：超过当前事件总数 → clamp 到末尾（不返回 4xx）；
    // 负数由本 schema 拒绝（400 VALIDATION_ERROR）——db 层 moveEvent 对负数 clamp 至 0
    // 仅为内部防御语义（HTTP 路径不可达）
    order: z.number().int().min(0),
  })
  .strict();

export const entityMoveResSchema = z.object({
  moved: z.literal(true),
});

// DELETE /api/v1/outline/:nodeId（软删 + 递归级联，决策 12）
export const outlineDeleteResSchema = z.object({
  deleted: z.literal(true),
  cascaded: z.object({
    children: z.number().int(), // 递归软删的子节点数
    relations: z.number().int(),
    deltas: z.number().int(),
  }),
});

// GET /api/v1/outline/:nodeId/path
export const outlinePathResSchema = z.object({
  nodeId: z.string(),
  path: z.array(z.string()), // 如 ["root", "vol-1", "ch-3", "sc-15"]
});

// ============ trash 端点（endpoints.md「回收站」，决策 12） ============

// GET /api/v1/trash（deletedAt 为 camelCase——响应体约定）
export const trashListResSchema = z.object({
  entities: z.array(
    z.object({ id: z.string(), type: z.string(), name: z.string(), deletedAt: z.string() }),
  ),
  nodes: z.array(
    z.object({ id: z.string(), type: z.string(), title: z.string(), deletedAt: z.string() }),
  ),
});

// POST /api/v1/trash/entity/:type/:id/restore（级联还原，决策 12 修订）
export const trashRestoreEntityResSchema = z.object({
  restored: z.literal(true),
  restoredRelations: z.number().int(),
  restoredDeltas: z.number().int(),
});

// POST /api/v1/trash/outline/:nodeId/restore（祖先链校验：软删祖先返回 409 OUTLINE_ANCESTOR_DELETED）
export const trashRestoreNodeResSchema = z.object({
  restored: z.literal(true),
  restoredChildren: z.number().int(),
  restoredRelations: z.number().int(),
  restoredDeltas: z.number().int(),
});

// DELETE /api/v1/trash/entity/:type/:id 与 /trash/outline/:nodeId（物理清除）
export const trashPurgeResSchema = z.object({
  purged: z.literal(true),
});

// ============ chat 端点（endpoints.md「AI 对话」，决策 18 持久化） ============

// POST /api/v1/chat（POST + SSE；消息落 chat_messages 表）
export const chatSendReqSchema = z
  .object({
    message: z.string(),
    session_id: z.string().optional(), // 不传则创建新会话
    context: z
      .object({
        focus_entity_type: entityTypeSchema.optional(),
        focus_entity_id: z.string().optional(),
        focus_node_id: z.string().optional(),
      })
      .optional(),
  })
  .strict();

// GET /api/v1/chat/sessions（按最后活动时间倒序，仅当前项目会话）
export const chatSessionSummarySchema = z.object({
  id: z.string(),
  lastMessage: z.string(), // 截断摘要
  messageCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(), // 最后活动时间
});

export const chatSessionsResSchema = z.object({
  sessions: z.array(chatSessionSummarySchema),
});

// GET /api/v1/chat/sessions/:id/messages（按 created_at 升序；tool 消息经 toolCallId 关联 assistant.tool_calls[].id）
export const chatMessagesResSchema = z.object({
  sessionId: z.string(),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["user", "assistant", "tool"]),
      content: z.string().nullable().optional(),
      toolCalls: z.array(z.unknown()).optional(), // assistant 消息的工具调用数组
      toolCallId: z.string().nullable().optional(), // tool 消息关联的调用 id（决策 18 修订）
      createdAt: z.string(),
    }),
  ),
});

// ============ proposal 端点（endpoints.md「提案确认」，决策 14） ============

// POST /api/v1/proposal/:proposalId/confirm（409 PROPOSAL_STALE / 404 PROPOSAL_NOT_FOUND / 409 PROPOSAL_PROJECT_MISMATCH）
export const proposalConfirmResSchema = z.object({
  confirmed: z.literal(true),
  result: z.unknown(), // 执行结果（如新创建的 entity id）
});

// POST /api/v1/proposal/:proposalId/reject
export const proposalRejectResSchema = z.object({
  rejected: z.literal(true),
});

// ============ settings 端点（endpoints.md「系统设置」，决策 17） ============

// GET /api/v1/settings/llm（key 不回传明文）
export const settingsLlmGetResSchema = z.object({
  model: z.string(), // 默认 "deepseek-v4-flash"
  apiKeySet: z.boolean(),
  apiKeyMasked: z.string().optional(), // 掩码展示（utils/format.ts maskApiKey）
});

// PUT /api/v1/settings/llm（写入 ~/.ai-editor/config.json，绝不入项目文件，决策 17）
export const settingsLlmPutReqSchema = z
  .object({
    model: z.string().optional(),
    api_key: z.string().optional(), // 空字符串 = 清除已保存 key
  })
  .strict();

export const settingsLlmPutResSchema = z.object({
  saved: z.literal(true),
});

// ============ SSE 事件（endpoints.md chat 端点事件流，第 738-765 行） ============

/** 心跳 ping（每 15-30s，决策 20）：空 payload */
export const ssePingEventSchema = z.object({});

/** tool_call：AI 调用了工具 */
export const sseToolCallEventSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  id: z.string(), // call_ 前缀（决策 18 成对重组依据）
});

/** tool_result：工具执行结果 */
export const sseToolResultEventSchema = z.object({
  tool: z.string(),
  result: z.unknown(),
  id: z.string(), // 与 tool_call 的 id 成对
});

/** text：AI 文本回复片段 */
export const sseTextEventSchema = z.object({
  delta: z.string(),
});

/** proposal：AI 发出提案（完整预览仅经此事件推送 GUI，tool_result 不含预览，2026-08 修订） */
export const sseProposalEventSchema = z.object({
  proposal_id: z.string(), // prop_ 前缀（决策 14）
  type: z.string(), // 提案对应工具名（如 "propose_create_entity"）
  preview: z.unknown(),
});

/** done：对话轮次结束 */
export const sseDoneEventSchema = z.object({
  session_id: z.string(), // sess_ 前缀
});

/** error：流终止（客户端收到即停止解析） */
export const sseErrorEventSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
});
