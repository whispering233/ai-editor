// S5.2 computeState 测试：沿大纲树父链累积 Delta 计算实体到达状态（决策 9 + endpoints.md 四段规则）
// 覆盖：基础累积（跨节点依赖证明节点间按树路径序）/ 同节点内按 order /
//   四 op 语义（set/update/add/remove，含 remove 首个匹配与值不存在静默忽略）/
//   update 冲突跳过 + skipped/conflicts 标注（后续 change 继续累积、跨 delta 扁平聚合）/
//   非路径节点不参与（兄弟场景 + at_node 提前截断）/ 软删过滤（触发节点、delta 自身）/
//   add 非数组静默跳过 / 目标实体缺失 → null / 未涉及字段保持初始值 / target_id 过滤
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DeltaChange, OutlineFileTree } from "@whispering233/ai-editor-shared";
import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { createEntity } from "./entity.js";
import { insertDelta } from "./delta.js";
import { computeState } from "./compute-state.js";
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

/** 一棵含 卷[章[场景一,场景二]] 的大纲树（vol-1 → ch-1 → sc-1/sc-2，可测路径序） */
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

/** 直接改 outline.json 软删指定场景（db 包无大纲软删 API，测试直接写，delta.test.ts 同款） */
function softDeleteScene(sceneId: string): void {
  const tree = readOutlineFile(dir);
  const sc = findOutlineNode(tree, sceneId)!;
  sc.deleted = true;
  sc.deleted_at = T0;
  writeOutlineFile(dir, tree);
}

describe("computeState 双层排序", () => {
  it("基础累积：卷→章→场景 各一 delta，结果 = 初始 data + 三 delta；跨节点依赖证明节点间按树路径序", () => {
    const { charA } = seedBase({ power: "100" });
    // vol-1 先 set 覆盖初始值；ch-1 的 update 依赖 vol-1 set 后的值；sc-1 的 update
    // 依赖 ch-1 的值——任何乱序都会让 from 校验失败，从而证明「节点间按路径序」应用
    addDelta("vol-1", charA, [{ field: "power", op: "set", to: "200" }], "卷级变更");
    addDelta("ch-1", charA, [{ field: "power", op: "update", from: "200", to: "300" }], "章级变更");
    addDelta("sc-1", charA, [{ field: "power", op: "update", from: "300", to: "400" }], "场景级变更");

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(result).not.toBeNull();
    expect(result!.state).toEqual({ power: "400" });
    expect(result!.appliedDeltas.map((d) => d.nodeId)).toEqual(["vol-1", "ch-1", "sc-1"]);
    expect(result!.conflicts).toEqual([]);
    // 无跳过 → 每个 delta 不带 skipped 字段
    for (const d of result!.appliedDeltas) expect(d.skipped).toBeUndefined();
    // 响应回显 Req 字段
    expect(result!.targetType).toBe("character");
    expect(result!.targetId).toBe(charA);
    expect(result!.atNodeId).toBe("sc-1");
  });

  it("同节点内按 order 应用：后者 update 依赖前者 set 的值（insertDelta 全局单调保证同节点序）", () => {
    const { charA } = seedBase({});
    addDelta("sc-1", charA, [{ field: "power", op: "set", to: "10" }], "先 set");
    addDelta("sc-1", charA, [{ field: "power", op: "update", from: "10", to: "20" }], "后 update");
    addDelta("sc-1", charA, [{ field: "power", op: "update", from: "20", to: "30" }], "再 update");

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(result!.state.power).toBe("30");
    expect(result!.conflicts).toEqual([]);
  });
});

describe("computeState 四 op 语义", () => {
  it("set 替换 / update 成功迁移 / add 数组追加 / remove 首个匹配移除（值不存在静默忽略）", () => {
    const { charA } = seedBase({ level: "1", tags: ["a", "b"] });
    addDelta(
      "sc-1",
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

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(result!.state).toEqual({ level: "3", tags: ["a", "c", "d"] });
    expect(result!.conflicts).toEqual([]);
  });

  it("remove 移除**首个**匹配：重复值只移除第一个", () => {
    const { charA } = seedBase({ tags: ["a", "b", "a"] });
    addDelta("sc-1", charA, [{ field: "tags", op: "remove", value: "a" }], "移除首个 a");

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(result!.state.tags).toEqual(["b", "a"]);
  });

  it("add 非数组字段 → 静默跳过，state 不变（防御，不标 conflicts）", () => {
    const { charA } = seedBase({ title: "孤身一人" });
    addDelta(
      "sc-1",
      charA,
      [
        { field: "title", op: "add", value: "追加" }, // 字符串字段非数组 → 跳过
        { field: "level", op: "add", value: "1" }, // 字段不存在（undefined 非数组）同样跳过
      ],
      "非数组 add",
    );

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(result!.state).toEqual({ title: "孤身一人" });
    expect(result!.conflicts).toEqual([]);
  });
});

describe("computeState update 冲突（决策 9 修订：跳过 + 标注，不抛 409）", () => {
  it("from 与实际不符 → state 不变 + skipped（index/field/expected/actual）+ conflicts；后续 change 继续应用", () => {
    const { charA } = seedBase({ power: "500" });
    const d = insertDelta(db, {
      nodeId: "sc-1",
      targetType: "character",
      targetId: charA,
      changes: [
        { field: "power", op: "update", from: "100", to: "200" }, // 冲突：当前 500 ≠ 100
        { field: "power", op: "update", from: "500", to: "600" }, // 匹配：继续应用
      ],
      description: "冲突演练",
    });

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
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
      nodeId: "vol-1",
      targetType: "character",
      targetId: charA,
      changes: [{ field: "a", op: "update", from: "9", to: "10" }],
      description: "卷冲突",
    });
    const d2 = insertDelta(db, {
      nodeId: "sc-1",
      targetType: "character",
      targetId: charA,
      changes: [{ field: "b", op: "update", from: "9", to: "10" }],
      description: "场景冲突",
    });
    insertDelta(db, {
      nodeId: "sc-1",
      targetType: "character",
      targetId: charA,
      changes: [{ field: "a", op: "set", to: "100" }],
      description: "正常",
    });

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(result!.conflicts).toEqual([
      { deltaId: d1.id, field: "a", expected: "9", actual: "1" },
      { deltaId: d2.id, field: "b", expected: "9", actual: "2" },
    ]);
    const byDesc = new Map(result!.appliedDeltas.map((d) => [d.description, d]));
    expect(byDesc.get("卷冲突")!.skipped).toHaveLength(1);
    expect(byDesc.get("场景冲突")!.skipped).toHaveLength(1);
    expect(byDesc.get("正常")!.skipped).toBeUndefined();
    expect(result!.state.a).toBe("100"); // 冲突 delta 之后的其他 delta 仍正常应用
  });
});

describe("computeState 路径与过滤", () => {
  it("非路径节点不参与：兄弟场景 sc-2 的 delta 不影响 sc-1 路径；at_node 提前截断", () => {
    const { charA } = seedBase({ power: "100" });
    addDelta("sc-1", charA, [{ field: "power", op: "set", to: "200" }], "路径内");
    addDelta("sc-2", charA, [{ field: "power", op: "set", to: "999" }], "兄弟节点");

    const atScene = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(atScene!.state.power).toBe("200");
    expect(atScene!.appliedDeltas.map((d) => d.nodeId)).toEqual(["sc-1"]);

    // at_node = ch-1 时，场景级 delta 全部不在路径上 → state = 初始 data
    const atChapter = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(atChapter!.state).toEqual({ power: "100" });
    expect(atChapter!.appliedDeltas).toEqual([]);
    expect(atChapter!.conflicts).toEqual([]);
  });

  it("只累积目标实体的 delta：同节点指向其他实体的 delta 不参与（target_id 过滤）", () => {
    const { charA } = seedBase({ power: "100" });
    const charB = createEntity(db, { type: "character", name: "阿珍" });
    addDelta("sc-1", charA, [{ field: "power", op: "set", to: "200" }], "指向阿强");
    insertDelta(db, {
      nodeId: "sc-1",
      targetType: "character",
      targetId: charB.id,
      changes: [{ field: "power", op: "set", to: "999" }],
      description: "指向阿珍",
    });

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(result!.state.power).toBe("200");
    expect(result!.appliedDeltas).toHaveLength(1);
  });

  it("软删过滤：触发节点软删 → 该节点全部 delta 不参与；delta 自身软删 → 不参与（决策 12 修订）", () => {
    const { charA } = seedBase({ power: "100" });
    addDelta("vol-1", charA, [{ field: "power", op: "set", to: "200" }], "卷级");
    const chDelta = insertDelta(db, {
      nodeId: "ch-1",
      targetType: "character",
      targetId: charA,
      changes: [{ field: "power", op: "set", to: "250" }],
      description: "章级",
    });
    insertDelta(db, {
      nodeId: "sc-1",
      targetType: "character",
      targetId: charA,
      changes: [{ field: "power", op: "set", to: "300" }],
      description: "场景级",
    });

    // a. delta 自身软删 → 不参与（直写 UPDATE，隔离验证 delta 层过滤）
    db.prepare("UPDATE delta_records SET deleted_at = ? WHERE id = ?").run(T0, chDelta.id);
    let result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(result!.state.power).toBe("300"); // 卷级与场景级生效，章级被过滤
    expect(result!.appliedDeltas.map((d) => d.description)).toEqual(["卷级", "场景级"]);

    // b. 触发节点软删 → 该节点全部 delta 不可见（决策 12 修订）
    softDeleteScene("sc-1");
    result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(result!.state.power).toBe("200"); // 只剩卷级
    expect(result!.appliedDeltas.map((d) => d.nodeId)).toEqual(["vol-1"]);
  });

  it("目标实体不存在 → null（含已软删——getEntity 默认过滤，决策 12）", () => {
    const { charA } = seedBase();
    expect(computeState(db, dir, { targetType: "character", targetId: "char-999", atNodeId: "sc-1" })).toBeNull();
    db.prepare("UPDATE entities SET deleted_at = ? WHERE id = ?").run(T0, charA);
    expect(computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" })).toBeNull();
  });

  it("未涉及字段保持初始值；路径无 delta 时 state = 初始 data（深拷贝，与实体行互不影响）", () => {
    const { charA } = seedBase({ power: "100", tags: ["a"], notes: "初始" });
    addDelta("sc-1", charA, [{ field: "power", op: "set", to: "200" }], "只改 power");

    const result = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(result!.state).toEqual({ power: "200", tags: ["a"], notes: "初始" });

    // oracle 建议：断言互不影响（深拷贝）——修改计算态后实体行不被污染，重算结果不变
    (result!.state as Record<string, unknown>).power = "hacked";
    const again = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "sc-1" });
    expect(again!.state).toEqual({ power: "200", tags: ["a"], notes: "初始" });

    const empty = computeState(db, dir, { targetType: "character", targetId: charA, atNodeId: "ch-1" });
    expect(empty!.state).toEqual({ power: "100", tags: ["a"], notes: "初始" });
    expect(empty!.appliedDeltas).toEqual([]);
    expect(empty!.conflicts).toEqual([]);
  });
});
