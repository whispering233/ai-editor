// API Zod schema（@whispering233/ai-editor-shared/types/api.ts，单一事实来源）
// 命名约定：请求体/查询参数 snake_case，响应体 camelCase；
// 嵌套 data 对象内部字段原样透传（snake_case，如 expected_payoff）。
// **校验执行边界（2026-08 修订）**：schema 定义于此，但**校验仅在服务端执行**——
// client 只消费推断出的类型与常量，不打包校验函数（避免 50KB 级依赖进浏览器包）。
// zod 版本：^4（注意 v4 API：z.record 必须两参、z.enum 接受 readonly 数组）

import { z } from "zod";
import { DEFAULT_ENTITY_LIST_LIMIT, ENTITY_TYPES, MAX_ENTITY_LIST_LIMIT } from "../constants/entity.js";
import { normalizeRelationType, relationTypeSyntaxError } from "../utils/relation-type.js";
import { HOOK_STATUSES, PAYOFF_TIMING } from "../constants/hook.js";
import { CONFLICT_LEVELS } from "../constants/outline.js";
import { BACKUP_FREQUENCIES } from "../constants/backup.js";
import { PROJECT_ORIGINS } from "../constants/project.js";
import type { ComputeStateResult, DeltaRecord, EntitySummary, ProjectAgents, ProjectConfig, RelationRecord } from "./index.js";

// ============ 基础 schema ============

/** 实体类型（entities 表 CHECK 约束；与 ENTITY_TYPES 常量对齐） */
export const entityTypeSchema = z.enum(ENTITY_TYPES);

/** 项目语言（project.json） */
export const projectLanguageSchema = z.enum(["zh", "en"]);

// ============ ErrorCode（单一来源：REST / SSE / 工具共用，「错误码」） ============

/**
 * 错误码全量枚举
 * 文档出处：各端点错误响应；DELTA_CONFLICT 为 2026-08 修订废弃码
 * （computeState 改为 skipped/conflicts 字段呈现，不再返回 409——保留枚举兼容历史引用）；
 * 末尾四个为 命名（文档未给具体码名，按语义命名，供 SSE error 事件使用）
 */
export const ERROR_CODES = [
 // ---- 提取（现行）----
  "VALIDATION_ERROR", // 400 参数校验失败（entity/delta/outline 创建等）
  "ENTITY_NOT_FOUND", // 404 实体不存在（详情/更新/删除/restore）
  "RELATION_EXISTS", // 409 关系已存在
  "EVENT_ALREADY_MOUNTED", // 409 事件已挂载时间点，occurs_at 1:n 重复挂载拒绝（G2）
  "RELATION_NOT_FOUND", // 404 关系不存在
  "OUTLINE_NODE_NOT_FOUND", // 404 大纲节点不存在（compute / path / restore / purge）
  "OUTLINE_ANCESTOR_DELETED", // 409 restore 时存在软删祖先
  "INVALID_PROJECT_PATH", // 400 create/open 路径校验失败
  "PROPOSAL_STALE", // 409 确认时引用快照不一致
  "PROPOSAL_NOT_FOUND", // 404 proposal_id 不存在
  "PROPOSAL_PROJECT_MISMATCH", // 409 提案所属项目 ≠ 当前项目
  "SCHEMA_VERSION_MISMATCH", // 409 导入 zip 的 data.db user_version 与当前程序版本不匹配（拒绝导入，不静默重建）
  "PROJECT_VERSION_NEWER", // 409 open 时项目 data.db user_version 高于当前程序版本（拒绝打开并提示升级程序，堵降级数据丢失）
  "BACKUP_TARGET_EXISTS", // 409 重命名备份目标文件名已存在（B2.6：renameSync 目标存在会静默覆盖——显式拒绝防数据丢失）
  "SESSION_NOT_FOUND", // 404 会话不存在（消息/思维链/删除端点：id 经磁盘发现未命中）
  "SESSION_BUSY", // 409 删除会话时该会话有在途 SSE 流（拒删）
  "SESSION_READONLY", // 409 向拆解会话（`decompose-` 前缀）发消息：拆解会话只读，不可续聊（docs/api/80-api-chat.md）
  "CHAT_BUSY", // 409 当前项目已有在途 chat 流（单项目单流约束，docs/api/80-api-chat.md）
  "THINKING_NOT_FOUND", // 404 思维链全文端点：blockIndex 越界或该块非 thinking
  "DOCUMENT_STALE", // 409 保存章正文时版本戳不一致（另一标签页/窗口已写入；参考资料正文无版本戳、不在本码覆盖范围）；**仅当请求携带 base_updated_at 时校验**，省略 = 覆盖保存（拒绝隐式丢失他人写入）
 // ---- 废弃（保留兼容）----
  "DELTA_CONFLICT", // 已废弃（2026-08 修订：computeState 以 conflicts 字段替代 409）
 // ---- 命名（调试日志用）----
  "TOOL_RESULT_TOO_LARGE", // 单条工具结果超 token 上限：截断 + 结构化提示（不终止对话；同时写 usage 类别调试日志）
] as const;

/** ErrorCode 枚举 schema */
export const errorCodeSchema = z.enum(ERROR_CODES);

/** 错误码类型（REST 响应 / SSE error 事件 / 工具结果共用） */
export type ErrorCode = z.infer<typeof errorCodeSchema>;

// ============ 通用响应包裹（「通用约定」） ============

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

// ============ 实体 data 字段 schema（创建接口 + +） ============

/**
 * character 专属字段（**不可变**：role/description；**可变**：alias/gender/age/race/motivation/personality[]/ability_panel；
 * custom_fields）——分层与不变式见 `docs/db/schema.md`「人物 data 分层」。
 * 注意：data 嵌套对象内部字段原样透传（snake_case，如 custom_fields），顶层字段才是 camelCase
 *
 * **2026-09 修订**：`status` 彻底移除（旧残留由 `.passthrough()` 容错，不再解析/展示）；
 * `abilities[]` → `ability_panel`（007 迁移）；`description` 为必填（**仅前端校验**——服务端不硬校验，
 * 保护 AI 提案/旧数据/备份导入三条路径）。
 * `ability_panel` 为**宽校验**声明（`z.unknown()`，不约束结构）：面板是用户自定义字段树，
 * 结构防御在读取端（shared `parseAbilityPanel`）——服务端绝不因面板结构问题拒绝写入。
 */
export const characterDataSchema = z
  .object({
    role: z.string().optional(),
    description: z.string().optional(),
    alias: z.string().optional(), // 假名/化名（单值：当前位置时这个人的化名）
    gender: z.string().optional(),
    age: z.union([z.string(), z.number()]).optional(), // 年龄文本或数字皆可（未定死类型）
    race: z.string().optional(),
    personality: z.array(z.string()).optional(),
    motivation: z.string().optional(),
    ability_panel: z.unknown().optional(), // 能力面板树（宽校验；解析见 shared parseAbilityPanel）
    custom_fields: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough(); // 允许未知字段（创作工具，用户自定义字段自由）

/** setting 专属字段（description/tags/rules/custom_fields；
 * `tags` = 分类标签（K2，2026-08：分类统一字段，前后端同名）；
 * `rules` = 规则条款（恢复原始语义，仅设定详情页编辑）；
 * `parent_id`（层级 belongs_to）与 `category`（废弃）不参与新字段，旧残留 passthrough 容错） */
export const settingDataSchema = z
  .object({
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    rules: z.array(z.string()).optional(),
    custom_fields: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** location 专属字段（type/parent_id/description/custom_fields） */
export const locationDataSchema = z
  .object({
    type: z.string().optional(),
    parent_id: z.string().optional(),
    description: z.string().optional(),
    custom_fields: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** hook 专属字段（status/category/expected_payoff/payoff_timing/half_life/is_core/notes/expected_resolve_node_id） */
export const hookDataSchema = z
  .object({
    status: z.enum(HOOK_STATUSES).optional(),
    category: z.string().optional(), // 自由填（HOOK_CATEGORIES 仅为前端建议值）
    expected_payoff: z.string().optional(),
    payoff_timing: z.enum(PAYOFF_TIMING).optional(),
    half_life: z.number().int().positive().optional(), // 章数；缺省映射见
    is_core: z.boolean().optional(),
    notes: z.string().optional(),
    expected_resolve_node_id: z.string().nullable().optional(), // ready_to_resolve 依据
  })
  .passthrough();

/** event 专属字段（时间轴事件：description/tags[]；字段名 snake_case） */
export const eventDataSchema = z
  .object({
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough(); // 允许未知字段（创作工具，用户自定义字段自由）

/** timepoint 专属字段（G2 时间标签点）：data 空——时间标签文本 = name，可重命名，YAGNI 不加 data 字段 */
export const timepointDataSchema = z.object({}).passthrough();

/** reference 专属字段（参考资料：type 自由文本分类 / url 外源链接 / tags 标签数组 / content 正文块数组 JSON）；
 * type 缺省 material 写入侧兜底；url 可选（纯本地笔记不需要，外源链接才填）。
 *
 * **content 只是端点对外的字段名**（2026-09 reference 特例）：真相存 `document_records`
 * （`owner_kind='reference'`，见 docs/api/30-api-entity.md「reference 特例」），entities.data 里
 * **不落** content——服务端路由层把请求里的 data.content 拆出、详情响应里再装回（存储形态见 docs/db/schema.md）。
 * `kind` / `file_name` / `file_mtime` / `source` **已废弃**（旧值不读、不迁移；`.passthrough()` 容错存量残留）。 */
export const referenceDataSchema = z
  .object({
    type: z.string().optional(), // 自由文本分类（取消预置枚举；缺省 material 写入侧兜底）
    url: z.string().optional(), // 外源链接 URL（可选——纯本地笔记不需要）
    content: z.string().optional(), // 块数组 JSON 字符串（拆分点：路由层写入 document_records，不进 data）
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
  timepoint: timepointDataSchema, // G2 时间标签点：data 空
  reference: referenceDataSchema, // 参考资料
} as const;

// ============ project 端点（「项目管理」） ============

/** ProjectConfig 响应（GET /api/v1/project/config；与 types/project.ts 的 ProjectConfig 对齐；
 * `prompt` 已废弃不再返回——项目规则唯一事实源改为项目目录） */
export const projectConfigSchema: z.ZodType<ProjectConfig> = z.object({
  id: z.string(),
  name: z.string(),
  language: projectLanguageSchema,
  schemaVersion: z.number().int(), //
  currentPosition: z.string().nullable(), // 「当前位置」节点 id；null = 未设置
  backupFrequencyMinutes: z.number().int().nullable(), // 自动备份频率；null = 关闭；缺省 10 由读侧兜底
  createdAt: z.string(),
  updatedAt: z.string(),
});

// POST /api/v1/project/create
export const projectCreateReqSchema = z
  .object({
    path: z.string(), // 项目目录绝对路径（校验）
    config: z
      .object({
        name: z.string().optional(),
        language: projectLanguageSchema.optional(),
 // prompt 已废弃：不再接受（strict schema 传入 → 400 VALIDATION_ERROR）；
 // 项目规则改由 PUT /api/v1/project/agents 写入 
      })
      .strict()
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

// POST /api/v1/project/delete（删书：本地目录 + 可选云端目录）
// 语义（docs/api/10-api-project.md）：**删除不可恢复**——该书 `.backups/` 在书目录内，随目录一并消失。
// - `path` 须是 `<创作根>/books/` 的**直接子目录**且含 project.json（否则 400 INVALID_PROJECT_PATH）
// - 该书有云同步记录（`cloud.json` 已配置 **且** 有 book state）→ 删前先推一份最新副本上云；
//   推送失败默认中止不删，`force` 才继续（最新改动不上云的风险由用户确认时承担）
// - `delete_remote` = 本地删除**之后**的 best-effort：失败不回退本地已删的结果，以 `remoteError` 告知
export const projectDeleteReqSchema = z
  .object({
    path: z.string(), // 书目录绝对路径（books/ 直接子目录 + 含 project.json）
    force: z.boolean().optional(), // true = 云端前置推送失败时仍删本机（缺省 false = 中止，不删任何东西）
    delete_remote: z.boolean().optional(), // true = 同时删云端书目录并清 cloud.json 的该书 state（缺省 false = 云端备份原样保留）
  })
  .strict();

export const projectDeleteResSchema = z.object({
  deleted: z.literal(true),
  path: z.string(),
  /** 删除前推送成功的那一份（云盘已配置且该书有同步记录时才有） */
  pushed: z.object({ fileName: z.string() }).optional(),
  /** delete_remote 且云端目录删除成功 */
  remoteDeleted: z.literal(true).optional(),
  /** delete_remote 失败：本地已删、云端保留（best-effort，UI 提示可去云盘网页手动清理） */
  remoteError: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type ProjectDeleteReq = z.infer<typeof projectDeleteReqSchema>;
export type ProjectDeleteRes = z.infer<typeof projectDeleteResSchema>;

// GET /api/v1/project/list（书架模式 S1.5：列出创作根 books/ 下的书，供 Dashboard 书架展示）
export const projectListResSchema = z.object({
 /** 创作根（server 启动参数 projectRoot） */
  rootPath: z.string(),
 /** books/ 下含 project.json 的书，按 updatedAt 倒序（最近更新在前） */
  books: z.array(
    z.object({
 /** project.json 的 id——**项目身份**：当前书高亮 / 已打开判定一律按它，不按 name */
      id: z.string(),
 /** 目录名（书名） */
      name: z.string(),
 /** 书目录绝对路径（books/<name>） */
      path: z.string(),
 /** 项目出处（**响应里恒有值**：服务端把 project.json 缺失的 origin 归一为 `book`） */
      origin: z.enum(PROJECT_ORIGINS),
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
 // prompt 已废弃：不再接受（strict schema 传入 → 400 VALIDATION_ERROR）；
 // 项目规则改由 PUT /api/v1/project/agents 写入 
    current_position: z.string().nullable().optional(), // 须指向存在的非软删大纲节点（服务端校验）
 /**
 * 自动备份频率（修订）：仅接受枚举 1/5/10/15/30/60（BACKUP_FREQUENCIES），其他（含 0）→ 400
 * VALIDATION_ERROR；null = 关闭（写入 null）——0 仅读侧兼容旧数据语义，写侧一律用 null 表示关闭
 */
    backup_frequency_minutes: z.union(BACKUP_FREQUENCIES.map((v) => z.literal(v))).nullable().optional(),
  })
  .strict();

export const projectConfigUpdateResSchema = z.object({
  updated: z.literal(true),
});

// GET /api/v1/project/agents（项目规则文件 ——唯一事实源，取代 project.json `prompt`）
// 语义：无当前项目 → 409 NO_PROJECT_OPEN；文件不存在不报错（exists:false + 空串）；
// updatedAt = 文件 mtime（ISO 8601，外部修改检测依据）；读取每次实时读文件不缓存
export const projectAgentsGetResSchema: z.ZodType<ProjectAgents> = z.object({
  content: z.string(), // 文件内容（文件不存在 → 空串）
  exists: z.boolean(), // 文件是否存在（false 时 content 为空串）
  updatedAt: z.string().nullable(), // 文件 mtime（ISO 8601；文件不存在 → null）
});

// PUT /api/v1/project/agents（设置页直接编辑 文件内容）
// 语义：整体替换（非追加）；空串 = 清空规则（保留空文件不删除）；文件不存在自动创建；
// 写入走原子写（同款）；写入后返回新 mtime（前端更新本地比对基线）
export const projectAgentsPutReqSchema = z
  .object({
    content: z.string(), // 完整内容（整体替换；空串 = 清空规则文件，保留空文件不删除）
  })
  .strict();

export const projectAgentsPutResSchema = z.object({
  saved: z.literal(true),
  updatedAt: z.string(), // 写入后的文件 mtime（ISO 8601）——前端更新本地比对基线
});

// POST /api/v1/project/backup（新增：手动备份可携带自定义名称）
// - 请求体可选 `name`（string）；空串/缺省 → 无自定义名称（纯时间戳文件名）。
// - **形状校验仅限类型**（oracle 审核 P2-1：zod 与 sanitize 的「.zip 剥离 + 长度」判定
// 顺序曾在 schema 内重复实现导致误拒——如 29 字符 + ".zip" schema 判超长而 sanitize 判合法）；
// **名称规则（trim/.zip 剥离/长度/字符集）权威判定全部收敛在 shared sanitizeBackupName**——
// writeBackup 为唯一执行点，非法 → 400 VALIDATION_ERROR。
export const projectBackupReqSchema = z
  .object({
    name: z.string().optional(),
  })
  .strict();
export type ProjectBackupReq = z.infer<typeof projectBackupReqSchema>;

// POST /api/v1/project/backup/rename：重命名备份（只改名称段，时间戳与 kind 保持）
// - 请求体 fileName 必填；name 可选——非空 → sanitize（非法 400）；空串/缺省 → 清除名称段
export const projectBackupRenameReqSchema = z
  .object({
    fileName: z.string(),
    name: z.string().optional(),
  })
  .strict();
export type ProjectBackupRenameReq = z.infer<typeof projectBackupRenameReqSchema>;

// ============ 导出/导入端点（产品承诺「数据主权归用户」） ============

/**
 * 导出 zip 内固定三文件名（GET /api/v1/project/export 的 zip 条目名与数据文件
 * 原名一致——import 侧按此固定名校验，缺失即坏包）
 */
export const PROJECT_EXPORT_FILE_NAMES = ["project.json", "outline.json", "data.db"] as const;

/**
 * GET /api/v1/project/export：
 * - **响应为二进制 zip（application/zip），非 JSON 包裹**——「成功响应
 * {success,data}」通用约定的显式例外；Content-Disposition: attachment;
 * filename*=UTF-8''<书名>.zip（RFC 5987）
 * - zip 内三文件：project.json + outline.json + data.db（导出前 wal_checkpoint(TRUNCATE)
 * 保证 data.db 主文件完整快照；key 存用户级配置，天然不入包）
 * - 错误：无当前项目 → 409 NO_PROJECT_OPEN（服务端补充码，与 /config 一致）；
 * 三文件缺失任一 → 500 INTERNAL_ERROR（打开的项目三文件必然齐全，缺失即损坏）
 * - 二进制响应不走 Zod parse——以本注释 + PROJECT_EXPORT_FILE_NAMES 常量表达
 */

// POST /api/v1/project/import（已落）
// - 请求：multipart/form-data 文件上传——field "file"（zip 备份包）+ field "name"（书名，
// 必填；禁路径分隔符/纯点/控制字符，与 client 新建项目同规则）——目标目录为
// 服务端决定的 创作根/books/<name>/（客户端不可指定路径，防越权）
// - 服务端流程：解压到临时目录 → 校验（条目白名单 = PROJECT_EXPORT_FILE_NAMES
// 三文件名 + project.json/outline.json 顶层data.db user_version 匹配）→
// 原子搬入新书目录（新建，不覆盖现有项目）→ 返回 200
// - 错误码：坏包/缺文件/未知条目/不符 → 400 VALIDATION_ERROR；data.db user_version
// 与当前程序版本不匹配 → 409 SCHEMA_VERSION_MISMATCH（拒绝导入，不静默重建）；
// 目标书名已存在 → 409 PROJECT_ALREADY_EXISTS（服务端补充码，与 create 同语义）
export const projectImportResSchema = z.object({
  imported: z.literal(true),
  id: z.string(), // 项目 project_id（覆盖恢复 = 书架目标项目原 id；导入新书 = 沿用 zip 内 project.json 的 id）
  path: z.string(), // 书目录绝对路径（创作根/books/<name>/ 或去重名 books/<name> (N)/）
  name: z.string(), // 书名（新书目录名；project.json 内部 name 同此——「目录名 = 书名」不变式）
 /** 分流：restored = zip 内 id 匹配书架 → 覆盖恢复；new = 导入为新书（前端按此提示 toast） */
  mode: z.enum(["restored", "new"]),
});
export type ProjectImportRes = z.infer<typeof projectImportResSchema>;

// ============ entity 端点（「实体 CRUD」） ============

/**
 * 关系（GET /api/v1/relation depth=1 项；与 types/entity.ts RelationRecord 对齐）
 * 定义于此处供 entity 详情响应（relations: RelationSummary[]，形状同 RelationRecord，
 * 未单独列字段）与 relation 查询共用，避免同结构两处定义漂移
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
 // M2（2026-08）：仅 setting 列表填充（层级 = belongs_to）
  parentId: z.string().optional(),
  parentName: z.string().optional(),
 // 手动排序位（2026-08）：仅 setting 类型填充（entities.sort_order 列）
  sortOrder: z.number().int().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// GET /api/v1/entity/:type（Query：snake_case）
export const entityListQuerySchema = z.object({
  q: z.string().optional(), // 模糊匹配 name
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_ENTITY_LIST_LIMIT).default(DEFAULT_ENTITY_LIST_LIMIT),
  sort: z.enum(["name", "created_at", "updated_at"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
 // 标签包含筛选（2026-08）：data 数组字段（setting.rules / event.tags）包含该标签即命中
  tag: z.string().optional(),
 // 上级设定筛选（2026-08，仅 setting 类型生效，其他类型路由层忽略）：匹配 = 实体在设定层级树
 // （belongs_to）中直接或间接属于该上级（递归子树，不含上级自身）；复用 listSettingHierarchyEdges
 // 建邻接表 DFS 收集后代集合走 db JS 过滤路径（total = 过滤后总数）；与 q/tag/排序/分页组合（AND）；
 // 指向不存在的设定（含已软删）→ 空结果（宽松，同 tag 无匹配不 404）；不传 = 不过滤
  parent_id: z.string().optional(),
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
  relations: z.array(relationRecordSchema), // RelationSummary（形状同 RelationRecord）
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

// DELETE /api/v1/entity/:type/:id（软删 + 级联计数）
export const entityDeleteResSchema = z.object({
  deleted: z.literal(true),
  cascaded: z.object({
    relations: z.number().int(),
    deltas: z.number().int(),
  }),
});

// ============ relation 端点（「关系管理」） ============

// relationRecordSchema 定义于 entity 区（entity 详情 relations 与 relation 查询共用，避免重复定义）

/** 路径结构（depth>=2） */
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

// POST /api/v1/relation（relation_type 自由字符串：预定义 17 类 ∪ 自定义类型，语法校验单一来源 =
// shared `utils/relation-type.ts`；收窄为枚举的只剩 AI 工具层，见 packages/tools/src/schemas/relation.ts）
export const relationCreateReqSchema = z
  .object({
    source_type: z.string(),
    source_id: z.string(),
    target_type: z.string(),
    target_id: z.string(),
    relation_type: z
      .string()
      .transform(normalizeRelationType)
      .superRefine((value, ctx) => {
        const message = relationTypeSyntaxError(value);
        if (message !== null) ctx.addIssue({ code: "custom", message });
      }),
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

// PUT /api/v1/relation/:id（「PUT /relation/:id」：metadata **整体替换**，含清空传 {}）
export const relationUpdateMetaReqSchema = z
  .object({
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

// DELETE /api/v1/relation/:id（物理删除，不进回收站）
export const relationDeleteResSchema = z.object({
  deleted: z.literal(true),
});

// ============ delta 端点（「Delta 变更追踪」） ============

/** 变更操作类型（2026-08 修订语义：set/update/add/remove，见） */
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

// POST /api/v1/delta/compute（章序前缀累积：章序 ≤ 目标进度章的全部章）
export const deltaComputeReqSchema = z
  .object({
    target_type: z.string(),
    target_id: z.string(),
    at_node_id: z.string(), // 目标节点（不限层级）——映射为进度章：章→自身 / 场景→所属章 / 卷→该卷最后一个未软删章
  })
  .strict();

export const deltaComputeResSchema: z.ZodType<ComputeStateResult> = z.object({
  targetType: z.string(),
  targetId: z.string(),
  atNodeId: z.string(),
  state: z.record(z.string(), z.unknown()), // 初始 data + 章序前缀（章序 ≤ 进度章）的全部 Delta 累积
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
        .optional(), // op=update 且当前值 ≠ from 时跳过该 change
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

// ============ outline 端点（「大纲操作」，严格三层） ============

/**
 * 大纲节点 data 字段 schema（麦基《故事》字段集，outline.json「节点结构化信息」节）：
 * scene——goal/conflict_levels/value_from/value_to；chapter——reversal/climax_scene；
 * volume——climax_scene/inciting_scene。
 * 宽松语义与 ENTITY_DATA_SCHEMAS 一致：
 * - `.passthrough` 允许未知字段（创作工具，用户自定义字段自由，未知字段原样保留透传）
 * - 引用字段（climax_scene/inciting_scene）仅类型校验（字符串），不校验存在性/范围（MVP 宽松）
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
    data: z.record(z.string(), z.unknown()).optional(), // 节点结构化信息（内部字段原样透传）
    updatedAt: z.string(), // 节点版本戳
    deleted: z.boolean().optional(), // 软删标记（管理视图）
    deletedAt: z.string().optional(),
    children: z.array(outlineNodeSchema).optional(),
    metadata: z
      .object({
        hookCount: z.number().int().optional(),
        charCount: z.number().int().optional(),
        deltaCount: z.number().int().optional(),
        textLength: z.number().int().optional(), // 章节点正文字数（content_text 长度；无文档 = 0；仅章节点返回）
      })
      .optional(), // 仅 with_metadata=true 时返回
  }),
);

/** 完整大纲树（GET /api/v1/outline） */
export const outlineTreeSchema = z.object({
  id: z.literal("root"),
  type: z.literal("root"),
  schemaVersion: z.number().int(), // outline.json 顶层 schema_version
  children: z.array(outlineNodeSchema),
});

// GET /api/v1/outline（Query）
export const outlineGetQuerySchema = z.object({
 // 显式字符串布尔：z.coerce.boolean 会把 "false" 解析为 true（反向问题），
 // 改为枚举 + transform：显式传 false → false；不传 → undefined（默认关闭 metadata 统计）
  with_metadata: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(), // 跨 outline.json × data.db 联查统计
});

// POST /api/v1/outline（parent_id 必填，无默认值）
export const outlineCreateReqSchema = z
  .object({
    type: z.enum(["volume", "chapter", "scene"]),
    title: z.string().min(1).max(200),
    parent_id: z.string(), // volume→root；chapter→volume（章只挂卷，2026-09）；scene→必须 chapter
    summary: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(), // 节点结构化信息（宽松 record，按层级 schema 精校验）
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
    data: z.record(z.string(), z.unknown()).optional(), // 部分合并（按层级 schema 精校验）
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

// PUT /api/v1/entity/event/:id/move（时间轴事件重排；命名风格同 outlineMoveReqSchema）
export const entityMoveReqSchema = z
  .object({
 // 0-based 全局事件线性序：超过当前事件总数 → clamp 到末尾（不返回 4xx）；
 // 负数由本 schema 拒绝（400 VALIDATION_ERROR）——db 层 moveEvent 对负数 clamp 至 0
 // 仅为内部防御语义（HTTP 路径不可达）
    order: z.number().int().min(0),
  })
  .strict();

export const entityMoveResSchema = z.object({
  moved: z.literal(true),
});

// PUT /api/v1/entity/setting/:id/move（设定同级重排 / 改父 + 重排，2026-08；
// 修订「设定无 sort_order 语义」约束——复用 entities.sort_order 列，无 DDL 迁移）
export const settingMoveReqSchema = z
  .object({
 // 目标父设定 id；null = 移为顶层根（无上级）。与当前父相同（含同为根）→ 仅重排
    parent_id: z.string().nullable(),
 // 0-based 同级组内序（改父后 = 新父子级组内位置 / 未改父 = 当前同级组内位置）；
 // 越界 clamp（负数 400 schema 拒绝；超组内数 → 组尾）；缺省 = 追加组尾
    order: z.number().int().min(0).optional(),
  })
  .strict();

// POST /api/v1/entity/event/:id/move_to（跨组挂载复合写，G2 事件拖到另一时间点
// 区块 = 改挂载 + 重排一次提交；服务端事务内原子完成——「G2 跨组拖拽」的复合端点实现）
export const eventMoveToReqSchema = z
  .object({
 // 目标时间点 id；null = 移出挂载区（仅重排，归入时间轴「未挂载」兜底区）。
 // 事件已挂载同一时间点 → 幂等跳过重建挂载（只重排）
    timepoint_id: z.string().nullable(),
 // 0-based 全局事件线性序（同 entityMoveReqSchema：越界 clamp、负数 400）
    order: z.number().int().min(0),
  })
  .strict();

// DELETE /api/v1/outline/:nodeId（软删 + 递归级联）
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

// ============ trash 端点（「回收站」） ============

// GET /api/v1/trash（deletedAt 为 camelCase——响应体约定）
export const trashListResSchema = z.object({
  entities: z.array(
    z.object({ id: z.string(), type: z.string(), name: z.string(), deletedAt: z.string() }),
  ),
  nodes: z.array(
    z.object({ id: z.string(), type: z.string(), title: z.string(), deletedAt: z.string() }),
  ),
});

// POST /api/v1/trash/entity/:type/:id/restore（级联还原）
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

// ============ manuscript 端点（「章正文」） ============
//
// 载荷 = 块编辑器原生文档（块数组）的 **JSON 字符串**：真相存 data.db 的 document_records
// （owner_kind='chapter'，owner_id = 章节点 id）；`content_text` 投影只由服务端派生（端点不接受客户端投影）。
// 契约见 docs/api/110-api-manuscript.md；层级仅 chapter（卷/场景 → 400）。

// GET /api/v1/manuscript/:chapterNodeId（从未写过 → content ""/updatedAt null/charCount 0）
export const manuscriptGetResSchema = z.object({
  chapterNodeId: z.string(),
  content: z.string(), // 块数组 JSON 字符串；"" = 从未写过（客户端按空文档处理）
  updatedAt: z.string().nullable(), // 版本戳（ISO 8601）；从未写过 = null
  charCount: z.number().int(), // 正文字数（content_text 长度）
});

// PUT /api/v1/manuscript/:chapterNodeId（整篇覆盖保存）
export const manuscriptPutReqSchema = z
  .object({
    content: z.string(), // 块数组 JSON 字符串（服务端浅校验：JSON.parse 后必须是块数组，否则 400）
    base_updated_at: z.string().optional(), // 保存前读到的版本戳；提供时不一致 → 409 DOCUMENT_STALE；省略 = 不做冲突检查（覆盖保存/导入路径显式使用）
  })
  .strict();

export const manuscriptPutResSchema = z.object({
  updated: z.literal(true),
  updatedAt: z.string(), // 本次写入后的新版本戳
  charCount: z.number().int(), // 重算后的字数
});
export type ManuscriptGetRes = z.infer<typeof manuscriptGetResSchema>;
export type ManuscriptPutReq = z.infer<typeof manuscriptPutReqSchema>;
export type ManuscriptPutRes = z.infer<typeof manuscriptPutResSchema>;

// ============ chat 端点（「AI 对话」，持久化） ============

// POST /api/v1/chat（POST + SSE；消息落项目目录 sessions/<session_id>.jsonl）
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
  // 会话显示名（pi `session_info` 条目）：拆解会话 = 「《书名》拆解」，普通 chat 会话 pi 不写 ⇒ 缺省
  name: z.string().optional(),
  lastMessage: z.string(), // 截断摘要
  messageCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(), // 最后活动时间
});

export const chatSessionsResSchema = z.object({
  sessions: z.array(chatSessionSummarySchema),
});

// GET /api/v1/chat/sessions/:id/messages（按时间升序；tool 消息经 toolCallId 关联 assistant 消息的 toolCalls[].id）

/** 思维链投影（列表/历史只给预览 + 定位参数；全文走按需端点，见 docs/api/80-api-chat.md） */
export const chatThinkingPreviewSchema = z.object({
  preview: z.string(), // 前 240 字符预览
  deferred: z.literal(true), // 全文需按需拉取
  blockIndex: z.number().int(), // 取全文时的块下标
  length: z.number().int(), // 原文字符数
});

/** 消息条目命名类型（schema 派生，服务端与 client 共用——client 不再重复声明） */
export type ChatSessionMessage = z.infer<typeof chatMessagesResSchema>["messages"][number];
/** 思维链预览命名类型（schema 派生） */
export type ChatThinkingPreview = z.infer<typeof chatThinkingPreviewSchema>;
/** 会话列表项命名类型（schema 派生） */
export type ChatSessionSummary = z.infer<typeof chatSessionSummarySchema>;

export const chatMessagesResSchema = z.object({
  sessionId: z.string(),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["user", "assistant", "tool"]),
      content: z.string().nullable().optional(),
      thinking: z.array(chatThinkingPreviewSchema).optional(), // assistant 消息的思维链预览
      toolCalls: z.array(z.unknown()).optional(), // assistant 消息的工具调用数组
      toolCallId: z.string().nullable().optional(), // tool 消息关联的调用 id
      isError: z.boolean().optional(), // tool 消息是否失败
      createdAt: z.string(),
    }),
  ),
});

// GET /api/v1/chat/sessions/:id/messages/:messageId/thinking
// 按需读取某条 assistant 消息的思维链全文（列表接口只回预览）
export const chatThinkingResSchema = z.object({
  thinking: z.string(),
});

// DELETE /api/v1/chat/sessions/:id（物理删会话文件；400 VALIDATION_ERROR / 404 SESSION_NOT_FOUND / 409 SESSION_BUSY）
export const chatSessionDeleteResSchema = z.object({
  deleted: z.literal(true),
});

// ============ proposal 端点（「提案确认」） ============

// POST /api/v1/proposal/:proposalId/confirm（409 PROPOSAL_STALE / 404 PROPOSAL_NOT_FOUND / 409 PROPOSAL_PROJECT_MISMATCH）
export const proposalConfirmResSchema = z.object({
  confirmed: z.literal(true),
  result: z.unknown(), // 执行结果（如新创建的 entity id）
});

// POST /api/v1/proposal/:proposalId/reject
export const proposalRejectResSchema = z.object({
  rejected: z.literal(true),
});

// ============ settings 端点（「系统设置」） ============

/** 思考强度（参考 pi 的 ThinkingLevel 档位——off / minimal / low / medium / high / xhigh / max；off = 不加 reasoning 参数） */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** 模型目录条目（GET /settings/llm 返回，供前端模型下拉与上下文占用分母） */
export const modelInfoSchema = z.object({
  id: z.string(),
  provider: z.string(),
  displayName: z.string(),
  contextWindow: z.number(),
  maxTokens: z.number(),
  reasoning: z.boolean(),
});
export type LlmModelInfo = z.infer<typeof modelInfoSchema>;

/** 单 provider 条目（GET /settings/llm providers[]——pi provider 目录 + 认证状态） */
export const settingsProviderSchema = z.object({
  id: z.string(), // pi provider id（deepseek / opencode-go / …）
  displayName: z.string(), // pi provider 名称（如 "OpenCode Go"）
  authConfigured: z.boolean(), // 该 provider 是否已有可用凭据（env / auth.json / runtime）
  // pi AuthStatus.source：stored / runtime / environment / fallback / models_json_key / models_json_command
  authSource: z.string().optional(),
  models: z.array(modelInfoSchema), // 该家模型目录（pi 静态目录 + 远端 overlay）
});
export type SettingsProvider = z.infer<typeof settingsProviderSchema>;

// GET /api/v1/settings/llm（pi provider 目录 + 认证状态 + 激活模型；凭据明文永不回传）
// provider/model 为空串 = 未配置任何可用模型（前端展示「未配置」引导）
export const settingsLlmGetResSchema = z.object({
  provider: z.string(), // 激活 provider id（pi settings defaultProvider / 首个可用模型）
  model: z.string(), // 当前模型 id（属于 provider 目录）
  thinkingLevel: z.enum(THINKING_LEVELS), // 思考强度（pi settings，全局）
  providers: z.array(settingsProviderSchema), // 全量 provider（前端下拉分组/禁用依据）
});

// PUT /api/v1/settings/llm（写 pi settings + pi credential store，绝不入项目文件）
// 语义：provider + model 成对（跨 provider 激活）；thinking_level 写 pi settings；
// api_key 单家凭据：key 非空写入 / 空串删除该家存量凭据；server 校验 model ∈ provider 目录
export const settingsLlmPutReqSchema = z
  .object({
    provider: z.string().optional(),
    model: z.string().optional(),
    thinking_level: z.enum(THINKING_LEVELS).optional(),
    api_key: z.object({ provider: z.string(), key: z.string() }).optional(),
  })
  .strict();

export const settingsLlmPutResSchema = z.object({
  saved: z.literal(true),
});

// ============ names 端点（「POST /api/v1/names/resolve」，工具调用人类可读化） ============

// 批量名称解析：把工具参数中的 id 解析为人类可读名称（label = 类型中文，name = 实体名/节点标题）
// 前缀分流（char-/set-/loc-/hook-/ev-/tp-/ref- → 实体；vol-/ch-/sc- → 大纲节点；rel- → null；其余 → null）
export const namesResolveReqSchema = z
  .object({
    ids: z.array(z.string()).max(50), // 上限 50；服务端去重（保持请求顺序）
  })
  .strict();

export const namesResolveResSchema = z.object({
  names: z.record(z.string(), z.object({ label: z.string(), name: z.string() }).nullable()),
});

export type NamesResolveResult = z.infer<typeof namesResolveResSchema>;

// ============ 云端存档（卡 2：账号配置段） ============
//
// PUT /api/v1/cloud/config：写入云端账号配置与设备名、自动推送开关
// - url / username：**空串 = 清空该项**（url+username+password 三项齐空 → 回到「未配置」）
// - **凭据三件套要么齐、要么全无**：url 与 username 皆为空 ⇒ **password 一并丢弃**（避免磁盘留下已失效的密码）
// - password：**缺省或空串 = 不修改**（响应从不回传，设置页表单留空即保留原值）
// - **URL 内嵌 userinfo（`https://用户名:密码@host/dav`）直接 400 拒绝**（不静默剥离——那会让用户以为已生效）
// - device：空串 = 回到缺省（简化 hostname）；语法规则执行点在 shared sanitizeDeviceName（非空时）
// - autoPush：缺省 = 不修改（本机级开关，缺省 false）
// - url 非空时的归一化（http(s) 绝对地址、去尾斜杠）在路由层校验（→ 400 VALIDATION_ERROR）
export const cloudConfigPutReqSchema = z
  .object({
    url: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    device: z.string().optional(),
    autoPush: z.boolean().optional(),
  })
  .strict();
export type CloudConfigPutReq = z.infer<typeof cloudConfigPutReqSchema>;

// POST /api/v1/cloud/push：推送一份本地备份（卡 4）
// - file_name 缺省 = 最新一份；须通过 parseBackupFileName 白名单（服务端校验 → 400）
// - force 缺省 false：云端 head ≠ 本机 lastPushedFileName 时 409 CLOUD_CONFLICT；
//   true = 先把云端那份下载存进本地 .backups/（两边都留档）再覆盖云端
export const cloudPushReqSchema = z
  .object({
    file_name: z.string().optional(),
    force: z.boolean().optional(),
  })
  .strict();
export type CloudPushReq = z.infer<typeof cloudPushReqSchema>;

// POST /api/v1/cloud/pull：从云端拉取一份备份应用到当前项目（卡 5）
// - file_name 缺省 = 云端 head；须通过 parseBackupFileName 白名单（服务端校验 → 400）
// - 语义 = 三文件覆盖（`sessions/` 是纯本地目录，不写不删），见 docs/api/100-api-cloud.md
export const cloudPullReqSchema = z
  .object({
    file_name: z.string().optional(),
  })
  .strict();
export type CloudPullReq = z.infer<typeof cloudPullReqSchema>;

// ============ decompose 端点（「拆解小说」导入式批量管线） ============
//
// 契约：docs/api/120-api-decompose.md（端点结构）+ docs/design/60-decompose.md §5（抽取 schema 口径）。
// **传输例外**：analyze / start 的请求体是小说文件原始字节（application/octet-stream），
// 文件名与范围走 query —— 故本段只声明 query 与响应 schema（无 JSON 请求体可校验）。

/** job 状态机（pending → running → (paused | done | failed)） */
export const DECOMPOSE_JOB_STATUSES = ["pending", "running", "paused", "done", "failed"] as const;
/** 批状态（pending → running → done | failed） */
export const DECOMPOSE_BATCH_STATUSES = ["pending", "running", "done", "failed"] as const;
/** 阶段条（进度页高亮用；`done` = 全流程结束） */
export const DECOMPOSE_STAGES = ["ingest", "extract", "merge", "report", "done"] as const;

/** 编码探测结果（与 server `decompose/split.ts` 的 NovelEncoding 同集：探测在服务端单一实现） */
export const decomposeEncodingSchema = z.enum(["utf-8", "utf-8-bom", "utf-16le", "utf-16be", "gb18030"]);

/** 切分警告（码表单一来源 = server `decompose/split.ts` 的 SPLIT_WARNING_CODES；client 不映射代码，故此处不复抄清单） */
export const decomposeWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
});

/** 预览章条目（index = 1-based 文件位置序） */
export const decomposeChapterPreviewSchema = z.object({
  index: z.number().int().min(1),
  title: z.string(),
  charCount: z.number().int().min(0),
  volumeIndex: z.number().int().min(0),
});

/** 章字数分布（min / median / max；median 可能是 x.5——偶数章取中位均值） */
export const decomposeChapterStatsSchema = z.object({
  min: z.number().min(0),
  median: z.number().min(0),
  max: z.number().min(0),
});

/** 范围预估（费率来自 pi 模型目录；未配置模型/凭据 → costApprox = null） */
export const decomposeEstimateSchema = z.object({
  batchCount: z.number().int().min(0),
  llmCalls: z.number().int().min(0),
  inputTokensApprox: z.number().int().min(0),
  outputTokensApprox: z.number().int().min(0),
  costApprox: z.number().nullable(),
});

// POST /api/v1/decompose/analyze（Query；缺省语义 = 起始 1 / 结束到末章——章数由服务端切分后才知道，故不在 schema 里给默认）
export const decomposeAnalyzeQuerySchema = z.object({
  file_name: z.string().min(1),
  scope_start: z.coerce.number().int().min(1).optional(),
  scope_end: z.coerce.number().int().min(1).optional(),
});

// POST /api/v1/decompose/analyze（Res: 200 切分预览，无状态、不落库）
export const decomposeAnalyzeResSchema = z.object({
  encoding: decomposeEncodingSchema,
  totalChars: z.number().int().min(0),
  chapters: z.array(decomposeChapterPreviewSchema),
  volumes: z.array(z.object({ index: z.number().int().min(0), title: z.string() })),
  stats: decomposeChapterStatsSchema,
  warnings: z.array(decomposeWarningSchema),
  estimate: decomposeEstimateSchema,
  defaultName: z.string(),
});
export type DecomposeAnalyzeRes = z.infer<typeof decomposeAnalyzeResSchema>;

// POST /api/v1/decompose/start（Query）
export const decomposeStartQuerySchema = z.object({
  file_name: z.string().min(1),
  name: z.string().min(1),
  scope_start: z.coerce.number().int().min(1).optional(),
  scope_end: z.coerce.number().int().min(1).optional(),
});

// POST /api/v1/decompose/start（Res: 200；S1 同步完成后再返回，job 已进入 running）
export const decomposeStartResSchema = z.object({
  projectId: z.string(),
  projectPath: z.string(),
  name: z.string(),
  jobId: z.string(),
  status: z.enum(["pending", "running"]),
  batchCount: z.number().int().min(0),
});
export type DecomposeStartRes = z.infer<typeof decomposeStartResSchema>;

// 续拆两端点（GET /decompose/plan + POST /decompose/continue）**共用一个 query**：范围解析是同一实现
// （缺省 = 未拆章最小覆盖区间，由服务端按历史 done 批推导 ⇒ 缺省值不进 schema）。
// **不吃文件字节**：章与正文已在库（S1 全量导入），故本组无请求体 schema。
export const decomposeContinueQuerySchema = z.object({
  scope_start: z.coerce.number().int().min(1).optional(),
  scope_end: z.coerce.number().int().min(1).optional(),
});

// GET /api/v1/decompose/plan（Res: 200 续拆预览；不落库、无状态）
// `decomposed` = 历史**所有** job 的 done 批覆盖；`scopeStart/scopeEnd = 0` = 无未拆章（无实际范围）。
export const decomposePlanChapterSchema = decomposeChapterPreviewSchema.extend({ decomposed: z.boolean() });

export const decomposePlanResSchema = z.object({
  scopeStart: z.number().int().min(0),
  scopeEnd: z.number().int().min(0),
  defaulted: z.boolean(), // true = 用了缺省范围（未拆章最小覆盖区间）
  remainingCount: z.number().int().min(0), // 未拆章总数（全书口径）
  decomposedInScope: z.number().int().min(0), // 范围内已拆章数（将重拆）
  chapters: z.array(decomposePlanChapterSchema), // 全书章列表（含已拆标注）
  stats: decomposeChapterStatsSchema,
  estimate: decomposeEstimateSchema,
});
export type DecomposePlanRes = z.infer<typeof decomposePlanResSchema>;

// POST /api/v1/decompose/continue（Res: 200；S1' 只落 job 与批规划，返回时 job 已 running）
export const decomposeContinueResSchema = z.object({
  jobId: z.string(),
  scopeStart: z.number().int().min(1),
  scopeEnd: z.number().int().min(1),
  status: z.literal("running"),
  batchCount: z.number().int().min(0),
});
export type DecomposeContinueRes = z.infer<typeof decomposeContinueResSchema>;

// ── S2 抽取结果（逐章对齐；口径表见 docs/design/60-decompose.md §5） ──
//
// 本组 schema 同时是「服务端归一后的批结果形状」与「client 展开批结果时消费的类型」；
// 模型原始输出先经 server `decompose/extract.ts` 的纯函数校验与归一（截断/丢弃/白名单），
// 再按本形状落 `decompose_batches.result`——故此处**只声明干净形状**：
// - 上限类约束（摘要/描述/动机长度、条数）由归一函数执行，schema 不重复声明数值；
// - `ability_panel` / `custom_fields` / `location.parent_id` 契约禁止填（§5），不在此声明。

/** 抽取人物（role 为自由文本：提示词给建议词表，服务端不校验、不给枚举） */
export const decomposeCharacterSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  description: z.string().optional(),
  alias: z.string().optional(), // 单值（多别名进 description 的「（又称：…）」）
  gender: z.string().optional(), // 只在文中明确时填
  age: z.union([z.string(), z.number()]).optional(),
  race: z.string().optional(),
  personality: z.array(z.string()).optional(),
  motivation: z.string().optional(),
});
export type DecomposeCharacter = z.infer<typeof decomposeCharacterSchema>;

/** 抽取设定（tags = 短标签、rules = 短句——长文本进 description） */
export const decomposeSettingSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  rules: z.array(z.string()).optional(),
});
export type DecomposeSetting = z.infer<typeof decomposeSettingSchema>;

/** 抽取地点（type 自由文本；不做地点层级 ⇒ 无 parent_id） */
export const decomposeLocationSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  description: z.string().optional(),
});
export type DecomposeLocation = z.infer<typeof decomposeLocationSchema>;

/** 抽取关系（type 白名单收窄，单一来源 = server `decompose/extract.ts` 的 DECOMPOSE_RELATION_TYPES） */
export const decomposeRelationSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.string(),
  evidence: z.string().optional(),
});
export type DecomposeRelation = z.infer<typeof decomposeRelationSchema>;

/** 单章抽取结果（chapterIndex = 1-based 文件位置序；批内必须逐章对齐） */
export const decomposeExtractedChapterSchema = z.object({
  chapterIndex: z.number().int().min(1),
  chapterTitle: z.string(),
  summary: z.string(),
  characters: z.array(decomposeCharacterSchema),
  settings: z.array(decomposeSettingSchema),
  locations: z.array(decomposeLocationSchema),
  relations: z.array(decomposeRelationSchema),
});
export type DecomposeExtractedChapter = z.infer<typeof decomposeExtractedChapterSchema>;

/** 一批抽取结果（= `decompose_batches.result` 的 JSON 形状） */
export const decomposeBatchResultSchema = z.object({
  chapters: z.array(decomposeExtractedChapterSchema),
});
export type DecomposeBatchResult = z.infer<typeof decomposeBatchResultSchema>;

// GET /api/v1/decompose/job（Res: 200；**不含批结果正文**，展开单批另取 batches/:seq）
export const decomposeJobResSchema = z.object({
  jobId: z.string(),
  status: z.enum(DECOMPOSE_JOB_STATUSES),
  stage: z.enum(DECOMPOSE_STAGES),
  scopeStart: z.number().int().min(1),
  scopeEnd: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  progress: z.object({
    done: z.number().int().min(0),
    failed: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
  batches: z.array(
    z.object({
      seq: z.number().int().min(1),
      chapterIndexes: z.array(z.number().int().min(1)),
      chapterTitles: z.array(z.string()), // 与 chapterIndexes 同序
      charCount: z.number().int().min(0),
      status: z.enum(DECOMPOSE_BATCH_STATUSES),
      attempts: z.number().int().min(0),
      error: z.string().nullable(),
    }),
  ),
  error: z.string().nullable(),
  report: z.object({ entityId: z.string(), name: z.string() }).nullable(),
});
export type DecomposeJobRes = z.infer<typeof decomposeJobResSchema>;

// GET /api/v1/decompose/job/batches/:seq（Res: 200；result 未完成 = null）
export const decomposeBatchResSchema = z.object({
  seq: z.number().int().min(1),
  status: z.enum(DECOMPOSE_BATCH_STATUSES),
  attempts: z.number().int().min(0),
  error: z.string().nullable(),
  result: decomposeBatchResultSchema.nullable(),
});
export type DecomposeBatchRes = z.infer<typeof decomposeBatchResSchema>;

// ── 拆解过程条目（GET /api/v1/decompose/job/log；docs/design/60-decompose.md §8 时间线） ──
// `text` = 服务端渲染好的**单行**中文文案（客户端直接展示，不解析、不拼接）；`kind` 是条目类别标签
// （值集 = server `decompose/llm.ts` 的 `DECOMPOSE_LOG_KINDS`，client 只展示不映射 ⇒ 此处收成 string）。
// 只记批表里没有的信息——批状态与批结果走 `GET /decompose/job` + `/job/batches/:seq`，不在此重复。
export const decomposeLogEntrySchema = z.object({
  id: z.string(), // 会话文件里的 entry id
  at: z.string(), // ISO 8601（条目落盘时刻）
  kind: z.string(),
  text: z.string(),
  batchSeq: z.number().int().min(1).optional(), // 批相关条目（归并 / 报告条目不带）
});
export type DecomposeLogEntry = z.infer<typeof decomposeLogEntrySchema>;

// GET /api/v1/decompose/job/log（Res: 200；**会话记录被删除时 entries 为空数组**，不回 404）
export const decomposeJobLogResSchema = z.object({
  sessionId: z.string(), // decompose-<jobId>（服务端组装）
  entries: z.array(decomposeLogEntrySchema), // 顺序 = 会话文件顺序
});
export type DecomposeJobLogRes = z.infer<typeof decomposeJobLogResSchema>;

// POST /api/v1/decompose/job/pause（409 DECOMPOSE_JOB_STATE：已 done / 已 paused / 已 failed）
export const decomposePauseResSchema = z.object({ status: z.literal("paused") });

// POST /api/v1/decompose/job/resume（409 DECOMPOSE_JOB_STATE：非 paused；400 LLM_API_KEY_MISSING）
export const decomposeResumeResSchema = z.object({ status: z.literal("running") });

// POST /api/v1/decompose/job/batches/:seq/rerun（404 批序号越界；409 job 正在 running / paused）
export const decomposeRerunResSchema = z.object({
  status: z.literal("running"),
  seq: z.number().int().min(1),
});

// ============ chat SSE 事件 ============
//
// 事件集（服务端→客户端的 pi 事件投影）以 docs/api/80-api-chat.md 为契约。本文件**不再镜像**
// 一份可能漂移的帧 schema：旧的 text/tool_call/tool_result/proposal/done/error 事件集已随内核更换退场，
// 客户端在自有 SSE 解析层（fetch + ReadableStream，非 EventSource）按文档帧表消费。
