// 预置作家素材目录测试：清单稳定性 / id 形状与全局唯一 / 解析守卫（契约为 docs/design/60-practice.md §3）
import { describe, expect, it } from "vitest";
import {
  AUTHOR_CATALOG,
  AUTHOR_IDS,
  PRACTICE_OTHER_WORK_LABEL,
  resolveAuthor,
  resolveWork,
} from "./index.js";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("预置作家清单", () => {
  it("清单非空、键与条目 id 一致、AUTHOR_IDS 顺序 = 清单声明顺序", () => {
    expect(AUTHOR_IDS.length).toBeGreaterThan(0);
    expect(AUTHOR_IDS).toEqual(Object.keys(AUTHOR_CATALOG));
    for (const id of AUTHOR_IDS) {
      expect(AUTHOR_CATALOG[id].id).toBe(id);
      expect(AUTHOR_CATALOG[id].name.trim()).not.toBe("");
      expect(AUTHOR_CATALOG[id].intro.trim()).not.toBe("");
      expect(AUTHOR_CATALOG[id].styleNotes.trim()).not.toBe("");
      expect(AUTHOR_CATALOG[id].works.length).toBeGreaterThan(0);
    }
  });

  it("作品 id 全局唯一、形状为 slug，且作品显示名与介绍非空", () => {
    const ids = AUTHOR_IDS.flatMap((id) => AUTHOR_CATALOG[id].works.map((work) => work.id));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const workId of ids) expect(workId).toMatch(SLUG_RE);
    for (const id of AUTHOR_IDS) {
      for (const work of AUTHOR_CATALOG[id].works) {
        expect(work.name.trim()).not.toBe("");
        expect(work.intro.trim()).not.toBe("");
      }
    }
  });

  it("「其他」兜底文案是唯一定义处（客户端与服务端都取它）", () => {
    expect(PRACTICE_OTHER_WORK_LABEL).toBe("其他");
  });
});

describe("resolveAuthor", () => {
  it("已知 id → 条目本身", () => {
    for (const id of AUTHOR_IDS) expect(resolveAuthor(id)).toBe(AUTHOR_CATALOG[id]);
  });

  it("未知值 / 非字符串 / 原型键 → null（不做名字认领）", () => {
    expect(resolveAuthor("nobody")).toBeNull();
    expect(resolveAuthor("")).toBeNull();
    expect(resolveAuthor(undefined)).toBeNull();
    expect(resolveAuthor(null)).toBeNull();
    expect(resolveAuthor(123)).toBeNull();
    expect(resolveAuthor({ id: "jiangnan" })).toBeNull();
    expect(resolveAuthor("__proto__")).toBeNull();
    expect(resolveAuthor("constructor")).toBeNull();
    expect(resolveAuthor("toString")).toBeNull();
  });
});

describe("resolveWork", () => {
  it("已知作家 + 已知作品 → 作品本身", () => {
    const author = AUTHOR_IDS[0];
    const work = AUTHOR_CATALOG[author].works[0];
    expect(resolveWork(author, work.id)).toBe(work);
  });

  it("未知作品 id / 未知作家（跨作者）→ null", () => {
    expect(resolveWork(AUTHOR_IDS[0], "no-such-work")).toBeNull();
    expect(resolveWork("nobody", AUTHOR_CATALOG[AUTHOR_IDS[0]].works[0].id)).toBeNull();
    expect(resolveWork("", "")).toBeNull();
  });
});