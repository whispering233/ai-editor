// 大纲树筛选接线守卫（源码扫描）：仓内无 jsdom，组件交互测不了——筛选的 UI 行为用扫描守住
// （同 `lib/relation-submit-wiring.test.ts` 的既有做法）。
// 纯判定（命中 / 祖先链 / 交集 / 软删）由 `lib/outline-tree.test.ts` 覆盖；本文件只守三条**接线**：
// ② 编号恒按全树 ③ 筛选态不拖拽 ④ 不持久化。
// 漏接线的表现：筛掉的章让后面的章编号前移（②）、拖拽落点在隐藏行上算错（③）、
// 筛选被顺手写进 localStorage / URL（④）——三种都不会让纯函数测试变红。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** client `src` 根（本文件在 src/pages 下）；`URL.pathname` 在 Windows 上是 `/C:/…`，必须转平台路径 */
const SRC = fileURLToPath(new URL("..", import.meta.url));
const PAGE = "pages/Outline.tsx";
const CONTROL = "components/outline/outline-filter-control.tsx";

/** 去掉注释行（`//` / `*` / `/*` 开头）——注释里提到函数名不算接线 */
function code(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

const page = code(PAGE);
const control = code(CONTROL);

/** 取某个函数的源码片段（到下一个同缩进的收尾大括号为止） */
function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("\n  }", start));
}

describe("大纲树筛选接线（源码扫描）", () => {
  it("渲染的是筛选后的树：filterOutlineNodes → renderNodes（判定不吃渲染用的副本以外的东西）", () => {
    expect(page).toContain("filterOutlineNodes(outline?.children ?? [], filter)");
    expect(page).toContain("renderNodes(visibleNodes, 0)");
  });

  it("② 编号恒按全树：numberOutline 只吃 outline，从不吃筛选结果", () => {
    expect(page).toContain("numberOutline(outline).labels");
    // 页面里 numberOutline( 只出现一次（喂给它的必须是全树——筛掉的章不能让「第N章」前移）
    expect(page.match(/numberOutline\(/g) ?? []).toHaveLength(1);
  });

  it("③ 筛选态不能拖拽：行 draggable 置 false + 拖拽唯一入口 handleDragStart 早退", () => {
    const draggable = page.split("\n").filter((line) => line.includes("draggable:"));
    expect(draggable).toHaveLength(1);
    expect(draggable[0]).toContain("!filterActive");
    const body = functionBody(page, "function handleDragStart");
    expect(body).toContain("if (filterActive) return;");
    // 兜底：拖拽态只由本函数设置，早退即 dragNodeId 恒为 null ⇒ 行 / 顶层容器的 dragover 一律早退
    expect(body).toContain("setDragNodeId(node.id)");
    expect(functionBody(page, "function handleRootDragOver")).toContain("if (!dragNode");
  });

  it("④ 不持久化：筛选是组件态——页面与控件都不碰 localStorage，筛选相关行不碰 URL", () => {
    for (const [name, source] of [
      [PAGE, page],
      [CONTROL, control],
    ] as const) {
      expect(source, name).not.toContain("localStorage");
      const lines = source.split("\n").filter((line) => /filter/i.test(line));
      expect(lines.length, name).toBeGreaterThan(0);
      for (const line of lines) expect(line, name).not.toMatch(/location|navigate|hash/);
    }
  });
});