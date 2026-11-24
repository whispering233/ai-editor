// server：pi 配置目录内核的单测（docs/design/tasks.md 卡 1）
//
// 隔离纪律：**不依赖 HOME 重定向**（Windows 的 `os.homedir()` 读 `USERPROFILE`，改 HOME 不生效），
// 一律用 mkdtemp 的临时路径注入；`process.env.PI_CODING_AGENT_DIR` 用例后原样恢复。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyPiConfigChange,
  DEFAULT_PI_AGENT_DIR,
  initPiAgentDir,
  readConfiguredAgentDir,
  resolvePiAgentDir,
  writeConfiguredAgentDir,
} from "./pi-agent-dir.js";
import { getSettingsManager, resetModelRuntime } from "./model-runtime.js";

let dirs: string[] = [];
let originalEnv: string | undefined;

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ai-editor-pi-dir-"));
  dirs.push(dir);
  return dir;
}

/** 写一份 pi.json 并返回其路径（config 由用例决定形状，可以是非法 JSON 文本） */
function configFile(content: string): string {
  const path = join(tempDir(), "pi.json");
  writeFileSync(path, content);
  return path;
}

beforeEach(() => {
  originalEnv = process.env.PI_CODING_AGENT_DIR;
});

afterEach(() => {
  // 先释放单例（它持有用例内的路径），再恢复 env
  resetModelRuntime();
  if (originalEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalEnv;
  originalEnv = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("解析：配置值 → 缺省", () => {
  it("配置不存在 → 缺省 ~/.ai-editor/pi-agent", () => {
    const path = join(tempDir(), "missing.json");
    expect(readConfiguredAgentDir(path)).toBeNull();
    expect(resolvePiAgentDir(path)).toBe(DEFAULT_PI_AGENT_DIR);
  });

  it("绝对路径的 agentDir 生效", () => {
    const target = join(tempDir(), "pi-agent");
    const path = configFile(JSON.stringify({ agentDir: target }));
    expect(readConfiguredAgentDir(path)).toBe(target);
    expect(resolvePiAgentDir(path)).toBe(target);
  });

  it("相对路径 / 空串 / 非字符串 / 顶层数组 / 坏 JSON → 一律回落缺省（不抛错）", () => {
    const cases = [
      JSON.stringify({ agentDir: "relative/dir" }),
      JSON.stringify({ agentDir: "   " }),
      JSON.stringify({ agentDir: 42 }),
      JSON.stringify(["agentDir"]),
      "{ 坏 JSON",
    ];
    for (const content of cases) {
      const path = configFile(content);
      expect(readConfiguredAgentDir(path)).toBeNull();
      expect(resolvePiAgentDir(path)).toBe(DEFAULT_PI_AGENT_DIR);
    }
  });
});

describe("写：合并写 + 原子写", () => {
  it("只改 agentDir，保留未知键，并自动创建父目录", () => {
    const target = join(tempDir(), "pi-agent");
    const path = join(tempDir(), "nested", ".ai-editor", "pi.json");
    writeConfiguredAgentDir(target, path);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ agentDir: target });

    // 预置未知键后再写一次：未知键必须原样保留
    writeFileSync(path, JSON.stringify({ agentDir: "/old", keepMe: { a: 1 } }));
    writeConfiguredAgentDir(target, path);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ agentDir: target, keepMe: { a: 1 } });
  });
});

describe("落地：env 与生效点", () => {
  it("initPiAgentDir(override) 写 env，且 pi 的 getAgentDir() 认这个变量（反验常量字面量）", () => {
    const target = join(tempDir(), "pi-agent");
    expect(initPiAgentDir(target)).toBe(target);
    expect(process.env.PI_CODING_AGENT_DIR).toBe(target);
    expect(getAgentDir()).toBe(target); // pi 自己的读取函数——字面量写错这里就红
  });

  it("initPiAgentDir() 无参 = 配置值（本机无 pi.json 时为缺省）", () => {
    const dir = initPiAgentDir();
    expect(dir).toBe(resolvePiAgentDir());
    expect(process.env.PI_CODING_AGENT_DIR).toBe(dir);
  });

  it("applyPiConfigChange 换目录后，SettingsManager 立即读新目录的 settings.json", () => {
    const first = tempDir();
    const second = tempDir();
    writeFileSync(join(first, "settings.json"), JSON.stringify({ defaultProvider: "deepseek", defaultModel: "m-1" }));
    writeFileSync(join(second, "settings.json"), JSON.stringify({ defaultProvider: "opencode-go", defaultModel: "m-2" }));

    applyPiConfigChange(first);
    expect(getSettingsManager().getDefaultModel()).toBe("m-1");

    applyPiConfigChange(second);
    expect(getSettingsManager().getDefaultModel()).toBe("m-2");
    expect(process.env.PI_CODING_AGENT_DIR).toBe(second);
  });
});