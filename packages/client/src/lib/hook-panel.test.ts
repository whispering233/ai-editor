// hook-panel 纯函数与复合写编排测试（S9.1）：
// 分组逻辑、依赖链解析（含环守卫/深度限制）、废弃锚点、复合写请求序列（delta → relation → status 同步）
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EntitySummary, OutlineTree, ProjectConfig } from "@whispering233/ai-editor-shared";
import { ApiError, type RelationSummaryItem } from "./api";

// 部分 mock api：保留 ApiError 真实实现，替换写函数为 spy（断言调用序列与请求体形状）
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    createDelta: vi.fn(),
    createRelation: vi.fn(),
    updateEntity: vi.fn(),
  };
});

import {
  anchorNodeForAbandon,
  buildLifecycleRelationBody,
  buildPlantRelationBody,
  buildStatusDeltaChange,
  buildStatusSyncData,
  currentHookStatus,
  dependentsCount,
  dependencyNames,
  expandDependencyChain,
  groupHooksByStatus,
  hookGroupOf,
  involvesNames,
  lastOutlineNode,
  nodeExists,
  runAbandonWrite,
  runLifecycleWrite,
} from "./hook-panel";
import { createDelta, createRelation, updateEntity } from "./api";

const mocked = {
  createDelta: vi.mocked(createDelta),
  createRelation: vi.mocked(createRelation),
  updateEntity: vi.mocked(updateEntity),
};

afterEach(() => {
  vi.clearAllMocks();
});

// ============ fixture ============

/** 列表摘要（summary 字段仅传测试需要的键） */
function summaryOf(id: string, name: string, status: unknown): EntitySummary {
  return {
    id,
    type: "hook",
    name,
    summary: status === undefined ? {} : { status },
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T10:00:00Z",
  };
}

/** 关系 fixture（默认 depends_on：source 依赖 target——hooks.md「B 依赖 A 先解开」） */
function rel(
  sourceId: string,
  targetId: string,
  relationType = "depends_on",
  names?: { s?: string; t?: string },
): RelationSummaryItem {
  return {
    id: `rel-${sourceId}-${targetId}`,
    sourceType: relationType === "depends_on" ? "hook" : "outline_node",
    sourceId,
    sourceName: names?.s,
    targetType: "hook",
    targetId,
    targetName: names?.t,
    relationType,
    createdAt: "2026-08-01T10:00:00Z",
  };
}

const makeTree = (): OutlineTree => ({
  id: "root",
  type: "root",
  schemaVersion: 1,
  children: [
    {
      id: "vol-1",
      type: "volume",
      title: "第一卷",
      updatedAt: "t",
      children: [
        {
          id: "ch-1",
          type: "chapter",
          title: "第一章",
          updatedAt: "t",
          children: [
            { id: "sc-1", type: "scene", title: "场景一", updatedAt: "t" },
            { id: "sc-2", type: "scene", title: "场景二", updatedAt: "t" },
          ],
        },
      ],
    },
    {
      id: "vol-2",
      type: "volume",
      title: "第二卷",
      updatedAt: "t",
      children: [{ id: "ch-2", type: "chapter", title: "第二章", updatedAt: "t" }],
    },
  ],
});

const makeConfig = (currentPosition: string | null): ProjectConfig => ({
  id: "proj-1",
  name: "我的小说",
  language: "zh",
  schemaVersion: 1,
  currentPosition,
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z",
});

// ============ 分组逻辑 ============

describe("hookGroupOf（状态 → 分组）", () => {
  it("planted/progressing → 活跃；resolved → 已回收；abandoned → 已废弃", () => {
    expect(hookGroupOf("planted")).toBe("active");
    expect(hookGroupOf("progressing")).toBe("active");
    expect(hookGroupOf("resolved")).toBe("resolved");
    expect(hookGroupOf("abandoned")).toBe("abandoned");
  });

  it("缺失/未知状态归活跃（决策 21：data.status 缺失视为 planted——创建即埋设）", () => {
    expect(hookGroupOf(undefined)).toBe("active");
    expect(hookGroupOf("custom_state")).toBe("active");
  });
});

describe("groupHooksByStatus（伏笔池按状态分组）", () => {
  it("三组按状态归位（含缺失状态伏笔落活跃组）", () => {
    const groups = groupHooksByStatus([
      summaryOf("hook-1", "身世之谜", "planted"),
      summaryOf("hook-2", "玉佩来历", "progressing"),
      summaryOf("hook-3", "灵根测试", "resolved"),
      summaryOf("hook-4", "废弃线索", "abandoned"),
      summaryOf("hook-5", "无状态", undefined),
    ]);
    expect(groups.active.map((h) => h.id)).toEqual(["hook-1", "hook-2", "hook-5"]);
    expect(groups.resolved.map((h) => h.id)).toEqual(["hook-3"]);
    expect(groups.abandoned.map((h) => h.id)).toEqual(["hook-4"]);
  });

  it("空列表 → 三组皆空", () => {
    const groups = groupHooksByStatus([]);
    expect(groups.active).toEqual([]);
    expect(groups.resolved).toEqual([]);
    expect(groups.abandoned).toEqual([]);
  });
});

// ============ 关系解析 ============

describe("依赖关系解析（depends_on：source 依赖 target）", () => {
  const relations = [
    rel("hook-2", "hook-1", "depends_on", { s: "玉佩来历", t: "身世之谜" }), // 玉佩来历 依赖 身世之谜
    rel("hook-3", "hook-2", "depends_on", { s: "断剑认主", t: "玉佩来历" }), // 断剑认主 依赖 玉佩来历
    rel("sc-5", "hook-1", "plants", { s: "入梦", t: "身世之谜" }),
  ];

  it("dependencyNames：本伏笔依赖的伏笔名（sourceId === hookId → targetName）", () => {
    expect(dependencyNames(relations, "hook-2")).toEqual(["身世之谜"]);
    expect(dependencyNames(relations, "hook-3")).toEqual(["玉佩来历"]);
    expect(dependencyNames(relations, "hook-1")).toEqual([]);
  });

  it("dependentNames/dependentsCount：依赖本伏笔的伏笔（targetId === hookId）", () => {
    expect(dependentsCount(relations, "hook-1")).toBe(1);
    expect(dependentsCount(relations, "hook-2")).toBe(1);
    expect(dependentsCount(relations, "hook-3")).toBe(0);
  });

  it("targetName 缺省时回退 targetId（联表名可能缺失）", () => {
    expect(dependencyNames([rel("hook-2", "hook-9")], "hook-2")).toEqual(["hook-9"]);
  });

  it("involvesNames：取另一端名称；任一端为本伏笔均可", () => {
    const involves = [
      rel("hook-1", "char-3", "involves", { s: "身世之谜", t: "苏眉" }),
      rel("set-7", "hook-1", "involves", { s: "云梦泽", t: "身世之谜" }),
    ];
    expect(involvesNames(involves, "hook-1")).toEqual(["苏眉", "云梦泽"]);
  });
});

// ============ 依赖链展开 ============

describe("expandDependencyChain（递归依赖链，点击行内「依赖: …」展开）", () => {
  /** 构造 depsOf/names 映射：edges = 直接依赖边（source 依赖 target） */
  function mapsFor(edges: Array<[string, string, string]>): {
    depsOf: Map<string, RelationSummaryItem[]>;
    names: Map<string, string>;
  } {
    const depsOf = new Map<string, RelationSummaryItem[]>();
    const names = new Map<string, string>();
    for (const [src, tgt, name] of edges) {
      const r = rel(src, tgt, "depends_on", { s: name });
      depsOf.set(src, [...(depsOf.get(src) ?? []), r]);
      names.set(src, name);
      if (!names.has(tgt)) names.set(tgt, `名-${tgt}`);
    }
    return { depsOf, names };
  }

  it("链式展开：起点 → 依赖 → 依赖的依赖（depth 递增）", () => {
    const { depsOf, names } = mapsFor([
      ["hook-1", "hook-2", "身世之谜"],
      ["hook-2", "hook-3", "玉佩来历"],
    ]);
    const chain = expandDependencyChain({ startHookId: "hook-1", depsOf, names });
    expect(chain).toEqual([
      { hookId: "hook-1", name: "身世之谜", depth: 0 },
      { hookId: "hook-2", name: "玉佩来历", depth: 1 },
      { hookId: "hook-3", name: "名-hook-3", depth: 2 },
    ]);
  });

  it("环守卫：A↔B 互依赖不陷入死循环", () => {
    const { depsOf, names } = mapsFor([
      ["hook-1", "hook-2", "A"],
      ["hook-2", "hook-1", "B"],
    ]);
    const chain = expandDependencyChain({ startHookId: "hook-1", depsOf, names });
    expect(chain).toEqual([
      { hookId: "hook-1", name: "A", depth: 0 },
      { hookId: "hook-2", name: "B", depth: 1 },
    ]);
  });

  it("深度限制：maxDepth 截断深层链", () => {
    const { depsOf, names } = mapsFor([
      ["hook-1", "hook-2", "A"],
      ["hook-2", "hook-3", "B"],
      ["hook-3", "hook-4", "C"],
    ]);
    const chain = expandDependencyChain({ startHookId: "hook-1", depsOf, names, maxDepth: 2 });
    expect(chain.map((n) => n.depth)).toEqual([0, 1, 2]);
    expect(chain.find((n) => n.hookId === "hook-4")).toBeUndefined();
  });

  it("名称缺失 → 回退 id；无依赖 → 仅起点", () => {
    const chain = expandDependencyChain({
      startHookId: "hook-1",
      depsOf: new Map(),
      names: new Map(),
    });
    expect(chain).toEqual([{ hookId: "hook-1", name: "hook-1", depth: 0 }]);
  });
});

// ============ 废弃锚点节点 ============

describe("anchorNodeForAbandon（废弃 Delta 锚定节点）", () => {
  it("current_position 有效（存在且未软删）优先", () => {
    expect(anchorNodeForAbandon(makeConfig("sc-1"), makeTree())).toBe("sc-1");
    expect(anchorNodeForAbandon(makeConfig("ch-2"), makeTree())).toBe("ch-2");
  });

  it("current_position 指向已软删节点 → 退化树末节点（决策 21 须非软删）", () => {
    const tree = makeTree();
    (
      tree.children[0] as { children: { children: { deleted: boolean }[] }[] }
    ).children[0].children[1].deleted = true;
    expect(anchorNodeForAbandon(makeConfig("sc-2"), tree)).toBe("ch-2");
  });

  it("current_position 未设置 → 树末节点（先序最后：第二卷）", () => {
    expect(anchorNodeForAbandon(makeConfig(null), makeTree())).toBe("ch-2");
  });

  it("大纲空树 → null（面板禁用提交并提示）", () => {
    expect(
      anchorNodeForAbandon(makeConfig("sc-1"), {
        id: "root",
        type: "root",
        schemaVersion: 1,
        children: [],
      }),
    ).toBeNull();
  });
});

describe("lastOutlineNode / nodeExists", () => {
  it("先序最后访问的非软删节点（卷无子时自身可作锚点，同 executor）", () => {
    const tree: OutlineTree = {
      id: "root",
      type: "root",
      schemaVersion: 1,
      children: [{ id: "vol-1", type: "volume", title: "v", updatedAt: "t" }],
    };
    expect(lastOutlineNode(tree)).toBe("vol-1");
    expect(nodeExists(tree, "vol-1")).toBe(true);
    expect(nodeExists(tree, "sc-x")).toBe(false);
  });
});

// ============ 请求构造 ============

describe("复合写请求构造（hooks.md 状态变化 + 关系约定）", () => {
  it("buildStatusDeltaChange：op=update + from 当前状态 + to 目标状态", () => {
    expect(buildStatusDeltaChange("planted", "progressing")).toEqual({
      field: "status",
      op: "update",
      from: "planted",
      to: "progressing",
    });
  });

  it("buildLifecycleRelationBody：outline_node → hook，snake_case（advances/resolves）", () => {
    expect(buildLifecycleRelationBody("advance", "hook-1", "sc-12")).toEqual({
      source_type: "outline_node",
      source_id: "sc-12",
      target_type: "hook",
      target_id: "hook-1",
      relation_type: "advances",
    });
    expect(buildLifecycleRelationBody("resolve", "hook-1", "sc-45").relation_type).toBe("resolves");
  });

  it("buildPlantRelationBody：新建埋点关系（plants）", () => {
    expect(buildPlantRelationBody("hook-9", "sc-5").relation_type).toBe("plants");
    expect(buildPlantRelationBody("hook-9", "sc-5").source_id).toBe("sc-5");
  });

  it("currentHookStatus：data.status 缺失/空串 → planted（决策 21）", () => {
    expect(currentHookStatus({ status: "progressing" })).toBe("progressing");
    expect(currentHookStatus({})).toBe("planted");
    expect(currentHookStatus({ status: "" })).toBe("planted");
  });

  it("buildStatusSyncData：浅合并单键", () => {
    expect(buildStatusSyncData("resolved")).toEqual({ status: "resolved" });
  });
});

// ============ 复合写编排（请求序列） ============

describe("runLifecycleWrite（推进/回收复合写序列）", () => {
  it("请求顺序：POST /delta → POST /relation → PUT /entity（status 同步）", async () => {
    mocked.createDelta.mockResolvedValue({ id: "delta-1", applied: {} as never });
    mocked.createRelation.mockResolvedValue({
      id: "rel-1",
      relation: {
        sourceType: "outline_node",
        sourceId: "sc-12",
        targetType: "hook",
        targetId: "hook-1",
        relationType: "advances",
      },
    });
    mocked.updateEntity.mockResolvedValue({ id: "hook-1", updated: true });

    await runLifecycleWrite({
      kind: "advance",
      hookId: "hook-1",
      fromStatus: "planted",
      nodeId: "sc-12",
      description: "主角发现玉佩秘密",
    });

    // delta 请求体：node_id/target_type/target_id/changes/description（snake_case）
    expect(mocked.createDelta).toHaveBeenCalledTimes(1);
    expect(mocked.createDelta).toHaveBeenCalledWith({
      node_id: "sc-12",
      target_type: "hook",
      target_id: "hook-1",
      changes: [{ field: "status", op: "update", from: "planted", to: "progressing" }],
      description: "主角发现玉佩秘密",
    });
    // relation 请求体（advances）
    expect(mocked.createRelation).toHaveBeenCalledTimes(1);
    expect(mocked.createRelation).toHaveBeenCalledWith({
      source_type: "outline_node",
      source_id: "sc-12",
      target_type: "hook",
      target_id: "hook-1",
      relation_type: "advances",
    });
    // status 同步（S6.7 语义：data.status 为唯一事实来源）
    expect(mocked.updateEntity).toHaveBeenCalledWith("hook", "hook-1", {
      data: { status: "progressing" },
    });

    // 顺序断言：delta → relation → sync（按 mock 调用次序）
    const order = [
      mocked.createDelta.mock.invocationCallOrder[0],
      mocked.createRelation.mock.invocationCallOrder[0],
      mocked.updateEntity.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("回收：to=resolved + resolves 关系", async () => {
    mocked.createDelta.mockResolvedValue({ id: "delta-1", applied: {} as never });
    mocked.createRelation.mockResolvedValue({ id: "rel-1", relation: {} as never });
    mocked.updateEntity.mockResolvedValue({ id: "hook-1", updated: true });
    await runLifecycleWrite({
      kind: "resolve",
      hookId: "hook-1",
      fromStatus: "progressing",
      nodeId: "sc-45",
      description: "揭示身世",
    });
    expect(mocked.createDelta).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [{ field: "status", op: "update", from: "progressing", to: "resolved" }],
      }),
    );
    expect(mocked.createRelation).toHaveBeenCalledWith(
      expect.objectContaining({ relation_type: "resolves" }),
    );
    expect(mocked.updateEntity).toHaveBeenCalledWith("hook", "hook-1", {
      data: { status: "resolved" },
    });
  });

  it("幂等边界：relation 409 RELATION_EXISTS → 放行不抛错，仍完成 status 同步", async () => {
    mocked.createDelta.mockResolvedValue({ id: "delta-1", applied: {} as never });
    mocked.createRelation.mockRejectedValue(new ApiError("RELATION_EXISTS", "这条关系已经存在"));
    mocked.updateEntity.mockResolvedValue({ id: "hook-1", updated: true });
    await expect(
      runLifecycleWrite({
        kind: "advance",
        hookId: "hook-1",
        fromStatus: "planted",
        nodeId: "sc-12",
        description: "d",
      }),
    ).resolves.toBeUndefined();
    expect(mocked.updateEntity).toHaveBeenCalledTimes(1);
  });

  it("relation 非 409 失败 → 抛出且不做 status 同步（避免伪成功）", async () => {
    mocked.createDelta.mockResolvedValue({ id: "delta-1", applied: {} as never });
    mocked.createRelation.mockRejectedValue(new ApiError("VALIDATION_ERROR", "端点不存在"));
    await expect(
      runLifecycleWrite({
        kind: "advance",
        hookId: "hook-1",
        fromStatus: "planted",
        nodeId: "sc-x",
        description: "d",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocked.updateEntity).not.toHaveBeenCalled();
  });

  it("delta 失败 → 抛出，relation 与 sync 均不执行（先 delta 后 relation 的失败边界）", async () => {
    mocked.createDelta.mockRejectedValue(new ApiError("OUTLINE_NODE_NOT_FOUND", "节点不存在"));
    await expect(
      runLifecycleWrite({
        kind: "advance",
        hookId: "hook-1",
        fromStatus: "planted",
        nodeId: "sc-x",
        description: "d",
      }),
    ).rejects.toMatchObject({ code: "OUTLINE_NODE_NOT_FOUND" });
    expect(mocked.createRelation).not.toHaveBeenCalled();
    expect(mocked.updateEntity).not.toHaveBeenCalled();
  });

  it("status 同步失败（第 3 步）→ 抛出（半状态：delta/relation 已写、data.status 未同步），后续重试收敛", async () => {
    // 第 1 次提交：delta + relation 成功，PUT 失败（模拟网络抖动/服务端瞬时错误）
    mocked.createDelta.mockResolvedValueOnce({ id: "delta-1", applied: {} as never });
    mocked.createRelation.mockResolvedValueOnce({ id: "rel-1", relation: {} as never });
    mocked.updateEntity.mockRejectedValueOnce(new ApiError("CLIENT_NETWORK_ERROR", "网络请求失败"));
    await expect(
      runLifecycleWrite({
        kind: "advance",
        hookId: "hook-1",
        fromStatus: "planted",
        nodeId: "sc-12",
        description: "d",
      }),
    ).rejects.toMatchObject({ code: "CLIENT_NETWORK_ERROR" });

    // 重试：delta 重复写（from 仍与陈旧值 planted 匹配，computeState 可正常累积）+
    // relation 409 幂等放行 + status 同步成功 → 整体成功
    mocked.createDelta.mockResolvedValueOnce({ id: "delta-2", applied: {} as never });
    mocked.createRelation.mockRejectedValueOnce(
      new ApiError("RELATION_EXISTS", "这条关系已经存在"),
    );
    mocked.updateEntity.mockResolvedValueOnce({ id: "hook-1", updated: true });
    await expect(
      runLifecycleWrite({
        kind: "advance",
        hookId: "hook-1",
        fromStatus: "planted",
        nodeId: "sc-12",
        description: "d",
      }),
    ).resolves.toBeUndefined();

    // 收敛断言：两次 delta、relation 409 未重写、两次 status 同步（末次成功）
    expect(mocked.createDelta).toHaveBeenCalledTimes(2);
    expect(mocked.createRelation).toHaveBeenCalledTimes(2);
    expect(mocked.updateEntity).toHaveBeenCalledTimes(2);
    expect(mocked.updateEntity).toHaveBeenLastCalledWith("hook", "hook-1", {
      data: { status: "progressing" },
    });
  });
});

describe("runAbandonWrite（废弃复合写序列）", () => {
  it("仅 POST /delta + PUT /entity（status=abandoned），不创建关系（tools.md abandon 无 relation）", async () => {
    mocked.createDelta.mockResolvedValue({ id: "delta-2", applied: {} as never });
    mocked.updateEntity.mockResolvedValue({ id: "hook-1", updated: true });
    await runAbandonWrite({
      hookId: "hook-1",
      fromStatus: "progressing",
      nodeId: "ch-2",
      description: "设定变更，放弃",
    });
    expect(mocked.createDelta).toHaveBeenCalledWith({
      node_id: "ch-2",
      target_type: "hook",
      target_id: "hook-1",
      changes: [{ field: "status", op: "update", from: "progressing", to: "abandoned" }],
      description: "设定变更，放弃",
    });
    expect(mocked.updateEntity).toHaveBeenCalledWith("hook", "hook-1", {
      data: { status: "abandoned" },
    });
    expect(mocked.createRelation).not.toHaveBeenCalled();
  });
});
