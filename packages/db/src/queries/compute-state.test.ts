// S5.2 computeState 测试：按**章序前缀**累积 Delta 计算实体到达状态（四段规则）
// 覆盖：跨章累积（章序前缀，含跨章 update 依赖证明应用序）/ 同章内按 order /
// 四 op 语义（set/update/add/remove，含 remove 首个匹配与值不存在静默忽略）/
// 字段路径（点分嵌套：顶层精确键优先 / 对象段按键 / 数组段按 name 取先序第一个 /
// 任意层数 / 空值叶子赋值 / 中途缺失与末段分支 → skipped+conflicts 不抛错 /
// add/remove 仅顶层字面键）+ field-path 纯函数直接单测 /
// update 冲突跳过 + skipped/conflicts 标注（后续 change 继续累积、跨 delta 扁平聚合）/
// 目标节点 → 进度章映射（章/场景/卷/root 不可作 at_node）/ 前缀截断（后续章不参与）+
// 场景锚点的存量 Delta 不参与（锚点仅章）/ 软删过滤（触发节点、delta 自身）/
// add 非数组静默跳过 / 目标实体缺失 → null / 未涉及字段保持初始值 / target_id 过滤
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DeltaChange, OutlineFileTree } from "@whispering233/ai-editor-shared";
import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { createEntity } from "./entity.js";
import { insertDelta, listDeltasByNode } from "./delta.js";
import { computeState } from "./compute-state.js";
import { readFieldPath, writeFieldPath } from "./field-path.js";
import { deriveChapterOrder } from "./outline-ops.js";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "../storage/outline.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-compute-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 一棵含 卷[章一[场景一,场景二], 章二[场景三]] 的大纲树（章序前缀累积：章序 ch-1=1、ch-2=2） */
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
            children: [{ id: "sc-3", type: "scene", title: "场景三", updated_at: T0 }],
          },
        ],
      },
    ],
  };
}

/** 种子：大纲树 + 指定初始 data 的角色「阿强」，返回 charA id */
function seedBase(initialData: Record<string, unknown> = {}): { charA: string } {
  writeOutlineFile(dir, seedOutlineTree());
  const charA = createEntity(db, { type: "character", name: "阿强", data: initialData });
  return { charA: charA.id };
}

/** 便捷：在指定节点插入一条指向 charA 的 delta（targetType 固定 character） */
function addDelta(nodeId: string, targetId: string, changes: DeltaChange[], description: string): void {
  insertDelta(db, { nodeId, targetType: "character", targetId, changes, description });
}

/** 直接改 outline.json 软删指定节点（db 包无大纲软删 API，测试直接写，delta.test.ts 同款） */
function softDeleteNode(nodeId: string): void {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId)!;
  node.deleted = true;
  node.deleted_at = T0;
  writeOutlineFile(dir, tree);
}

describe("computeState 章序前缀累积", () => {
  it("跨章累积：ch-1 与 ch-2 各一 delta，在 at_node=ch-2 下场景全部生效（跨章 update 依赖证明按章序应用）", () => {
    const { charA } = seedBase({ power: "100" });
 // ch-1 先 set；ch-2 的 update 依赖 ch-1 后的值——乱序（如只取父链/逆序）会让 from 校验失败，
 // 从而证明「章序前缀 + 章序升序应用」
    addDelta("ch-1", charA, [{ field: "power", op: "set", to: "200" }], "第一章变更");
    addDelta("ch-2", charA, [{ field: "power", op: "update", from: "200", to: "300" }], "第二章变更");

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-3" });
    expect(result).not.toBeNull();
    expect(result!.state).toEqual({ power: "300" });
    expect(result!.appliedDeltas.map((d) => d.nodeId)).toEqual(["ch-1", "ch-2"]);
    expect(result!.conflicts).toEqual([]);
 // 无跳过 → 每个 delta 不带 skipped 字段
    for (const d of result!.appliedDeltas) expect(d.skipped).toBeUndefined();
 // 响应回显 Req 字段
    expect(result!.targetType).toBe("character");
    expect(result!.targetId).toBe(charA);
    expect(result!.atNodeId).toBe("sc-3");
  });

  it("同章内按 order 应用：后者 update 依赖前者 set 的值（insertDelta 全局单调保证同章序）", () => {
    const { charA } = seedBase({});
    addDelta("ch-1", charA, [{ field: "power", op: "set", to: "10" }], "先 set");
    addDelta("ch-1", charA, [{ field: "power", op: "update", from: "10", to: "20" }], "后 update");
    addDelta("ch-1", charA, [{ field: "power", op: "update", from: "20", to: "30" }], "再 update");

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(result!.state.power).toBe("30");
    expect(result!.conflicts).toEqual([]);
  });
});

/**
 * 计数一次调用内提交给 SQLite 的**语句数**（包裹 db.prepare——drizzle 每查询 prepare 一次）：
 * 卡 2.6 批量化护栏用，不依赖实现细节的语句内容，只看“语句数是否随章数增长”。
 */
function countPreparedStatements(db: Db, fn: () => void): number {
  const original = db.prepare;
  let count = 0;
  (db as unknown as { prepare: (...args: unknown[]) => unknown }).prepare = (...args: unknown[]) => {
    count++;
    return (original as unknown as (...a: unknown[]) => unknown).apply(db, args);
  };
  try {
    fn();
  } finally {
    (db as unknown as { prepare: typeof original }).prepare = original;
  }
  return count;
}

/** N 章单卷树（每章一场景；章 id ch-1..ch-N）——批量化护栏用 */
function treeWithChapters(count: number): OutlineFileTree {
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
        children: Array.from({ length: count }, (_, i) => ({
          id: `ch-${i + 1}`,
          type: "chapter" as const,
          title: `第${i + 1}章`,
          updated_at: T0,
          children: [{ id: `sc-x${i + 1}`, type: "scene" as const, title: `场景${i + 1}`, updated_at: T0 }],
        })),
      },
    ],
  };
}

/** 独立临时项目（自管 dir/db，调用方负责 cleanup）——同一用例内对比不同章数用 */
function openScratchProject(chapters: number, deltasPerChapter: number): {
  dir: string;
  db: Db;
  charId: string;
  cleanup: () => void;
} {
  const scratchDir = mkdtempSync(join(tmpdir(), "ai-editor-db-compute-batch-"));
  const scratchDb = openDatabase(join(scratchDir, "data.db"));
  writeOutlineFile(scratchDir, treeWithChapters(chapters));
  const char = createEntity(scratchDb, { type: "character", name: "阿强", data: { combat_power: 0 } });
  for (let ch = 1; ch <= deltasPerChapter; ch++) {
    insertDelta(scratchDb, {
      nodeId: `ch-${ch}`,
      targetType: "character",
      targetId: char.id,
      changes: [{ field: "combat_power", op: "set", to: ch }],
      description: `第${ch}章变化`,
    });
  }
  return {
    dir: scratchDir,
    db: scratchDb,
    charId: char.id,
    cleanup: () => {
      closeDatabase(scratchDb);
      rmSync(scratchDir, { recursive: true, force: true });
    },
  };
}

describe("computeState 批量化（卡 2.6：一次批量取数取代逐章查询）", () => {
  it("SQL 语句数不随章数增长：2 章与 6 章项目语句数相同（护栏——逐章口径会随章数线性增长）", () => {
    const small = openScratchProject(2, 1);
    const large = openScratchProject(6, 1);
    try {
 // warmup（drizzle 内部首次查询无额外语句，此处仅为消除首调用抖动）
      computeState(small.db, small.dir, { targetType: "character", targetId: small.charId, atNodeId: "ch-2" });
      computeState(large.db, large.dir, { targetType: "character", targetId: large.charId, atNodeId: "ch-6" });

      const smallCount = countPreparedStatements(small.db, () => {
        computeState(small.db, small.dir, { targetType: "character", targetId: small.charId, atNodeId: "ch-2" });
      });
      const largeCount = countPreparedStatements(large.db, () => {
        computeState(large.db, large.dir, { targetType: "character", targetId: large.charId, atNodeId: "ch-6" });
      });

      expect(largeCount).toBe(smallCount); // 常数（与章数无关）
      expect(smallCount).toBeLessThanOrEqual(8); // 实体 get + delta IN + 实体软删 IN + 名称 IN
    } finally {
      small.cleanup();
      large.cleanup();
    }
  });

  it("收集层差分等价：appliedDeltas 序列 = 逐章 listDeltasByNode（旧口径）过滤 targetId 后的序列", () => {
    const { charA } = seedBase({ motivation: "初始" });
    const charB = createEntity(db, { type: "character", name: "阿珍" });
 // ch-1：两条指向 charA（同章 order 序）；ch-2：一条；sc-1（场景锚点存量）：一条（不得参与）
    addDelta("ch-1", charA, [{ field: "combat_power", op: "set", to: 1 }], "ch1-a");
    addDelta("ch-1", charA, [{ field: "combat_power", op: "update", from: 1, to: 2 }], "ch1-b");
    addDelta("ch-2", charA, [{ field: "combat_power", op: "update", from: 2, to: 3 }], "ch2-a");
    addDelta("sc-1", charA, [{ field: "combat_power", op: "set", to: 99 }], "sc1-存量");
    addDelta("ch-2", charB.id, [{ field: "combat_power", op: "set", to: 7 }], "ch2-另实体");

    for (const atNodeId of ["ch-1", "ch-2"]) {
      const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId });
      if (result === null) throw new Error("computeState 不应为 null");
 // 旧口径参照：章序前缀内逐章 listDeltasByNode（升序）→ 过滤目标实体 → 序列
      const order = deriveChapterOrder(dir);
      const progressNumber = order.find((c) => c.chapterId === atNodeId)!.chapterNumber;
      const expected = order
        .filter((c) => c.chapterNumber <= progressNumber)
        .flatMap((c) => listDeltasByNode(db, c.chapterId, dir))
        .filter((d) => d.targetId === charA);
      expect(result.appliedDeltas.map((a) => a.nodeId)).toEqual(expected.map((d) => d.nodeId));
      expect(result.appliedDeltas.map((a) => a.description)).toEqual(expected.map((d) => d.description));
    }
 // 语义断言（不只看序列）：前两章累积出 3；场景存量不参与
    const atCh2 = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-2" });
    expect(atCh2?.state.combat_power).toBe(3);
    expect(atCh2?.conflicts).toEqual([]);
  });
});

describe("computeState 四 op 语义", () => {
  it("set 替换 / update 成功迁移 / add 数组追加 / remove 首个匹配移除（值不存在静默忽略）", () => {
    const { charA } = seedBase({ level: "1", tags: ["a", "b"] });
    addDelta(
      "ch-1",
      charA,
      [
        { field: "level", op: "set", to: "2" }, // set：直接替换
        { field: "level", op: "update", from: "2", to: "3" }, // update：旧值 → 新值
        { field: "tags", op: "add", value: "c" }, // add：数组追加
        { field: "tags", op: "add", value: "d" },
        { field: "tags", op: "remove", value: "b" }, // remove：按值移除
        { field: "tags", op: "remove", value: "zzz" }, // 值不存在 → 静默忽略
      ],
      "四 op 演练",
    );

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(result!.state).toEqual({ level: "3", tags: ["a", "c", "d"] });
    expect(result!.conflicts).toEqual([]);
  });

  it("remove 移除**首个**匹配：重复值只移除第一个", () => {
    const { charA } = seedBase({ tags: ["a", "b", "a"] });
    addDelta("ch-1", charA, [{ field: "tags", op: "remove", value: "a" }], "移除首个 a");

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(result!.state.tags).toEqual(["b", "a"]);
  });

  it("add 非数组字段 → 静默跳过，state 不变（防御，不标 conflicts）", () => {
    const { charA } = seedBase({ title: "孤身一人" });
    addDelta(
      "ch-1",
      charA,
      [
        { field: "title", op: "add", value: "追加" }, // 字符串字段非数组 → 跳过
        { field: "level", op: "add", value: "1" }, // 字段不存在（undefined 非数组）同样跳过
      ],
      "非数组 add",
    );

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(result!.state).toEqual({ title: "孤身一人" });
    expect(result!.conflicts).toEqual([]);
  });
});

describe("computeState update 冲突（跳过 + 标注，不抛 409）", () => {
  it("from 与实际不符 → state 不变 + skipped（index/field/expected/actual）+ conflicts；后续 change 继续应用", () => {
    const { charA } = seedBase({ power: "500" });
    const d = insertDelta(db, {
      nodeId: "ch-1",
      targetType: "character",
      targetId: charA,
      changes: [
        { field: "power", op: "update", from: "100", to: "200" }, // 冲突：当前 500 ≠ 100
        { field: "power", op: "update", from: "500", to: "600" }, // 匹配：继续应用
      ],
      description: "冲突演练",
    });

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(result!.state.power).toBe("600"); // 冲突 change 跳过，后续累积不打断
    expect(result!.appliedDeltas).toHaveLength(1);
    const applied = result!.appliedDeltas[0];
    expect(applied.skipped).toEqual([{ index: 0, field: "power", expected: "100", actual: "500" }]);
    expect(applied.changes).toEqual([
      { field: "power", op: "update", from: "100", to: "200" }, // changes 原样保留
      { field: "power", op: "update", from: "500", to: "600" },
    ]);
    expect(result!.conflicts).toEqual([{ deltaId: d.id, field: "power", expected: "100", actual: "500" }]);
  });

  it("跨 delta 冲突聚合为扁平 conflicts 数组；无冲突 delta 不带 skipped 字段", () => {
    const { charA } = seedBase({ a: "1", b: "2" });
    const d1 = insertDelta(db, {
      nodeId: "ch-1",
      targetType: "character",
      targetId: charA,
      changes: [{ field: "a", op: "update", from: "9", to: "10" }],
      description: "第一章冲突",
    });
    const d2 = insertDelta(db, {
      nodeId: "ch-2",
      targetType: "character",
      targetId: charA,
      changes: [{ field: "b", op: "update", from: "9", to: "10" }],
      description: "第二章冲突",
    });
    insertDelta(db, {
      nodeId: "ch-2",
      targetType: "character",
      targetId: charA,
      changes: [{ field: "a", op: "set", to: "100" }],
      description: "正常",
    });

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-3" });
    expect(result!.conflicts).toEqual([
      { deltaId: d1.id, field: "a", expected: "9", actual: "1" },
      { deltaId: d2.id, field: "b", expected: "9", actual: "2" },
    ]);
    const byDesc = new Map(result!.appliedDeltas.map((d) => [d.description, d]));
    expect(byDesc.get("第一章冲突")!.skipped).toHaveLength(1);
    expect(byDesc.get("第二章冲突")!.skipped).toHaveLength(1);
    expect(byDesc.get("正常")!.skipped).toBeUndefined();
    expect(result!.state.a).toBe("100"); // 冲突 delta 之后的其他 delta 仍正常应用
  });
});

describe("computeState 章序前缀与过滤", () => {
  it("前缀截断：章序 ≤ 进度章的章参与、之后的章不参与；场景锚点的存量 Delta 不参与（锚点仅章）", () => {
    const { charA } = seedBase({ power: "100" });
    addDelta("ch-1", charA, [{ field: "power", op: "set", to: "200" }], "第一章");
    addDelta("ch-2", charA, [{ field: "power", op: "set", to: "999" }], "第二章（序在后）");
    addDelta("sc-1", charA, [{ field: "power", op: "set", to: "777" }], "场景锚点（存量/手工，不参与）");

 // at_node = ch-1 下场景：前缀 = [ch-1]——ch-2 与场景锚点均不参与
    const atSceneOfCh1 = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(atSceneOfCh1!.state.power).toBe("200");
    expect(atSceneOfCh1!.appliedDeltas.map((d) => d.nodeId)).toEqual(["ch-1"]);

 // at_node = ch-1 自身：前缀同 [ch-1]
    const atCh1 = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(atCh1!.state.power).toBe("200");
    expect(atCh1!.appliedDeltas.map((d) => d.nodeId)).toEqual(["ch-1"]);

 // at_node = ch-2：前缀 = [ch-1, ch-2]
    const atCh2 = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-2" });
    expect(atCh2!.state.power).toBe("999");
    expect(atCh2!.appliedDeltas.map((d) => d.nodeId)).toEqual(["ch-1", "ch-2"]);
    expect(atCh2!.conflicts).toEqual([]);
  });

  it("只累积目标实体的 delta：同节点指向其他实体的 delta 不参与（target_id 过滤）", () => {
    const { charA } = seedBase({ power: "100" });
    const charB = createEntity(db, { type: "character", name: "阿珍" });
    addDelta("ch-1", charA, [{ field: "power", op: "set", to: "200" }], "指向阿强");
    insertDelta(db, {
      nodeId: "ch-1",
      targetType: "character",
      targetId: charB.id,
      changes: [{ field: "power", op: "set", to: "999" }],
      description: "指向阿珍",
    });

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(result!.state.power).toBe("200");
    expect(result!.appliedDeltas).toHaveLength(1);
  });

  it("软删过滤：触发节点软删 → 该章全部 delta 不参与；delta 自身软删 → 不参与（章序前缀仍成立）", () => {
    const { charA } = seedBase({ power: "100" });
    addDelta("ch-1", charA, [{ field: "power", op: "set", to: "200" }], "第一章");
    const ch2Delta = insertDelta(db, {
      nodeId: "ch-2",
      targetType: "character",
      targetId: charA,
      changes: [{ field: "power", op: "set", to: "250" }],
      description: "第二章",
    });

 // a. delta 自身软删 → 不参与（直写 UPDATE，隔离验证 delta 层过滤）
    db.prepare("UPDATE delta_records SET deleted_at = ? WHERE id = ?").run(T0, ch2Delta.id);
    let result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-3" });
    expect(result!.state.power).toBe("200"); // 第一章生效，第二章 delta 被过滤
    expect(result!.appliedDeltas.map((d) => d.description)).toEqual(["第一章"]);

 // b. 触发节点软删（ch-1）→ 该章全部 delta 不可见；前缀区间仍含两章但均无可见 delta
    softDeleteNode("ch-1");
    result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-3" });
    expect(result!.state.power).toBe("100"); // 只剩初始值
    expect(result!.appliedDeltas).toEqual([]);
  });

  it("目标实体不存在 → null（含已软删——getEntity 默认过滤）", () => {
    const { charA } = seedBase();
    expect(computeState(db, dir, { targetType: "character", targetId: "char-999", atNodeId: "sc-1" })).toBeNull();
    db.prepare("UPDATE entities SET deleted_at = ? WHERE id = ?").run(T0, charA);
    expect(computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" })).toBeNull();
  });

  it("未涉及字段保持初始值；前缀内无 delta 时 state = 初始 data（深拷贝，与实体行互不影响）", () => {
    const { charA } = seedBase({ power: "100", tags: ["a"], notes: "初始" });
    addDelta("ch-2", charA, [{ field: "power", op: "set", to: "200" }], "只改 power");

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-3" });
    expect(result!.state).toEqual({ power: "200", tags: ["a"], notes: "初始" });

 // oracle 建议：断言互不影响（深拷贝）——修改计算态后实体行不被污染，重算结果不变
    (result!.state as Record<string, unknown>).power = "hacked";
    const again = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-3" });
    expect(again!.state).toEqual({ power: "200", tags: ["a"], notes: "初始" });

 // 前缀截断：at_node = ch-1（章序 1 < 2）→ 前缀内无 delta → state = 初始 data
    const empty = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(empty!.state).toEqual({ power: "100", tags: ["a"], notes: "初始" });
    expect(empty!.appliedDeltas).toEqual([]);
    expect(empty!.conflicts).toEqual([]);
  });
});

describe("computeState 目标节点 → 进度章映射", () => {
  it("scene → 所属章（前缀边界）；chapter → 自身：同章的兄弟场景取同一前缀", () => {
    const { charA } = seedBase({ power: "100" });
    addDelta("ch-2", charA, [{ field: "power", op: "set", to: "300" }], "第二章变更");

 // sc-1 / sc-2 均属 ch-1 → 前缀 = [ch-1]，不含 ch-2
    for (const scene of ["sc-1", "sc-2"]) {
      const at = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: scene });
      expect(at!.state.power).toBe("100");
      expect(at!.appliedDeltas).toEqual([]);
    }
 // sc-3 属 ch-2 → 前缀含 ch-2
    const atSceneOfCh2 = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-3" });
    expect(atSceneOfCh2!.state.power).toBe("300");
    const atCh1 = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(atCh1!.state.power).toBe("100");
  });

  it("volume → 该卷最后一个未软删章；root 不可作 at_node（getOutlinePathIds 只搜 children → 抛错）", () => {
    const { charA } = seedBase({ power: "100" });
    addDelta("ch-1", charA, [{ field: "power", op: "set", to: "200" }], "第一章变更");
    addDelta("ch-2", charA, [{ field: "power", op: "set", to: "300" }], "第二章变更");

 // 整卷进度 = 末章（ch-2）
    const atVolume = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "vol-1" });
    expect(atVolume!.state.power).toBe("300");
    expect(atVolume!.appliedDeltas.map((d) => d.nodeId)).toEqual(["ch-1", "ch-2"]);

 // 末章软删 → 退化到最后一个**未软删**章（ch-1）
    softDeleteNode("ch-2");
    const afterDelete = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "vol-1" });
    expect(afterDelete!.state.power).toBe("200");
    expect(afterDelete!.appliedDeltas.map((d) => d.nodeId)).toEqual(["ch-1"]);

 // root 不是可查询节点（非 children 成员）——路由层 404 兜底，本层直接抛错
    expect(() =>
      computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "root" }),
    ).toThrow(/大纲节点不存在/);
  });
});

// ============ 字段路径（点分嵌套，卡片 2.4） ============

/** 便捷：读 state 里面板某叶子的值（测试断言用；state 为计算产物，形状由用例自定） */
function panelLeafValue(state: Record<string, unknown>, group: string, leaf: string): unknown {
  const panel = state.ability_panel as Array<{ name: string; children?: Array<{ name: string; value?: unknown }> }>;
  return panel.find((n) => n.name === group)?.children?.find((n) => n.name === leaf)?.value;
}

describe("computeState 字段路径（点分嵌套）", () => {
  it("set 嵌套叶子：ability_panel.火系.等级 累积正确（顶层键与嵌套路径并存互不影响）", () => {
    const { charA } = seedBase({
      alias: "小强",
      ability_panel: [{ name: "火系", children: [{ name: "等级", value: 3 }, { name: "熟练度" }] }],
    });
    addDelta(
      "ch-1",
      charA,
      [
        { field: "ability_panel.火系.等级", op: "set", to: 5 },
        { field: "alias", op: "set", to: "强哥" }, // 顶层字段照旧
      ],
      "第一章：火系升级",
    );

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(result!.conflicts).toEqual([]);
    expect(panelLeafValue(result!.state, "火系", "等级")).toBe(5);
    expect(result!.state.alias).toBe("强哥");
  });

  it("嵌套 update 链跨章累积：ch-1 3→5、ch-2 5→7（按章序应用，at=ch-1 得 5、at=ch-2 得 7）", () => {
    const { charA } = seedBase({
      ability_panel: [{ name: "火系", children: [{ name: "等级", value: 3 }] }],
    });
    addDelta("ch-1", charA, [{ field: "ability_panel.火系.等级", op: "update", from: 3, to: 5 }], "第一章：3→5");
    addDelta("ch-2", charA, [{ field: "ability_panel.火系.等级", op: "update", from: 5, to: 7 }], "第二章：5→7");

    const atCh1 = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(atCh1!.conflicts).toEqual([]);
    expect(panelLeafValue(atCh1!.state, "火系", "等级")).toBe(5);

    const atCh2 = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-2" });
    expect(atCh2!.conflicts).toEqual([]);
    expect(panelLeafValue(atCh2!.state, "火系", "等级")).toBe(7);
    expect(atCh2!.appliedDeltas.map((d) => d.nodeId)).toEqual(["ch-1", "ch-2"]);
  });

  it("任意层数：ability_panel.火系.攻击.火球术 三级下钻；空值叶子（无 value 键）可被 set 赋值", () => {
    const { charA } = seedBase({
      ability_panel: [
        { name: "火系", children: [{ name: "攻击", children: [{ name: "火球术", value: 1 }] }] },
        { name: "水系", children: [{ name: "控水" }] }, // 空值叶子（无 value 键）
      ],
    });
    addDelta(
      "ch-1",
      charA,
      [
        { field: "ability_panel.火系.攻击.火球术", op: "update", from: 1, to: 3 },
        { field: "ability_panel.水系.控水", op: "set", to: 2 },
      ],
      "三级下钻 + 空值叶子赋值",
    );

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(result!.conflicts).toEqual([]);
    const panel = result!.state.ability_panel as Array<Record<string, unknown>>;
    const fire = panel.find((n) => n.name === "火系") as { children: Array<Record<string, unknown>> };
    const attack = fire.children.find((n) => n.name === "攻击") as { children: Array<{ value?: unknown }> };
    expect(attack.children[0].value).toBe(3);
    expect(panelLeafValue(result!.state, "水系", "控水")).toBe(2);
  });

  it("数组段按同层 name 匹配取**先序第一个**（同层重名 → 只改第一个）", () => {
    const { charA } = seedBase({
      ability_panel: [
        { name: "火系", children: [{ name: "等级", value: 1 }, { name: "等级", value: 2 }] },
      ],
    });
    addDelta("ch-1", charA, [{ field: "ability_panel.火系.等级", op: "update", from: 1, to: 9 }], "重名取先序第一");

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(result!.conflicts).toEqual([]);
    const panel = result!.state.ability_panel as Array<{ children: Array<{ value?: unknown }> }>;
    expect(panel[0].children.map((n) => n.value)).toEqual([9, 2]);
  });

  it("顶层精确键优先：字面含 `.` 的顶层键不被当作路径（自定义字段名兼容）", () => {
    const { charA } = seedBase({ "a.b": "字面键", nested: { a: { b: "对象里" } } });
    addDelta("ch-1", charA, [{ field: "a.b", op: "set", to: "改写字面键" }], "字面点键");

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(result!.conflicts).toEqual([]);
    expect(result!.state["a.b"]).toBe("改写字面键");
    expect(result!.state.nested).toEqual({ a: { b: "对象里" } });
  });

  it("对象段按键下钻：custom_fields.门派 可写（泛型嵌套对象，非面板专用）", () => {
    const { charA } = seedBase({ custom_fields: { 门派: "青云", 境界: "练气" } });
    addDelta("ch-1", charA, [{ field: "custom_fields.门派", op: "update", from: "青云", to: "魔教" }], "改门派");

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(result!.conflicts).toEqual([]);
    expect(result!.state.custom_fields).toEqual({ 门派: "魔教", 境界: "练气" });
  });

  it("中途缺失三例（面板不存在 / 分组不存在 / 叶子不存在）→ state 不变 + skipped(actual=undefined) + conflicts，且不抛错", () => {
    const { charA } = seedBase({
      alias: "小强", // 未涉及字段（断言不被路径解析波及）
      ability_panel: [{ name: "水系", children: [{ name: "控水", value: 1 }] }],
    });
    addDelta(
      "ch-1",
      charA,
      [
        { field: "ability_panel.火系.等级", op: "set", to: 5 }, // 分组不存在
        { field: "ability_panel.水系.火球术", op: "set", to: 5 }, // 叶子不存在
        { field: "missing_panel.火系.等级", op: "set", to: 5 }, // 顶层容器不存在
        { field: "ability_panel.水系.控水", op: "update", from: 1, to: 2 }, // 正常（对照：仍应生效）
      ],
      "路径缺失演练",
    );

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
 // 三条缺失被标注、第四条正常生效 → 证明缺失不打断后续 change
    expect(result!.conflicts).toEqual([
      { deltaId: expect.any(String), field: "ability_panel.火系.等级", expected: undefined, actual: undefined },
      { deltaId: expect.any(String), field: "ability_panel.水系.火球术", expected: undefined, actual: undefined },
      { deltaId: expect.any(String), field: "missing_panel.火系.等级", expected: undefined, actual: undefined },
    ]);
    expect(result!.appliedDeltas[0].skipped).toEqual([
      { index: 0, field: "ability_panel.火系.等级", expected: undefined, actual: undefined },
      { index: 1, field: "ability_panel.水系.火球术", expected: undefined, actual: undefined },
      { index: 2, field: "missing_panel.火系.等级", expected: undefined, actual: undefined },
    ]);
    expect(panelLeafValue(result!.state, "水系", "控水")).toBe(2); // 正常 change 生效
    expect(result!.state.alias).toBe("小强"); // 未涉及字段不动
  });

  it("面板字段整体缺失（data 无 ability_panel）→ 嵌套 set 标冲突，不新建结构、不抛错", () => {
    const { charA } = seedBase({ alias: "小强" });
    addDelta("ch-1", charA, [{ field: "ability_panel.火系.等级", op: "set", to: 5 }], "面板缺失");

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(result!.state).toEqual({ alias: "小强" }); // 未新建 ability_panel
    expect(result!.conflicts).toEqual([
      { deltaId: expect.any(String), field: "ability_panel.火系.等级", expected: undefined, actual: undefined },
    ]);
  });

  it("末段落在**分支**节点上 → 不可赋值（标冲突，不写坏结构）", () => {
    const { charA } = seedBase({
      ability_panel: [{ name: "火系", children: [{ name: "等级", value: 3 }] }],
    });
    addDelta("ch-1", charA, [{ field: "ability_panel.火系", op: "set", to: 99 }], "写分支");

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    const panel = result!.state.ability_panel as Array<Record<string, unknown>>;
    expect(panel[0].value).toBeUndefined(); // 分支未被塞入 value
    expect(result!.conflicts).toEqual([
      { deltaId: expect.any(String), field: "ability_panel.火系", expected: undefined, actual: undefined },
    ]);
  });

  it("嵌套 update 的 from 与实际不符 → conflicts.actual = 叶子当前值（非 undefined）", () => {
    const { charA } = seedBase({
      ability_panel: [{ name: "火系", children: [{ name: "等级", value: 3 }] }],
    });
    addDelta("ch-1", charA, [{ field: "ability_panel.火系.等级", op: "update", from: 8, to: 9 }], "from 不符");

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(panelLeafValue(result!.state, "火系", "等级")).toBe(3); // 未被改写
    expect(result!.conflicts).toEqual([
      { deltaId: expect.any(String), field: "ability_panel.火系.等级", expected: 8, actual: 3 },
    ]);
  });

  it("add/remove 不走点分路径（仅顶层字面键）：字面点键数组可追加，面板路径不做数组语义", () => {
    const { charA } = seedBase({
      "list.a": ["x"],
      ability_panel: [{ name: "火系", children: [{ name: "等级", value: 3 }] }],
    });
    addDelta(
      "ch-1",
      charA,
      [
        { field: "list.a", op: "add", value: "y" }, // 字面顶层键（含点）→ 按顶层数组追加
        { field: "ability_panel.火系", op: "add", value: "z" }, // 点分字段 → 不做路径解析，字面键非数组 → 静默跳过
        { field: "ability_panel.火系", op: "remove", value: "z" }, // 同上，静默跳过
      ],
      "add/remove 仅顶层",
    );

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(result!.conflicts).toEqual([]); // add/remove 静默跳过不标冲突（既有语义）
    expect(result!.state["list.a"]).toEqual(["x", "y"]);
    expect(panelLeafValue(result!.state, "火系", "等级")).toBe(3);
    const panel = result!.state.ability_panel as Array<Record<string, unknown>>;
    expect(panel[0].children).toHaveLength(1); // 未被数组语义污染
  });
});

describe("字段路径解析（field-path 纯函数直接单测）", () => {
  it("顶层键优先于点分解析；无点字段不要求键存在（set 可新建语义保留）", () => {
    const state: Record<string, unknown> = { "a.b": "字面", a: { b: "再嵌套也不影响" } };
    expect(readFieldPath(state, "a.b")).toEqual({ found: true, value: "字面" });
    expect(writeFieldPath(state, "a.b", "改")).toBe(true);
    expect(state["a.b"]).toBe("改");
    expect(state.a).toEqual({ b: "再嵌套也不影响" });

 // 无点且键不存在：locate 仍给出顶层键位置（与历史 `state[field] = to` 语义一致）
    expect(readFieldPath(state, "新字段")).toEqual({ found: true, value: undefined });
    expect(writeFieldPath(state, "新字段", 1)).toBe(true);
    expect(state["新字段"]).toBe(1);
  });

  it("数组段按 name 匹配；中途缺失/末段分支/标量中途 → 未命中且写入返回 false（state 不变）", () => {
    const leaf = { name: "等级", value: 3 };
    const branch = { name: "火系", children: [leaf] };
    const state: Record<string, unknown> = {
      ability_panel: [branch],
      scalar: "文本",
      bad: [{ name: 123 }, null, { noName: true }, { name: "正常", value: 1 }],
    };

    expect(readFieldPath(state, "ability_panel.火系.等级")).toEqual({ found: true, value: 3 });
    expect(writeFieldPath(state, "ability_panel.火系.等级", 5)).toBe(true);
    expect(leaf.value).toBe(5);

 // 中途段缺失
    expect(readFieldPath(state, "ability_panel.水系.等级")).toEqual({ found: false, value: undefined });
    expect(writeFieldPath(state, "ability_panel.水系.等级", 1)).toBe(false);
 // 末段落到分支（分支不可赋值）
    expect(writeFieldPath(state, "ability_panel.火系", 1)).toBe(false);
    expect(branch).not.toHaveProperty("value");
 // 中途落在标量上
    expect(writeFieldPath(state, "scalar.任意", 1)).toBe(false);
 // 数组内坏元素跳过，正常元素仍可匹配
    expect(readFieldPath(state, "bad.正常")).toEqual({ found: true, value: 1 });
  });
});
