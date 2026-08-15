// F9 提案类工具测试：时间轴事件重排（propose_reorder_events）
// 覆盖：tool_result 仅 { proposal_id(prop_ 前缀), summary } 无预览细节（2026-08 修订）/
//   **不落盘**（调用后事件序零变化——与 S6.7 reorder_events 对比的核心差异）/
//   集合相等校验（缺/多/重复 → 抛错，LLM 幻觉漏事件喂回自纠）/ references 全量快照
//   （每个事件自身 updated_at，决策 14）/ preview changes（仅变化事件、name 缺失用 id）/
//   signal aborted（AbortedError）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolContext } from "../context.js";
import { closeDatabase, listAllEvents, openDatabase, softDeleteEntity, type Db } from "@whispering233/ai-editor-db";
import { AbortedError } from "../analysis/utils.js";
import { buildProposeReorderEvents, runProposeReorderEvents } from "./reorder-events.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-prop-reorder-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T00:00:00Z";

/** 造 n 个 event，sort_order 0..n-1；返回 id 数组（按序，db 测试同款 INSERT 模式） */
function seedEvents(names: string[]): string[] {
  const ids: string[] = [];
  names.forEach((name, i) => {
    const id = `ev-prop-reorder-${i}`;
    ids.push(id);
    db.prepare(
      `INSERT INTO entities (id, type, name, sort_order, created_at, updated_at)
       VALUES (?, 'event', ?, ?, ?, ?)`,
    ).run(id, name, i, T0, T0);
  });
  return ids;
}

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

describe("propose_reorder_events build", () => {
  it("完整提案结构：type/args/references 全量快照（每事件自身 updated_at，决策 14）/summary/preview.changes", () => {
    const ids = seedEvents(["玉佩来历揭开", "第二次交手", "少年时", "大婚之夜"]);
    const newOrder = [ids[2], ids[0], ids[1], ids[3]]; // 少年时 → 玉佩 → 交手 → 大婚
    const proposal = buildProposeReorderEvents(makeCtx(), { event_ids: newOrder });
    expect(proposal.type).toBe("propose_reorder_events");
    expect(proposal.args).toEqual({ event_ids: newOrder });
    expect(proposal.project_id).toBe("proj-test");
    // references：全部 4 个事件，kind=entity + 自身 updated_at 快照（确认时逐一比对）；
    // 顺序按**新序**（args.event_ids）——校验遍历顺序与执行（reorder_events）一致
    expect(proposal.references).toHaveLength(4);
    expect(proposal.references.map((r) => r.id)).toEqual(newOrder);
    for (const r of proposal.references) {
      expect(r).toEqual({ kind: "entity", id: r.id, updated_at: T0 });
    }
    expect(proposal.summary).toBe("按时间标签语义排序 4 个事件");
    // preview：顺序变化说明（仅变化事件；按新序遍历输出——提案卡按最终时间轴顺序从上到下展示变化）
    expect(proposal.preview).toEqual({
      changes: [
        "「少年时」从第 3 位移到第 1 位",
        "「玉佩来历揭开」从第 1 位移到第 2 位",
        "「第二次交手」从第 2 位移到第 3 位",
      ],
    });
  });

  it("preview changes 仅列变化事件；name 缺失用 id（tools.md 契约）", () => {
    const ids = seedEvents(["事件A", "事件B", "事件C"]);
    // 只动末尾两个：B 与 C 互换，A 保持第 1 位
    const newOrder = [ids[0], ids[2], ids[1]];
    const proposal = buildProposeReorderEvents(makeCtx(), { event_ids: newOrder });
    // changes 按新序排列（提案卡按最终时间轴顺序从上到下展示变化）
    expect(proposal.preview).toEqual({
      changes: ["「事件C」从第 3 位移到第 2 位", "「事件B」从第 2 位移到第 3 位"],
    });
    // name 为空串 → 用 id（防御）
    db.prepare("UPDATE entities SET name = '' WHERE id = ?").run(ids[2]);
    const emptyName = buildProposeReorderEvents(makeCtx(), { event_ids: [ids[2], ids[0], ids[1]] });
    expect(emptyName.preview).toEqual({
      changes: [
        `「${ids[2]}」从第 3 位移到第 1 位`,
        "「事件A」从第 1 位移到第 2 位",
        "「事件B」从第 2 位移到第 3 位",
      ],
    });
  });

  it("集合与当前时间轴不一致 → 抛错（缺/多/重复，LLM 幻觉漏事件喂回自纠）", () => {
    const ids = seedEvents(["事件A", "事件B", "事件C"]);
    // 缺一个（LLM 幻觉漏事件）
    expect(() => buildProposeReorderEvents(makeCtx(), { event_ids: [ids[2], ids[0]] })).toThrow(
      /事件集合与当前时间轴不一致.*缺失 1 个/,
    );
    // 多一个不存在的 id
    expect(() => buildProposeReorderEvents(makeCtx(), { event_ids: [ids[2], ids[1], ids[0], "ev-999"] })).toThrow(
      /事件集合与当前时间轴不一致.*多余 1 个/,
    );
    // 重复 id
    expect(() => buildProposeReorderEvents(makeCtx(), { event_ids: [ids[0], ids[1], ids[0]] })).toThrow(
      /事件集合与当前时间轴不一致.*含重复/,
    );
  });

  it("软删事件不参与集合（决策 12 过滤）：新序必须剔除软删事件，否则抛错", () => {
    const ids = seedEvents(["事件A", "事件B", "事件C"]);
    softDeleteEntity(db, ids[1], T0);
    // 新序仍含软删事件 → 该 id 不在当前集合（多余），且缺一个未软删事件（缺失）
    expect(() => buildProposeReorderEvents(makeCtx(), { event_ids: [ids[1], ids[0], ids[2]] })).toThrow(
      /事件集合与当前时间轴不一致/,
    );
    // 按剩余未软删事件提供新序 → 正常（references 只含 2 个未软删事件，按**新序**——与执行顺序一致）
    const proposal = buildProposeReorderEvents(makeCtx(), { event_ids: [ids[2], ids[0]] });
    expect(proposal.references.map((r) => r.id)).toEqual([ids[2], ids[0]]);
    expect(proposal.summary).toBe("按时间标签语义排序 2 个事件");
  });
});

describe("propose_reorder_events run", () => {
  it("tool_result 仅 { proposal_id, summary }：prop_ 前缀 + 一句话摘要，无预览细节", () => {
    const ids = seedEvents(["事件A", "事件B"]);
    const result = runProposeReorderEvents(makeCtx(), { event_ids: [ids[1], ids[0]] });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]); // 不含 preview/changes（2026-08 修订）
    expect(result.proposal_id.startsWith("prop_")).toBe(true);
    expect(result.summary).toBe("按时间标签语义排序 2 个事件");
  });

  it("不落盘：调用后事件序零变化（与 S6.7 reorder_events 对比的核心差异）", () => {
    const ids = seedEvents(["事件A", "事件B", "事件C"]);
    runProposeReorderEvents(makeCtx(), { event_ids: [ids[2], ids[0], ids[1]] });
    expect(listAllEvents(db).map((r) => r.id)).toEqual(ids); // sort_order 未被重写
    const raw = db.prepare("SELECT updated_at FROM entities WHERE type = 'event' ORDER BY id").all() as Array<{
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
    expect(() => runProposeReorderEvents(ctx, { event_ids: ["ev-x"] }, controller.signal)).toThrow(AbortedError);
  });
});
