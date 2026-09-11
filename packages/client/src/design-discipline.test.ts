// 视觉纪律守卫（T9）：用源码扫描把 DESIGN.md §Do's and Don'ts 的硬约束变成可执行断言。
// 为什么需要它：收敛掉的四类「历史遗留」（双图标库 / 硬编码色 / `!` 前缀类 / 手写字号）
// 都是"改完就没人拦得住"的类别；且 antd 样式是运行时注入的**无层 CSS**，会静默压掉 Tailwind 工具类
// ——这种失效不报错、只在浏览器里肉眼可见，必须由测试兜住。
//
// 规则与白名单（改白名单必须先改 DESIGN.md 并说明理由）：
// 1. lucide-import      图标一律 @ant-design/icons（lucide 已退役）
// 2. hardcoded-color    颜色只经 antd token / 语义变量；白名单：AntdProvider（token 定义唯一允许处）
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

/** 颜色白名单：token 定义处（唯一允许硬编码色值的地方） */
const COLOR_ALLOW = ["components/AntdProvider.tsx"];

/** 拦截 className 里以 `!` 开头的 Tailwind token（`!` 还有 `!==` 等用途，故先取 className 串） */
function importantClasses(line: string): string[] {
  return [...line.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
    .flatMap((m) => (m[1] ?? m[2] ?? "").split(/\s+/))
    .filter((token) => token.startsWith("!"));
}

/** antd 自身会声明的属性 —— 挂在组件根元素上会被无层 CSS 压掉（Tailwind 在 @layer utilities） */
const ANTD_OVERRIDDEN_PROPS =
  /(?:^|\s)(?:w-\d|h-\d|px-|py-|ps-|pe-|pt-|pb-|pl-|pr-|justify-|cursor-|rounded-(?:sm|md|lg|xl|2xl|full)|text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|\[\d))/;
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

/** antd v6 的 Button 只在 `color` 与 `variant` **同时**给出时才走 color/variant 分支
 * （antd/es/button/Button.js：`if (color && variant) ...`），否则静默回落 `['default','outlined']`
 * ——即 `variant="text"` 会渲染成带边框的 outlined 按钮（实测踩坑：同一角色图标按钮一半有边框
 * 一半没有）。要么写 `color="default" variant="text"`，要么用遗留 `type="text"`。*/
function buttonVariantWithoutColor(source: string): boolean {
  const tag = /<Button\b/g;
  let match = tag.exec(source);
  while (match !== null) {
    const opening = openingTagAt(source, match.index) ?? "";
    if (/\svariant=/.test(opening) && !/\scolor=/.test(opening)) return true;
    match = tag.exec(source);
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
  {
    // colorPrimaryBg 是「主色浅底」，但主色 seed 是深墨 #37352f：antd 对该 seed 派生的
    // colorPrimaryBg 实测为 #787771（中灰）——压在 colorText（同为 #37352f）上当底色即不可读。
    // 次级面/选中面一律用 colorFillTertiary（= {colors.surface-muted} = Tailwind bg-accent）。
    id: "primary-bg-token",
    violationsIn: (line) => /colorPrimaryBg\b/.test(line),
  },
  {
    // 会话列表选中态（用户反馈 #4）：antd `Dropdown` 自带一套 menu 样式，**不吃 `Menu` 组件 token**
    // （`antd/es/dropdown/style/index.js` 的 `&-selected` 直接取全局 `controlItemBgActive`）——历史上这里
    // 就是选中项不可读的现场（主色 seed 是深墨，该 token 派生中深灰，实测 2.26:1）。
    // 可读性现由全局选中面 token（`AntdProvider` 的 `controlItemBgActive*` + `antd-tokens.test.ts` 对比度守卫）
    // 兜住，但会话/列表的选中态语言仍统一走 x `Conversations`（两行项语义 + 灰面 + colorText），
    // 禁止在调用点另起一套（否则又会出现「文档登记灰面、像素另一套」）。
    id: "dropdown-menu-selectable",
    violationsIn: (line) => /\bselectable\b/.test(line),
  },
];

/** 动态拼接的 Tailwind 类名（`className={`bg-tag-${tint}`}`）：Tailwind 只在源码里扫**字面量**类名，
 * 拼接出来的类不会被生成——DOM 上有类、CSS 里没有样式，表现是「背景透明/字号失效」而不报错
 * （实测踩坑：标签 tint 静态查表前，chip 类名在 DOM 却无色）。含 `-${` 的 className 模板串即拦。 */
function dynamicClassConcat(source: string): boolean {
  for (const m of source.matchAll(/className=\{`([^`]*)`\}/g)) {
    if (/-\$\{/.test(m[1] ?? "")) return true;
  }
  return false;
}

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

/** 注释行豁免：规则扫的是「真正生效的代码」。注释里写清「为什么禁某个 token / 某个色值实测是多少」
 * 是文档职责（DESIGN.md 同款内容），不能因此把守卫变成「禁写注释里的关键词」。 */
function isCommentLine(text: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(text);
}

describe("视觉纪律守卫（源码扫描）", () => {
  for (const rule of RULES) {
    it(`${rule.id}：全仓无违规`, () => {
      const hits = FILES.filter((file) => !rule.allow?.(file.path)).flatMap((file) =>
        file.text
          .split("\n")
          .map((line, index) => ({ file: file.path, line: index + 1, text: line }))
          .filter((entry) => !isCommentLine(entry.text) && rule.violationsIn(entry.text))
          .map((entry) => `${entry.file}:${entry.line}  ${entry.text.trim().slice(0, 120)}`),
      );
      expect(hits).toEqual([]);
    });
  }

  it("antd-root-override：antd 组件根元素无被无层 CSS 压掉的类", () => {
    const hits = FILES.filter((file) => antdRootOverrides(file.text)).map((file) => file.path);
    expect(hits).toEqual([]);
  });

  it("cssvar-scope：index.html 的 <html class> 与 AntdProvider 的 CSS_VAR_KEY 同值", () => {
    // 为什么需要它：antd 的 cssVar 变量注入在「组件级 class 作用域」，不注入 :root；
    // index.css 的 `:root { --primary: var(--ant-color-primary) }` 映射只有在 <html> 也带上
    // 同一个 key class 时才解析得到值——一旦两处字面量脱钩，全站语义色（bg-card/border-border/
    // text-muted-foreground/bg-primary…）会静默变透明，且类型检查与既有测试全绿（2026-09 实际发生）。
    const provider = FILES.find((f) => f.path === "components/AntdProvider.tsx");
    const key = provider?.text.match(/export const CSS_VAR_KEY = "([^"]+)";/)?.[1];
    expect(key, "AntdProvider 必须导出 CSS_VAR_KEY 常量").toBeTruthy();
    expect(provider?.text).toContain("cssVar: { key: CSS_VAR_KEY }");
    const html = readFileSync(join(SRC, "..", "index.html"), "utf8");
    expect(html).toMatch(new RegExp(`<html[^>]*class="[^"]*\\b${key}\\b`));
  });

  it("no-dynamic-class：Tailwind 类名不得拼接（拼接类不会被生成）", () => {
    const hits = FILES.filter((file) => dynamicClassConcat(file.text)).map((f) => f.path);
    expect(hits).toEqual([]);
  });

  it("button-variant-color：Button 的 variant 必须与 color 同时给", () => {
    const hits = FILES.filter((file) => buttonVariantWithoutColor(file.text)).map((f) => f.path);
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
      "primary-bg-token": `styles={{ content: { background: token.colorPrimaryBg } }}`,
      "dropdown-menu-selectable": `menu={{ items, selectable: true, selectedKeys: [id] }}`,
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

  it("no-dynamic-class 命中拼接、放过字面量", () => {
    expect(dynamicClassConcat("className={`bg-tag-${tint}`}")).toBe(true);
    expect(dynamicClassConcat("className={`${base} bg-tag-sky`}")).toBe(false);
    expect(dynamicClassConcat('className={cn("bg-tag-sky", active && "ring-1")}')).toBe(false);
  });

  it("button-variant-color 命中无 color 的 variant、放过合法写法", () => {
    expect(buttonVariantWithoutColor(`<Button variant="text">x</Button>`)).toBe(true);
    expect(buttonVariantWithoutColor(`<Button\n  variant="filled"\n  icon={<A />}\n/>`)).toBe(true);
    expect(buttonVariantWithoutColor(`<Button color="default" variant="text" />`)).toBe(false);
    expect(buttonVariantWithoutColor(`<Button type="primary" danger />`)).toBe(false);
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
