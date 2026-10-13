// 「首帧直达上次工作区」判定（纯函数走查）：
// 服务端启动时已按创作根 lastProject 打开上次那个工作区（docs/design/build.md §启动流程），
// 本判定决定前端首帧是否把它送到该工作区，落点按 kind（`WORKSPACE_ENTRY_PATH`：小说 → #/overview、
// 练习 → #/practice）。
import { describe, expect, it } from "vitest";
import type { ProjectConfig, WorkspaceKind } from "@whispering233/ai-editor-shared";
import { shouldEnterLastBook } from "./use-enter-last-book";
import { WORKSPACE_ENTRY_PATH } from "../lib/workspace";

const config: ProjectConfig = {
  id: "proj-1",
  name: "我的小说",
  language: "zh",
  kind: "novel",
  schemaVersion: 1,
  currentPosition: null,
  deductionNodes: [], // （推演标记字段）
  backupFrequencyMinutes: 10,
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z",
};

describe("shouldEnterLastBook", () => {
  it("已打开项目 + 书架路由（空 hash / #/）→ 进概览", () => {
    expect(shouldEnterLastBook(config, "")).toBe(true);
    expect(shouldEnterLastBook(config, "#/")).toBe(true);
  });

  it("未打开项目 → 不进（留在书架引导 create/open）", () => {
    expect(shouldEnterLastBook(null, "#/")).toBe(false);
  });

  it("首帧已落在具体页面 → 不劫持（尊重地址栏 / 书签）", () => {
    expect(shouldEnterLastBook(config, "#/outline")).toBe(false);
    expect(shouldEnterLastBook(config, "#/preferences")).toBe(false);
  });

  it("未知 hash（回退书架）→ 视为书架路由，进概览", () => {
    expect(shouldEnterLastBook(config, "#/nope")).toBe(true);
  });
});

// 首帧落点按 kind（卡 8）：小说 → #/overview（**现状无回归**）、练习 → #/practice（它没有概览页，
// 落概览会打小说端点得 400 KIND_MISMATCH）。落点常量与 useEnterLastBook 消费同一处。
describe("首帧落点按工作区类型", () => {
  const forKind = (kind: WorkspaceKind): ProjectConfig => ({ ...config, kind });

  it("小说工作区：#/ 首帧 → #/overview（原行为）", () => {
    expect(shouldEnterLastBook(forKind("novel"), "#/")).toBe(true);
    expect(WORKSPACE_ENTRY_PATH.novel).toBe("/overview");
  });

  it("练习工作区：#/ 首帧 → #/practice", () => {
    expect(shouldEnterLastBook(forKind("practice"), "#/")).toBe(true);
    expect(WORKSPACE_ENTRY_PATH.practice).toBe("/practice");
  });
});
