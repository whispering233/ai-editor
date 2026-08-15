// G2 提案类工具测试：时间轴时间点重排（propose_reorder_timepoints，决策 26 G2 修订，
// 取代 F9 的 propose_reorder_events——事件不再带 time_label，语义序载体变为时间点实体）
// 覆盖：tool_result 仅 { proposal_id(prop_ 前缀), summary } 无预览细节（2026-08 修订）/
//   **不落盘**（调用后时间点序零变化——与 S6.7 reorder_timepoints 对比的核心差异）/
//   集合相等校验（缺/多/重复 → 抛错，LLM 幻觉漏时间点喂回自纠）/ references 全量快照
//   （每个时间点自身 updated_at，决策 14）/ preview changes（仅变化时间点、name 缺失用 id）/
//   signal aborted（AbortedError）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolContext } from "../context.js";
import { closeDatabase, listTimepoints, openDatabase, softDeleteEntity, type Db } from "@whispering233/ai-editor-db";
import { AbortedError } from "../analysis/utils.js";
import { buildProposeReorderTimepoints, runProposeReorderTimepoints } from "./reorder-timepoints.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-prop-reorder-tp-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T00:00:00Z";

/** 造 n 个 timepoint，sort_order 0..n-1；返回 id 数组（按序，db 测试同款 INSERT 模式） */
function seedTimepoints(names: string[]): string[] {
  const ids: string[] = [];
  names.forEach((name, i) => {
    const id = `tp-prop-reorder-${i}`;
    ids.push(id);
    db.prepare(
      `INSERT INTO entities (id, type, name, sort_order, created_at, updated_at)
       VALUES (?, 'timepoint', ?, ?, ?, ?)`,
    ).run(id, name, i, T0, T0);
  });
  return ids;
}

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

describe("propose_reorder_timepoints build", () => {
  it("完整提案结构：type/args/references 全量快照（每时间点自身 updated_at，决策 14）/summary/preview.changes", () => {
    const ids = seedTimepoints(["少年时", "玉佩来历揭开", "第二次交手", "大婚之夜"]);
    const newOrder = [ids[0], ids[2], ids[1], ids[3]]; // 少年时 → 交手 → 玉佩 → 大婚
    const proposal = buildProposeReorderTimepoints(makeCtx(), { timepoint_ids: newOrder });
    expect(proposal.type).toBe("propose_reorder_timepoints");
    expect(proposal.args).toEqual({ timepoint_ids: newOrder });
    expect(proposal.project_id).toBe("proj-test");
    // references：全部 4 个时间点，kind=entity + 自身 updated_at 快照（确认时逐一比对）；
    // 顺序按**新序**（args.timepoint_ids）——校验遍历顺序与执行（reorder_timepoints）一致
    expect(proposal.references).toHaveLength(4);
    expect(proposal.references.map((r) => r.id)).toEqual(newOrder);
    for (const r of proposal.references) {
      expect(r).toEqual({ kind: "entity", id: r.id, updated_at: T0 });
    }
    expect(proposal.summary).toBe("按时间标签语义排序 4 个时间点");
    // preview：顺序变化说明（仅变化时间点；按新序遍历输出——提案卡按最终时间轴顺序从上到下展示变化）
    expect(proposal.preview).toEqual({
      changes: [
        "「第二次交手」从第 3 位移到第 2 位",
        "「玉佩来历揭开」从第 2 位移到第 3 位",
      ],
    });
  });

  it("preview changes 仅列变化时间点；name 缺失用 id（tools.md 契约）", () => {
    const ids = seedTimepoints(["拂晓", "正午", "黄昏"]);
    // 只动末尾两个：黄昏与正午互换，拂晓保持第 1 位
    const newOrder = [ids[0], ids[2], ids[1]];
    const proposal = buildProposeReorderTimepoints(makeCtx(), { timepoint_ids: newOrder });
    // changes 按新序排列（提案卡按最终时间轴顺序从上到下展示变化）
    expect(proposal.preview).toEqual({
      changes: ["「黄昏」从第 3 位移到第 2 位", "「正午」从第 2 位移到第 3 位"],
    });
    // name 为空串 → 用 id（防御）
    db.prepare("UPDATE entities SET name = '' WHERE id = ?").run(ids[2]);
    const emptyName = buildProposeReorderTimepoints(makeCtx(), { timepoint_ids: [ids[2], ids[0], ids[1]] });
    expect(emptyName.preview).toEqual({
      changes: [
        `「${ids[2]}」从第 3 位移到第 1 位`,
        "「拂晓」从第 1 位移到第 2 位",
        "「正午」从第 2 位移到第 3 位",
      ],
    });
  });

  it("集合与当前时间轴不一致 → 抛错（缺/多/重复，LLM 幻觉漏时间点喂回自纠）", () => {
    const ids = seedTimepoints(["拂晓", "正午", "黄昏"]);
    // 缺一个（LLM 幻觉漏时间点）
    expect(() => buildProposeReorderTimepoints(makeCtx(), { timepoint_ids: [ids[2], ids[0]] })).toThrow(
      /时间点集合与当前时间轴不一致.*缺失 1 个/,
    );
    // 多一个不存在的 id
    expect(() => buildProposeReorderTimepoints(makeCtx(), { timepoint_ids: [ids[2], ids[1], ids[0], "tp-999"] })).toThrow(
      /时间点集合与当前时间轴不一致.*多余 1 个/,
    );
    // 重复 id
    expect(() => buildProposeReorderTimepoints(makeCtx(), { timepoint_ids: [ids[0], ids[1], ids[0]] })).toThrow(
      /时间点集合与当前时间轴不一致.*含重复/,
    );
  });

  it("软删时间点不参与集合（决策 12 过滤）：新序必须剔除软删时间点，否则抛错", () => {
    const ids = seedTimepoints(["拂晓", "正午", "黄昏"]);
    softDeleteEntity(db, ids[1], T0);
    // 新序仍含软删时间点 → 该 id 不在当前集合（多余），且缺一个未软删时间点（缺失）
    expect(() => buildProposeReorderTimepoints(makeCtx(), { timepoint_ids: [ids[1], ids[0], ids[2]] })).toThrow(
      /时间点集合与当前时间轴不一致/,
    );
    // 按剩余未软删时间点提供新序 → 正常（references 只含 2 个未软删时间点，按**新序**——与执行顺序一致）
    const proposal = buildProposeReorderTimepoints(makeCtx(), { timepoint_ids: [ids[2], ids[0]] });
    expect(proposal.references.map((r) => r.id)).toEqual([ids[2], ids[0]]);
    expect(proposal.summary).toBe("按时间标签语义排序 2 个时间点");
  });
});

describe("propose_reorder_timepoints run", () => {
  it("tool_result 仅 { proposal_id, summary }：prop_ 前缀 + 一句话摘要，无预览细节", () => {
    const ids = seedTimepoints(["拂晓", "正午"]);
    const result = runProposeReorderTimepoints(makeCtx(), { timepoint_ids: [ids[1], ids[0]] });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]); // 不含 preview/changes（2026-08 修订）
    expect(result.proposal_id.startsWith("prop_")).toBe(true);
    expect(result.summary).toBe("按时间标签语义排序 2 个时间点");
  });

  it("不落盘：调用后时间点序零变化（与 S6.7 reorder_timepoints 对比的核心差异）", () => {
    const ids = seedTimepoints(["拂晓", "正午", "黄昏"]);
    runProposeReorderTimepoints(makeCtx(), { timepoint_ids: [ids[2], ids[0], ids[1]] });
    expect(listTimepoints(db).map((r) => r.id)).toEqual(ids); // sort_order 未被重写
    const raw = db.prepare("SELECT updated_at FROM entities WHERE type = 'timepoint' ORDER BY id").all() as Array<{
      updated_at: string;
    }>;
    expect(raw.every((r) => r.updated_at === T0)).toBe(true); // updated_at 未被刷新
  });
});

describe("signal aborted（决策 16 ③）", () => {
  it("signal 已中止时抛 AbortedError", () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx();
    expect(() => runProposeReorderTimepoints(ctx, { timepoint_ids: ["tp-x"] }, controller.signal)).toThrow(AbortedError);
  });
});
