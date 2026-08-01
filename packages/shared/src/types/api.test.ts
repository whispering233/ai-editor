// API 契约 schema 测试（T1.4）：按 endpoints.md 示例做 parse 通过与拒绝用例
import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  apiErrorSchema,
  chatSendReqSchema,
  deltaChangeSchema,
  deltaComputeReqSchema,
  deltaCreateReqSchema,
  entityCreateReqSchema,
  entityListQuerySchema,
  entitySummarySchema,
  errorCodeSchema,
  outlineCreateReqSchema,
  outlineGetQuerySchema,
  outlineTreeSchema,
  projectConfigSchema,
  relationCreateReqSchema,
  relationQuerySchema,
  sseDoneEventSchema,
  sseProposalEventSchema,
  sseToolCallEventSchema,
  sseToolResultEventSchema,
} from "./api";

describe("ErrorCode 完整性（endpoints.md 错误码对照）", () => {
  it("包含 endpoints.md 全部 10 个现行错误码", () => {
    for (const code of [
      "VALIDATION_ERROR",
      "ENTITY_NOT_FOUND",
      "RELATION_EXISTS",
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
  it("projectConfigSchema：endpoints.md 示例响应 parse 通过", () => {
    const config = projectConfigSchema.parse({
      id: "proj-1",
      name: "我的小说",
      language: "zh",
      prompt: "力量体系：练气→筑基→金丹",
      schemaVersion: 1,
      currentPosition: "sc-42",
      createdAt: "2026-08-01T10:00:00Z",
      updatedAt: "2026-08-01T10:00:00Z",
    });
    expect(config.currentPosition).toBe("sc-42");
  });

  it("language 非法拒绝；currentPosition null 允许", () => {
    expect(projectConfigSchema.safeParse({ ...validConfig(), language: "fr" }).success).toBe(false);
    expect(projectConfigSchema.parse({ ...validConfig(), currentPosition: null }).currentPosition).toBeNull();
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

/** 构造合法 ProjectConfig 测试数据 */
function validConfig() {
  return {
    id: "proj-1",
    name: "我的小说",
    language: "zh" as const,
    prompt: "力量体系",
    schemaVersion: 1,
    currentPosition: "sc-42",
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T10:00:00Z",
  };
}
