// 视觉纪律守卫（批次十九 T9）：用源码扫描把 DESIGN.md §Do's and Don'ts 的硬约束变成可执行断言。
// 为什么需要它：批次十九收敛掉的四类「历史遗留」（双图标库 / 硬编码色 / `!` 前缀类 / 手写字号）
// 都是"改完就没人拦得住"的类别；且 antd 样式是运行时注入的**无层 CSS**，会静默压掉 Tailwind 工具类
// ——这种失效不报错、只在浏览器里肉眼可见，必须由测试兜住。
//
// 规则与白名单（改白名单必须先改 DESIGN.md 并说明理由）：
// 1. lucide-import      图标一律 @ant-design/icons（lucide 已退役）
// 2. hardcoded-color    颜色只经 antd token / 语义变量；白名单：AntdProvider（token 定义唯一允许处）、
//                       lib/book-cover.ts（书封取色，DESIGN.md Known Gaps 已登记的待办）
// 3. important-class    `!` 前缀类会掩盖「antd 无层 CSS 覆盖 Tailwind」这一事实，禁
// 4. ad-hoc-font-size   字号只有四档（20/16/14/12），手写 px/rem 字号禁
// 5. antd-root-override antd 组件根元素上不得挂会被 antd 自身声明压掉的布局/排版类
//                       （Button/Input 的 width/height/padding/font-size/justify/border-radius）
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL(".", import.meta.url).pathname;

interface Rule {
  id: string;
  /** 返回该行是否违规（逐行扫描） */
  violationsIn: (line: string) => boolean;
  /** 该文件是否豁免此规则 */
  allow?: (file: string) => boolean;
}

/** 颜色白名单：token 定义处 + 已登记的书封取色 */
const COLOR_ALLOW = ["components/AntdProvider.tsx", "lib/book-cover.ts"];

/** 拦截 className 里以 `!` 开头的 Tailwind token（`!` 还有 `!==` 等用途，故先取 className 串） */
function importantClasses(line: string): string[] {
  return [...line.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
    .flatMap((m) => (m[1] ?? m[2] ?? "").split(/\s+/))
    .filter((token) => token.startsWith("!"));
}

/** antd 自身会声明的属性 —— 挂在组件根元素上会被无层 CSS 压掉（Tailwind 在 @layer utilities） */
const ANTD_OVERRIDDEN_PROPS =
  /(?:^|\s)(?:w-\d|h-\d|px-|py-|ps-|pe-|pt-|pb-|pl-|pr-|justify-|rounded-(?:sm|md|lg|xl|2xl|full)|text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|\[\d))/;
const ANTD_GUARDED_COMPONENTS = ["Button", "Input"];

/** 取出 JSX 开标签（大括号深度归零后的第一个 `>`），避免把子元素/图标上的类误判为根元素类 */
function openingTagAt(source: string, start: number): string | null {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

/** 去掉属性值里的 `{}` 表达式（可能嵌套）：子元素/图标上的类不算根元素类，且表达式无法静态求值 */
function stripExpressions(tag: string): string {
  let previous = tag;
  for (let i = 0; i < 10; i += 1) {
    const next = previous.replace(/\{[^{}]*\}/g, "");
    if (next === previous) break;
    previous = next;
  }
  return previous;
}

function antdRootOverrides(source: string): boolean {
  for (const component of ANTD_GUARDED_COMPONENTS) {
    const tag = new RegExp(`<${component}\\b`, "g");
    let match = tag.exec(source);
    while (match !== null) {
      const opening = openingTagAt(source, match.index);
      const className = stripExpressions(opening ?? "").match(/className="([^"]*)"/)?.[1];
      if (className !== undefined && ANTD_OVERRIDDEN_PROPS.test(className)) return true;
      match = tag.exec(source);
    }
  }
  return false;
}

const RULES: Rule[] = [
  {
    id: "lucide-import",
    violationsIn: (line) => /from\s+["']lucide-react["']/.test(line),
  },
  {
    id: "hardcoded-color",
    violationsIn: (line) => /(?<!&)#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/.test(line),
    allow: (file) => COLOR_ALLOW.includes(file),
  },
  {
    id: "important-class",
    violationsIn: (line) => importantClasses(line).length > 0,
  },
  {
    id: "ad-hoc-font-size",
    violationsIn: (line) => /text-\[\d+(?:\.\d+)?(?:px|rem)\]/.test(line),
  },
];

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

const FILES = sourceFiles();

describe("视觉纪律守卫（源码扫描）", () => {
  for (const rule of RULES) {
    it(`${rule.id}：全仓无违规`, () => {
      const hits = FILES.filter((file) => !rule.allow?.(file.path)).flatMap((file) =>
        file.text
          .split("\n")
          .map((line, index) => ({ file: file.path, line: index + 1, text: line }))
          .filter((entry) => rule.violationsIn(entry.text))
          .map((entry) => `${entry.file}:${entry.line}  ${entry.text.trim().slice(0, 120)}`),
      );
      expect(hits).toEqual([]);
    });
  }

  it("antd-root-override：antd 组件根元素无被无层 CSS 压掉的类", () => {
    const hits = FILES.filter((file) => antdRootOverrides(file.text)).map((file) => file.path);
    expect(hits).toEqual([]);
  });
});

describe("守卫规则自检（规则必须能识别违规样例，否则规则形同虚设）", () => {
  it("逐条命中违规样例", () => {
    const samples: Record<string, string> = {
      "lucide-import": `import { Trash2 } from "lucide-react";`,
      "hardcoded-color": `className="text-[#1677ff]"`,
      "important-class": `className="!mb-0 text-sm"`,
      "ad-hoc-font-size": `className="text-[13px]"`,
    };
    for (const rule of RULES) {
      const sample = samples[rule.id];
      if (sample !== undefined) expect(rule.violationsIn(sample), rule.id).toBe(true);
    }
    // 合法样例不得误报
    expect(importantClasses(`className="mb-0 text-sm"`)).toEqual([]);
    expect(RULES[0].violationsIn(`import { Button } from "antd";`)).toBe(false);
    expect(RULES[3].violationsIn(`className="w-[calc(100%-2rem)]"`)).toBe(false);
  });

  it("antd-root-override 命中根元素、放过子元素", () => {
    expect(antdRootOverrides(`<Button className="w-20">提交</Button>`)).toBe(true);
    expect(antdRootOverrides(`<Input className="h-8" />`)).toBe(true);
    // 子元素（图标 / 包装层）上的类不算违规：antd 只在自己根元素上声明属性
    expect(antdRootOverrides(`<Button icon={<DeleteOutlined className="text-sm" />} />`)).toBe(
      false,
    );
    expect(antdRootOverrides(`<div className="w-52"><Input value="" /></div>`)).toBe(false);
    // 合法类：外边距/伸缩/非 antd 组件
    expect(antdRootOverrides(`<Button className="mb-1" block />`)).toBe(false);
    expect(antdRootOverrides(`<div className="w-52 text-sm" />`)).toBe(false);
  });
});
