// 星形图布局纯函数单测（卡 8.4；follow-up：叶子按对方人物去重 + 半径/画布自适应）
// 覆盖：判据 1（去重后叶子数 < 4 不渲染）/ 判据 2（叶子 > 24 只画点不画名字）/ 判据 3（自环剔除）/ 按人去重（多类型合并一叶、
// 方向合并、条数后缀）/ 角度均匀（正上方起顺时针）、半径随叶子数自适应（下限 + 宽度/高度预算上限 + 画布随半径长高）/
// 方向 → 箭头（both 不画，out 朝外、in 朝内）/ 标签锚点与 8 字截断。
import { describe, expect, it } from "vitest";
import type { CharacterRelationRow } from "./character-relations";
import {
  buildRelationStarLayout,
  RELATION_STAR_HEIGHT,
  RELATION_STAR_LABEL_MAX_CHARS,
  RELATION_STAR_LABEL_MAX_LEAVES,
  RELATION_STAR_MAX_HEIGHT,
  RELATION_STAR_MIN_LEAVES,
  RELATION_STAR_PADDING,
  RELATION_STAR_WIDTH,
  relationStarLeafLabel,
  relationStarRadius,
  truncateRelationStarName,
} from "./relation-star";

const SIZE = { width: RELATION_STAR_WIDTH, height: RELATION_STAR_HEIGHT };

function row(index: number, over: Partial<CharacterRelationRow> = {}): CharacterRelationRow {
  const direction = over.direction ?? "out";
  return {
    key: `${direction}:${index}`,
    relationId: `r${index}`,
    relationType: "ally",
    other: { type: "character", id: `char-${index}`, name: `人物${index}` },
    direction,
    note: null,
    ...over,
  };
}

/** n 行（对方姓名 = 人物1..n） */
function rows(count: number): CharacterRelationRow[] {
  return Array.from({ length: count }, (_, index) => row(index + 1));
}

function layoutOf(count: number) {
  const layout = buildRelationStarLayout(rows(count), SIZE);
  if (layout === null) throw new Error(`${count} 行应当出图`);
  return layout;
}

/** 叶子相对中心的角度（度，0 = 正右，顺时针为正 = SVG 的 y 轴向下的极坐标） */
function angleOf(
  layout: { center: { x: number; y: number }; radius: number },
  x: number,
  y: number,
) {
  return (Math.atan2(y - layout.center.y, x - layout.center.x) * 180) / Math.PI;
}

describe("判据 1：去重后叶子数 < 4 不渲染", () => {
  it("3 人 → null；4 人 → 出图", () => {
    expect(buildRelationStarLayout(rows(3), SIZE)).toBeNull();
    expect(buildRelationStarLayout(rows(4), SIZE)).not.toBeNull();
    expect(RELATION_STAR_MIN_LEAVES).toBe(4);
  });

  it("threshold 按**去重后的叶子数**：4 行全指向同一人 → 仍 null", () => {
    const sameTarget = [
      row(1, { relationType: "ally" }),
      row(1, { relationType: "rival" }),
      row(1, { relationType: "mentor", direction: "in" }),
      row(1, { relationType: "kills", direction: "out" }),
    ];
    expect(buildRelationStarLayout(sameTarget, SIZE)).toBeNull();
  });

  it("自环行剔除后无叶子 → 仍不出图（只剩中心点无信息量）", () => {
    const selfLoops = Array.from({ length: 4 }, (_, index) =>
      row(index + 1, { direction: "self" }),
    );
    expect(buildRelationStarLayout(selfLoops, SIZE)).toBeNull();
  });

  it("无行（空关系网）→ null", () => {
    expect(buildRelationStarLayout([], SIZE)).toBeNull();
  });
});

describe("按对方人物去重（同一人多类型合并一叶）", () => {
  it("3 条到 char-2（含双向）+ 1 条到 char-3 → 2 叶，方向合并为 both，条数 = 3", () => {
    const input = [
      row(2, { relationType: "ally" }),
      row(2, { relationType: "rival", direction: "in" }),
      row(2, { relationType: "mentor", direction: "in" }),
      row(3),
      row(4),
      row(5),
    ];
    const layout = buildRelationStarLayout(input, SIZE);
    if (layout === null) throw new Error("4 人应当出图");
    expect(layout.leaves.map((leaf) => leaf.other.id)).toEqual(["char-2", "char-3", "char-4", "char-5"]);
    const merged = layout.leaves[0];
    expect(merged.count).toBe(3); // out + in 并存 → both
    expect(merged.direction).toBe("both");
    expect(merged.arrow).toBeNull();
    expect(merged.labelText).toBe("人物2 · 3");
    expect(layout.leaves[1].count).toBe(1);
    expect(layout.leaves[1].labelText).toBe("人物3");
  });

  it("全是 out → out；全是 in → in；含一行 both → both", () => {
    const only = (direction: CharacterRelationRow["direction"]) =>
      buildRelationStarLayout([row(1, { direction }), row(2), row(3), row(4)], SIZE);
    const outLayout = only("out");
    const inLayout = only("in");
    const bothLayout = only("both");
    if (outLayout === null || inLayout === null || bothLayout === null) {
      throw new Error("4 行应当出图");
    }
    expect(outLayout.leaves[0].direction).toBe("out");
    expect(outLayout.leaves[0].arrow).toBe("out");
    expect(inLayout.leaves[0].direction).toBe("in");
    expect(inLayout.leaves[0].arrow).toBe("in");
    expect(bothLayout.leaves[0].direction).toBe("both");
    expect(bothLayout.leaves[0].arrow).toBeNull();
  });

  it("叶子 key 按人物稳定（不随行序变），且去掉行 key 后仍不重复", () => {
    const layout = layoutOf(4);
    expect(layout.leaves.map((leaf) => leaf.key)).toEqual([
      "star:char-1",
      "star:char-2",
      "star:char-3",
      "star:char-4",
    ]);
    expect(new Set(layout.leaves.map((leaf) => leaf.key)).size).toBe(layout.leaves.length);
  });
});

describe("极坐标：角度均匀 + 半径自适应", () => {
  it("从正上方起顺时针均匀分布（6 叶 → 每叶 60°）", () => {
    const layout = layoutOf(6);
    expect(layout.leaves).toHaveLength(6);
    // 第一片叶子在中心正上方（x 对齐、y 在上方）
    expect(layout.leaves[0].point.x).toBeCloseTo(layout.center.x, 6);
    expect(layout.leaves[0].point.y).toBeLessThan(layout.center.y);
    const angles = layout.leaves.map((leaf) => angleOf(layout, leaf.point.x, leaf.point.y));
    expect(angles[0]).toBeCloseTo(-90, 6);
    for (let i = 1; i < angles.length; i += 1) {
      // 相邻夹角（`atan2` 归一化到 (-180,180]，故取模回正）
      const delta = (((angles[i] - angles[i - 1]) % 360) + 360) % 360;
      expect(delta).toBeCloseTo(60, 6);
    }
  });

  it("每片叶子到中心的距离 = 半径；叶子越多半径越大（到预算上限为止），画布随之长高", () => {
    const layout = layoutOf(8);
    for (const leaf of layout.leaves) {
      const distance = Math.hypot(leaf.point.x - layout.center.x, leaf.point.y - layout.center.y);
      expect(distance).toBeCloseTo(layout.radius, 6);
    }
    expect(layoutOf(4).radius).toBeGreaterThan(0);
    expect(layoutOf(8).radius).toBeGreaterThan(layoutOf(4).radius);
    expect(layoutOf(16).radius).toBeGreaterThan(layoutOf(8).radius);
    // 上限 = min(宽度预算, 画布高度上限预算)——叶子再多也不越界
    const maxRadius = Math.min(
      SIZE.width / 2 - RELATION_STAR_PADDING,
      RELATION_STAR_MAX_HEIGHT / 2 - RELATION_STAR_PADDING,
    );
    expect(layoutOf(24).radius).toBeLessThanOrEqual(maxRadius);
    expect(relationStarRadius(200, SIZE)).toBeLessThanOrEqual(maxRadius);
    // 画布随半径长高（下限 = 传入高度，上限 = RELATION_STAR_MAX_HEIGHT）
    const tall = layoutOf(24);
    expect(tall.height).toBeGreaterThan(RELATION_STAR_HEIGHT);
    expect(tall.height).toBeLessThanOrEqual(RELATION_STAR_MAX_HEIGHT);
    expect(tall.center.y).toBeCloseTo(tall.height / 2, 6);
    // 画布过小时保下限（不塌成一点）
    expect(relationStarRadius(20, { width: 40, height: 40 })).toBe(
      relationStarRadius(4, { width: 40, height: 40 }),
    );
  });

  it("叶子点落在画布内（含标签一侧的余量）", () => {
    const layout = layoutOf(12);
    for (const leaf of layout.leaves) {
      expect(leaf.point.x).toBeGreaterThanOrEqual(0);
      expect(leaf.point.x).toBeLessThanOrEqual(layout.width);
      expect(leaf.point.y).toBeGreaterThanOrEqual(0);
      expect(leaf.point.y).toBeLessThanOrEqual(layout.height);
    }
  });

  it("标签锚点：左右两侧贴圆点外侧，上/下半区在正上/正下居中", () => {
    const layout = layoutOf(4); // 顶 / 右 / 底 / 左
    const [top, right, bottom, left] = layout.leaves;
    expect(right.label.anchor).toBe("start");
    expect(right.label.point.x).toBeGreaterThan(right.point.x);
    expect(left.label.anchor).toBe("end");
    expect(left.label.point.x).toBeLessThan(left.point.x);
    expect(top.label.anchor).toBe("middle");
    expect(top.label.point.y).toBeLessThan(top.point.y);
    expect(bottom.label.anchor).toBe("middle");
    expect(bottom.label.point.y).toBeGreaterThan(bottom.point.y);
  });
});

describe("判据 2：叶子 > 24 只画点不画名字", () => {
  it("24 叶 → 画名字；25 叶 → showLabels=false 但叶子仍在", () => {
    expect(layoutOf(RELATION_STAR_LABEL_MAX_LEAVES).showLabels).toBe(true);
    const crowded = layoutOf(RELATION_STAR_LABEL_MAX_LEAVES + 1);
    expect(crowded.showLabels).toBe(false);
    expect(crowded.leaves).toHaveLength(RELATION_STAR_LABEL_MAX_LEAVES + 1);
  });
});

describe("判据 3：自环剔除", () => {
  it("direction === 'self' 不进图（其余叶子角度仍均匀）", () => {
    const layout = buildRelationStarLayout(
      [row(1, { direction: "self" }), row(2), row(3), row(4), row(5, { direction: "in" })],
      SIZE,
    );
    if (layout === null) throw new Error("5 行应当出图");
    expect(layout.leaves.map((leaf) => leaf.other.id)).toEqual([
      "char-2",
      "char-3",
      "char-4",
      "char-5",
    ]);
    const angles = layout.leaves.map((leaf) => angleOf(layout, leaf.point.x, leaf.point.y));
    for (let i = 1; i < angles.length; i += 1) {
      const delta = (((angles[i] - angles[i - 1]) % 360) + 360) % 360;
      expect(delta).toBeCloseTo(90, 6);
    }
  });
});

describe("方向 → 箭头（out 朝外 / in 朝内 / both 不画）", () => {
  it("both（对称合并行）不画箭头：连线整条从中心到叶子点", () => {
    const layout = buildRelationStarLayout(
      [row(1, { direction: "both" }), row(2), row(3), row(4)],
      SIZE,
    );
    if (layout === null) throw new Error("4 行应当出图");
    const leaf = layout.leaves[0];
    expect(leaf.direction).toBe("both");
    expect(leaf.arrow).toBeNull();
    expect(leaf.line.from).toEqual(layout.center);
    expect(leaf.line.to).toEqual(leaf.point);
  });

  it("out：箭头在叶子端（连线终点内缩，朝外）", () => {
    const layout = layoutOf(4);
    const leaf = layout.leaves[0]; // out（默认方向）
    expect(leaf.arrow).toBe("out");
    expect(leaf.line.from).toEqual(layout.center);
    expect(leaf.line.to).not.toEqual(leaf.point);
    // 内缩点仍在中心 → 叶子的射线上
    expect(
      Math.hypot(leaf.line.to.x - layout.center.x, leaf.line.to.y - layout.center.y),
    ).toBeLessThan(layout.radius);
  });

  it("in：箭头在中心端（连线从叶子画向中心，终点内缩）", () => {
    const layout = buildRelationStarLayout(
      [row(1, { direction: "in" }), row(2), row(3), row(4)],
      SIZE,
    );
    if (layout === null) throw new Error("4 行应当出图");
    const leaf = layout.leaves[0];
    expect(leaf.arrow).toBe("in");
    expect(leaf.line.from).toEqual(leaf.point);
    expect(leaf.line.to).not.toEqual(layout.center);
    expect(
      Math.hypot(leaf.line.to.x - layout.center.x, leaf.line.to.y - layout.center.y),
    ).toBeLessThan(layout.radius);
  });
});

describe("叶子名截断（8 字 + …）与条数后缀", () => {
  it("≤ 8 字原名；> 8 字截到 8 字 + …", () => {
    expect(RELATION_STAR_LABEL_MAX_CHARS).toBe(8);
    expect(truncateRelationStarName("李四")).toBe("李四");
    expect(truncateRelationStarName("一二三四五六七八")).toBe("一二三四五六七八");
    expect(truncateRelationStarName("一二三四五六七八九十")).toBe("一二三四五六七八…");
  });

  it("条数 > 1 加 ` · N` 后缀（截断在先，后缀在后）", () => {
    expect(relationStarLeafLabel("李四", 1)).toBe("李四");
    expect(relationStarLeafLabel("李四", 3)).toBe("李四 · 3");
    expect(relationStarLeafLabel("一二三四五六七八九十", 2)).toBe("一二三四五六七八… · 2");
  });
});
