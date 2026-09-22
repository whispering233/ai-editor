// 卡 21.3 拆解 job / 批读写测试
// 覆盖：创建（job + 批行同事务）/ 读 job / 批列表（不含 result）与单批（含 result）/
// 批状态流转与 attempts 自增 / job 状态与错误 / running → paused 归一 / merge_written 往返 /
// 删除 job（连删批行）；JSON 列坏值防御（坏行 → 空数组 / null，不抛错）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DecomposeBatchResult } from "@whispering233/ai-editor-shared";
import { closeDatabase, openDatabase, type Db } from "../connection.js";
import {
  completeBatch,
  createDecomposeJob,
  deleteDecomposeJob,
  failBatch,
  getDecomposeBatch,
  getDecomposeJob,
  listDecomposeBatches,
  listDecomposeJobs,
  pauseRunningJobs,
  setJobError,
  startBatchAttempt,
  updateJobStatus,
  writeMergeWritten,
} from "./decompose.js";

const T1 = "2026-09-01T10:00:00Z";
const T2 = "2026-09-01T10:05:00Z";

/** 一批抽取结果（形状见 docs/api/120-api-decompose.md §batches/:seq） */
const RESULT: DecomposeBatchResult = {
  chapters: [
    {
      chapterIndex: 1,
      chapterTitle: "第一章",
      summary: "主角出场",
      characters: [{ name: "张三", role: "主角" }],
      settings: [],
      locations: [],
      relations: [],
    },
  ],
};

let dir: string;
let db: Db;

function countRows(table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

/** 建一个 job：范围 1..3、两批（**故意乱序传入**，锁定列表按 seq 升序的输出口径） */
function seedJob() {
  return createDecomposeJob(db, {
    scopeStart: 1,
    scopeEnd: 3,
    batchTargetChars: 6000,
    concurrency: 1,
    model: "faux/model",
    batches: [
      { seq: 2, chapterIds: ["ch-3"] },
      { seq: 1, chapterIds: ["ch-1", "ch-2"] },
    ],
    now: T1,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-decompose-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("createDecomposeJob / getDecomposeJob", () => {
  it("job 与批行同事务落库：id 为 job- 前缀、初始状态 pending、批行 pending/attempts 0/result NULL", () => {
    const job = seedJob();

    expect(job.id).toMatch(/^job-[A-Za-z0-9_-]{21}$/); // api-public id 约定 {前缀}-{nanoid}
    expect(job).toEqual({
      id: job.id,
      status: "pending",
      scope_start: 1,
      scope_end: 3,
      batch_target_chars: 6000,
      concurrency: 1,
      model: "faux/model",
      merge_written: [],
      error: null,
      created_at: T1,
      updated_at: T1,
    });
    expect(countRows("decompose_jobs")).toBe(1);
    expect(countRows("decompose_batches")).toBe(2);
 // chapter_ids 以 JSON 文本落库（顺序 = 文件序）
    const raw = db
      .prepare("SELECT chapter_ids, status, attempts, result FROM decompose_batches WHERE seq = ?")
      .get(1) as Record<string, unknown>;
    expect(raw).toEqual({ chapter_ids: '["ch-1","ch-2"]', status: "pending", attempts: 0, result: null });
 // 读回同一条（一项目一 job；无 job → null）
    expect(getDecomposeJob(db)).toEqual(job);
    const empty = openDatabase(join(dir, "empty.db"));
    try {
      expect(getDecomposeJob(empty)).toBeNull();
    } finally {
      closeDatabase(empty);
    }
  });

  it("批行写入失败 → 事务回滚，job 行不落库（不留半条 job）", () => {
    expect(() =>
      createDecomposeJob(db, {
        scopeStart: 1,
        scopeEnd: 2,
        batchTargetChars: 6000,
        concurrency: 1,
        model: null,
        batches: [
          { seq: 1, chapterIds: ["ch-1"] },
          { seq: 1, chapterIds: ["ch-2"] }, // 复合主键冲突 (job_id, seq)
        ],
        now: T1,
      }),
    ).toThrow();
    expect(countRows("decompose_jobs")).toBe(0);
    expect(countRows("decompose_batches")).toBe(0);
  });
});

describe("listDecomposeBatches / getDecomposeBatch", () => {
  it("列表按 seq 升序且**不含 result 列**；单批含 result（坏 JSON → null）；越界 → null", () => {
    const job = seedJob();
    completeBatch(db, { jobId: job.id, seq: 1, result: RESULT, now: T2 });

    const rows = listDecomposeBatches(db, job.id);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(rows[0]).toEqual({
      job_id: job.id,
      seq: 1,
      chapter_ids: ["ch-1", "ch-2"],
      status: "done",
      attempts: 0,
      error: null,
      updated_at: T2,
    });
    expect("result" in rows[0]).toBe(false); // 列表口径：结果正文不进列表

    expect(getDecomposeBatch(db, job.id, 1)?.result).toEqual(RESULT);
    expect(getDecomposeBatch(db, job.id, 2)?.result).toBeNull(); // 未完成 = null
    expect(getDecomposeBatch(db, job.id, 99)).toBeNull(); // 批序号越界 → null（端点 404）

 // 坏 JSON 防御：listing/读取不抛错，chapter_ids 列退化为空数组、result 退化为 null
    db.prepare("UPDATE decompose_batches SET chapter_ids = ?, result = ? WHERE seq = ?").run(
      "not-json",
      "{oops",
      2,
    );
    expect(listDecomposeBatches(db, job.id)[1]?.chapter_ids).toEqual([]);
    expect(getDecomposeBatch(db, job.id, 2)?.result).toBeNull();
  });
});

describe("批状态流转与 attempts", () => {
  it("startBatchAttempt：pending → running 且 attempts 自增（重跑再 +1）；completeBatch 落结果、清错误", () => {
    const job = seedJob();

    expect(startBatchAttempt(db, job.id, 1, T1)).toBe(1); // 首次尝试
    expect(startBatchAttempt(db, job.id, 1, T2)).toBe(2); // 重跑 = 新一轮尝试
    const running = listDecomposeBatches(db, job.id)[0]!;
    expect(running).toMatchObject({ status: "running", attempts: 2, error: null, updated_at: T2 });

    expect(completeBatch(db, { jobId: job.id, seq: 1, result: RESULT, now: T2 })).toBe(1);
    const done = listDecomposeBatches(db, job.id)[0]!;
    expect(done).toMatchObject({ status: "done", attempts: 2, error: null });
    expect(getDecomposeBatch(db, job.id, 1)?.result).toEqual(RESULT);
 // 批序号越界 → null（不静默造行）
    expect(startBatchAttempt(db, job.id, 99, T2)).toBeNull();
  });

  it("failBatch：状态 failed + 错误摘要，result 置 NULL（重跑失败不留上一轮结果冒充产物）", () => {
    const job = seedJob();
    completeBatch(db, { jobId: job.id, seq: 1, result: RESULT, now: T1 }); // 第一轮成功

    expect(failBatch(db, { jobId: job.id, seq: 1, error: "模型返回缺章", now: T2 })).toBe(1);
    expect(listDecomposeBatches(db, job.id)[0]).toMatchObject({
      status: "failed",
      error: "模型返回缺章",
      updated_at: T2,
    });
    expect(getDecomposeBatch(db, job.id, 1)?.result).toBeNull();
 // 新一轮尝试清上一条错误
    expect(startBatchAttempt(db, job.id, 1, T2)).toBe(1);
    expect(listDecomposeBatches(db, job.id)[0]?.error).toBeNull();
  });
});

describe("listDecomposeJobs（跨轮 baseline 的读取面）", () => {
  it("全部 job 按创建时间升序返回（跨轮 baseline 按此顺序覆盖取并）；空库 → 空数组", () => {
    const old = seedJob();
    const fresh = createDecomposeJob(db, {
      scopeStart: 4,
      scopeEnd: 6,
      batchTargetChars: 6000,
      concurrency: 4,
      model: null,
      batches: [{ seq: 1, chapterIds: ["ch-4"] }],
      now: T2,
    });

    expect(listDecomposeJobs(db).map((job) => job.id)).toEqual([old.id, fresh.id]);
    expect(fresh.concurrency).toBe(4); // 并发快照逐行读取（不落 db 缺省）

    const empty = openDatabase(join(dir, "empty.db"));
    try {
      expect(listDecomposeJobs(empty)).toEqual([]);
    } finally {
      closeDatabase(empty);
    }
  });
});

describe("job 状态、错误与 merge_written", () => {
  it("updateJobStatus 推进状态与 updated_at；setJobError 写入后置 null 清除；job 不存在 → 0 行", () => {
    const job = seedJob();

    expect(updateJobStatus(db, job.id, "running", T2)).toBe(1);
    expect(updateJobStatus(db, "job-missing", "running", T2)).toBe(0);
    expect(getDecomposeJob(db)).toMatchObject({ status: "running", updated_at: T2 });

    expect(setJobError(db, job.id, "全部批失败", T2)).toBe(1);
    expect(getDecomposeJob(db)?.error).toBe("全部批失败");
    expect(setJobError(db, job.id, null, T2)).toBe(1);
    expect(getDecomposeJob(db)?.error).toBeNull();
  });

  it("writeMergeWritten 往返：列内为 JSON 文本、读回解析为清单（含空清单）", () => {
    const job = seedJob();
    const entries = [
      { id: "char-1", type: "character", updated_at: T2 },
      { id: "rel-1", type: "relation", updated_at: T2 },
      { id: "ref-report", type: "reference", updated_at: T2 },
    ];

    expect(writeMergeWritten(db, job.id, entries, T2)).toBe(1);
    const raw = db.prepare("SELECT merge_written FROM decompose_jobs WHERE id = ?").get(job.id) as {
      merge_written: string;
    };
    expect(raw.merge_written).toBe(JSON.stringify(entries)); // JSON 文本列（非 drizzle json mode）
    expect(getDecomposeJob(db)?.merge_written).toEqual(entries);

    expect(writeMergeWritten(db, job.id, [], T2)).toBe(1);
    expect(getDecomposeJob(db)?.merge_written).toEqual([]);
 // 坏 JSON 防御：清单退化为空数组
    db.prepare("UPDATE decompose_jobs SET merge_written = ? WHERE id = ?").run("{oops", job.id);
    expect(getDecomposeJob(db)?.merge_written).toEqual([]);
  });
});

describe("pauseRunningJobs（打开项目时的状态归一）", () => {
  it("残留 running → paused（返回归一数）；pending / done 不动；再调返回 0", () => {
    const job = seedJob();
    updateJobStatus(db, job.id, "running", T1);

    expect(pauseRunningJobs(db, T2)).toBe(1);
    expect(getDecomposeJob(db)?.status).toBe("paused");
    expect(getDecomposeJob(db)?.updated_at).toBe(T2);
    expect(pauseRunningJobs(db, T2)).toBe(0); // 幂等：已无 running

 // 非 running 状态不被改写
    updateJobStatus(db, job.id, "done", T2);
    expect(pauseRunningJobs(db, T2)).toBe(0);
    expect(getDecomposeJob(db)?.status).toBe("done");
 // 批行不动（续拆从第一个未完成批续，attempts 在下一轮尝试里 +1）
    expect(listDecomposeBatches(db, job.id).map((b) => b.status)).toEqual(["pending", "pending"]);
  });
});

describe("deleteDecomposeJob", () => {
  it("连删 job 行与全部批行（返回总行数）；不存在 → 0（幂等，不留孤儿批行）", () => {
    const job = seedJob();
    completeBatch(db, { jobId: job.id, seq: 1, result: RESULT, now: T2 });

    expect(deleteDecomposeJob(db, job.id)).toBe(3); // 1 job + 2 批
    expect(countRows("decompose_jobs")).toBe(0);
    expect(countRows("decompose_batches")).toBe(0);
    expect(getDecomposeJob(db)).toBeNull();
    expect(deleteDecomposeJob(db, job.id)).toBe(0);
  });
});
