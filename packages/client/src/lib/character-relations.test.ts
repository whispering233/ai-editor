// 人物关系网/其他关联分区纯函数单测（卡 3.6）
// 覆盖：分区判据（另一端端点类型）/ 方向 / 对称关系显示去重（含 metadata 取舍与有向类型不去重）/
//       分组与排序稳定性 / 自环 / 脏数据（两端都不是本角色）/ 备注提取 / 端点路由 / 删除文案。
import { describe, expect, it } from "vitest";
import type { RelationSummaryItem } from "./api";
import {
  buildCharacterRelationGroups,
  buildOtherRelationRows,
  characterRelationDeleteDescription,
  characterRelationNote,
  INTER_CHARACTER_RELATION_TYPES,
  partitionCharacterRelations,
  relationEndpointHref,
  relationOtherEndpoint,
  RELATION_NOTE_MAX_LENGTH,
  SYMMETRIC_CHARACTER_RELATION_TYPES,
} from "./character-relations";

const SELF = { selfId: "char-1", selfName: "张三" };

function rel(over: Partial<RelationSummaryItem> & { id: string }): RelationSummaryItem {
  return {
    sourceType: "character",
    sourceId: "char-1",
    sourceName: "张三",
    targetType: "character",
    targetId: "char-2",
    targetName: "李四",
    relationType: "ally",
    ...over,
  };
}

describe("分区判据（另一端端点类型）", () => {
  it("另一端是 character → 关系网；其余类型 → 其他关联", () => {
    const relations: RelationSummaryItem[] = [
      rel({ id: "r1" }), // out，另一端 character
      rel({ id: "r2", sourceType: "character", sourceId: "char-2", sourceName: "李四", targetId: "char-1", targetName: "张三", relationType: "rival" }), // in
      rel({ id: "r3", targetType: "outline_node", targetId: "ch-1", targetName: "第一章", relationType: "appears_in" }),
      rel({ id: "r4", targetType: "setting", targetId: "set-1", targetName: "青云门", relationType: "belongs_to" }),
      rel({ id: "r5", targetType: "location", targetId: "loc-1", targetName: "青云山", relationType: "owns" }),
      rel({ id: "r6", targetType: "hook", targetId: "hook-1", targetName: "玉佩", relationType: "masters" }),
      rel({ id: "r7", targetType: "timepoint", targetId: "tp-1", targetName: "三年后", relationType: "involves" }),
    ];
    const { network, other } = partitionCharacterRelations(relations, SELF);
    expect(network.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(other.map((r) => r.id)).toEqual(["r3", "r4", "r5", "r6", "r7"]);
  });

  it("自环（两端都是本角色）归关系网；两端都不是本角色的脏数据归其他关联（不静默丢）", () => {
    const relations: RelationSummaryItem[] = [
      rel({ id: "self-1", targetId: "char-1", targetName: "张三", relationType: "family" }),
      rel({ id: "dirty-1", sourceId: "char-9", sourceName: "王五", targetId: "char-8", targetName: "赵六" }),
    ];
    const { network, other } = partitionCharacterRelations(relations, SELF);
    expect(network.map((r) => r.id)).toEqual(["self-1"]);
    expect(other.map((r) => r.id)).toEqual(["dirty-1"]);
  });
});

describe("另一端端点与方向", () => {
  it("out 取 target（名称缺省回退 id）；in 取 source；自环取本角色名", () => {
    expect(
      relationOtherEndpoint(rel({ id: "r1", targetName: undefined, targetId: "char-7" }), SELF),
    ).toEqual({ type: "character", id: "char-7", name: "char-7" });
    expect(
      relationOtherEndpoint(
        rel({ id: "r2", sourceId: "char-3", sourceName: undefined, targetId: "char-1", targetName: "张三" }),
        SELF,
      ),
    ).toEqual({ type: "character", id: "char-3", name: "char-3" });
    expect(
      relationOtherEndpoint(rel({ id: "r3", targetId: "char-1", targetName: "张三", relationType: "family" }), SELF),
    ).toEqual({ type: "character", id: "char-1", name: "张三" });
  });

  it("关系网分组行：out → →；in → ←", () => {
    const groups = buildCharacterRelationGroups(
      [
        rel({ id: "r1" }),
        rel({ id: "r2", sourceId: "char-2", targetId: "char-1", relationType: "rival" }),
      ],
      SELF,
    );
    const rows = groups.flatMap((g) => g.rows);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ relationId: "r1", direction: "out", relationType: "ally" });
    expect(rows[1]).toMatchObject({ relationId: "r2", direction: "in", relationType: "rival" });
  });
});

describe("对称关系显示去重", () => {
  it("ally 双向同时存在 → 合并一行 + both；relationId 取 out 边；备注取 out 边优先", () => {
    const groups = buildCharacterRelationGroups(
      [
        rel({ id: "out-1", relationType: "ally", metadata: { label: "自幼相识" } }),
        rel({
          id: "in-1",
          sourceId: "char-2",
          sourceName: "李四",
          targetId: "char-1",
          targetName: "张三",
          relationType: "ally",
          metadata: { label: "另一侧备注" },
        }),
      ],
      SELF,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0]).toMatchObject({
      relationId: "out-1",
      direction: "both",
      note: "自幼相识",
    });
  });

  it("out 边无备注 → 合并行回退 in 边备注", () => {
    const groups = buildCharacterRelationGroups(
      [
        rel({ id: "out-1", relationType: "family" }),
        rel({
          id: "in-1",
          sourceId: "char-2",
          sourceName: "李四",
          targetId: "char-1",
          targetName: "张三",
          relationType: "family",
          metadata: { label: "义妹" },
        }),
      ],
      SELF,
    );
    expect(groups[0].rows[0].note).toBe("义妹");
  });

  it("有向类型（mentor）不去重：A→B 与 B→A 各占一行", () => {
    const groups = buildCharacterRelationGroups(
      [
        rel({ id: "out-1", relationType: "mentor" }),
        rel({
          id: "in-1",
          sourceId: "char-2",
          sourceName: "李四",
          targetId: "char-1",
          targetName: "张三",
          relationType: "mentor",
        }),
      ],
      SELF,
    );
    expect(groups[0].rows.map((r) => r.direction)).toEqual(["out", "in"]);
  });

  it("对称类型只有单方向 → 不合并（保持 out/in 原方向）", () => {
    const groups = buildCharacterRelationGroups([rel({ id: "out-1", relationType: "rival" })], SELF);
    expect(groups[0].rows[0].direction).toBe("out");
  });

  it("自环单独一行、不参与合并", () => {
    const groups = buildCharacterRelationGroups(
      [
        rel({ id: "self-1", targetId: "char-1", targetName: "张三", relationType: "ally" }),
        rel({ id: "out-1", relationType: "ally" }),
        rel({
          id: "in-1",
          sourceId: "char-2",
          sourceName: "李四",
          targetId: "char-1",
          targetName: "张三",
          relationType: "ally",
        }),
      ],
      SELF,
    );
    const rows = groups[0].rows;
    expect(rows).toHaveLength(2); // 自环一行 + (out,in) 合并一行
    expect(rows.map((r) => r.direction).sort()).toEqual(["both", "self"]);
  });
});

describe("分组与排序稳定性", () => {
  it("组序 = RELATION_TYPES 序（ally → rival → mentor → family → kills）", () => {
    const groups = buildCharacterRelationGroups(
      [
        rel({ id: "r1", relationType: "kills" }),
        rel({ id: "r2", relationType: "family" }),
        rel({ id: "r3", relationType: "ally" }),
        rel({ id: "r4", relationType: "mentor" }),
        rel({ id: "r5", relationType: "rival" }),
      ],
      SELF,
    );
    expect(groups.map((g) => g.relationType)).toEqual([
      "ally",
      "rival",
      "mentor",
      "family",
      "kills",
    ]);
  });

  // 排序基线：`localeCompare`（与仓内既有排序同款；CJK 实际按码位序 = 后端 `ORDER BY name` 的字节序）
  // ——测试用 ASCII 名称，避免把 ICU 语言相关排序钉进断言。
  it("未知关系类型置尾；组内按对方姓名排序", () => {
    const groups = buildCharacterRelationGroups(
      [
        rel({ id: "r1", relationType: "custom_x" }),
        rel({ id: "r2", relationType: "ally", targetId: "char-3", targetName: "Zed" }),
        rel({ id: "r3", relationType: "ally", targetId: "char-4", targetName: "Abe" }),
      ],
      SELF,
    );
    expect(groups.map((g) => g.relationType)).toEqual(["ally", "custom_x"]);
    expect(groups[0].rows.map((r) => r.other.name)).toEqual(["Abe", "Zed"]);
  });

  it("条数 = 去重后行数（组头/折叠区计数同源）", () => {
    const groups = buildCharacterRelationGroups(
      [
        rel({ id: "out-1", relationType: "ally" }),
        rel({
          id: "in-1",
          sourceId: "char-2",
          sourceName: "李四",
          targetId: "char-1",
          targetName: "张三",
          relationType: "ally",
        }),
        rel({ id: "r2", relationType: "kills" }),
      ],
      SELF,
    );
    // 组头与折叠区计数同源 = 各行数组长度（去重后）
    expect(groups.map((g) => g.rows.length)).toEqual([1, 1]);
    expect(groups[0].rows).toHaveLength(1);
  });

  it("脏数据（两端都不是本角色）不产生关系网行", () => {
    const groups = buildCharacterRelationGroups(
      [rel({ id: "dirty-1", sourceId: "char-9", targetId: "char-8" })],
      SELF,
    );
    expect(groups).toEqual([]);
  });
});

describe("其他关联行", () => {
  it("不去重、不分组；按类型序（belongs_to → owns → masters → appears_in）→ 姓名排序", () => {
    const rows = buildOtherRelationRows(
      [
        rel({ id: "r1", targetType: "outline_node", targetId: "ch-9", targetName: "第九章", relationType: "appears_in" }),
        rel({ id: "r2", targetType: "setting", targetId: "set-2", targetName: "B门", relationType: "belongs_to" }),
        rel({ id: "r3", targetType: "setting", targetId: "set-1", targetName: "A门", relationType: "belongs_to" }),
        rel({ id: "r4", targetType: "hook", targetId: "hook-1", targetName: "玉佩", relationType: "masters" }),
      ],
      SELF,
    );
    expect(rows.map((r) => r.relationId)).toEqual(["r3", "r2", "r4", "r1"]);
  });

  it("in 方向行按反向端点构造", () => {
    const rows = buildOtherRelationRows(
      [
        rel({
          id: "in-1",
          sourceType: "hook",
          sourceId: "hook-1",
          sourceName: "玉佩",
          targetType: "character",
          targetId: "char-1",
          targetName: "张三",
          relationType: "involves",
        }),
      ],
      SELF,
    );
    expect(rows[0]).toMatchObject({ direction: "in", other: { type: "hook", id: "hook-1", name: "玉佩" } });
  });
});

describe("备注提取与路由/删除文案", () => {
  it("metadata.label 优先；空对象/数组/非对象 → null；长 JSON 截断", () => {
    expect(characterRelationNote({ label: " 青梅竹马 " })).toBe("青梅竹马");
    expect(characterRelationNote({})).toBeNull();
    expect(characterRelationNote({ a: 1 })).toBe('{"a":1}');
    expect(characterRelationNote([1, 2])).toBeNull();
    expect(characterRelationNote("label")).toBeNull();
    expect(characterRelationNote(null)).toBeNull();
    const long = characterRelationNote({ label: "甲".repeat(500) });
    expect(long).toHaveLength(RELATION_NOTE_MAX_LENGTH);
  });

  it("端点路由：实体走宿主段、大纲节点走 #/outline/:id、未知类型不可点", () => {
    expect(relationEndpointHref("character", "char-1")).toBe("#/characters/char-1");
    expect(relationEndpointHref("setting", "set-1")).toBe("#/setting/set-1");
    expect(relationEndpointHref("event", "ev-1")).toBe("#/timeline/ev-1");
    expect(relationEndpointHref("outline_node", "ch-1")).toBe("#/outline/ch-1");
    expect(relationEndpointHref("unknown", "x-1")).toBeNull();
  });

  it("删除文案：合并行声明只删一条；in 方向按反向书写", () => {
    const both = characterRelationDeleteDescription(
      {
        key: "k",
        relationId: "out-1",
        relationType: "ally",
        other: { type: "character", id: "char-2", name: "李四" },
        direction: "both",
        note: null,
      },
      "张三",
    );
    expect(both).toContain("张三 盟友 李四");
    expect(both).toContain("本次只删除");
    const inbound = characterRelationDeleteDescription(
      {
        key: "k2",
        relationId: "in-1",
        relationType: "appears_in",
        other: { type: "outline_node", id: "ch-1", name: "第一章" },
        direction: "in",
        note: null,
      },
      "张三",
    );
    expect(inbound).toContain("第一章 出现于 张三");
  });

  it("契约常量：人↔人 5 类；对称 3 类且是前者子集", () => {
    expect(INTER_CHARACTER_RELATION_TYPES).toHaveLength(5);
    expect(SYMMETRIC_CHARACTER_RELATION_TYPES).toEqual(["ally", "rival", "family"]);
    for (const t of SYMMETRIC_CHARACTER_RELATION_TYPES) {
      expect(INTER_CHARACTER_RELATION_TYPES).toContain(t);
    }
  });
});
