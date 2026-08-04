// S6.5 伏笔分析工具测试：_health 指标（决策 21 口径）+ 5 个工具
// 覆盖：half_life 显式/缺省映射（payoff_timing 各档与缺失）、age/dormancy/stale/overdue、
//   ready_to_resolve（设置/未设置不猜测）、blocked（依赖未回收）、advances 跨章推进 dormancy 重置、
//   current_position 推进口径、节点 move 后章节序不陈旧、**data 未写回**、软删不可见、signal aborted
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EntityRow, OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, type Db } from "@whispering233/ai-editor-db";
import { createEntity, createRelation, getEntity, softDeleteEntity } from "@whispering233/ai-editor-db";
import { findOutlineNode, readOutlineFile, writeOutlineFile, writeProjectFile } from "@whispering233/ai-editor-db";
import { computeHookHealth, runAnalyzeHookHealth, runDetectHookConflicts, runFindHookOpportunities, runSuggestHookPayoff, runTraceHookLifecycle } from "./hook.js";
import { AbortedError, buildChapterIndex } from "./utils.js";
import type { HookRecord } from "./hook.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-hook-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 三章树：ch-1[sc-1,sc-2]（第 1 章）/ ch-2[sc-3,sc-4]（第 2 章）/ ch-3[sc-5,sc-6]（第 3 章） */
function seedOutlineTree(): OutlineFileTree {
  return {
    id: "root",
    type: "root",
    schema_version: 1,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updated_at: T0,
        children: [
          {
            id: "ch-1",
            type: "chapter",
            title: "第一章",
            updated_at: T0,
            children: [
              { id: "sc-1", type: "scene", title: "场景一", updated_at: T0 },
              { id: "sc-2", type: "scene", title: "场景二", updated_at: T0 },
            ],
          },
          {
            id: "ch-2",
            type: "chapter",
            title: "第二章",
            updated_at: T0,
            children: [
              { id: "sc-3", type: "scene", title: "场景三", updated_at: T0 },
              { id: "sc-4", type: "scene", title: "场景四", updated_at: T0 },
            ],
          },
          {
            id: "ch-3",
            type: "chapter",
            title: "第三章",
            updated_at: T0,
            children: [
              { id: "sc-5", type: "scene", title: "场景五", updated_at: T0 },
              { id: "sc-6", type: "scene", title: "场景六", updated_at: T0 },
            ],
          },
        ],
      },
    ],
  };
}

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

/** 种子：大纲树 + project.json（current_position 可配） */
function seedBase(currentPosition: string | null = "sc-5"): void {
  writeOutlineFile(dir, seedOutlineTree());
  writeProjectFile(dir, {
    id: "proj-test",
    name: "测试书",
    language: "zh",
    prompt: "",
    schema_version: 1,
    current_position: currentPosition,
    created_at: T0,
    updated_at: T0,
  });
}

/** 创建伏笔实体，返回 id */
function makeHook(name: string, data: Record<string, unknown>): string {
  return createEntity(db, { type: "hook", name, data }).id;
}

/** 伏笔生命周期关系（outline_node → hook） */
function plant(hookId: string, nodeId: string): void {
  createRelation(db, { sourceType: "outline_node", sourceId: nodeId, targetType: "hook", targetId: hookId, relationType: "plants" }, dir);
}
function advance(hookId: string, nodeId: string): void {
  createRelation(db, { sourceType: "outline_node", sourceId: nodeId, targetType: "hook", targetId: hookId, relationType: "advances" }, dir);
}
function resolve(hookId: string, nodeId: string): void {
  createRelation(db, { sourceType: "outline_node", sourceId: nodeId, targetType: "hook", targetId: hookId, relationType: "resolves" }, dir);
}
/** 伏笔依赖：hookA depends_on hookB */
function depend(hookA: string, hookB: string): void {
  createRelation(db, { sourceType: "hook", sourceId: hookA, targetType: "hook", targetId: hookB, relationType: "depends_on" }, dir);
}

/** 深比较 data 未写回：调用后实体行与调用前逐字段一致（决策 21：_health 绝不写回 data） */
function expectDataUnchanged(hookId: string, before: Record<string, unknown>): void {
  const after = getEntity(db, hookId)!.data;
  expect(JSON.stringify(after)).toBe(JSON.stringify(before));
}

/** 直接构造 HookRecord（computeHookHealth 单测用） */
function makeRecord(entity: EntityRow, relations: { plants?: string[]; advances?: string[]; resolves?: string[] } = {}): HookRecord {
  const rel = (nodeId: string, relationType: string) =>
    ({ sourceType: "outline_node", sourceId: nodeId, targetType: "hook", targetId: entity.id, relationType } as never);
  return {
    entity,
    plants: (relations.plants ?? []).map((n) => rel(n, "plants")),
    advances: (relations.advances ?? []).map((n) => rel(n, "advances")),
    resolves: (relations.resolves ?? []).map((n) => rel(n, "resolves")),
    dependsOn: [],
    dependedOnBy: [],
  };
}

describe("computeHookHealth（决策 21 口径）", () => {
  it("age/dormancy/stale/overdue：显式 half_life + advances 跨章推进（dormancy 重置）", () => {
    seedBase("sc-5"); // 当前第 3 章
    const hook = getEntity(db, makeHook("身世之谜", { status: "progressing", half_life: 2 }))!;
    const chapterIndex = buildChapterIndex(makeCtx());
    // 埋设 sc-1（第 1 章）、推进 sc-2（第 1 章）→ 最后活跃第 1 章
    const rec = makeRecord(hook, { plants: ["sc-1"], advances: ["sc-2"] });
    let health = computeHookHealth(chapterIndex, rec, new Map([["", "progressing"]]));
    // stale 边界：dormancy(2) == half_life(2) → 不 stale（严格大于）
    expect(health).toMatchObject({ age: 2, dormancy: 2, stale: false, overdue: false, half_life: 2 });
    // 推进到 sc-3（第 2 章）→ dormancy 重置为 1
    const rec2 = makeRecord(hook, { plants: ["sc-1"], advances: ["sc-3"] });
    health = computeHookHealth(chapterIndex, rec2, new Map([["", "progressing"]]));
    expect(health).toMatchObject({ age: 2, dormancy: 1, stale: false });
    // 推进到 sc-5（第 3 章）→ dormancy 0
    const rec3 = makeRecord(hook, { plants: ["sc-1"], advances: ["sc-5"] });
    health = computeHookHealth(chapterIndex, rec3, new Map([["", "progressing"]]));
    expect(health).toMatchObject({ age: 2, dormancy: 0 });
    // half_life=1：dormancy=2 > 1 → stale；age=2 > 1*2? 否——用 age=2 与 half_life=1：overdue 需 age > 2 不触发；
    // 直接以「埋设第 1 章 + 当前第 3 章 + half_life=1」age=2：stale=true、overdue=false；
    // overdue=true 用 half_life=1 且 age=3 不可达（三章树）——overdue 真值由下方 hook2 的 age=2/half_life=1 覆盖
    const hook2 = getEntity(db, makeHook("快节奏", { status: "progressing", half_life: 1 }))!;
    const rec4 = makeRecord(hook2, { plants: ["sc-1"], advances: ["sc-2"] });
    health = computeHookHealth(chapterIndex, rec4, new Map([["", "progressing"]]));
    expect(health).toMatchObject({ age: 2, dormancy: 2, stale: true, overdue: false }); // 2 > 1（stale）；2 > 2? 否
  });

  it("overdue 真值：埋设较早 + 当前较晚 → age > half_life*2（四章树，age=3）", () => {
    // 四章树：ch-4[sc-7,sc-8]（第 4 章）——age 上限提升到 3
    const base = seedOutlineTree();
    const vol = base.children[0];
    if (vol.type !== "volume") throw new Error("fixture 缺失 volume");
    vol.children = [
      ...(vol.children ?? []),
      {
        id: "ch-4",
        type: "chapter",
        title: "第四章",
        updated_at: T0,
        children: [
          { id: "sc-7", type: "scene", title: "场景七", updated_at: T0 },
          { id: "sc-8", type: "scene", title: "场景八", updated_at: T0 },
        ],
      },
    ];
    writeOutlineFile(dir, base);
    writeProjectFile(dir, {
      id: "proj-test", name: "测试书", language: "zh", prompt: "", schema_version: 1,
      current_position: "sc-7", created_at: T0, updated_at: T0,
    });
    const chapterIndex = buildChapterIndex(makeCtx());
    // 埋设 sc-1（第 1 章），half_life=1 → age=3 > 1*2=2 → overdue
    const hook = getEntity(db, makeHook("积压伏笔", { status: "progressing", half_life: 1 }))!;
    const health = computeHookHealth(chapterIndex, makeRecord(hook, { plants: ["sc-1"], advances: ["sc-2"] }), new Map());
    expect(health).toMatchObject({ age: 3, overdue: true, stale: true });
  });

  it("half_life 缺省映射：payoff_timing 各档；缺失/非法 → slow_burn（25，长线保守）", () => {
    seedBase();
    const chapterIndex = buildChapterIndex(makeCtx());
    const statuses = new Map<string, string>();
    const byTiming: Record<string, number> = { immediate: 3, near_term: 8, mid_arc: 15, slow_burn: 25, endgame: 40 };
    for (const [timing, expected] of Object.entries(byTiming)) {
      const hook = getEntity(db, makeHook(`节奏-${timing}`, { status: "planted", payoff_timing: timing }))!;
      const health = computeHookHealth(chapterIndex, makeRecord(hook, { plants: ["sc-1"] }), statuses);
      expect(health.half_life).toBe(expected);
    }
    // payoff_timing 缺失 / 非法值 → slow_burn
    const noTiming = getEntity(db, makeHook("无节奏", { status: "planted" }))!;
    expect(computeHookHealth(chapterIndex, makeRecord(noTiming, { plants: ["sc-1"] }), statuses).half_life).toBe(25);
    const badTiming = getEntity(db, makeHook("坏节奏", { status: "planted", payoff_timing: "weekly" }))!;
    expect(computeHookHealth(chapterIndex, makeRecord(badTiming, { plants: ["sc-1"] }), statuses).half_life).toBe(25);
    // 显式 half_life 优先于 payoff_timing
    const explicit = getEntity(db, makeHook("显式", { status: "planted", payoff_timing: "endgame", half_life: 5 }))!;
    expect(computeHookHealth(chapterIndex, makeRecord(explicit, { plants: ["sc-1"] }), statuses).half_life).toBe(5);
    // 小数防御（oracle 修复轮）：0 < half_life < 1 截断为 0 会让 stale/overdue 恒真——
    // 退化走 payoff_timing 映射（immediate → 3）
    const fractional = getEntity(db, makeHook("小数半衰期", { status: "planted", payoff_timing: "immediate", half_life: 0.5 }))!;
    expect(computeHookHealth(chapterIndex, makeRecord(fractional, { plants: ["sc-1"] }), statuses).half_life).toBe(3);
  });

  it("ready_to_resolve：已设置且 current >= 节点章 → true；current < 节点章 → false；未设置 → null（不猜测）", () => {
    seedBase("sc-3"); // 当前第 2 章
    const chapterIndex = buildChapterIndex(makeCtx());
    const statuses = new Map<string, string>();
    // sc-2 第 1 章：current(2) >= 1 → true
    const early = getEntity(db, makeHook("早回收", { status: "progressing", expected_resolve_node_id: "sc-2" }))!;
    expect(computeHookHealth(chapterIndex, makeRecord(early), statuses).ready_to_resolve).toBe(true);
    // sc-5 第 3 章：current(2) < 3 → false
    const late = getEntity(db, makeHook("晚回收", { status: "progressing", expected_resolve_node_id: "sc-5" }))!;
    expect(computeHookHealth(chapterIndex, makeRecord(late), statuses).ready_to_resolve).toBe(false);
    // 未设置 → null
    const unset = getEntity(db, makeHook("未设", { status: "progressing" }))!;
    expect(computeHookHealth(chapterIndex, makeRecord(unset), statuses).ready_to_resolve).toBeNull();
    // 指向不存在的节点 → null（无法推导章节序，不猜测）
    const dangling = getEntity(db, makeHook("悬空", { status: "progressing", expected_resolve_node_id: "sc-999" }))!;
    expect(computeHookHealth(chapterIndex, makeRecord(dangling), statuses).ready_to_resolve).toBeNull();
    // 指向软删节点 → null（决策 12 可见性：软删节点不可作为兑现依据，与 consistency R4 同口径）
    const tree = readOutlineFile(dir);
    const sc4 = findOutlineNode(tree, "sc-4")!;
    sc4.deleted = true;
    sc4.deleted_at = T0;
    writeOutlineFile(dir, tree);
    const softResolve = getEntity(db, makeHook("软删兑现点", { status: "progressing", expected_resolve_node_id: "sc-4" }))!;
    expect(computeHookHealth(buildChapterIndex(makeCtx()), makeRecord(softResolve), statuses).ready_to_resolve).toBeNull();
  });

  it("blocked：依赖（depends_on）尚未 resolved → blocked + blocked_by；依赖已回收 → 不阻塞", () => {
    seedBase();
    const chapterIndex = buildChapterIndex(makeCtx());
    const a = makeHook("玉佩来历", { status: "progressing" });
    const b = makeHook("身世之谜", { status: "progressing" });
    const c = makeHook("已回收", { status: "resolved" });
    const statuses = new Map([
      [a, "progressing"],
      [b, "progressing"],
      [c, "resolved"],
    ]);
    const recB = getEntity(db, b)!;
    const rec: HookRecord = {
      entity: recB,
      plants: [],
      advances: [],
      resolves: [],
      dependsOn: [
        { sourceType: "hook", sourceId: b, targetType: "hook", targetId: a, relationType: "depends_on" } as never,
        { sourceType: "hook", sourceId: b, targetType: "hook", targetId: c, relationType: "depends_on" } as never,
      ],
      dependedOnBy: [],
    };
    const health = computeHookHealth(chapterIndex, rec, statuses);
    expect(health.blocked).toBe(true);
    expect(health.blocked_by).toEqual([a]); // 已回收的依赖不阻塞
  });
});

describe("analyze_hook_health 聚合", () => {
  it("activeCount/stale/overdue/blockedChains/warnings；软删与已回收不参与", () => {
    seedBase("sc-5"); // 当前第 3 章
    // 活跃：埋设第 1 章无推进，half_life=1 → dormancy=2 > 1 → stale；age=2 > 2? 否
    const stale = makeHook("掉队伏笔", { status: "progressing", half_life: 1 });
    plant(stale, "sc-1");
    // 活跃：埋设第 1 章，half_life=1，age=2 > 2? 否——需要 age > 2：第 3 章 current 时埋设第 1 章 age=2 不 overdue；
    // 用 half_life=1 与 age=3 场景：current 第 3 章 + 埋设 sc-1？age=2。构造 overdue：half_life 使 age > 2*half
    // half_life=1 时 age=2 == 2 不触发；改为埋设第 1 章且 half_life=1 且 current 第 3 章 → age=2 → overdue 需 age>2 → 不触发。
    // 简化：直接构造 age=3 场景（half_life=1）：current_position=sc-5（第 3 章）时埋设于第 0 章不存在——
    // 用「埋设于卷级（无章号）」不可行。改为推进测试：stale 已覆盖；overdue 用例单独构造 current 更大。
    void stale;
    // 回收的伏笔不参与统计
    const resolved = makeHook("已回收伏笔", { status: "resolved", half_life: 1 });
    plant(resolved, "sc-1");
    // 软删伏笔不参与
    const deleted = makeHook("幽灵伏笔", { status: "progressing", half_life: 1 });
    plant(deleted, "sc-1");
    softDeleteEntity(db, deleted, T0);

    const overview = runAnalyzeHookHealth(makeCtx(), {});
    expect(overview.current_chapter).toBe(3);
    expect(overview.active_count).toBe(1); // 仅 stale（resolved/软删不参与）
    expect(overview.stale).toEqual([stale]);
    expect(overview.overdue).toEqual([]);
    expect(overview.blocked_chains).toEqual([]);
    expect(overview.warnings).toHaveLength(1);
    expect(overview.warnings[0]).toContain("掉队伏笔");
    expect(overview.warnings[0]).toContain("半衰期 1");
  });

  it("overdue 检出与 blockedChains；current_position 推进后指标变化（口径一致性）", () => {
    seedBase("sc-5"); // 当前第 3 章
    // 三章树 age 最大 2（埋设第 1 章 + current 第 3 章），half_life=1 时 overdue 需 age > 2 不可达；
    // 聚合层 overdue 检出由下一用例（四章树）覆盖，此处验证聚合结构与 blockedChains。
    const a = makeHook("依赖源", { status: "progressing", half_life: 5 });
    const b = makeHook("被阻塞", { status: "progressing", half_life: 5 });
    plant(a, "sc-1");
    plant(b, "sc-1");
    depend(b, a); // b 依赖 a，a 未回收 → b blocked

    const overview = runAnalyzeHookHealth(makeCtx(), {});
    expect(overview.active_count).toBe(2);
    expect(overview.blocked_chains).toEqual([{ hookId: b, blockedBy: [a] }]);
    expect(overview.warnings.some((w) => w.includes("被阻塞") && w.includes("依赖源"))).toBe(true);
    expect(overview.overdue).toEqual([]);
  });

  it("聚合层 overdue 检出（四章树）：current 第 4 章 + 埋设第 1 章 + half_life=1 → age=3 > 2", () => {
    // 四章树（oracle 修复轮：覆盖聚合层 if (health.overdue) 分支与 warnings 第二条）
    const base = seedOutlineTree();
    const vol = base.children[0];
    if (vol.type !== "volume") throw new Error("fixture 缺失 volume");
    vol.children = [
      ...(vol.children ?? []),
      {
        id: "ch-4",
        type: "chapter",
        title: "第四章",
        updated_at: T0,
        children: [
          { id: "sc-7", type: "scene", title: "场景七", updated_at: T0 },
          { id: "sc-8", type: "scene", title: "场景八", updated_at: T0 },
        ],
      },
    ];
    writeOutlineFile(dir, base);
    writeProjectFile(dir, {
      id: "proj-test", name: "测试书", language: "zh", prompt: "", schema_version: 1,
      current_position: "sc-7", created_at: T0, updated_at: T0,
    });
    const staleHook = makeHook("积压伏笔", { status: "progressing", half_life: 1 });
    plant(staleHook, "sc-1"); // 第 1 章埋设，第 4 章当前 → age=3 > 1*2 → overdue 且 stale
    const normal = makeHook("正常伏笔", { status: "progressing", half_life: 10 });
    plant(normal, "sc-1");
    advance(normal, "sc-7"); // 第 4 章推进 → 不 stale 不 overdue

    const overview = runAnalyzeHookHealth(makeCtx(), {});
    expect(overview.current_chapter).toBe(4);
    expect(overview.active_count).toBe(2);
    expect(overview.stale).toEqual([staleHook]);
    expect(overview.overdue).toEqual([staleHook]);
    expect(overview.warnings).toHaveLength(2); // stale + overdue 各一条
    const overdueWarning = overview.warnings.find((w) => w.includes("超过两倍半衰期"))!;
    expect(overdueWarning).toContain("积压伏笔");
    expect(overdueWarning).toContain("建议尽快回收");
  });
});

describe("trace_hook_lifecycle", () => {
  it("plant（最早埋设）/advances（章节序升序）/resolve/dormancy/timelineGraph 按章节序合并", () => {
    seedBase("sc-5"); // 当前第 3 章
    const hookId = makeHook("身世之谜", { status: "resolved", half_life: 2 });
    plant(hookId, "sc-1"); // 第 1 章（更早插入——同章并列时保留插入序）
    plant(hookId, "sc-2"); // 第 1 章
    advance(hookId, "sc-3"); // 第 2 章
    advance(hookId, "sc-1"); // 第 1 章
    resolve(hookId, "sc-5"); // 第 3 章

    const result = runTraceHookLifecycle(makeCtx(), { hook_id: hookId })!;
    expect(result.hook.id).toBe(hookId);
    expect(result.plant!.nodeId).toBe("sc-1"); // 同章并列取最早插入（稳定排序）
    expect(result.plant!.chapter).toBe(1);
    expect(result.advances.map((e) => e.nodeId)).toEqual(["sc-1", "sc-3"]); // 章节序升序
    expect(result.resolve!.nodeId).toBe("sc-5");
    expect(result.resolve!.nodeName).toBe("场景五");
    // dormancy = current - advances 最新（hooks.md 公式；resolve 不参与——回收后休眠语义由 status=resolved 表达）
    expect(result.dormancy).toBe(1); // 最后推进 sc-3（第 2 章），当前第 3 章
    // timelineGraph：plant/advance/resolve 按章节序合并
    expect(result.timeline_graph.events.map((e) => `${e.kind}:${e.nodeId}`)).toEqual([
      "plant:sc-1",
      "advance:sc-1",
      "advance:sc-3",
      "resolve:sc-5",
    ]);
  });

  it("hook 不存在/已软删/非 hook 类型 → null", () => {
    seedBase();
    expect(runTraceHookLifecycle(makeCtx(), { hook_id: "hook-999" })).toBeNull();
    const charId = createEntity(db, { type: "character", name: "阿强" }).id;
    expect(runTraceHookLifecycle(makeCtx(), { hook_id: charId })).toBeNull();
    const hookId = makeHook("幽灵", { status: "planted" });
    softDeleteEntity(db, hookId, T0);
    expect(runTraceHookLifecycle(makeCtx(), { hook_id: hookId })).toBeNull();
  });
});

describe("suggest_hook_payoff", () => {
  it("理想回收点（埋设章 + 半衰期）附近场景 top 3；排除已回收节点", () => {
    seedBase("sc-1"); // 当前第 1 章
    const hookId = makeHook("身世之谜", { status: "progressing", payoff_timing: "near_term" }); // half_life=8
    plant(hookId, "sc-1"); // 理想回收点 = 1 + 8 = 9（超过树末章 3——取最近场景）
    const result = runSuggestHookPayoff(makeCtx(), { hook_id: hookId })!;
    expect(result.suggestions).toHaveLength(3);
    // 全部候选章节 >= 当前第 1 章；与理想点 9 距离升序：第 3 章(距离6) < 第 2 章(7) < 第 1 章(8)
    expect(result.suggestions[0].at_node).toMatch(/^sc-[56]$/); // 第 3 章场景
    expect(result.suggestions[0].reason).toContain("半衰期 8");
    expect(result.suggestions[0].reason).toContain("理想回收点约第 9 章");

    // 已回收节点排除：resolve sc-5 → 不再建议 sc-5
    resolve(hookId, "sc-5");
    const after = runSuggestHookPayoff(makeCtx(), { hook_id: hookId })!;
    expect(after.suggestions.every((s) => s.at_node !== "sc-5")).toBe(true);
    expect(after.suggestions).toHaveLength(3); // sc-6（第 3 章）+ sc-3/sc-4（第 2 章）
  });

  it("无埋设记录 → 空建议；hook 不存在 → null", () => {
    seedBase();
    const hookId = makeHook("未埋设", { status: "planted" });
    expect(runSuggestHookPayoff(makeCtx(), { hook_id: hookId })).toEqual({ suggestions: [] });
    expect(runSuggestHookPayoff(makeCtx(), { hook_id: "hook-999" })).toBeNull();
  });
});

describe("find_hook_opportunities", () => {
  it("R1 无伏笔埋设 → mystery；R2 多角色在场 → relationship", () => {
    seedBase();
    const c1 = createEntity(db, { type: "character", name: "甲" }).id;
    const c2 = createEntity(db, { type: "character", name: "乙" }).id;
    createRelation(db, { sourceType: "character", sourceId: c1, targetType: "outline_node", targetId: "sc-1", relationType: "appears_in" }, dir);
    createRelation(db, { sourceType: "character", sourceId: c2, targetType: "outline_node", targetId: "sc-1", relationType: "appears_in" }, dir);

    const result = runFindHookOpportunities(makeCtx(), { outline_node_id: "sc-1" })!;
    const categories = result.opportunities.map((o) => o.category);
    expect(categories).toContain("mystery"); // R1
    expect(categories).toContain("relationship"); // R2（2 角色在场）
    const rel = result.opportunities.find((o) => o.category === "relationship")!;
    expect(rel.reason).toContain("2 个角色");
  });

  it("R3 冲突外部层面 → world_building；R4 价值转向 → character_growth；已有伏笔 → R1 不触发", () => {
    seedBase();
    // sc-2 带麦基字段（决策 23）
    const tree = readOutlineFile(dir);
    const sc2 = findOutlineNode(tree, "sc-2")!;
    sc2.data = { conflict_levels: ["inner", "extra_personal"], value_from: "平静", value_to: "绝望" };
    writeOutlineFile(dir, tree);

    const result = runFindHookOpportunities(makeCtx(), { outline_node_id: "sc-2" })!;
    const byCategory = new Map(result.opportunities.map((o) => [o.category, o.reason]));
    expect(byCategory.has("world_building")).toBe(true);
    expect(byCategory.get("world_building")).toContain("extra_personal");
    expect(byCategory.get("character_growth")).toContain("平静");
    expect(byCategory.get("character_growth")).toContain("绝望");

    // 已有 plants 关系 → R1（mystery）不触发
    const hookId = makeHook("已有伏笔", { status: "planted" });
    plant(hookId, "sc-2");
    const withPlant = runFindHookOpportunities(makeCtx(), { outline_node_id: "sc-2" })!;
    expect(withPlant.opportunities.map((o) => o.category)).not.toContain("mystery");
  });

  it("节点不存在/已软删 → null", () => {
    seedBase();
    expect(runFindHookOpportunities(makeCtx(), { outline_node_id: "sc-999" })).toBeNull();
    const tree = readOutlineFile(dir);
    findOutlineNode(tree, "sc-1")!.deleted = true;
    writeOutlineFile(dir, tree);
    expect(runFindHookOpportunities(makeCtx(), { outline_node_id: "sc-1" })).toBeNull();
  });
});

describe("detect_hook_conflicts", () => {
  it("R1 循环依赖 / R2 依赖已废弃", () => {
    seedBase();
    const a = makeHook("玉佩来历", { status: "progressing" });
    const b = makeHook("身世之谜", { status: "progressing" });
    const c = makeHook("废弃伏笔", { status: "abandoned" });
    const d = makeHook("依赖废弃者", { status: "progressing" });
    depend(a, b);
    depend(b, a); // 循环依赖
    depend(d, c); // 依赖已废弃

    const { conflicts } = runDetectHookConflicts(makeCtx(), {});
    const byField = conflicts.filter((c) => c.field === "depends_on");
    expect(byField).toHaveLength(2);
    const loop = byField.find((c) => c.description.includes("循环依赖"))!;
    expect([loop.hook_a, loop.hook_b].sort()).toEqual([a, b].sort());
    const abandoned = byField.find((c) => c.description.includes("废弃"))!;
    expect(abandoned).toMatchObject({ hook_a: d, hook_b: c });
  });

  it("R3 回收早于埋设 / R4 推进早于埋设（时间悖论）", () => {
    seedBase();
    const earlyResolve = makeHook("早回收", { status: "resolved" });
    plant(earlyResolve, "sc-3"); // 第 2 章埋设
    resolve(earlyResolve, "sc-1"); // 第 1 章回收 → 悖论
    const earlyAdvance = makeHook("早推进", { status: "progressing" });
    plant(earlyAdvance, "sc-3"); // 第 2 章埋设
    advance(earlyAdvance, "sc-1"); // 第 1 章推进 → 悖论

    const { conflicts } = runDetectHookConflicts(makeCtx(), {});
    const timeline = conflicts.filter((c) => c.field === "timeline");
    expect(timeline).toHaveLength(2);
    expect(timeline.some((c) => c.hook_a === earlyResolve && c.description.includes("回收节点"))).toBe(true);
    expect(timeline.some((c) => c.hook_a === earlyAdvance && c.description.includes("推进节点"))).toBe(true);
  });

  it("干净项目 → 空；软删伏笔不参与", () => {
    seedBase();
    const a = makeHook("正常", { status: "progressing" });
    const b = makeHook("被依赖", { status: "resolved" });
    depend(a, b); // 依赖已回收 → 正常
    const deleted = makeHook("幽灵", { status: "progressing" });
    depend(deleted, a);
    softDeleteEntity(db, deleted, T0);
    expect(runDetectHookConflicts(makeCtx(), {})).toEqual({ conflicts: [] });
  });
});

describe("hook 工具边界（data 未写回 / signal / current_position 口径）", () => {
  it("data 未被写回：全部工具调用后实体行与调用前逐字段一致（决策 21：_health 不落库）", () => {
    seedBase("sc-5");
    const hookId = makeHook("身世之谜", { status: "progressing", half_life: 2, expected_resolve_node_id: "sc-4" });
    plant(hookId, "sc-1");
    advance(hookId, "sc-3");
    const before = getEntity(db, hookId)!.data;

    runAnalyzeHookHealth(makeCtx(), {});
    runTraceHookLifecycle(makeCtx(), { hook_id: hookId });
    runSuggestHookPayoff(makeCtx(), { hook_id: hookId });
    runDetectHookConflicts(makeCtx(), {});
    expectDataUnchanged(hookId, before);

    // 非本 hook 的实体也不受影响
    const charId = createEntity(db, { type: "character", name: "阿强", data: { role: "主角" } }).id;
    const charBefore = getEntity(db, charId)!.data;
    runFindHookOpportunities(makeCtx(), { outline_node_id: "sc-1" });
    expectDataUnchanged(charId, charBefore);
  });

  it("节点 move 后章节序不陈旧：advances 节点移动后 dormancy 重新推导（决策 21：章节不落库）", () => {
    seedBase("sc-5"); // 当前第 3 章
    const hookId = makeHook("身世之谜", { status: "progressing", half_life: 5 });
    plant(hookId, "sc-1");
    advance(hookId, "sc-3"); // 第 2 章推进 → dormancy = 3-2 = 1

    const before = runTraceHookLifecycle(makeCtx(), { hook_id: hookId })!;
    expect(before.dormancy).toBe(1);

    // move sc-3 到 ch-3（第 3 章）——直接改树（moveOutlineNode 亦可，测试直写）
    const tree = readOutlineFile(dir);
    const ch2 = findOutlineNode(tree, "ch-2");
    if (ch2?.type !== "chapter") throw new Error("fixture 缺失 ch-2");
    ch2.children = ch2.children!.filter((c) => c.id !== "sc-3");
    const ch3 = findOutlineNode(tree, "ch-3");
    if (ch3?.type !== "chapter") throw new Error("fixture 缺失 ch-3");
    ch3.children = [...(ch3.children ?? []), { id: "sc-3", type: "scene", title: "场景三", updated_at: T0 }];
    writeOutlineFile(dir, tree);

    const after = runTraceHookLifecycle(makeCtx(), { hook_id: hookId })!;
    expect(after.dormancy).toBe(0); // 推进点移到第 3 章 → 当前章，dormancy 重置
  });

  it("current_position 推进：指标随写作进度变化（与 S6.4 孤儿工具同口径）", () => {
    seedBase("sc-1"); // 当前第 1 章
    const hookId = makeHook("身世之谜", { status: "progressing", half_life: 2 });
    plant(hookId, "sc-1");
    advance(hookId, "sc-1");

    const overview = runAnalyzeHookHealth(makeCtx(), {});
    expect(overview.current_chapter).toBe(1);
    expect(overview.stale).toEqual([]); // dormancy 0

    // 推进到第 3 章 → dormancy=2 > half_life=2? 否（严格大于）——half_life=1 更敏感
    writeProjectFile(dir, {
      id: "proj-test", name: "测试书", language: "zh", prompt: "", schema_version: 1,
      current_position: "sc-5", created_at: T0, updated_at: T0,
    });
    const after = runAnalyzeHookHealth(makeCtx(), {});
    expect(after.current_chapter).toBe(3);
    expect(after.stale).toEqual([]); // dormancy=2 == half_life=2 边界不触发（严格大于）
    // 无 current_position 时退化树末章（第 3 章）——口径一致
    writeProjectFile(dir, {
      id: "proj-test", name: "测试书", language: "zh", prompt: "", schema_version: 1,
      current_position: null, created_at: T0, updated_at: T0,
    });
    const fallback = runAnalyzeHookHealth(makeCtx(), {});
    expect(fallback.current_chapter).toBe(3);
  });

  it("signal 已中止 → AbortedError（name=AbortError）", () => {
    seedBase();
    const hookId = makeHook("身世之谜", { status: "planted" });
    plant(hookId, "sc-1");
    const controller = new AbortController();
    controller.abort();
    expect(() => runAnalyzeHookHealth(makeCtx(), {}, controller.signal)).toThrowError(AbortedError);
    expect(() => runTraceHookLifecycle(makeCtx(), { hook_id: hookId }, controller.signal)).toThrowError(AbortedError);
    expect(() => runSuggestHookPayoff(makeCtx(), { hook_id: hookId }, controller.signal)).toThrowError(AbortedError);
    expect(() => runFindHookOpportunities(makeCtx(), { outline_node_id: "sc-1" }, controller.signal)).toThrowError(AbortedError);
    expect(() => runDetectHookConflicts(makeCtx(), {}, controller.signal)).toThrowError(AbortedError);
  });
});
