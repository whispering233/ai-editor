// 建立关联对话框关系类型选项测试（卡片 1.6：伏笔锚点仅章——非章大纲节点源排除伏笔三类）
// 服务端契约（非章 → 400）由 packages/server/src/routes/relation.test.ts 覆盖，
// 本测试锁 UI 侧同向收窄：不留必定 400 的死胡同。
import { describe, expect, it } from "vitest";
import { dialogRelationTypeOptions } from "./relation-types";

const HOOK_TYPES = ["plants", "advances", "resolves"];

describe("dialogRelationTypeOptions（源端层级过滤）", () => {
  it("章节点源 → 伏笔三类全可选（与基集一致）", () => {
    const options = dialogRelationTypeOptions({ type: "outline_node", nodeType: "chapter" });
    for (const t of HOOK_TYPES) expect(options).toContain(t);
  });

  it("卷 / 场景节点源 → 排除伏笔三类（服务端 400，UI 不给入口）", () => {
    for (const nodeType of ["volume", "scene"] as const) {
      const options = dialogRelationTypeOptions({ type: "outline_node", nodeType });
      for (const t of HOOK_TYPES) expect(options).not.toContain(t);
    }
  });

  it("nodeType 缺失 → 按非章处理（fail-closed，少一个选项而非留死入口）", () => {
    const options = dialogRelationTypeOptions({ type: "outline_node" });
    for (const t of HOOK_TYPES) expect(options).not.toContain(t);
  });

  it("实体源（人物 / 参考资料）→ 不受限（含伏笔三类）", () => {
    for (const type of ["character", "reference"]) {
      const options = dialogRelationTypeOptions({ type });
      for (const t of HOOK_TYPES) expect(options).toContain(t);
    }
  });

  it("列表模式（source 为 null）→ 不受限（源端下拉只有实体类型，不产生该组合）", () => {
    const options = dialogRelationTypeOptions(null);
    for (const t of HOOK_TYPES) expect(options).toContain(t);
  });

  it("基集恒排除 occurs_at（挂载由时间轴 UI 专管）", () => {
    const sources = [
      null,
      { type: "character" },
      { type: "outline_node", nodeType: "chapter" as const },
      { type: "outline_node", nodeType: "volume" as const },
    ];
    for (const source of sources)
      expect(dialogRelationTypeOptions(source)).not.toContain("occurs_at");
  });
});
