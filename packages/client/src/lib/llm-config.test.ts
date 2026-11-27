// 配置行写失败的回滚口径（DESIGN.md `session-status-bar`「配置写入」）：
// ① 只写回本次失败的字段（另一字段的在途成功值不得被盖掉）；
// ② 回读失败时退回写入前的本地快照（不留假的「已切换」值）。
import { describe, expect, it } from "vitest";
import type { SettingsLlmConfig } from "./api";
import { rollbackLlmConfig } from "./llm-config";

const base: SettingsLlmConfig = {
  provider: "p1",
  model: "m1",
  thinkingLevel: "max",
  providers: [],
};

describe("rollbackLlmConfig（配置行失败回滚）", () => {
  it("model 失败：只写回 provider + model，思考强度保留界面当前值", () => {
    const current: SettingsLlmConfig = { ...base, provider: "p2", model: "m2", thinkingLevel: "low" };
    const fresh: SettingsLlmConfig = { ...base, provider: "p1", model: "m1", thinkingLevel: "max" };
    const next = rollbackLlmConfig("model", current, fresh);
    expect(next.provider).toBe("p1");
    expect(next.model).toBe("m1");
    // 关键：界面上的思考强度是用户刚选的 low，不得被服务端旧值 max 盖回
    expect(next.thinkingLevel).toBe("low");
  });

  it("thinking 失败：只写回 thinkingLevel，模型保留界面当前值", () => {
    const current: SettingsLlmConfig = { ...base, provider: "p2", model: "m2", thinkingLevel: "low" };
    const fresh: SettingsLlmConfig = { ...base, provider: "p1", model: "m1", thinkingLevel: "max" };
    const next = rollbackLlmConfig("thinking", current, fresh);
    expect(next.thinkingLevel).toBe("max");
    expect(next.provider).toBe("p2");
    expect(next.model).toBe("m2");
  });

  it("回读失败（调用方传写入前快照）：退回快照，而不是留在乐观值", () => {
    const prev: SettingsLlmConfig = { ...base, provider: "p1", model: "m1" };
    const current: SettingsLlmConfig = { ...base, provider: "p9", model: "m9" };
    const next = rollbackLlmConfig("model", current, prev);
    expect(next.provider).toBe("p1");
    expect(next.model).toBe("m1");
  });
});
