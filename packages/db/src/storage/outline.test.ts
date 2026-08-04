// T2.2 outline.json 存储模块测试：读写 / 缺失语义 / 损坏抛错 / 节点查找 / 版本戳更新 / 路径
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileNode, OutlineFileTree } from "@whispering233/ai-editor-shared";
import { SCHEMA_VERSION } from "../schema.js";
import {
  findOutlineNode,
  getOutlinePathIds,
  OUTLINE_FILE_NAME,
  readOutlineFile,
  touchOutlineNode,
  updateOutlineNode,
  writeOutlineFile,
} from "./outline.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-outline-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 构造一个严格三层的大纲树（卷→章→场景，决策 19） */
function makeTree(): OutlineFileTree {
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
              { id: "sc-1", type: "scene", title: "灵根测试", updated_at: T0 },
              { id: "sc-2", type: "scene", title: "拜入山门", updated_at: T0 },
            ],
          },
          { id: "ch-2", type: "chapter", title: "第二章", updated_at: T0, children: [] },
        ],
      },
      { id: "vol-2", type: "volume", title: "第二卷", updated_at: T0 },
    ],
  };
}

/** 收集树上所有节点的 updated_at 快照（id → updated_at） */
function allUpdatedAt(tree: OutlineFileTree): Record<string, string> {
  const map: Record<string, string> = {};
  const visit = (n: OutlineFileNode): void => {
    map[n.id] = n.updated_at;
    const children = (n as { children?: readonly OutlineFileNode[] }).children;
    for (const c of children ?? []) visit(c);
  };
  for (const vol of tree.children) visit(vol);
  return map;
}

describe("readOutlineFile", () => {
  it("文件不存在返回最小空树（schema_version 取当前常量，决策 13）", () => {
    const tree = readOutlineFile(dir);
    expect(tree).toEqual({ id: "root", type: "root", schema_version: SCHEMA_VERSION, children: [] });
  });

  it("缺失返回的空树是新对象：修改它不影响后续读取", () => {
    const first = readOutlineFile(dir);
    first.children.push({ id: "vol-x", type: "volume", title: "脏数据", updated_at: T0 });
    expect(readOutlineFile(dir).children).toEqual([]);
  });

  it("写读往返：writeOutlineFile 后 readOutlineFile 深比较一致（含 schema_version 原样保留）", () => {
    const tree = makeTree();
    writeOutlineFile(dir, tree);
    expect(readOutlineFile(dir)).toEqual(tree);
  });

  it("JSON 损坏抛错，不静默重建（防掩盖文件损坏）", () => {
    writeFileSync(join(dir, OUTLINE_FILE_NAME), "{ 这不是合法 JSON", "utf8");
    expect(() => readOutlineFile(dir)).toThrow();
  });

  it("顶层结构不符契约抛错（id/type/schema_version/children 任一缺失）", () => {
    writeFileSync(join(dir, OUTLINE_FILE_NAME), '{"id":"root","type":"root","children":[]}', "utf8"); // 缺 schema_version
    expect(() => readOutlineFile(dir)).toThrow(/顶层结构不符/);
    writeFileSync(join(dir, OUTLINE_FILE_NAME), '{"id":"vol-1","type":"volume","schema_version":1,"children":[]}', "utf8");
    expect(() => readOutlineFile(dir)).toThrow(/顶层结构不符/);
  });
});

describe("findOutlineNode", () => {
  it("多层树定位：卷 / 章 / 场景均可命中", () => {
    const tree = makeTree();
    expect(findOutlineNode(tree, "vol-1")?.title).toBe("第一卷");
    expect(findOutlineNode(tree, "ch-1")?.title).toBe("第一章");
    expect(findOutlineNode(tree, "sc-2")?.title).toBe("拜入山门");
    // 无 children 的卷（vol-2）也能被找到
    expect(findOutlineNode(tree, "vol-2")?.title).toBe("第二卷");
  });

  it("未找到返回 undefined", () => {
    expect(findOutlineNode(makeTree(), "sc-999")).toBeUndefined();
  });
});

describe("touchOutlineNode（决策 19：版本戳统一更新）", () => {
  it("目标节点 updated_at 更新，其余节点 updated_at 不变", () => {
    const tree = makeTree();
    const before = allUpdatedAt(tree);
    const t1 = "2026-08-02T10:00:00Z";

    touchOutlineNode(tree, "ch-1", t1);
    const after = allUpdatedAt(tree);

    expect(after["ch-1"]).toBe(t1);
    expect(after["ch-1"]).not.toBe(before["ch-1"]);
    // 其余节点（含父卷与子场景）版本戳不变
    for (const id of Object.keys(after)) {
      if (id !== "ch-1") expect(after[id]).toBe(before[id]);
    }
  });

  it("节点不存在时抛错（静默忽略会掩盖调用方 bug）", () => {
    expect(() => touchOutlineNode(makeTree(), "sc-999", T0)).toThrow(/不存在/);
  });
});

describe("updateOutlineNode（字段更新 + 版本戳统一更新，决策 19）", () => {
  it("title/summary 更新且 updated_at 统一更新，其余节点不变", () => {
    const tree = makeTree();
    const before = allUpdatedAt(tree);
    const t1 = "2026-08-03T08:00:00Z";

    const node = updateOutlineNode(tree, "sc-1", { title: "灵根测试失败", summary: "改名了" }, t1);

    expect(node.title).toBe("灵根测试失败");
    expect(node.summary).toBe("改名了");
    expect(node.updated_at).toBe(t1);
    const after = allUpdatedAt(tree);
    for (const id of Object.keys(after)) {
      if (id !== "sc-1") expect(after[id]).toBe(before[id]);
    }
    // 修改的是树内同一引用（就地修改）
    expect(findOutlineNode(tree, "sc-1")?.title).toBe("灵根测试失败");
  });

  it("软删字段可更新（决策 12：deleted + deleted_at）", () => {
    const tree = makeTree();
    updateOutlineNode(tree, "vol-2", { deleted: true, deleted_at: T0 }, T0);
    const vol2 = findOutlineNode(tree, "vol-2");
    expect(vol2?.deleted).toBe(true);
    expect(vol2?.deleted_at).toBe(T0);
  });

  it("节点不存在时抛错", () => {
    expect(() => updateOutlineNode(makeTree(), "ch-999", { title: "x" }, T0)).toThrow(/不存在/);
  });
});

describe("getOutlinePathIds", () => {
  it("返回根 → 节点的完整路径（含 root 与自身，供章节序 / computeState 用）", () => {
    const tree = makeTree();
    expect(getOutlinePathIds(tree, "sc-2")).toEqual(["root", "vol-1", "ch-1", "sc-2"]);
    expect(getOutlinePathIds(tree, "vol-2")).toEqual(["root", "vol-2"]);
  });

  it("节点不存在时抛错（路径唯一是严格三层的推论）", () => {
    expect(() => getOutlinePathIds(makeTree(), "sc-999")).toThrow(/不存在/);
  });
});
