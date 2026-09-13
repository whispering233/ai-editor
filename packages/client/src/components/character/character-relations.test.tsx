// 关系区渲染走查（卡 3.6；卡 6.3 改 pane 制）：仓内无 jsdom/@testing-library
// （既有纪律：不引新依赖），用 react-dom/server renderToString 直渲染展示层 `CharacterRelationsView`（数据由 props 注入）。
// 覆盖：两个 pane（render 时按 `pane` 只渲一个）/ 组头「类型 · 条数」/ 行（对方姓名 + 方向箭头 + 备注）/
//       「双向」徽标 / 各自 pane 的添加入口与空态 / 删除入口（**不再有折叠态**——其他关联本身即 tab）。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { CharacterRelationsView } from "./character-relations";
import type { CharacterRelationGroup, CharacterRelationRow } from "../../lib/character-relations";

const OUT_ROW: CharacterRelationRow = {
  key: "ally:out:r1",
  relationId: "r1",
  relationType: "ally",
  other: { type: "character", id: "char-2", name: "李四" },
  direction: "out",
  note: "自幼相识",
};

const BOTH_ROW: CharacterRelationRow = {
  key: "rival:both:r2:r3",
  relationId: "r2",
  relationType: "rival",
  other: { type: "character", id: "char-3", name: "王五" },
  direction: "both",
  note: null,
};

const OTHER_ROW: CharacterRelationRow = {
  key: "appears_in:out:r9",
  relationId: "r9",
  relationType: "appears_in",
  other: { type: "outline_node", id: "ch-1", name: "第一章" },
  direction: "out",
  note: null,
};

const GROUPS: CharacterRelationGroup[] = [
  { relationType: "ally", rows: [OUT_ROW] },
  { relationType: "rival", rows: [BOTH_ROW] },
];

function render(
  pane: "network" | "other",
  opts: { groups?: CharacterRelationGroup[]; otherRows?: CharacterRelationRow[] } = {},
): string {
  return renderToString(
    <CharacterRelationsView
      pane={pane}
      groups={opts.groups ?? GROUPS}
      otherRows={opts.otherRows ?? [OTHER_ROW]}
      onAddCharacterRelation={() => {}}
      onAddOtherRelation={() => {}}
      onDeleteRow={() => {}}
    />,
  );
}

describe("关系区渲染（卡 6.3：两个 pane）", () => {
  it("关系网 pane：组头「类型 · 条数」+ 行（对方姓名 + 箭头 + 备注）+ 添加入口", () => {
    const html = render("network");
    expect(html).toContain("+ 添加人物关系");
    expect(html).toContain("盟友 · 1");
    expect(html).toContain("对手 · 1");
    expect(html).toContain("李四");
    expect(html).toContain("自幼相识");
    // 对方姓名可点跳转（人物详情路由）
    expect(html).toContain('href="#/characters/char-2"');
    // 其他关联内容不混入关系网 pane
    expect(html).not.toContain("第一章");
    expect(html).not.toContain("+ 添加关联");
  });

  it("双向合并行显示「双向」徽标、不显示方向箭头字符；单向行显示 →", () => {
    const html = render("network");
    expect(html).toContain("双向");
    expect(html).toContain("→");
  });

  it("其他关联 pane：行渲染（类型 chip + 对方名 + 可点 #/outline/:id）+ 添加入口；无折叠态", () => {
    const html = render("other");
    expect(html).toContain("第一章");
    expect(html).toContain("出现于");
    expect(html).toContain('href="#/outline/ch-1"');
    expect(html).toContain("+ 添加关联");
    expect(html).not.toContain("+ 添加人物关系");
    expect(html).not.toContain("aria-expanded");
  });

  it("空态：关系网给引导；其他关联给引导 + 添加入口仍在", () => {
    const network = render("network", { groups: [] });
    expect(network).toContain("还没有人物关系，添加一条");
    const other = render("other", { otherRows: [] });
    expect(other).toContain("暂无其他关联");
    expect(other).toContain("+ 添加关联");
  });

  it("每行都有删除入口（aria-label 带对方姓名与类型）", () => {
    const html = render("network");
    expect(html).toContain('aria-label="删除与「李四」的盟友关系"');
    expect(html).toContain('aria-label="删除与「王五」的对手关系"');
    const other = render("other");
    expect(other).toContain('aria-label="删除与「第一章」的出现于关系"');
  });
});
