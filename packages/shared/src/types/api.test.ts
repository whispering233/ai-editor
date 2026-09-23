// API schema 测试（T1.4）：按 示例做 parse 通过与拒绝用例
import { describe, expect, it } from "vitest";
import { CHARACTER_PRIORITIES } from "../constants/entity.js";
import {
  ENTITY_DATA_SCHEMAS,
  ERROR_CODES,
  OUTLINE_NODE_DATA_SCHEMAS,
  PROJECT_EXPORT_FILE_NAMES,
  apiErrorSchema,
  characterDataSchema,
  chatSendReqSchema,
  chatSessionSummarySchema,
  deltaChangeSchema,
  deltaComputeReqSchema,
  deltaCreateReqSchema,
  entityCreateReqSchema,
  entityDeleteResSchema,
  entityDetailResSchema,
  entityListQuerySchema,
  entityListResSchema,
  entityMoveReqSchema,
  settingMoveReqSchema,
  entityMoveResSchema,
  entitySummarySchema,
  entityUpdateResSchema,
  errorCodeSchema,
  eventDataSchema,
  outlineCreateReqSchema,
  outlineGetQuerySchema,
  outlineNodeSchema,
  outlineTreeSchema,
  outlineUpdateReqSchema,
  projectBackupReqSchema,
  projectAgentsGetResSchema,
  projectAgentsPutReqSchema,
  projectAgentsPutResSchema,
  projectConfigSchema,
  projectConfigUpdateReqSchema,
  projectImportResSchema,
  projectListResSchema,
  relationCreateReqSchema,
  relationQuerySchema,
  relationUpdateMetaReqSchema,
  settingsLlmGetResSchema,
  settingsLlmPutReqSchema,
} from "./api.js";

describe("ErrorCode 完整性", () => {
  it("包含全部 10 个现行错误码", () => {
    for (const code of [
      "VALIDATION_ERROR",
      "ENTITY_NOT_FOUND",
      "RELATION_EXISTS",
      "EVENT_ALREADY_MOUNTED", // G2 occurs_at 1:n 重复挂载（assertEventSingleOccursAt 抛出 → 409）
      "RELATION_NOT_FOUND",
      "OUTLINE_NODE_NOT_FOUND",
      "OUTLINE_ANCESTOR_DELETED",
      "INVALID_PROJECT_PATH",
      "PROPOSAL_STALE",
      "PROPOSAL_NOT_FOUND",
      "PROPOSAL_PROJECT_MISMATCH",
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it("保留废弃码 DELTA_CONFLICT（2026-08 修订标注）", () => {
    expect(ERROR_CODES).toContain("DELTA_CONFLICT");
  });

  it("补充码：工具结果截断 + 会话/对话流冲突", () => {
    expect(ERROR_CODES).toContain("TOOL_RESULT_TOO_LARGE");
    expect(ERROR_CODES).toContain("SESSION_NOT_FOUND");
    expect(ERROR_CODES).toContain("SESSION_BUSY");
    expect(ERROR_CODES).toContain("CHAT_BUSY");
    expect(ERROR_CODES).toContain("THINKING_NOT_FOUND");
    expect(ERROR_CODES).toContain("DOCUMENT_STALE"); // 块文档版本戳冲突（仅携带 base_updated_at 时校验）
  });

  it("errorCodeSchema 拒绝未知错误码；apiErrorSchema 形状正确", () => {
    expect(errorCodeSchema.safeParse("UNKNOWN_CODE").success).toBe(false);
    expect(errorCodeSchema.parse("ENTITY_NOT_FOUND")).toBe("ENTITY_NOT_FOUND");
    expect(
      apiErrorSchema.parse({ success: false, error: { code: "VALIDATION_ERROR", message: "name is required", fields: ["name"] } }),
    ).toEqual({ success: false, error: { code: "VALIDATION_ERROR", message: "name is required", fields: ["name"] } });
  });
});

describe("project 端点", () => {
  it("projectConfigSchema：示例响应 parse 通过（prompt 已废弃 不再返回）", () => {
    const config = projectConfigSchema.parse({
      id: "proj-1",
      name: "我的小说",
      language: "zh",
      schemaVersion: 1,
      currentPosition: "sc-42",
      deductionNodes: [],
      backupFrequencyMinutes: 10,
      createdAt: "2026-08-01T10:00:00Z",
      updatedAt: "2026-08-01T10:00:00Z",
    });
    expect(config.currentPosition).toBe("sc-42");
  });

  it("projectConfigUpdateReqSchema：prompt 已废弃strict 拒绝", () => {
    expect(projectConfigUpdateReqSchema.safeParse({ prompt: "力量体系" }).success).toBe(false);
    expect(projectConfigUpdateReqSchema.safeParse({ name: "x", prompt: "力量体系" }).success).toBe(false);
  });

  it("projectAgentsGetResSchema：合法响应 parse 通过（文件存在/不存在两态）", () => {
    expect(
      projectAgentsGetResSchema.parse({ content: "力量体系：练气→筑基", exists: true, updatedAt: "2026-08-01T10:00:00Z" }),
    ).toEqual({ content: "力量体系：练气→筑基", exists: true, updatedAt: "2026-08-01T10:00:00Z" });
 // 文件不存在：content 空串 + exists:false + updatedAt:null
    expect(projectAgentsGetResSchema.parse({ content: "", exists: false, updatedAt: null })).toEqual({
      content: "",
      exists: false,
      updatedAt: null,
    });
 // 类型不符拒绝
    expect(projectAgentsGetResSchema.safeParse({ content: "", exists: "yes", updatedAt: null }).success).toBe(false);
    expect(projectAgentsGetResSchema.safeParse({ content: "", exists: false }).success).toBe(false); // 缺 updatedAt
  });

  it("projectAgentsPutReqSchema：content 必填 string；strict 拒绝未知字段", () => {
    expect(projectAgentsPutReqSchema.parse({ content: "新规则" }).content).toBe("新规则");
    expect(projectAgentsPutReqSchema.parse({ content: "" }).content).toBe(""); // 空串 = 清空规则
    expect(projectAgentsPutReqSchema.safeParse({}).success).toBe(false); // 缺 content
    expect(projectAgentsPutReqSchema.safeParse({ content: 123 }).success).toBe(false);
    expect(projectAgentsPutReqSchema.safeParse({ content: "x", extra: 1 }).success).toBe(false); // strict
  });

  it("projectAgentsPutResSchema：{ saved: true, updatedAt } parse 通过", () => {
    expect(projectAgentsPutResSchema.parse({ saved: true, updatedAt: "2026-08-01T10:00:00Z" })).toEqual({
      saved: true,
      updatedAt: "2026-08-01T10:00:00Z",
    });
    expect(projectAgentsPutResSchema.safeParse({ saved: false, updatedAt: "x" }).success).toBe(false);
    expect(projectAgentsPutResSchema.safeParse({ saved: true }).success).toBe(false); // 缺 updatedAt
  });

  it("language 非法拒绝；currentPosition null 允许；backupFrequencyMinutes null（关闭）允许", () => {
    expect(projectConfigSchema.safeParse({ ...validConfig(), language: "fr" }).success).toBe(false);
    expect(projectConfigSchema.parse({ ...validConfig(), currentPosition: null }).currentPosition).toBeNull();
    expect(projectConfigSchema.parse({ ...validConfig(), backupFrequencyMinutes: null }).backupFrequencyMinutes).toBeNull();
  });

  it("projectConfigSchema：deductionNodes 必填字符串数组（缺失/非数组拒绝）", () => {
    expect(projectConfigSchema.parse(validConfig()).deductionNodes).toEqual([]);
    expect(
      projectConfigSchema.safeParse({
        id: "proj-1",
        name: "我的小说",
        language: "zh",
        schemaVersion: 1,
        currentPosition: null,
        backupFrequencyMinutes: 10,
        createdAt: "2026-08-01T10:00:00Z",
        updatedAt: "2026-08-01T10:00:00Z",
      }).success,
    ).toBe(false); // 缺 deductionNodes（响应形态必填）
    expect(projectConfigSchema.safeParse({ ...validConfig(), deductionNodes: "ch-1" }).success).toBe(false);
    expect(projectConfigSchema.parse({ ...validConfig(), deductionNodes: ["ch-1", "ch-3"] }).deductionNodes).toEqual([
      "ch-1",
      "ch-3",
    ]);
  });

  it("projectConfigUpdateReqSchema：deduction_nodes 可选字符串数组（省略 = 不动；非数组/元素非字符串拒绝）", () => {
    expect(projectConfigUpdateReqSchema.parse({ deduction_nodes: ["ch-3", "ch-1"] }).deduction_nodes).toEqual(["ch-3", "ch-1"]);
    expect(projectConfigUpdateReqSchema.parse({ deduction_nodes: [] }).deduction_nodes).toEqual([]); // 空 = 清空
    expect(projectConfigUpdateReqSchema.parse({ name: "x" }).deduction_nodes).toBeUndefined(); // 省略 = 不动
    expect(projectConfigUpdateReqSchema.safeParse({ deduction_nodes: "ch-1" }).success).toBe(false);
    expect(projectConfigUpdateReqSchema.safeParse({ deduction_nodes: ["ch-1", 2] }).success).toBe(false);
  });

  it("projectConfigUpdateReqSchema：backup_frequency_minutes 接受枚举值/null/省略，拒绝其他（修订加 1 分钟档）", () => {
 // 枚举值全接受
    for (const v of [1, 5, 10, 15, 30, 60]) {
      expect(projectConfigUpdateReqSchema.safeParse({ backup_frequency_minutes: v }).success).toBe(true);
    }
 // null = 关闭；省略 = 不更新该字段
    expect(projectConfigUpdateReqSchema.parse({ backup_frequency_minutes: null }).backup_frequency_minutes).toBeNull();
    expect(projectConfigUpdateReqSchema.parse({ name: "x" }).backup_frequency_minutes).toBeUndefined();
 // 非枚举拒绝：0（关闭语义写侧一律用 null）、7、小数、字符串、布尔
    expect(projectConfigUpdateReqSchema.safeParse({ backup_frequency_minutes: 0 }).success).toBe(false);
    expect(projectConfigUpdateReqSchema.safeParse({ backup_frequency_minutes: 7 }).success).toBe(false);
    expect(projectConfigUpdateReqSchema.safeParse({ backup_frequency_minutes: 5.5 }).success).toBe(false);
    expect(projectConfigUpdateReqSchema.safeParse({ backup_frequency_minutes: "10" }).success).toBe(false);
    expect(projectConfigUpdateReqSchema.safeParse({ backup_frequency_minutes: true }).success).toBe(false);
  });

  it("projectBackupReqSchema：仅形状校验（oracle P2-1——名称规则权威判定在 sanitizeBackupName，schema 不重复判长）", () => {
 // 缺省/空对象 → 通过（无自定义名称）
    expect(projectBackupReqSchema.safeParse({}).success).toBe(true);
    expect(projectBackupReqSchema.parse({}).name).toBeUndefined();
 // 任意 string（含超长/.zip 后缀/空格等——是否合法由 sanitizeBackupName 判定，schema 不拦截）
    expect(projectBackupReqSchema.safeParse({ name: "定稿" }).success).toBe(true);
    expect(projectBackupReqSchema.safeParse({ name: "a".repeat(100) }).success).toBe(true); // 超长放行（writeBackup → 400）
    expect(projectBackupReqSchema.safeParse({ name: "a".repeat(30) + ".zip" }).success).toBe(true); // 剥 .zip 后 30 字符（P2-1 回归：不得误拒）
    expect(projectBackupReqSchema.safeParse({ name: "  " }).success).toBe(true); // 空白放行（writeBackup → 400）
 // 类型不符拒绝：非 string / null / 数字
    expect(projectBackupReqSchema.safeParse({ name: 123 }).success).toBe(false);
    expect(projectBackupReqSchema.safeParse({ name: null }).success).toBe(false);
    expect(projectBackupReqSchema.safeParse({ name: true }).success).toBe(false);
 // strict：未知字段拒绝
    expect(projectBackupReqSchema.safeParse({ name: "x", extra: 1 }).success).toBe(false);
  });

  it("projectListResSchema：合法响应 parse 通过（books 数组、id 必填、倒序语义由服务端保证）", () => {
    const res = projectListResSchema.parse({
      rootPath: "/home/me/bookshelf",
      books: [
        { id: "proj-2", name: "第二本", path: "/home/me/bookshelf/books/第二本", updatedAt: "2026-08-02T10:00:00Z" },
        { id: "proj-1", name: "第一本", path: "/home/me/bookshelf/books/第一本", updatedAt: "2026-08-01T10:00:00Z" },
      ],
    });
    expect(res.rootPath).toBe("/home/me/bookshelf");
    expect(res.books).toHaveLength(2);
    expect(res.books[0].name).toBe("第二本");
    expect(res.books[0].id).toBe("proj-2");
  });

  it("projectListResSchema：books 为空数组合法；缺字段（id / name / path / updatedAt）/ 类型不符拒绝", () => {
 // 空书架合法
    expect(projectListResSchema.parse({ rootPath: "/x", books: [] }).books).toEqual([]);
 // 书缺 updatedAt → 拒绝
    expect(
      projectListResSchema.safeParse({
        rootPath: "/x",
        books: [{ id: "proj-1", name: "书", path: "/x/books/书" }],
      }).success,
    ).toBe(false);
 // 书缺 id（项目身份，不得缺失）→ 拒绝
    expect(
      projectListResSchema.safeParse({
        rootPath: "/x",
        books: [{ name: "书", path: "/x/books/书", updatedAt: "2026-08-01T10:00:00Z" }],
      }).success,
    ).toBe(false);
 // id 非 string → 拒绝
    expect(
      projectListResSchema.safeParse({
        rootPath: "/x",
        books: [{ id: 1, name: "书", path: "/x/books/书", updatedAt: "2026-08-01T10:00:00Z" }],
      }).success,
    ).toBe(false);
 // rootPath 非 string → 拒绝
    expect(projectListResSchema.safeParse({ rootPath: 1, books: [] }).success).toBe(false);
  });
});

describe("entity 端点", () => {
  it("创建：合法请求通过（data 宽松 record）", () => {
    const req = entityCreateReqSchema.parse({
      name: "张三",
      data: { role: "主角", custom_fields: { expected_payoff: "揭示身世" } },
    });
 // data 为宽松 record 原样透传（含 snake_case 内层字段）
    expect(req.data).toEqual({ role: "主角", custom_fields: { expected_payoff: "揭示身世" } });
  });

  it("创建：name 缺失 / 超 100 字符拒绝", () => {
    expect(entityCreateReqSchema.safeParse({ data: {} }).success).toBe(false);
    expect(entityCreateReqSchema.safeParse({ name: "a".repeat(101) }).success).toBe(false);
    expect(entityCreateReqSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("创建：strict 请求体——camelCase 顶层键被拒绝（请求体必须 snake_case）", () => {
    expect(entityCreateReqSchema.safeParse({ name: "张三", createdAt: "x" }).success).toBe(false);
  });

  it("列表查询：limit 上限 200 / 超限拒绝；offset 默认 0", () => {
    expect(entityListQuerySchema.parse({}).offset).toBe(0);
    expect(entityListQuerySchema.parse({ limit: 200 }).limit).toBe(200);
    expect(entityListQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it("列表查询：sort 含 priority 档（2026-09，排序语义在 db 层）；其余档位不变、未知档位拒绝", () => {
    expect(entityListQuerySchema.parse({ sort: "priority" }).sort).toBe("priority");
    for (const s of ["name", "created_at", "updated_at"] as const) {
      expect(entityListQuerySchema.parse({ sort: s }).sort).toBe(s);
    }
    expect(entityListQuerySchema.safeParse({ sort: "relevance" }).success).toBe(false);
  });

  it("EntitySummary 响应 parse（camelCase）", () => {
    expect(
      entitySummarySchema.parse({
        id: "char-1",
        type: "character",
        name: "张三",
        summary: { role: "主角", status: "alive" },
        createdAt: "2026-08-01T10:00:00Z",
        updatedAt: "2026-08-01T10:00:00Z",
      }).summary.role,
    ).toBe("主角");
  });

  it("详情响应 parse：entityDetailResSchema（relations/deltaCount 形状，S3.3 锁定）", () => {
    const detail = entityDetailResSchema.parse({
      id: "char-1",
      type: "character",
      name: "张三",
      data: { role: "主角" },
      relations: [
        {
          id: "rel-1",
          sourceType: "character",
          sourceId: "char-1",
          sourceName: "张三",
          targetType: "character",
          targetId: "char-2",
          targetName: "李四",
          relationType: "ally",
          createdAt: "2026-08-01T10:00:00Z",
        },
      ],
      deltaCount: 3,
      createdAt: "2026-08-01T10:00:00Z",
      updatedAt: "2026-08-01T10:00:00Z",
    });
    expect(detail.relations).toHaveLength(1);
    expect(detail.deltaCount).toBe(3);
 // relations 元素按 relationRecordSchema 校验（双向紧邻查询的两种方向同构）
    expect(detail.relations[0]).toMatchObject({ sourceId: "char-1", targetId: "char-2", relationType: "ally" });
  });

  it("列表响应 parse：entityListResSchema（items/total/offset/limit）", () => {
    const list = entityListResSchema.parse({
      items: [
        { id: "char-1", type: "character", name: "张三", summary: {}, createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z" },
      ],
      total: 1,
      offset: 0,
      limit: 50,
    });
    expect(list.total).toBe(1);
    expect(list.items[0].name).toBe("张三");
  });

  it("删除响应 parse：entityDeleteResSchema（cascaded 级联计数形状）", () => {
    const del = entityDeleteResSchema.parse({
      deleted: true,
      cascaded: { relations: 2, deltas: 1 },
    });
    expect(del.cascaded).toEqual({ relations: 2, deltas: 1 });
  });

  it("更新响应 parse：entityUpdateResSchema", () => {
    expect(entityUpdateResSchema.parse({ id: "char-1", updated: true }).updated).toBe(true);
  });
});

describe("event 时间轴", () => {
  it("eventDataSchema：description/tags 全字段通过（字段名 snake_case）", () => {
    const parsed = eventDataSchema.parse({
      description: "张三在藏经阁发现玉佩",
      tags: ["主线", "伏笔"],
    });
    expect(parsed).toEqual({
      description: "张三在藏经阁发现玉佩",
      tags: ["主线", "伏笔"],
    });
  });

  it("eventDataSchema：空对象合法；tags 非字符串数组拒绝；未知字段保留透传（.passthrough）", () => {
    expect(eventDataSchema.parse({})).toEqual({});
    expect(eventDataSchema.safeParse({ tags: "主线" }).success).toBe(false);
    expect(eventDataSchema.safeParse({ tags: [1] }).success).toBe(false);
    const parsed = eventDataSchema.parse({ description: "x", custom_field: { a: 1 } });
    expect(parsed).toEqual({ description: "x", custom_field: { a: 1 } });
  });

  it("ENTITY_DATA_SCHEMAS 注册 event → eventDataSchema（服务端按 type 选用精校验）", () => {
    expect(ENTITY_DATA_SCHEMAS.event).toBe(eventDataSchema);
  });

  it("characterDataSchema：新字段（description/alias/race/ability_panel）通过，personality 仍为字符串数组", () => {
    const parsed = characterDataSchema.parse({
      role: "主角",
      description: "青云门最小弟子，灵根被夺",
      alias: "阿九",
      gender: "男",
      age: 17,
      race: "人族",
      personality: ["坚韧", "孤僻"],
      motivation: "查明灵根被夺真相",
      ability_panel: [{ name: "火系", children: [{ name: "等级", value: 3 }, { name: "熟练度" }] }],
    });
    expect(parsed.alias).toBe("阿九");
    expect(parsed.race).toBe("人族");
    expect(parsed.ability_panel).toEqual([
      { name: "火系", children: [{ name: "等级", value: 3 }, { name: "熟练度" }] },
    ]);
    expect(characterDataSchema.safeParse({ personality: "坚韧" }).success).toBe(false); // 须数组
  });

  it("characterDataSchema：ability_panel 宽校验——任意结构（对象/字符串/坏元素）都不拒绝写入", () => {
 // 面板是用户自定义字段树，结构防御在读取端（shared parseAbilityPanel），服务端绝不因此 400
    expect(characterDataSchema.safeParse({ ability_panel: { nope: 1 } }).success).toBe(true);
    expect(characterDataSchema.safeParse({ ability_panel: "脏" }).success).toBe(true);
    expect(characterDataSchema.safeParse({ ability_panel: [{ name: 1 }, null, 3] }).success).toBe(true);
    expect(characterDataSchema.parse({ ability_panel: {} }).ability_panel).toEqual({});
  });

  it("characterDataSchema：status 不再声明（旧残留由 .passthrough 容错，不参与新字段集）", () => {
    expect(Object.keys(characterDataSchema.shape)).not.toContain("status");
    expect(Object.keys(characterDataSchema.shape)).not.toContain("abilities");
    expect(Object.keys(characterDataSchema.shape)).toContain("ability_panel"); // 客户端字段清单编译期断言依赖
 // 旧数据/旧客户端带 status 仍能写入（passthrough 兜底），但不被解析/展示
    expect(characterDataSchema.parse({ role: "主角", status: "活跃" })).toEqual({
      role: "主角",
      status: "活跃",
    });
  });

  it("characterDataSchema：priority 档位枚举——合法档位 / null（= 未分级，PUT 清除语义）通过，缺失可选，非法字符串拒绝", () => {
    for (const priority of CHARACTER_PRIORITIES) {
      expect(characterDataSchema.parse({ priority }).priority).toBe(priority);
    }
    expect(characterDataSchema.parse({ priority: null }).priority).toBeNull();
    expect(characterDataSchema.parse({}).priority).toBeUndefined();
    expect(characterDataSchema.safeParse({ priority: "" }).success).toBe(false); // 空串不是档位
    expect(characterDataSchema.safeParse({ priority: "主角色" }).success).toBe(false); // 中文标签不是存储值
    expect(characterDataSchema.safeParse({ priority: "主角" }).success).toBe(false);
  });

  it("entityMoveReqSchema：order 必填非负整数；负数/小数/缺字段拒绝；strict 拒绝未知键", () => {
    expect(entityMoveReqSchema.parse({ order: 3 }).order).toBe(3);
    expect(entityMoveReqSchema.safeParse({ order: -1 }).success).toBe(false);
    expect(entityMoveReqSchema.safeParse({ order: 1.5 }).success).toBe(false);
    expect(entityMoveReqSchema.safeParse({}).success).toBe(false);
    expect(entityMoveReqSchema.safeParse({ order: 3, parent_id: "root" }).success).toBe(false);

  });

  it("settingMoveReqSchema：parent_id 必填 nullable；order 可选非负整数；strict 拒绝未知键", () => {
    expect(settingMoveReqSchema.parse({ parent_id: null }).parent_id).toBeNull();
    expect(settingMoveReqSchema.parse({ parent_id: "set-1", order: 3 }).order).toBe(3);
    expect(settingMoveReqSchema.safeParse({ parent_id: 1 }).success).toBe(false); // 非字符串
    expect(settingMoveReqSchema.safeParse({ order: -1 }).success).toBe(false); // 缺 parent_id + 负数
    expect(settingMoveReqSchema.safeParse({ parent_id: null, order: 1.5 }).success).toBe(false); // 小数
    expect(settingMoveReqSchema.safeParse({ parent_id: null, extra: 1 }).success).toBe(false); // strict
  });

  it("entityMoveResSchema：{ moved: true } 字面量（响应 200）", () => {
    expect(entityMoveResSchema.parse({ moved: true })).toEqual({ moved: true });
    expect(entityMoveResSchema.safeParse({ moved: false }).success).toBe(false);
  });
});

describe("relation 端点", () => {
  it("查询：depth 枚举 1|2|3——4 拒绝、2 通过（coerce 字符串入参）", () => {
    expect(relationQuerySchema.safeParse({ depth: 4 }).success).toBe(false);
    expect(relationQuerySchema.parse({ depth: "2" }).depth).toBe(2);
    expect(relationQuerySchema.safeParse({}).success).toBe(false); // depth 必填
  });

  it("创建：relation_type 自由字符串（自定义类型通过；语法非法拒绝——共享纯函数同源校验）", () => {
    const valid = {
      source_type: "character",
      source_id: "char-1",
      target_type: "outline_node",
      target_id: "sc-5",
      relation_type: "appears_in",
    };
    expect(relationCreateReqSchema.parse(valid).relation_type).toBe("appears_in");
 // 自定义类型（不在 RELATION_TYPES 里的中文类型名）→ 接受，且去首尾空白
    expect(
      relationCreateReqSchema.parse({ ...valid, relation_type: " 宿敌 " }).relation_type,
    ).toBe("宿敌");
 // 语法非法：空 / 超 32 字 / 控制字符 → 拒绝（中文错误消息）
    const empty = relationCreateReqSchema.safeParse({ ...valid, relation_type: "  " });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.message).toBe("关系类型不能为空");
    const tooLong = relationCreateReqSchema.safeParse({ ...valid, relation_type: "宿".repeat(33) });
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.message).toBe("关系类型不能超过 32 个字符");
    const control = relationCreateReqSchema.safeParse({ ...valid, relation_type: "宿\u0000敌" });
    expect(control.success).toBe(false);
    expect(control.error?.issues[0]?.message).toBe("关系类型不能包含控制字符");
  });

  it("更新元数据：metadata 必填整体替换；{} 清空通过；未知键拒绝（strict）", () => {
    expect(relationUpdateMetaReqSchema.parse({ metadata: { label: "新标签" } }).metadata).toEqual({ label: "新标签" });
    expect(relationUpdateMetaReqSchema.parse({ metadata: {} }).metadata).toEqual({});
    expect(relationUpdateMetaReqSchema.safeParse({}).success).toBe(false); // metadata 必填
    expect(relationUpdateMetaReqSchema.safeParse({ metadata: { label: "x" }, source_id: "sc-1" }).success).toBe(false); // strict 拒绝未知键
  });
});

describe("delta 端点", () => {
  it("changes[].op 枚举：非法 op 拒绝；四种合法 op 通过", () => {
    expect(deltaChangeSchema.safeParse({ field: "a", op: "replace", to: 1 }).success).toBe(false);
    for (const op of ["set", "update", "add", "remove"] as const) {
      expect(deltaChangeSchema.parse({ field: "a", op }).op).toBe(op);
    }
  });

  it("追加：changes 空数组拒绝；node_id 必填（snake_case）", () => {
    expect(deltaCreateReqSchema.safeParse({ node_id: "sc-1", target_type: "character", target_id: "char-1", changes: [], description: "x" }).success).toBe(false);
    expect(deltaCreateReqSchema.safeParse({ target_type: "character", target_id: "char-1", changes: [{ field: "a", op: "set", to: 1 }], description: "x" }).success).toBe(false);
 // camelCase 键被 strict 拒绝
    expect(deltaCreateReqSchema.safeParse({ nodeId: "sc-1", target_type: "character", target_id: "char-1", changes: [{ field: "a", op: "set", to: 1 }], description: "x" }).success).toBe(false);
  });

  it("compute：at_node_id 必填；响应含 appliedDeltas/conflicts", () => {
    expect(deltaComputeReqSchema.safeParse({ target_type: "character", target_id: "char-1" }).success).toBe(false);
    expect(
      deltaComputeReqSchema.parse({ target_type: "character", target_id: "char-1", at_node_id: "sc-30" }).at_node_id,
    ).toBe("sc-30");
  });
});

describe("outline 端点", () => {
  it("创建：parent_id 必填（无默认值）", () => {
    expect(outlineCreateReqSchema.safeParse({ type: "scene", title: "灵根测试" }).success).toBe(false);
  });

  it("创建：title 空 / 超 200 字符拒绝；合法通过", () => {
    expect(outlineCreateReqSchema.safeParse({ type: "scene", title: "", parent_id: "ch-1" }).success).toBe(false);
    expect(outlineCreateReqSchema.safeParse({ type: "scene", title: "a".repeat(201), parent_id: "ch-1" }).success).toBe(false);
    const req = outlineCreateReqSchema.parse({ type: "scene", title: "灵根测试", parent_id: "ch-1", summary: "测试" });
    expect(req.parent_id).toBe("ch-1");
  });

  it("查询 with_metadata：显式 false → false（回归：z.coerce.boolean 会把 \"false\" 解析为 true）", () => {
    expect(outlineGetQuerySchema.parse({ with_metadata: "false" }).with_metadata).toBe(false);
    expect(outlineGetQuerySchema.parse({ with_metadata: "true" }).with_metadata).toBe(true);
 // 不传 → undefined（默认关闭 metadata 统计语义）
    expect(outlineGetQuerySchema.parse({}).with_metadata).toBeUndefined();
 // 非法值拒绝（enum 方案）
    expect(outlineGetQuerySchema.safeParse({ with_metadata: "yes" }).success).toBe(false);
  });

  it("创建/更新：data 为宽松 record 可选字段（精校验在服务端路由层）", () => {
    const req = outlineCreateReqSchema.parse({
      type: "scene",
      title: "灵根测试",
      parent_id: "ch-1",
      data: { goal: "确认灵根品质", conflict_levels: ["inner", "personal"] },
    });
    expect(req.data).toEqual({ goal: "确认灵根品质", conflict_levels: ["inner", "personal"] });
 // 更新：data 可选（部分合并语义由服务端保证）
    expect(
      outlineUpdateReqSchema.parse({ data: { goal: "新目标" } }).data,
    ).toEqual({ goal: "新目标" });
 // 不传 data 合法
    expect(outlineUpdateReqSchema.safeParse({ title: "x" }).success).toBe(true);
  });

  it("响应节点 schema：data 可选且原样透传", () => {
 // outlineNodeSchema 为 lazy 递归 schema（ZodTypeAny），parse 结果用 safeParse + 断言收窄
    const parsed = outlineNodeSchema.safeParse({
      id: "sc-1",
      type: "scene",
      title: "灵根测试失败",
      updatedAt: "2026-08-01T10:00:00Z",
      data: { goal: "确认灵根品质", value_from: "希望", value_to: "绝望" },
    });
    expect(parsed.success).toBe(true);
    expect((parsed.data as { data?: Record<string, unknown> }).data).toEqual({
      goal: "确认灵根品质",
      value_from: "希望",
      value_to: "绝望",
    });
  });

  it("整树响应：三层示例 parse 通过（递归 children）", () => {
    const tree = outlineTreeSchema.parse({
      id: "root",
      type: "root",
      schemaVersion: 1,
      children: [
        {
          id: "vol-1",
          type: "volume",
          title: "第一卷",
          updatedAt: "2026-08-01T10:00:00Z",
          children: [
            {
              id: "ch-1",
              type: "chapter",
              title: "第一章",
              updatedAt: "2026-08-01T10:00:00Z",
              children: [
                { id: "sc-1", type: "scene", title: "灵根测试失败", updatedAt: "2026-08-01T10:00:00Z" },
              ],
            },
          ],
        },
      ],
    });
 // 递归结构断言（toMatchObject 避免依赖递归 schema 的推断类型）
    expect(tree).toMatchObject({
      id: "root",
      schemaVersion: 1,
      children: [{ id: "vol-1", type: "volume", children: [{ id: "ch-1", type: "chapter", children: [{ id: "sc-1", type: "scene", title: "灵根测试失败" }] }] }],
    });
  });
});

describe("OUTLINE_NODE_DATA_SCHEMAS", () => {
  it("scene：麦基字段集全字段通过（goal/conflict_levels/value_from/value_to）", () => {
    const parsed = OUTLINE_NODE_DATA_SCHEMAS.scene.parse({
      goal: "确认灵根品质",
      conflict_levels: ["inner", "personal", "extra_personal"],
      value_from: "希望",
      value_to: "绝望",
    });
    expect(parsed).toEqual({
      goal: "确认灵根品质",
      conflict_levels: ["inner", "personal", "extra_personal"],
      value_from: "希望",
      value_to: "绝望",
    });
  });

  it("scene：conflict_levels 非法枚举 / goal 超 1000 字符拒绝", () => {
    expect(OUTLINE_NODE_DATA_SCHEMAS.scene.safeParse({ conflict_levels: ["social"] }).success).toBe(false);
    expect(OUTLINE_NODE_DATA_SCHEMAS.scene.safeParse({ goal: "a".repeat(1001) }).success).toBe(false);
    expect(OUTLINE_NODE_DATA_SCHEMAS.scene.safeParse({ value_from: "a".repeat(201) }).success).toBe(false);
  });

  it("scene：value_to 超 200 字符拒绝（与 value_from 同限，麦基「收场价值」）", () => {
    expect(OUTLINE_NODE_DATA_SCHEMAS.scene.safeParse({ value_to: "a".repeat(201) }).success).toBe(false);
 // 边界 200 合法
    expect(OUTLINE_NODE_DATA_SCHEMAS.scene.parse({ value_to: "a".repeat(200) }).value_to).toHaveLength(200);
  });

  it("chapter：reversal/climax_scene 通过；reversal 超 1000 拒绝；引用字段仅类型校验（宽松）", () => {
    expect(
      OUTLINE_NODE_DATA_SCHEMAS.chapter.parse({ reversal: "张三决定叛出师门", climax_scene: "sc-5" }),
    ).toEqual({ reversal: "张三决定叛出师门", climax_scene: "sc-5" });
    expect(OUTLINE_NODE_DATA_SCHEMAS.chapter.safeParse({ reversal: "a".repeat(1001) }).success).toBe(false);
 // 引用字段指向任意场景 id 均通过（MVP 不校验引用范围）；非字符串拒绝
    expect(OUTLINE_NODE_DATA_SCHEMAS.chapter.safeParse({ climax_scene: "sc-999" }).success).toBe(true);
    expect(OUTLINE_NODE_DATA_SCHEMAS.chapter.safeParse({ climax_scene: 42 }).success).toBe(false);
  });

  it("volume：climax_scene/inciting_scene 通过；非字符串引用拒绝", () => {
    expect(
      OUTLINE_NODE_DATA_SCHEMAS.volume.parse({ climax_scene: "sc-12", inciting_scene: "sc-3" }),
    ).toEqual({ climax_scene: "sc-12", inciting_scene: "sc-3" });
    expect(OUTLINE_NODE_DATA_SCHEMAS.volume.safeParse({ inciting_scene: 7 }).success).toBe(false);
  });

  it("宽松语义与 ENTITY_DATA_SCHEMAS 一致：未知字段保留透传（.passthrough()）", () => {
    const parsed = OUTLINE_NODE_DATA_SCHEMAS.scene.parse({ goal: "x", custom_field: { a: 1 } });
    expect(parsed).toEqual({ goal: "x", custom_field: { a: 1 } });
  });
});

describe("chat 端点", () => {
  it("会话列表项：name（会话名）可选——有名字时回传，缺省省略", () => {
    const base = {
      id: "sess-1",
      lastMessage: "帮我梳理第三章的冲突",
      messageCount: 3,
      createdAt: "2026-08-01T10:00:00Z",
      updatedAt: "2026-08-01T11:00:00Z",
    };
    expect(chatSessionSummarySchema.safeParse(base).success).toBe(true); // 无 name（缺省会话名）
    expect(chatSessionSummarySchema.parse({ ...base, name: "《测试书》写作笔记" }).name).toBe("《测试书》写作笔记");
    expect(chatSessionSummarySchema.safeParse({ ...base, name: 42 }).success).toBe(false);
  });

  it("POST /chat：message 必填；session_id 与 context 可选", () => {
    expect(chatSendReqSchema.safeParse({}).success).toBe(false);
    expect(
      chatSendReqSchema.parse({
        message: "张三在第30章战力如何",
        session_id: "sess_1",
        context: { focus_entity_type: "character", focus_entity_id: "char-1", focus_node_id: "sc-30" },
      }).message,
    ).toBe("张三在第30章战力如何");
  });

  it("POST /chat：context.focus_deduction 可选布尔（非布尔拒绝）——客户端只发布尔标记，不传 id 数组", () => {
    expect(chatSendReqSchema.parse({ message: "推演一下", context: { focus_deduction: true } }).context?.focus_deduction).toBe(true);
    expect(chatSendReqSchema.parse({ message: "推演一下" }).context?.focus_deduction).toBeUndefined();
    expect(chatSendReqSchema.safeParse({ message: "x", context: { focus_deduction: "yes" } }).success).toBe(false);
    expect(chatSendReqSchema.safeParse({ message: "x", context: { focus_deduction: ["ch-1"] } }).success).toBe(false);
  });
});

describe("导出/导入", () => {
  it("导出 zip 三文件名常量与数据文件原名一致（import 侧按此固定名校验）", () => {
    expect(PROJECT_EXPORT_FILE_NAMES).toEqual(["project.json", "outline.json", "data.db"]);
  });

  it("ErrorCode 含 SCHEMA_VERSION_MISMATCH（409：import 版本不匹配拒绝导入，不静默重建）", () => {
    expect(ERROR_CODES).toContain("SCHEMA_VERSION_MISMATCH");
    expect(errorCodeSchema.safeParse("SCHEMA_VERSION_MISMATCH").success).toBe(true);
  });

  it("ErrorCode 含 PROJECT_VERSION_NEWER（409：open 时项目版本高于程序版本，拒绝打开堵降级数据丢失）", () => {
    expect(ERROR_CODES).toContain("PROJECT_VERSION_NEWER");
    expect(errorCodeSchema.safeParse("PROJECT_VERSION_NEWER").success).toBe(true);
  });

  it("import 响应 { imported: true, id, path, name, mode } parse（B2.3 同步：mode 分流字段必填）", () => {
    expect(
      projectImportResSchema.parse({ imported: true, id: "proj-1", path: "/books/我的小说", name: "我的小说", mode: "new" }),
    ).toEqual({ imported: true, id: "proj-1", path: "/books/我的小说", name: "我的小说", mode: "new" });
 // mode 枚举：restored/new 通过（分流），其他值拒绝
    expect(projectImportResSchema.parse({ imported: true, id: "proj-1", path: "/books/我的小说", name: "我的小说", mode: "restored" }).mode).toBe("restored");
    expect(projectImportResSchema.safeParse({ imported: true, id: "proj-1", path: "/x", name: "x", mode: "overwrite" }).success).toBe(false);
 // 收紧：imported 字面量 true、mode 必填、其余字段必填
    expect(projectImportResSchema.safeParse({ imported: false, id: "proj-1", path: "/x", name: "x", mode: "new" }).success).toBe(false);
    expect(projectImportResSchema.safeParse({ imported: true, id: "proj-1", path: "/x", name: "x" }).success).toBe(false); // 缺 mode
    expect(projectImportResSchema.safeParse({ imported: true, id: "proj-1" }).success).toBe(false);
  });
});

describe("settings/llm 端点 schema（pi provider 目录契约）", () => {
  it("GET：provider/model 可为空串（未配置任何可用模型）+ provider 认证状态字段", () => {
    const parsed = settingsLlmGetResSchema.parse({
      provider: "",
      model: "",
      thinkingLevel: "medium",
      providers: [
        {
          id: "deepseek",
          displayName: "DeepSeek",
          authConfigured: false,
          models: [{ id: "deepseek-v4-flash", provider: "deepseek", displayName: "DeepSeek V4 Flash", contextWindow: 64000, maxTokens: 8192, reasoning: false }],
        },
      ],
    });
    expect(parsed.provider).toBe("");
    expect(parsed.providers[0].authConfigured).toBe(false);
    expect(parsed.providers[0].authSource).toBeUndefined();
  });

  it("GET：authSource 可选（有凭据时透传 pi 的来源标识）", () => {
    const parsed = settingsLlmGetResSchema.parse({
      provider: "opencode-go",
      model: "qwen3.7-max",
      thinkingLevel: "high",
      providers: [{ id: "opencode-go", displayName: "OpenCode Go", authConfigured: true, authSource: "stored", models: [] }],
    });
    expect(parsed.providers[0].authSource).toBe("stored");
  });

  it("PUT：provider+model+thinking_level 可选；api_key 单家凭据形状", () => {
    expect(settingsLlmPutReqSchema.parse({ provider: "deepseek", model: "deepseek-v4-flash" })).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-flash",
    });
    expect(settingsLlmPutReqSchema.parse({ api_key: { provider: "deepseek", key: "" } })).toEqual({
      api_key: { provider: "deepseek", key: "" },
    });
    expect(settingsLlmPutReqSchema.parse({})).toEqual({});
  });

  it("PUT：strict——旧的 api_keys 映射 / 裸 api_key 字符串都被拒绝", () => {
    expect(settingsLlmPutReqSchema.safeParse({ api_keys: { deepseek: "sk-x" } }).success).toBe(false);
    expect(settingsLlmPutReqSchema.safeParse({ api_key: "sk-x" }).success).toBe(false);
    expect(settingsLlmPutReqSchema.safeParse({ api_key: { provider: "deepseek" } }).success).toBe(false);
    expect(settingsLlmPutReqSchema.safeParse({ thinking_level: "bogus" }).success).toBe(false);
    expect(settingsLlmPutReqSchema.safeParse({ model: 42 }).success).toBe(false);
  });
});

/** 构造合法 ProjectConfig 测试数据（prompt 已废弃，不再包含） */
function validConfig() {
  return {
    id: "proj-1",
    name: "我的小说",
    language: "zh" as const,
    schemaVersion: 1,
    currentPosition: "sc-42",
    deductionNodes: [], // （D1 新增字段）
    backupFrequencyMinutes: 10,
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T10:00:00Z",
  };
}
