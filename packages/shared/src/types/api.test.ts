// API 契约 schema 测试（T1.4）：按 endpoints.md 示例做 parse 通过与拒绝用例
import { describe, expect, it } from "vitest";
import {
  ENTITY_DATA_SCHEMAS,
  ERROR_CODES,
  OUTLINE_NODE_DATA_SCHEMAS,
  PROJECT_EXPORT_FILE_NAMES,
  apiErrorSchema,
  chatSendReqSchema,
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
  sseDoneEventSchema,
  sseProposalEventSchema,
  sseToolCallEventSchema,
  sseToolResultEventSchema,
  userConfigFileSchema,
} from "./api.js";

describe("ErrorCode 完整性（endpoints.md 错误码对照）", () => {
  it("包含 endpoints.md 全部 10 个现行错误码", () => {
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

  it("补充码（tools.md 决策 15）：工具结果截断 + agent 终止", () => {
    expect(ERROR_CODES).toContain("TOOL_RESULT_TOO_LARGE");
    expect(ERROR_CODES).toContain("AGENT_MAX_ITERATIONS");
    expect(ERROR_CODES).toContain("AGENT_TIMEOUT");
    expect(ERROR_CODES).toContain("AGENT_TOKEN_BUDGET");
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
  it("projectConfigSchema：endpoints.md 示例响应 parse 通过（prompt 已废弃决策 41 不再返回）", () => {
    const config = projectConfigSchema.parse({
      id: "proj-1",
      name: "我的小说",
      language: "zh",
      schemaVersion: 1,
      currentPosition: "sc-42",
      backupFrequencyMinutes: 10,
      createdAt: "2026-08-01T10:00:00Z",
      updatedAt: "2026-08-01T10:00:00Z",
    });
    expect(config.currentPosition).toBe("sc-42");
  });

  it("projectConfigUpdateReqSchema：prompt 已废弃（决策 41）strict 拒绝", () => {
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

  it("projectConfigUpdateReqSchema：backup_frequency_minutes 接受枚举值/null/省略，拒绝其他（决策 27 + 批次十四修订加 1 分钟档）", () => {
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

  it("projectBackupReqSchema：仅形状校验（决策 28 + oracle P2-1——名称规则权威判定在 sanitizeBackupName，schema 不重复判长）", () => {
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

  it("projectListResSchema：合法响应 parse 通过（books 数组、倒序语义由服务端保证）", () => {
    const res = projectListResSchema.parse({
      rootPath: "/home/me/bookshelf",
      books: [
        { name: "第二本", path: "/home/me/bookshelf/books/第二本", updatedAt: "2026-08-02T10:00:00Z" },
        { name: "第一本", path: "/home/me/bookshelf/books/第一本", updatedAt: "2026-08-01T10:00:00Z" },
      ],
    });
    expect(res.rootPath).toBe("/home/me/bookshelf");
    expect(res.books).toHaveLength(2);
    expect(res.books[0].name).toBe("第二本");
  });

  it("projectListResSchema：books 为空数组合法；缺字段/类型不符拒绝", () => {
    // 空书架合法
    expect(projectListResSchema.parse({ rootPath: "/x", books: [] }).books).toEqual([]);
    // 书缺 updatedAt → 拒绝
    expect(
      projectListResSchema.safeParse({
        rootPath: "/x",
        books: [{ name: "书", path: "/x/books/书" }],
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

describe("event 时间轴契约（决策 26）", () => {
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

  it("entityMoveReqSchema：order 必填非负整数；负数/小数/缺字段拒绝；strict 拒绝未知键", () => {
    expect(entityMoveReqSchema.parse({ order: 3 }).order).toBe(3);
    expect(entityMoveReqSchema.safeParse({ order: -1 }).success).toBe(false);
    expect(entityMoveReqSchema.safeParse({ order: 1.5 }).success).toBe(false);
    expect(entityMoveReqSchema.safeParse({}).success).toBe(false);
    expect(entityMoveReqSchema.safeParse({ order: 3, parent_id: "root" }).success).toBe(false);

  });

  it("settingMoveReqSchema（决策 46）：parent_id 必填 nullable；order 可选非负整数；strict 拒绝未知键", () => {
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

  it("创建：relation_type 限定预定义 16 种——非预定义拒绝", () => {
    const valid = {
      source_type: "character",
      source_id: "char-1",
      target_type: "outline_node",
      target_id: "sc-5",
      relation_type: "appears_in",
    };
    expect(relationCreateReqSchema.parse(valid).relation_type).toBe("appears_in");
    expect(relationCreateReqSchema.safeParse({ ...valid, relation_type: "teleports_to" }).success).toBe(false);
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
  it("创建：parent_id 必填（决策 19 无默认值）", () => {
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

  it("创建/更新：data 为宽松 record 可选字段（决策 23，精校验在服务端路由层）", () => {
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

  it("响应节点 schema：data 可选且原样透传（schema.md 示例）", () => {
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

  it("整树响应：schema.md 三层示例 parse 通过（递归 children）", () => {
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

describe("OUTLINE_NODE_DATA_SCHEMAS（决策 23，麦基字段集，schema.md outline.json 节）", () => {
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

  it("chapter：reversal/climax_scene 通过；reversal 超 1000 拒绝；引用字段仅类型校验（宽松，决策 23）", () => {
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
});

describe("SSE 事件（endpoints.md 第 738-765 行）", () => {
  it("tool_call / tool_result / proposal / done 事件 data parse", () => {
    expect(sseToolCallEventSchema.parse({ tool: "get_entity", args: { type: "character", id: "char-1" }, id: "call_1" }).id).toBe("call_1");
    expect(sseToolResultEventSchema.parse({ tool: "get_entity", result: { id: "char-1" }, id: "call_1" }).tool).toBe("get_entity");
    expect(
      sseProposalEventSchema.parse({ proposal_id: "prop_1", type: "propose_create_entity", preview: { name: "李四" } }).proposal_id,
    ).toBe("prop_1");
    expect(sseDoneEventSchema.parse({ session_id: "sess_1" }).session_id).toBe("sess_1");
  });
});

describe("导出/导入契约（E1，release-review §二）", () => {
  it("导出 zip 三文件名常量与数据文件原名一致（import 侧按此固定名校验）", () => {
    expect(PROJECT_EXPORT_FILE_NAMES).toEqual(["project.json", "outline.json", "data.db"]);
  });

  it("ErrorCode 含 SCHEMA_VERSION_MISMATCH（409：import 版本不匹配拒绝导入，不静默重建）", () => {
    expect(ERROR_CODES).toContain("SCHEMA_VERSION_MISMATCH");
    expect(errorCodeSchema.safeParse("SCHEMA_VERSION_MISMATCH").success).toBe(true);
  });

  it("ErrorCode 含 PROJECT_VERSION_NEWER（409：open 时项目版本高于程序版本，E4 拒绝打开堵降级数据丢失）", () => {
    expect(ERROR_CODES).toContain("PROJECT_VERSION_NEWER");
    expect(errorCodeSchema.safeParse("PROJECT_VERSION_NEWER").success).toBe(true);
  });

  it("import 响应 { imported: true, id, path, name, mode } parse（B2.3 契约同步：mode 分流字段必填）", () => {
    expect(
      projectImportResSchema.parse({ imported: true, id: "proj-1", path: "/books/我的小说", name: "我的小说", mode: "new" }),
    ).toEqual({ imported: true, id: "proj-1", path: "/books/我的小说", name: "我的小说", mode: "new" });
    // mode 枚举：restored/new 通过（决策 27 分流），其他值拒绝
    expect(projectImportResSchema.parse({ imported: true, id: "proj-1", path: "/books/我的小说", name: "我的小说", mode: "restored" }).mode).toBe("restored");
    expect(projectImportResSchema.safeParse({ imported: true, id: "proj-1", path: "/x", name: "x", mode: "overwrite" }).success).toBe(false);
    // 契约收紧：imported 字面量 true、mode 必填、其余字段必填
    expect(projectImportResSchema.safeParse({ imported: false, id: "proj-1", path: "/x", name: "x", mode: "new" }).success).toBe(false);
    expect(projectImportResSchema.safeParse({ imported: true, id: "proj-1", path: "/x", name: "x" }).success).toBe(false); // 缺 mode
    expect(projectImportResSchema.safeParse({ imported: true, id: "proj-1" }).success).toBe(false);
  });
});

describe("userConfigFileSchema（决策 48，批次十四：~/.ai-editor/config.json schema v1）", () => {
  it("v1 全字段 parse（schema_version=1 + model + thinking_level + api_key）", () => {
    const parsed = userConfigFileSchema.parse({
      schema_version: 1,
      model: "deepseek-v4-flash",
      thinking_level: "high",
      api_key: "sk-xxx",
    });
    expect(parsed).toEqual({
      schema_version: 1,
      model: "deepseek-v4-flash",
      thinking_level: "high",
      api_key: "sk-xxx",
    });
  });

  it("v0 旧格式（无 schema_version）直接兼容：与 v1 同结构读取，不迁移不写回", () => {
    const parsed = userConfigFileSchema.parse({ model: "deepseek-v4-flash", api_key: "sk-xxx" });
    expect(parsed.schema_version).toBeUndefined();
    expect(parsed.model).toBe("deepseek-v4-flash");
  });

  it("空对象 parse 成功（所有字段可选）", () => {
    expect(userConfigFileSchema.parse({})).toEqual({});
  });

  it("宽松读取：未知字段保留不拒绝（用户自有文件，未来版本追加字段不应使整份配置失效）", () => {
    const parsed = userConfigFileSchema.parse({ model: "x", future_field: 42 });
    expect(parsed.future_field).toBe(42);
  });

  it("非法值拒绝：thinking_level 非枚举、model 非字符串、schema_version 非 1", () => {
    expect(userConfigFileSchema.safeParse({ thinking_level: "bogus" }).success).toBe(false);
    expect(userConfigFileSchema.safeParse({ model: 42 }).success).toBe(false);
    expect(userConfigFileSchema.safeParse({ schema_version: 2 }).success).toBe(false);
  });
});

/** 构造合法 ProjectConfig 测试数据（prompt 已废弃决策 41，不再包含） */
function validConfig() {
  return {
    id: "proj-1",
    name: "我的小说",
    language: "zh" as const,
    schemaVersion: 1,
    currentPosition: "sc-42",
    backupFrequencyMinutes: 10,
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T10:00:00Z",
  };
}
