// 书架行渲染守卫：「当前书按 id 判定」与行结构。
//
// 为什么扫源码不 SSR：Dashboard 的书架数据来自 zustand store，
// SSR 走 getServerSnapshot（初始 state），预置的书架在 renderToString 里不可见。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");

describe("书架行渲染", () => {
  it("书架行直接渲染 bookshelf.books（无分组小标题）", () => {
    expect(dashboard).toContain("bookshelf!.books.map((book)");
    expect(dashboard).not.toContain("groupShelfBooks");
  });

  it("当前书判定走纯函数 isCurrentBook（按项目 id，不再按书名）", () => {
    expect(dashboard).toContain("isCurrentBook(book, config)");
    expect(dashboard).not.toMatch(/book\.name\s*===\s*config\??\.name/);
  });

  it("打开语义仍挂在 isCurrent 上（判定只服务识别，不改变打开行为）", () => {
    expect(dashboard).toMatch(/if \(isCurrent\) navigate\("\/overview"\)/);
  });
});

// 行结构（卡 23.5）：整行 `<button>` → `div` 行容器 + 内层「打开」按钮 + 行尾垃圾桶。
// 为什么必须拆：HTML 不允许按钮嵌按钮——整行按钮 + 行尾图标按钮是无效结构（点击冒泡成「打开」）。
describe("书架行结构（卡 23.5）", () => {
  it("行容器是 div（不再是整行 button），内层「打开」按钮与行尾垃圾桶并列", () => {
    expect(dashboard).toMatch(/<li key=\{book\.path\}>\s*<div/);
    expect(dashboard).toMatch(/title=\{[\s\S]{0,120}?打开《\$\{book\.name\}》/);
    expect(dashboard).toContain('aria-label="删除书籍"');
    expect(dashboard).toContain('title="删除书籍"');
    expect(dashboard).toContain("<DeleteOutlined");
  });

  it("旧形态不得回归：整行 button（`flex w-full … py-2.5` 行类）不再出现在 <button 上", () => {
    expect(dashboard).not.toMatch(/<button\b[\s\S]{0,240}?"flex w-full items-center gap-3 px-3 py-2\.5/);
  });

  it("删书确认框挂在书架页（受控：book = deleteTarget；两者共用同一实例）", () => {
    expect(dashboard).toContain("<BookDeleteDialog");
    expect(dashboard).toMatch(/<BookDeleteDialog[\s\S]{0,120}?book=\{deleteTarget\}/);
  });

  it("当前书条并列「删除」入口（导出 / 重命名那一行）", () => {
    expect(dashboard).toMatch(/重命名\s*<\/Button>[\s\S]{0,600}?删除/);
  });
});

// 导出入口（卡 E5）：点「导出」不再直接下载，先弹类型选择框（两条产物两条端点 + 同一落盘管道）。
describe("当前书条导出入口（卡 E5）", () => {
  it("「导出」按钮开弹窗（不再直接发起下载）", () => {
    expect(dashboard).toMatch(/导出\s*<\/Button>/);
    expect(dashboard).toMatch(/onClick=\{\(\) => setExportOpen\(true\)\}/);
    expect(dashboard).toContain("<ExportBookDialog");
  });

  it("弹窗只上报所选类型（onExport(kind)），不自己下载", () => {
    expect(dashboard).toMatch(/<ExportBookDialog[\s\S]{0,360}?onExport=\{\(kind\) => void handleExportBook\(/);
  });

  it("handleExportBook 按 kind 分派端点，成功关框、失败留框", () => {
    expect(dashboard).toMatch(/kind === "novel" \? await exportNovelZip\(\) : await exportProjectZip\(\)/);
    expect(dashboard).toContain("setExportOpen(false)");
  });
});
