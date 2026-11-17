// 提交接线守卫（源码扫描）：对话框确实走 `relationSubmitError`，且客户端不自己再查语法。
// 为什么扫描而不是渲染：仓内无 jsdom，组件交互测不了——这是接线的最小可自动化守卫。
// 漏接线的表现：对话框自己拼 guard 或只查语法，端点矩阵失效却不报错（纯函数测试仍全绿）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/** client `src` 根（本文件在 src/lib 下） */
const SRC = new URL("..", import.meta.url).pathname;
const DIALOG = "components/entity/create-relation-dialog.tsx";

/** 采集 src 下所有非测试源码文件（相对 src 的 posix 风格路径） */
function sourceFiles(dir: string = SRC): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) continue;
    out.push({ path: relative(SRC, full).split(sep).join("/"), text: readFileSync(full, "utf8") });
  }
  return out;
}

/** 去掉注释行（`//` / `*` / `/*` 开头）——注释里提到函数名不算接线 */
function code(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

const FILES = sourceFiles();

describe("关系提交接线（源码扫描）", () => {
  it("建立关联对话框调用 relationSubmitError（提交判定唯一入口）", () => {
    const dialog = FILES.find((file) => file.path === DIALOG);
    expect(dialog, `${DIALOG} 不存在`).toBeDefined();
    expect(code(dialog!.text)).toContain("relationSubmitError(");
  });

  it("relationTypeSyntaxError 调用点只在 lib/relation-types.ts（对话框不自己查语法）", () => {
    const callers = FILES.filter((file) => code(file.text).includes("relationTypeSyntaxError(")).map(
      (file) => file.path,
    );
    expect(callers).toEqual(["lib/relation-types.ts"]);
  });
});
