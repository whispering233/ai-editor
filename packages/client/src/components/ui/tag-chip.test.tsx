// 徽标 chip 准入规则的执行断言（DESIGN.md §Components `tag` / `type-badge`）：
// 「tint 只给用户标签，枚举类型走中性」这条口径唯一可执行的形式 =
// `TagChip` 必须带 `bg-tag-*`、`TypeChip` 必须带 `bg-accent` 且**不带** `bg-tag-*`
// ——防未来有人把 `TypeChip` 改回取色（或在调用点给类型塞 `TagChip`）。
// 渲染方式沿用仓内纪律：无 jsdom/@testing-library，用 react-dom/server renderToString。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { TagChip, TypeChip } from "./tag-chip";

describe("TagChip（用户标签：tint 底）", () => {
  it("按文案 hash 取 tint 类 + 墨字 + 与 TypeChip 同形状类", () => {
    const html = renderToString(<TagChip>宗门</TagChip>);
    expect(html).toContain("bg-tag-yellow"); // 固定值锁定（tag-tint.test.ts 同档）
    expect(html).toContain("text-foreground");
    expect(html).toContain("rounded-sm");
    expect(html).toContain("text-xs");
  });

  it("富内容（非单字符串 children）显式给 label 时按 label 取色；不给则回落首色且不抛错", () => {
    expect(renderToString(<TagChip label="宗门">宗门 →</TagChip>)).toContain("bg-tag-yellow");
    // 多子节点（非单字符串）且没给 label：key = 空串 → 回落首色，不抛错
    expect(renderToString(<TagChip>{["宗门", "→"]}</TagChip>)).toContain("bg-tag-sky");
  });
});

describe("TypeChip（类型/分类徽标：中性底，不参与 tint）", () => {
  it("固定橙底 + 恒定墨字（两态不翻转），且**不含**任何 tint 底色类", () => {
    const html = renderToString(<TypeChip>章</TypeChip>);
    expect(html).toContain("bg-type-badge");
    // 不能用 text-foreground：它在深色态翻成 81% 白，压橙底仅 2.61:1（卡 11.3）
    expect(html).toContain("text-type-badge-fg");
    expect(html).not.toContain("text-foreground");
    expect(html).not.toContain("bg-tag-");
  });

  it("形状类与 TagChip 一致（并排时基线/圆角/字号不漂移）", () => {
    const html = renderToString(<TypeChip>章</TypeChip>);
    for (const cls of ["inline-flex", "items-center", "rounded-sm", "px-1", "py-0.5", "text-xs", "whitespace-nowrap"]) {
      expect(html, cls).toContain(cls);
    }
  });

  it("附加类与 children 照传（截断/伸缩由调用点给）", () => {
    const html = renderToString(<TypeChip className="shrink-0 truncate">大纲节点</TypeChip>);
    expect(html).toContain("shrink-0");
    expect(html).toContain("truncate");
    expect(html).toContain("大纲节点");
  });
});
