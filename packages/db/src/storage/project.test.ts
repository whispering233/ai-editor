// T2.2 project.json 存储模块测试：缺失返回 null / 写读往返 / 原子写不残留 / 损坏抛错
// + 决策 41：AGENTS.md 项目规则文件读写（readAgentsFile/writeAgentsFile/agentsFileMtimeIso）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectFileConfig } from "@whispering233/ai-editor-shared";
import {
  AGENTS_FILE_NAME,
  PROJECT_FILE_NAME,
  agentsFileMtimeIso,
  readAgentsFile,
  readProjectFile,
  writeAgentsFile,
  writeProjectFile,
} from "./project.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-project-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 合法 project.json 配置（schema.md 契约字段全量） */
function makeConfig(): ProjectFileConfig {
  return {
    id: "proj-abc123",
    name: "我的小说",
    language: "zh",
    prompt: "力量体系：练气→筑基→金丹",
    schema_version: 1,
    current_position: "sc-42",
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
  };
}

describe("readProjectFile", () => {
  it("文件不存在返回 null（未初始化语义，决策 8 由上层创建）", () => {
    expect(readProjectFile(dir)).toBeNull();
  });

  it("写读往返：writeProjectFile 后读回深比较一致", () => {
    const config = makeConfig();
    writeProjectFile(dir, config);
    expect(readProjectFile(dir)).toEqual(config);
  });

  it("文件存在但 JSON 损坏抛错，不静默重建", () => {
    writeFileSync(join(dir, PROJECT_FILE_NAME), "{ broken", "utf8");
    expect(() => readProjectFile(dir)).toThrow();
  });

  it("顶层结构不符契约抛错：id / name / schema_version 任一缺失或类型不符（与 outline 校验对称）", () => {
    const cases: Array<{ label: string; json: string }> = [
      { label: "缺 id", json: '{"name":"我的小说","schema_version":1}' },
      { label: "id 非 string", json: '{"id":123,"name":"我的小说","schema_version":1}' },
      { label: "缺 name", json: '{"id":"proj-1","schema_version":1}' },
      { label: "缺 schema_version", json: '{"id":"proj-1","name":"我的小说"}' },
      { label: "schema_version 非 number", json: '{"id":"proj-1","name":"我的小说","schema_version":"1"}' },
    ];
    for (const c of cases) {
      writeFileSync(join(dir, PROJECT_FILE_NAME), c.json, "utf8");
      expect(() => readProjectFile(dir)).toThrow(/顶层结构不符/);
    }
  });
});

describe("writeProjectFile", () => {
  it("走决策 11 原子写：完成后无临时文件残留（schema.md 第 186 行）", () => {
    writeProjectFile(dir, makeConfig());
    expect(existsSync(join(dir, PROJECT_FILE_NAME))).toBe(true);
    expect(existsSync(join(dir, ".project.json.tmp"))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, PROJECT_FILE_NAME), "utf8"))).toEqual(makeConfig());
  });

  it("覆盖写：旧配置被原子替换", () => {
    writeProjectFile(dir, makeConfig());
    const updated = { ...makeConfig(), name: "改名", updated_at: "2026-08-02T10:00:00Z" };
    writeProjectFile(dir, updated);
    expect(readProjectFile(dir)).toEqual(updated);
  });
});

// ============ AGENTS.md 项目规则文件（决策 41） ============

describe("AGENTS.md 读写（决策 41：项目规则唯一事实源）", () => {
  it("readAgentsFile：文件不存在返回 null（可选文件语义）", () => {
    expect(readAgentsFile(dir)).toBeNull();
  });

  it("写读往返：writeAgentsFile 后读回内容一致（原样文本，不追加换行）", () => {
    writeAgentsFile(dir, "力量体系：练气→筑基→金丹");
    expect(readAgentsFile(dir)).toBe("力量体系：练气→筑基→金丹");
  });

  it("writeAgentsFile 走决策 11 原子写：完成后无临时文件残留", () => {
    writeAgentsFile(dir, "规则内容");
    expect(existsSync(join(dir, AGENTS_FILE_NAME))).toBe(true);
    expect(existsSync(join(dir, `.${AGENTS_FILE_NAME}.tmp`))).toBe(false);
  });

  it("空串写入 = 清空规则（保留空文件不删除，exists 语义稳定）", () => {
    writeAgentsFile(dir, "旧规则");
    writeAgentsFile(dir, "");
    expect(readAgentsFile(dir)).toBe("");
    expect(existsSync(join(dir, AGENTS_FILE_NAME))).toBe(true);
  });

  it("agentsFileMtimeIso：文件存在返回 ISO 8601；不存在返回 null", () => {
    expect(agentsFileMtimeIso(dir)).toBeNull();
    writeAgentsFile(dir, "规则");
    const mtime = agentsFileMtimeIso(dir);
    expect(mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
