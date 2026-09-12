// 「首帧直达上次书籍」判定（纯函数走查）：
// 服务端启动时已按创作根 lastProject 打开上次那本书（docs/design/build.md §启动流程），
// 本判定决定前端首帧是否把它送到该书概览。
import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "@whispering233/ai-editor-shared";
import { shouldEnterLastBook } from "./use-enter-last-book";

const config: ProjectConfig = {
  id: "proj-1",
  name: "我的小说",
  language: "zh",
  schemaVersion: 1,
  currentPosition: null,
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
