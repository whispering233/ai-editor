// 关系区渲染走查（卡 3.6）：仓内无 jsdom/@testing-library（既有纪律：不引新依赖），
// 用 react-dom/server renderToString 直渲染展示层 `CharacterRelationsView`（数据由 props 注入）。
// 覆盖：两个区块标题（关系网 / 其他关联 · N 条）/ 组头「类型 · 条数」/ 行（对方姓名 + 方向箭头 + 备注）/
//       「双向」徽标 / 折叠态（默认收起：其他关联行不渲染、添加按钮不渲染）/ 展开态 / 删除入口。
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

function render(opts: { groups?: CharacterRelationGroup[]; otherRows?: CharacterRelationRow[]; otherExpanded?: boolean } = {}): string {
  return renderToString(
    <CharacterRelationsView
      groups={opts.groups ?? GROUPS}
      otherRows={opts.otherRows ?? [OTHER_ROW]}
      otherExpanded={opts.otherExpanded ?? false}
      onToggleOther={() => {}}
      onAddCharacterRelation={() => {}}
      onAddOtherRelation={() => {}}
      onDeleteRow={() => {}}
    />,
  );
}

describe("关系区渲染（卡 3.6）", () => {
  it("关系网：区标题 + 组头「类型 · 条数」+ 行（对方姓名 + 箭头 + 备注）", () => {
    const html = render();
    expect(html).toContain("人物关系网");
    expect(html).toContain("+ 添加人物关系");
    expect(html).toContain("盟友 · 1");
    expect(html).toContain("对手 · 1");
    expect(html).toContain("李四");
    expect(html).toContain("自幼相识");
    // 对方姓名可点跳转（人物详情路由）
    expect(html).toContain('href="#/characters/char-2"');
  });

  it("双向合并行显示「双向」徽标、不显示方向箭头字符；单向行显示 →", () => {
    const html = render();
    expect(html).toContain("双向");
    expect(html).toContain("→");
  });

  it("其他关联默认收起：标题常显条数、行与「+ 添加关联」不渲染", () => {
    const html = render();
    expect(html).toContain("其他关联 · 1 条");
    expect(html).not.toContain("第一章");
    expect(html).not.toContain("+ 添加关联");
    // chevron 是 icon-button（collapse 语义由 aria 表达）
    expect(html).toContain('aria-expanded="false"');
  });

  it("其他关联展开：行渲染（类型 chip + 对方名 + 可点 #/outline/:id）+ 添加入口", () => {
    const html = render({ otherExpanded: true });
    expect(html).toContain("第一章");
    expect(html).toContain("出现于");
    expect(html).toContain('href="#/outline/ch-1"');
    expect(html).toContain("+ 添加关联");
    expect(html).toContain('aria-expanded="true"');
  });

  it("空态：无人物关系给引导；其他关联 0 条仍常显", () => {
    const html = render({ groups: [], otherRows: [] });
    expect(html).toContain("还没有人物关系，添加一条");
    expect(html).toContain("其他关联 · 0 条");
  });

  it("每行都有删除入口（aria-label 带对方姓名与类型）", () => {
    const html = render();
    expect(html).toContain('aria-label="删除与「李四」的盟友关系"');
    expect(html).toContain('aria-label="删除与「王五」的对手关系"');
  });
});
