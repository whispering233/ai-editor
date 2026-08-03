// S2.1 大纲树操作测试：创建/更新/移动/软删/还原/物理删除/回收站列表/章节序
// 覆盖：严格三层约束（决策 19）、软删递归与还原（决策 12）、祖先链校验（409 语义）、
//       章节序跨卷连续（决策 21）、原子写不破（写后文件可读、无临时文件残留）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findOutlineNode, readOutlineFile } from "../storage/outline.js";
import {
  createOutlineNode,
  deleteOutlineNode,
  deriveChapterOrder,
  getChapterNumber,
  listDeletedNodes,
  moveOutlineNode,
  purgeOutlineNode,
  OutlineError,
  restoreOutlineNode,
  updateOutlineNodeInfo,
} from "./outline-ops.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-outline-ops-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";
const T1 = "2026-08-02T10:00:00Z";

/** 断言抛 OutlineError 指定 code */
function expectOutlineError(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable(`应抛出 OutlineError(${code})`);
  } catch (err) {
    expect(err).toBeInstanceOf(OutlineError);
    expect((err as OutlineError).code).toBe(code);
  }
}

/** 构造一棵「卷1[章1[场景1]] + 卷2[章2]」的标准树 */
function seedTree(): void {
  createOutlineNode(dir, { type: "volume", title: "第一卷", parentId: "root", updatedAt: T0 });
  const tree = readOutlineFile(dir);
  const v1 = tree.children[0];
  createOutlineNode(dir, { type: "chapter", title: "第一章", parentId: v1.id, updatedAt: T0 });
  const t2 = readOutlineFile(dir);
  createOutlineNode(dir, { type: "scene", title: "场景一", parentId: t2.children[0].children![0].id, updatedAt: T0 });
  createOutlineNode(dir, { type: "volume", title: "第二卷", parentId: "root", updatedAt: T0 });
  const t3 = readOutlineFile(dir);
  createOutlineNode(dir, { type: "chapter", title: "第二章", parentId: t3.children[1].id, updatedAt: T0 });
}

describe("createOutlineNode（严格三层，决策 19）", () => {
  it("合法各层级创建：volume 挂 root、chapter 挂 volume、scene 挂 chapter，id 前缀正确", () => {
    const vol = createOutlineNode(dir, { type: "volume", title: "第一卷", parentId: "root", updatedAt: T0 });
    expect(vol.id).toMatch(/^vol-/);
    const ch = createOutlineNode(dir, { type: "chapter", title: "第一章", parentId: vol.id, updatedAt: T0 });
    expect(ch.id).toMatch(/^ch-/);
    const sc = createOutlineNode(dir, { type: "scene", title: "场景一", parentId: ch.id, updatedAt: T0 });
    expect(sc.id).toMatch(/^sc-/);
    // 写回文件可读、结构正确
    const tree = readOutlineFile(dir);
    expect(tree.children[0].id).toBe(vol.id);
    expect(tree.children[0].children![0].id).toBe(ch.id);
    expect(tree.children[0].children![0].children![0].id).toBe(sc.id);
  });

  it("chapter 直接挂 root 允许（决策 19：chapter → volume 或 root）", () => {
    const ch = createOutlineNode(dir, { type: "chapter", title: "直挂章", parentId: "root", updatedAt: T0 });
    expect(ch.id).toMatch(/^ch-/);
    expect(readOutlineFile(dir).children.some((n) => n.id === ch.id)).toBe(true);
  });

  it("父节点不存在 → PARENT_NOT_FOUND", () => {
    expectOutlineError(
      () => createOutlineNode(dir, { type: "chapter", title: "x", parentId: "ch-999", updatedAt: T0 }),
      "PARENT_NOT_FOUND",
    );
  });

  it("层级非法拒绝（畸形树）：scene 挂 volume、chapter 挂 chapter、volume 挂 volume", () => {
    const vol = createOutlineNode(dir, { type: "volume", title: "卷", parentId: "root", updatedAt: T0 });
    expectOutlineError(
      () => createOutlineNode(dir, { type: "scene", title: "x", parentId: vol.id, updatedAt: T0 }),
      "INVALID_HIERARCHY",
    );
    const ch = createOutlineNode(dir, { type: "chapter", title: "章", parentId: vol.id, updatedAt: T0 });
    expectOutlineError(
      () => createOutlineNode(dir, { type: "chapter", title: "x", parentId: ch.id, updatedAt: T0 }),
      "INVALID_HIERARCHY",
    );
    expectOutlineError(
      () => createOutlineNode(dir, { type: "volume", title: "x", parentId: vol.id, updatedAt: T0 }),
      "INVALID_HIERARCHY",
    );
  });

  it("父节点 updated_at 统一更新（决策 19），其余节点不变", () => {
    const vol = createOutlineNode(dir, { type: "volume", title: "卷", parentId: "root", updatedAt: T0 });
    createOutlineNode(dir, { type: "chapter", title: "章", parentId: vol.id, updatedAt: T1 });
    const tree = readOutlineFile(dir);
    expect(tree.children[0].updated_at).toBe(T1); // 父（卷）版本戳刷新
    expect(vol.updated_at).toBe(T0); // 内存旧引用不受影响（读树是新对象）
  });

  it("挂 root 不向顶层写入 updated_at（root 是树根非节点，schema.md 顶层契约仅 id/type/schema_version/children）", () => {
    // create 挂 root（volume 与 chapter 直挂两种）
    createOutlineNode(dir, { type: "volume", title: "卷", parentId: "root", updatedAt: T0 });
    createOutlineNode(dir, { type: "chapter", title: "直挂章", parentId: "root", updatedAt: T1 });
    // move 挂 root（chapter 从卷内移到 root 下）
    const t1 = readOutlineFile(dir);
    const volId = t1.children[0].id;
    createOutlineNode(dir, { type: "chapter", title: "卷内章", parentId: volId, updatedAt: T0 });
    const t2 = readOutlineFile(dir);
    moveOutlineNode(dir, t2.children[0].children![0].id, { parentId: "root", order: 0 }, T1);

    // 顶层字段集合必须严格等于契约四字段（无 updated_at）
    const tree = readOutlineFile(dir);
    expect(Object.keys(tree).sort()).toEqual(["children", "id", "schema_version", "type"]);
  });
});

describe("updateOutlineNodeInfo（PUT /outline/:nodeId）", () => {
  it("title/summary 更新 + 节点版本戳刷新，其他节点不变", () => {
    const vol = createOutlineNode(dir, { type: "volume", title: "旧名", parentId: "root", updatedAt: T0 });
    updateOutlineNodeInfo(dir, vol.id, { title: "新名", summary: "描述" }, T1);
    const node = readOutlineFile(dir).children[0];
    expect(node.title).toBe("新名");
    expect(node.summary).toBe("描述");
    expect(node.updated_at).toBe(T1);
  });

  it("节点不存在 → NODE_NOT_FOUND", () => {
    expectOutlineError(() => updateOutlineNodeInfo(dir, "sc-999", { title: "x" }, T0), "NODE_NOT_FOUND");
  });
});

describe("节点 data（决策 23，麦基字段集）", () => {
  it("创建带 data：scene 全字段 + volume/chapter 引用字段，落盘可读（读写透传）", () => {
    const vol = createOutlineNode(dir, {
      type: "volume",
      title: "第一卷",
      parentId: "root",
      data: { climax_scene: "sc-12", inciting_scene: "sc-3" },
      updatedAt: T0,
    });
    const ch = createOutlineNode(dir, {
      type: "chapter",
      title: "第一章",
      parentId: vol.id,
      data: { reversal: "张三决定叛出师门", climax_scene: "sc-5" },
      updatedAt: T0,
    });
    const sc = createOutlineNode(dir, {
      type: "scene",
      title: "灵根测试失败",
      parentId: ch.id,
      data: { goal: "确认灵根品质", conflict_levels: ["inner", "personal"], value_from: "希望", value_to: "绝望" },
      updatedAt: T0,
    });

    // 整树读回：三层 data 均原样透传（findOutlineNode 与 readOutlineFile 同一数据源）
    const tree = readOutlineFile(dir);
    expect(findOutlineNode(tree, vol.id)?.data).toEqual({ climax_scene: "sc-12", inciting_scene: "sc-3" });
    expect(findOutlineNode(tree, ch.id)?.data).toEqual({ reversal: "张三决定叛出师门", climax_scene: "sc-5" });
    expect(findOutlineNode(tree, sc.id)?.data).toEqual({
      goal: "确认灵根品质",
      conflict_levels: ["inner", "personal"],
      value_from: "希望",
      value_to: "绝望",
    });
  });

  it("不传 data 创建：节点无 data 字段（默认省略，schema.md 契约）", () => {
    const vol = createOutlineNode(dir, { type: "volume", title: "卷", parentId: "root", updatedAt: T0 });
    expect(findOutlineNode(readOutlineFile(dir), vol.id)?.data).toBeUndefined();
  });

  it("更新 data 部分合并：未传字段保留（与实体 updateEntity 浅合并同语义）", () => {
    const vol = createOutlineNode(dir, {
      type: "volume",
      title: "第一卷",
      parentId: "root",
      data: { climax_scene: "sc-12", inciting_scene: "sc-3" },
      updatedAt: T0,
    });
    // 浅合并：仅合并传入字段（climax_scene 替换），未传字段（inciting_scene）保留
    updateOutlineNodeInfo(dir, vol.id, { data: { climax_scene: "sc-99" } }, T1);
    expect(readOutlineFile(dir).children[0].data).toEqual({ climax_scene: "sc-99", inciting_scene: "sc-3" });
    // 节点原先无 data 时：仅写入传入字段
    const ch = createOutlineNode(dir, { type: "chapter", title: "章", parentId: vol.id, updatedAt: T0 });
    updateOutlineNodeInfo(dir, ch.id, { data: { reversal: "反转" } }, T1);
    expect(findOutlineNode(readOutlineFile(dir), ch.id)?.data).toEqual({ reversal: "反转" });
  });

  it("PUT { data: {} } 空对象：原有 data 保留（no-op）；原无 data 节点落盘 data: {}（与 updateEntity 浅合并语义一致，有意为之）", () => {
    const vol = createOutlineNode(dir, {
      type: "volume",
      title: "第一卷",
      parentId: "root",
      data: { climax_scene: "sc-12", inciting_scene: "sc-3" },
      updatedAt: T0,
    });
    // 有 data 节点：空对象浅合并（{ ...existing, ...{} }）no-op，字段全保留
    updateOutlineNodeInfo(dir, vol.id, { data: {} }, T1);
    expect(readOutlineFile(dir).children[0].data).toEqual({ climax_scene: "sc-12", inciting_scene: "sc-3" });
    // 原无 data 节点：浅合并展开（{ ...(data ?? {}), ...{} } = {}）并落盘——
    // data 键从省略变为空对象，与 updateEntity 的 data 浅合并语义一致，有意为之
    // （详情页保存表单传空 data 时行为可预期，不依赖 JSON.stringify 省略 undefined）
    const ch = createOutlineNode(dir, { type: "chapter", title: "章", parentId: vol.id, updatedAt: T0 });
    expect(findOutlineNode(readOutlineFile(dir), ch.id)?.data).toBeUndefined(); // 前置：创建时无 data 键
    updateOutlineNodeInfo(dir, ch.id, { data: {} }, T1);
    expect(findOutlineNode(readOutlineFile(dir), ch.id)?.data).toEqual({});
  });

  it("data 变更 touch updated_at（决策 19 版本戳）", () => {
    const vol = createOutlineNode(dir, { type: "volume", title: "卷", parentId: "root", updatedAt: T0 });
    updateOutlineNodeInfo(dir, vol.id, { data: { climax_scene: "sc-1" } }, T1);
    const node = readOutlineFile(dir).children[0];
    expect(node.data).toEqual({ climax_scene: "sc-1" });
    expect(node.updated_at).toBe(T1);
    // 未传 data 的更新不改动既有 data
    updateOutlineNodeInfo(dir, vol.id, { title: "新名" }, T1);
    expect(readOutlineFile(dir).children[0].data).toEqual({ climax_scene: "sc-1" });
  });
});

describe("moveOutlineNode（PUT /outline/:nodeId/move）", () => {
  it("同父重排：order 生效，返回 previousParentId === newParentId", () => {
    seedTree();
    const tree0 = readOutlineFile(dir);
    const v1 = tree0.children[0];
    const ch1 = v1.children![0];
    // 再建一章同卷，把 ch1 移到第二位
    const ch3 = createOutlineNode(dir, { type: "chapter", title: "新章", parentId: v1.id, updatedAt: T0 });

    const r = moveOutlineNode(dir, ch1.id, { parentId: v1.id, order: 1 }, T1);
    expect(r.previousParentId).toBe(v1.id);
    expect(r.newParentId).toBe(v1.id);
    const tree = readOutlineFile(dir);
    expect(tree.children[0].children!.map((c) => c.id)).toEqual([ch3.id, ch1.id]);
    // 父（卷）版本戳刷新（children 重排，决策 19）
    expect(tree.children[0].updated_at).toBe(T1);
  });

  it("跨父移动：chapter 从卷1 移到卷2，新旧父 updated_at 均刷新", () => {
    seedTree();
    const tree0 = readOutlineFile(dir);
    const ch1 = tree0.children[0].children![0];
    const v2 = tree0.children[1];

    const r = moveOutlineNode(dir, ch1.id, { parentId: v2.id, order: 0 }, T1);
    expect(r.previousParentId).toBe(tree0.children[0].id);
    expect(r.newParentId).toBe(v2.id);
    const tree = readOutlineFile(dir);
    expect(tree.children[1].children!.map((c) => c.id)).toEqual([ch1.id, v2.children![0].id]);
    expect(tree.children[0].children).toHaveLength(0);
    // 新旧父版本戳均刷新
    expect(tree.children[0].updated_at).toBe(T1);
    expect(tree.children[1].updated_at).toBe(T1);
  });

  it("scene 移到 volume 下 → INVALID_HIERARCHY（三层约束同 create）", () => {
    seedTree();
    const tree0 = readOutlineFile(dir);
    const sc1 = tree0.children[0].children![0].children![0];
    const v2 = tree0.children[1];
    expectOutlineError(
      () => moveOutlineNode(dir, sc1.id, { parentId: v2.id, order: 0 }, T1),
      "INVALID_HIERARCHY",
    );
  });

  it("目标父不存在 → PARENT_NOT_FOUND；节点不存在 → NODE_NOT_FOUND", () => {
    seedTree();
    const tree0 = readOutlineFile(dir);
    const ch1 = tree0.children[0].children![0];
    expectOutlineError(() => moveOutlineNode(dir, ch1.id, { parentId: "vol-999", order: 0 }, T1), "PARENT_NOT_FOUND");
    expectOutlineError(() => moveOutlineNode(dir, "sc-999", { parentId: "root", order: 0 }, T1), "NODE_NOT_FOUND");
  });

  it("order 越界 clamp 到有效范围（负数→0、超长→末尾）", () => {
    seedTree();
    const tree0 = readOutlineFile(dir);
    const v1 = tree0.children[0];
    const ch1 = v1.children![0];
    // 负 order → 最前（不变）
    moveOutlineNode(dir, ch1.id, { parentId: v1.id, order: -5 }, T1);
    expect(readOutlineFile(dir).children[0].children![0].id).toBe(ch1.id);
    // 超大 order → 末尾
    moveOutlineNode(dir, ch1.id, { parentId: v1.id, order: 999 }, T1);
    const t2 = readOutlineFile(dir);
    expect(t2.children[0].children![t2.children[0].children!.length - 1].id).toBe(ch1.id);
  });
});

describe("deleteOutlineNode（软删，决策 12）", () => {
  it("单节点软删：标记 deleted/deleted_at，本体保留（find 仍可见），计数 0", () => {
    seedTree();
    const tree0 = readOutlineFile(dir);
    const sc1 = tree0.children[0].children![0].children![0];
    const r = deleteOutlineNode(dir, sc1.id, T1);
    expect(r.children).toBe(0);
    const node = findOutlineNode(readOutlineFile(dir), sc1.id);
    expect(node?.deleted).toBe(true);
    expect(node?.deleted_at).toBe(T1);
    expect(node?.title).toBe("场景一"); // 本体保留
  });

  it("子树级联软删：卷下所有章/场景一并标记，children 计数正确", () => {
    seedTree();
    const tree0 = readOutlineFile(dir);
    const v1 = tree0.children[0];
    const r = deleteOutlineNode(dir, v1.id, T1);
    expect(r.children).toBe(2); // 章1 + 场景1
    const tree = readOutlineFile(dir);
    const vol = tree.children[0];
    expect(vol.deleted).toBe(true);
    expect(vol.children![0].deleted).toBe(true);
    expect(vol.children![0].children![0].deleted).toBe(true);
  });

  it("已软删节点再次软删：幂等重标不报错", () => {
    seedTree();
    const tree0 = readOutlineFile(dir);
    const sc1 = tree0.children[0].children![0].children![0];
    deleteOutlineNode(dir, sc1.id, T1);
    expect(() => deleteOutlineNode(dir, sc1.id, T1)).not.toThrow();
  });

  it("原子写不破：操作抛错后原文件完好、无临时文件残留", () => {
    seedTree();
    expectOutlineError(() => deleteOutlineNode(dir, "root", T0), "NODE_NOT_FOUND"); // root 不是可操作节点
    expect(existsSync(join(dir, ".outline.json.tmp"))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "outline.json"), "utf8")).children).toHaveLength(2);
  });
});

describe("restoreOutlineNode（决策 12 修订）", () => {
  it("正常还原：清除标记 + 级联还原子树（仍软删的子孙一并还原）", () => {
    seedTree();
    const tree0 = readOutlineFile(dir);
    const v1 = tree0.children[0];
    deleteOutlineNode(dir, v1.id, T1);
    const r = restoreOutlineNode(dir, v1.id, T0);
    expect(r.children).toBe(2);
    const tree = readOutlineFile(dir);
    const vol = tree.children[0];
    expect(vol.deleted).toBeUndefined();
    expect(vol.deleted_at).toBeUndefined();
    expect(vol.children![0].deleted).toBeUndefined(); // 子孙一并还原
    expect(vol.children![0].children![0].deleted).toBeUndefined();
    expect(vol.updated_at).toBe(T0);
  });

  it("祖先软删 → OUTLINE_ANCESTOR_DELETED（409 语义，决策 12 修订）", () => {
    seedTree();
    const tree0 = readOutlineFile(dir);
    const v1 = tree0.children[0];
    const sc1 = v1.children![0].children![0];
    deleteOutlineNode(dir, v1.id, T1); // 祖先（卷）软删
    expectOutlineError(() => restoreOutlineNode(dir, sc1.id, T0), "OUTLINE_ANCESTOR_DELETED");
    // 先还原祖先后可还原子孙
    restoreOutlineNode(dir, v1.id, T0);
    expect(restoreOutlineNode(dir, sc1.id, T0).children).toBe(0);
  });
});

describe("purgeOutlineNode（物理删除）", () => {
  it("整棵子树从文件移除，find 不可见", () => {
    seedTree();
    const tree0 = readOutlineFile(dir);
    const v1 = tree0.children[0];
    purgeOutlineNode(dir, v1.id);
    const tree = readOutlineFile(dir);
    expect(tree.children).toHaveLength(1);
    expect(findOutlineNode(tree, v1.id)).toBeUndefined();
    // 子树节点一并消失
    expect(findOutlineNode(tree, v1.children![0].id)).toBeUndefined();
  });

  it("节点不存在 → NODE_NOT_FOUND", () => {
    expectOutlineError(() => purgeOutlineNode(dir, "sc-999"), "NODE_NOT_FOUND");
  });
});

describe("listDeletedNodes（回收站列表）", () => {
  it("收集所有软删节点（含子树内），按 deleted_at 倒序", () => {
    seedTree();
    const tree0 = readOutlineFile(dir);
    const v1 = tree0.children[0];
    const sc1 = v1.children![0].children![0];
    deleteOutlineNode(dir, sc1.id, "2026-08-01T00:00:00Z"); // 先删场景（较早）
    deleteOutlineNode(dir, v1.id, "2026-08-03T00:00:00Z"); // 再删卷（级联重标子孙 deleted_at 为 08-03）

    const list = listDeletedNodes(dir);
    // 卷、章1、场景1 均入回收站（级联软删重标 deleted_at——子节点随父级联，以级联时间为准）；
    // 倒序：同时间戳（08-03）保持先序遍历序，卷（最新）在最前
    expect(list.map((n) => n.id)).toEqual([v1.id, v1.children![0].id, sc1.id]);
    expect(list[0].title).toBe("第一卷");
    expect(list.every((n) => n.deleted_at !== undefined)).toBe(true);
    expect(list[0].deleted_at).toBe("2026-08-03T00:00:00Z");
  });

  it("无软删节点 → 空数组", () => {
    seedTree();
    expect(listDeletedNodes(dir)).toEqual([]);
  });
});

describe("章节序推导（决策 21）", () => {
  it("多卷多章跨卷连续编号：卷1[章1,章2] + 卷2[章3]", () => {
    seedTree();
    // 补充：卷1 再建一章（章2）
    const tree0 = readOutlineFile(dir);
    createOutlineNode(dir, { type: "chapter", title: "第二章", parentId: tree0.children[0].id, updatedAt: T0 });

    const order = deriveChapterOrder(dir);
    expect(order).toEqual([
      { chapterId: expect.stringMatching(/^ch-/), chapterNumber: 1 },
      { chapterId: expect.stringMatching(/^ch-/), chapterNumber: 2 },
      { chapterId: expect.stringMatching(/^ch-/), chapterNumber: 3 },
    ]);
    // 编号跨卷连续（卷2 的章 = 3）
    expect(order[2].chapterNumber).toBe(3);
  });

  it("scene 归入所属章：getChapterNumber(scene) = 父章序号；volume → null", () => {
    seedTree();
    const tree = readOutlineFile(dir);
    const sc1 = tree.children[0].children![0].children![0];
    const ch1 = tree.children[0].children![0];
    const info = getChapterNumber(dir, sc1.id);
    expect(info?.chapterId).toBe(ch1.id);
    expect(info?.chapterNumber).toBe(1);
    // volume 无章节号
    expect(getChapterNumber(dir, tree.children[0].id)).toBeNull();
    // 不存在节点 → null（防御）
    expect(getChapterNumber(dir, "sc-999")).toBeNull();
  });

  it("直接挂 root 的 chapter 按兄弟顺序编号（决策 19/21）", () => {
    createOutlineNode(dir, { type: "volume", title: "卷", parentId: "root", updatedAt: T0 });
    createOutlineNode(dir, { type: "chapter", title: "直挂章", parentId: "root", updatedAt: T0 });
    const t3 = readOutlineFile(dir);
    createOutlineNode(dir, { type: "chapter", title: "卷内章", parentId: t3.children[0].id, updatedAt: T0 });

    const order = deriveChapterOrder(dir);
    // root.children 顺序：卷（第1个，其内部章=1）、直挂章（第2个，=2）
    expect(order.map((c) => c.chapterNumber)).toEqual([1, 2]);
    expect(order[1].chapterNumber).toBe(2);
  });
});
