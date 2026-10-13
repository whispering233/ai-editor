// 冒烟测试：验证 @whispering233/ai-editor-tools 入口可正常导入（T0.3 语义）
// 冒烟断言为新入口形态：注册表 API + 工具副作用注册（查询 11 + 分析 5 +
// S6.5 伏笔 5 + S6.6 提案 16 + S6.7 卡 12.9（get_chapter_text）1 + D4（get_deduction_marks）1
// + 练习 3（两读一提交，scope = practice）= 40 个；执行 13 个不暴露）；
// workspace 依赖 @whispering233/ai-editor-db / @whispering233/ai-editor-shared 解析由 import 在编译/运行期验证
import { describe, expect, it } from "vitest";
import { AUTO_TOOLS, CHARACTER_PRIORITIES, CHARACTER_PRIORITY_LABELS, DEFAULT_HALF_LIFE, MAX_FEEDBACK_DIMENSIONS, PRACTICE_TOOLS, PROPOSAL_TOOLS, TOOL_SCOPES } from "@whispering233/ai-editor-shared";
import * as m from "./index";

describe("@whispering233/ai-editor-tools 入口冒烟", () => {
  it("可正常导入：注册表/上下文/工具 API 导出，且查询/分析/伏笔/提案工具已注册", () => {
    expect(m).toBeDefined();
 // registry API
    expect(typeof m.registerTool).toBe("function");
    expect(typeof m.registerTools).toBe("function");
    expect(typeof m.getTool).toBe("function");
    expect(typeof m.listTools).toBe("function");
 // 查询工具实现导出（S6.3）
    expect(typeof m.runGetEntity).toBe("function");
    expect(typeof m.runSearchEntities).toBe("function");
    expect(typeof m.runQueryRelationships).toBe("function");
    expect(typeof m.runGetOutline).toBe("function");
    expect(typeof m.runGetOutlinePath).toBe("function");
    expect(typeof m.runComputeState).toBe("function");
    expect(typeof m.runGetDeltaHistory).toBe("function");
    expect(typeof m.runGetEntitySummary).toBe("function");
 // 提案工具实现导出（S6.6）
    expect(typeof m.runProposeCreateEntity).toBe("function");
    expect(typeof m.runProposeAddDelta).toBe("function");
    expect(typeof m.runProposeAdvanceHook).toBe("function");
 // 入口副作用注册：查询 11 + 分析 5 + 伏笔 5 + 提案 16 + 练习 3 = 40 个（含 get_chapter_text 正文只读 + get_deduction_marks 推演标记）
    expect(m.toolCount()).toBe(40);
    expect(m.getTool("get_entity")).toBeDefined();
    expect(m.getTool("get_chapter_text")!.permission).toBe("auto"); // 正文只读：自动权限
 // 分页数值防漂移：description 由 query/manuscript.ts 的常量插值生成
    const chapterTextDescription = m.getTool("get_chapter_text")!.description;
    const descriptionNumbers = chapterTextDescription.match(/\d{4,}/g) ?? [];
    // 描述里 4 位以上的数字集合必须恰好 = {缺省, 上限}：既证两个常量真的进了描述，
    // 也挡住任何手写数值（如残留的「上限 20000」）——改为硬编码 / 改了值没同步，此处报红
    expect(new Set(descriptionNumbers)).toEqual(
      new Set([String(m.DEFAULT_TEXT_PAGE_CHARS), String(m.MAX_TEXT_PAGE_CHARS)]),
    );
 // 练习工具分页描述同源：同两个常量（文本分页预算单源），同样挡住手写数字与值改了没同步
    for (const name of ["get_practice_sample", "get_practice_draft"]) {
      const practiceDescription = m.getTool(name)!.description;
      expect(new Set(practiceDescription.match(/\d{4,}/g) ?? [])).toEqual(
        new Set([String(m.DEFAULT_TEXT_PAGE_CHARS), String(m.MAX_TEXT_PAGE_CHARS)]),
      );
    }
 // 维度上限防漂移：submit_style_feedback 的 description 由 shared MAX_FEEDBACK_DIMENSIONS 插值生成
    expect(m.getTool("submit_style_feedback")!.description).toContain(
      `dimensions 最多 ${MAX_FEEDBACK_DIMENSIONS} 个维度`,
    );
 // 半衰期缺省映射防漂移：description 由 shared DEFAULT_HALF_LIFE 插值生成——
 // 改成手写数字 / 值改了没同步，逐项比对即报红
    const hookHealthDescription = m.getTool("analyze_hook_health")!.description;
    for (const [timing, chapters] of Object.entries(DEFAULT_HALF_LIFE)) {
      expect(hookHealthDescription).toContain(`${timing}=${chapters}`);
    }
 // 角色优先级档防漂移：两处实体提案 description 的档位片段由 shared 常量插值生成——
 // 期望值现算于常量（不手抄中文 / 不复述清单）；改成手写、漏一档、顺序漂移，逐项比对即报红
    const priorityPairs = CHARACTER_PRIORITIES.map((key) => `${key}(${CHARACTER_PRIORITY_LABELS[key]})`).join("/");
    for (const name of ["propose_create_entity", "propose_update_entity"]) {
      const description = m.getTool(name)!.description;
      expect(description).toContain(`priority=${priorityPairs}`);
      expect(description).toContain("省略或 null = 未分级");
    }
 // 已移除字段（REMOVED_CHARACTER_FIELDS 会拒）不得作为角色 data 示例：旧文案会把模型引向必然失败
    expect(m.getTool("propose_create_entity")!.description).not.toContain("role/status");
 // 正向钉住「已分级字段示例」本身（防整段示例被删而无感）：create 侧必须给出可用的角色字段示例
    expect(m.getTool("propose_create_entity")!.description).toContain("角色 role/priority");
 // 提案类工具权限为 PROPOSAL（「提案类（需确认）」）
    expect(m.getTool("propose_create_entity")!.permission).toBe("proposal");
    expect(m.getTool("propose_abandon_hook")!.permission).toBe("proposal");
    expect(m.getTool("propose_reorder_timepoints")!.permission).toBe("proposal");
 // 全部提案工具注册（`PROPOSAL_TOOLS` 常量与注册表一致；含 propose_create_reference）
    expect(PROPOSAL_TOOLS.length).toBe(16);
    for (const name of PROPOSAL_TOOLS) {
      expect(m.getTool(name)).toBeDefined();
    }
  });

 // 跨包单源守卫：shared 的工具目录常量（AUTO_TOOLS + PRACTICE_TOOLS + PROPOSAL_TOOLS）与 registry 事实源必须**同集**——
 // 新增工具只改 registry 不改 shared 常量（或反之）时，此处报红（此前两者无同步守卫，目录常量曾静默漂移）。
 // EXECUTOR_TOOLS 不参与：执行类工具**不注册 registry**（LLM 不可见，见 ./index.js 头注释）。
 // 断言放本文件而非 registry.test.ts：后者会注册 4 个测试辅助工具，listTools 并非纯目录。
  it("shared 工具目录常量与 registry 注册表同集（无遗漏 / 无多余）", () => {
    const registered = new Set(m.listTools().map((tool) => tool.name));
    expect(registered).toEqual(new Set([...AUTO_TOOLS, ...PRACTICE_TOOLS, ...PROPOSAL_TOOLS]));
  });

 // 工具 scope（工作区作用域，2026-10）：既有 37 个工具全为 novel（逐名对账，不用「长度相等」代替）
 // + 练习三个为 practice（**误标 common ⇒ 小说侧变 40；误标 novel ⇒ 小说集合逐名相等报红**）。
  it("scope 无遗漏：每个已注册工具的 scope 合法，novel 集合 = 既有 37 个、practice 集合 = 练习三个（逐名相等）", () => {
    const legacyToolNames = [
      "analyze_consistency",
      "analyze_hook_health",
      "compute_state",
      "detect_conflicts",
      "detect_hook_conflicts",
      "find_hook_opportunities",
      "find_orphan_elements",
      "get_chapter_text",
      "get_deduction_marks",
      "get_delta_history",
      "get_entity",
      "get_entity_summary",
      "get_outline",
      "get_outline_path",
      "propose_abandon_hook",
      "propose_add_delta",
      "propose_add_relation",
      "propose_advance_hook",
      "propose_create_entity",
      "propose_create_hook",
      "propose_create_reference",
      "propose_delete_entity",
      "propose_delete_node",
      "propose_move_node",
      "propose_outline_node",
      "propose_remove_relation",
      "propose_reorder_timepoints",
      "propose_resolve_hook",
      "propose_update_entity",
      "propose_update_hook",
      "query_relationships",
      "search_entities",
      "search_references",
      "suggest_connections",
      "suggest_hook_payoff",
      "trace_hook_lifecycle",
      "trace_plot_paths",
    ];
    const tools = m.listTools();
    for (const tool of tools) {
      expect(TOOL_SCOPES, `工具 ${tool.name} 的 scope 非法`).toContain(tool.scope);
    }
    expect(tools.filter((tool) => tool.scope === "novel").map((tool) => tool.name)).toEqual(legacyToolNames);
    expect(tools.filter((tool) => tool.scope === "practice").map((tool) => tool.name)).toEqual([...PRACTICE_TOOLS].sort());
    expect(tools).toHaveLength(legacyToolNames.length + PRACTICE_TOOLS.length);
  });
});
