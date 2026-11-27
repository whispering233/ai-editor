// `RefChip` SSR 走查（仓内无 jsdom / @testing-library，用 react-dom/server，同 PanelToggleButton.test）。
// 契约 = docs/ui/DESIGN.md §Components `ref-chip`：可点内联引用的第三种 chip；
// 元素语义（`to` → `<a>`、`onClick` → `<button>`）、三档语义色、防拖透传。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RefChip } from "./ref-chip";

/** 本轮迁移的 8 处里出现过的形态：导航 / 弱动作 / 强调动作 */
describe("RefChip · 元素语义", () => {
  it("给 `to` 渲染成锚点（保住中键 / ⌘ 新标签页），不渲染 button", () => {
    const html = renderToString(<RefChip to="/setting/abc">上级设定</RefChip>);
    expect(html).toContain('<a href="#/setting/abc"');
    expect(html).not.toContain("<button");
  });

  it('只给 `onClick` 渲染成 `type="button"`（不进表单提交）', () => {
    const html = renderToString(<RefChip onClick={() => {}}>展开</RefChip>);
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).not.toContain("<a ");
  });

  it("`to` 与 `onClick` 可共存（未保存守卫要先问再 navigate）", () => {
    const html = renderToString(
      <RefChip to="/setting/abc" onClick={() => {}}>
        上级设定
      </RefChip>,
    );
    expect(html).toContain('href="#/setting/abc"');
    expect(html).not.toContain("<button");
  });
});

describe("RefChip · 几何与语义色", () => {
  it("壳串走 4px 小内衬档（不是按钮的 6px）+ hairline 描边，且为行内盒（不撑满整行）", () => {
    const html = renderToString(<RefChip onClick={() => {}}>x</RefChip>);
    expect(html).toContain("rounded-sm");
    expect(html).toContain("border-border");
    // 4px 档由 index.css 的 --radius-sm 承担；这里只钉类名，钉像素值会与 token 漂移
    expect(html).not.toContain("rounded-md");
    // `inline-flex`：块级 `flex` 会把「依赖: …」这类文字 chip 撑成整行宽的描边条
    expect(html).toContain("inline-flex");
  });

  it("三档语义色（缺省墨字 / muted hover 转墨 / primary）", () => {
    expect(renderToString(<RefChip onClick={() => {}}>x</RefChip>)).toContain("text-foreground");
    const muted = renderToString(
      <RefChip onClick={() => {}} tone="muted">
        x
      </RefChip>,
    );
    expect(muted).toContain("text-muted-foreground");
    expect(muted).toContain("hover:text-foreground");
    expect(
      renderToString(
        <RefChip onClick={() => {}} tone="primary">
          x
        </RefChip>,
      ),
    ).toContain("text-primary");
  });

  it("调用点附加类与壳串合并（`mx` / 截断 / 字号由调用点给）", () => {
    const html = renderToString(
      <RefChip onClick={() => {}} className="ml-1 min-w-0 flex-1 truncate text-xs">
        x
      </RefChip>,
    );
    for (const cls of ["ml-1", "min-w-0", "flex-1", "truncate", "text-xs"])
      expect(html).toContain(cls);
  });
});

describe("RefChip · 可访问性与防拖", () => {
  it("`ariaExpanded` 只在给出时渲染", () => {
    expect(
      renderToString(
        <RefChip onClick={() => {}} ariaExpanded>
          展开
        </RefChip>,
      ),
    ).toContain('aria-expanded="true"');
    expect(renderToString(<RefChip onClick={() => {}}>展开</RefChip>)).not.toContain(
      "aria-expanded",
    );
  });

  it("`draggable={false}` 透传（时间轴事件行根是 draggable，行内控件必须防拖）", () => {
    expect(
      renderToString(
        <RefChip onClick={() => {}} draggable={false}>
          x
        </RefChip>,
      ),
    ).toContain('draggable="false"');
  });

  it("`title` 走原生提示（全站口径：不引 antd Tooltip）", () => {
    expect(
      renderToString(
        <RefChip onClick={() => {}} title="展开变更记录">
          x
        </RefChip>,
      ),
    ).toContain('title="展开变更记录"');
  });
});
