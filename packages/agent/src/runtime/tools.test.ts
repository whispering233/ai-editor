// K2 工具适配层测试：领域工具 → pi 工具定义（TypeBox 直通 + 提案载荷走 details）
//
// 用 registry 的真实工具（35 个）验证适配面，不 mock 工具实现：
// - get_outline：AUTO 工具，content = 结果文本化，details = 原始结果
// - propose_create_entity：PROPOSAL 工具，接 sink 时 content 只给「提案已发出」，details = 载荷
// - compute_state：stub db 下必然抛错 → execute 必须 reject（抛错即失败，不编码进 content）

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listTools, type ToolContext } from "@whispering233/ai-editor-tools";
import { createCustomTools, type ProposalPayload } from "./tools.js";

function stubContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return { db: {} as ToolContext["db"], outlineDir: "/nonexistent-project", projectId: "proj-tools-test", ...overrides };
}

function findTool(name: string) {
  const tools = createCustomTools({ toolContext: stubContext() });
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`工具未装配: ${name}`);
  return tool;
}

describe("createCustomTools", () => {
  it("转发 registry 全部工具（名称/描述/参数 schema 同一对象）", () => {
    const defs = listTools();
    const tools = createCustomTools({ toolContext: stubContext() });
    expect(tools).toHaveLength(defs.length);
    expect(tools.map((tool) => tool.name)).toEqual(defs.map((def) => def.name));
    for (const def of defs) {
      const tool = tools.find((candidate) => candidate.name === def.name);
      expect(tool?.description).toBe(def.description);
      expect(tool?.parameters).toBe(def.parameters);
    }
  });
});

describe("AUTO 工具", () => {
  it("get_outline：content 为结果文本化，details 为原始结果", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-editor-k2-toolresult-"));
    try {
      writeFileSync(
        join(dir, "outline.json"),
        JSON.stringify({ id: "root", type: "root", schema_version: 1, children: [] }),
      );
      const tools = createCustomTools({ toolContext: stubContext({ outlineDir: dir }) });
      const tool = tools.find((candidate) => candidate.name === "get_outline");
      const result = await tool!.execute("call-1", {} as never, undefined, undefined, {} as never);
      const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
      expect(text).toContain("\"children\"");
      expect(result.details).toEqual(JSON.parse(text));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("compute_state：工具内部抛错 → execute reject（不编码进 content）", async () => {
    const tool = findTool("compute_state");
    await expect(
      tool.execute(
        "call-2",
        { target_type: "character", target_id: "char-1", at_node_id: "ch-1" } as never,
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe("PROPOSAL 工具", () => {
  it("接 sink：content 只给『提案已发出』，details = sink 返回的载荷", async () => {
    const payload: ProposalPayload = {
      proposal_id: "prop_x",
      type: "propose_create_entity",
      preview: { summary: "创建实体「张三」" },
    };
    const seen: Array<{ toolName: string; params: unknown; result: unknown }> = [];
    const tools = createCustomTools({
      toolContext: stubContext(),
      proposalSink: (input) => {
        seen.push({ toolName: input.toolName, params: input.params, result: input.result });
        return payload;
      },
    });
    const tool = tools.find((candidate) => candidate.name === "propose_create_entity")!;
    const result = await tool.execute(
      "call-3",
      { type: "character", name: "张三" } as never,
      undefined,
      undefined,
      {} as never,
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.toolName).toBe("propose_create_entity");
    expect(seen[0]?.params).toEqual({ type: "character", name: "张三" });
    expect(seen[0]?.result).toMatchObject({ proposal_id: expect.any(String) });

    const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    expect(text).toContain("提案已发出");
    expect(text).toContain("prop_x");
    expect(text).not.toContain("preview");
    expect(result.details).toEqual(payload);
  });

  it("未接 sink：回退为结果文本化（过渡期行为，K3 接线后不再发生）", async () => {
    const tool = findTool("propose_create_entity");
    const result = await tool.execute(
      "call-4",
      { type: "character", name: "李四" } as never,
      undefined,
      undefined,
      {} as never,
    );
    const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    expect(text).toContain("proposal_id");
    expect(result.details).toMatchObject({ proposal_id: expect.any(String) });
  });
});
