// 冒烟测试：验证 @whispering233/ai-editor-tools 入口可正常导入（T0.3 语义）
// 冒烟断言为新入口形态：注册表 API + 工具副作用注册（查询 10 + 分析 5 +
// S6.5 伏笔 5 + S6.6 提案 16 + S6.7 卡 12.9（get_chapter_text）1 = 36 个；执行 13 个不暴露）；
// workspace 依赖 @whispering233/ai-editor-db / @whispering233/ai-editor-shared 解析由 import 在编译/运行期验证
import { describe, expect, it } from "vitest";
import { DEFAULT_HALF_LIFE, PROPOSAL_TOOLS } from "@whispering233/ai-editor-shared";
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
 // 入口副作用注册：查询 10 + 分析 5 + 伏笔 5 + 提案 16 = 36 个（+get_chapter_text 正文只读）
    expect(m.toolCount()).toBe(36);
    expect(m.getTool("get_entity")).toBeDefined();
    expect(m.getTool("get_chapter_text")!.permission).toBe("auto"); // 正文只读：自动权限
 // 分页数值防漂移：description 由 query/manuscript.ts 的常量插值生成
    const chapterTextDescription = m.getTool("get_chapter_text")!.description;
    const descriptionNumbers = chapterTextDescription.match(/\d{4,}/g) ?? [];
    // 描述里 4 位以上的数字集合必须恰好 = {缺省, 上限}：既证两个常量真的进了描述，
    // 也挡住任何手写数值（如残留的「上限 20000」）——改为硬编码 / 改了值没同步，此处报红
    expect(new Set(descriptionNumbers)).toEqual(
      new Set([String(m.DEFAULT_CHAPTER_TEXT_CHARS), String(m.MAX_CHAPTER_TEXT_CHARS)]),
    );
 // 半衰期缺省映射防漂移：description 由 shared DEFAULT_HALF_LIFE 插值生成——
 // 改成手写数字 / 值改了没同步，逐项比对即报红
    const hookHealthDescription = m.getTool("analyze_hook_health")!.description;
    for (const [timing, chapters] of Object.entries(DEFAULT_HALF_LIFE)) {
      expect(hookHealthDescription).toContain(`${timing}=${chapters}`);
    }
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
});
