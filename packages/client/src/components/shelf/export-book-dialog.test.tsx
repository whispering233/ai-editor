// `export-book-dialog` 渲染走查（卡 E5）：仓内无 jsdom，用 react-dom/server 直渲染
// **内容体** `ExportBookFormBody`（弹窗外壳走 `createPortal`，SSR 不支持，见 `ui/dialog.test.tsx`）。
// 契约 = docs/ui/DESIGN.md §书架主页 `export-book-dialog`：标题 `导出《书名》` + 竖排单选项
// （默认 `项目压缩文件`，小说工作区三项）+ 三处 caption + Footer `[取消]` / `[导出]`；
// 选中 `纯文本` 时在单选组**之外**多一个「网文排版」勾选（默认不勾、在途禁用）；
// 练习工作区**只给三文件包一项**（`小说文档` / `纯文本` 是小说语义，服务端 `export-novel` /
// `export-novel-txt` 对练习 400 `KIND_MISMATCH`）——`exportBookOptions(workspaceKind)` 是这层过滤的
// 唯一实现。注意：antd `Button` 会在两字中文之间插空格（「导 出」/「取 消」）⇒ 这些断言用正则。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPORT_BOOK_KIND,
  EXPORT_BOOK_OPTIONS,
  ExportBookDialog,
  ExportBookFormBody,
  exportBookOptions,
  exportBookToast,
  WEBNOVEL_LAYOUT_LABEL,
  type ExportBookKind,
} from "./export-book-dialog";

const noop = () => {};

function renderBody(over: Partial<Parameters<typeof ExportBookFormBody>[0]> = {}): string {
  return renderToString(
    <ExportBookFormBody
      name="青云记"
      workspaceKind="novel"
      kind={DEFAULT_EXPORT_BOOK_KIND}
      onKindChange={noop}
      webnovel={false}
      onWebnovelChange={noop}
      exporting={false}
      onExport={noop}
      onCancel={noop}
      {...over}
    />,
  );
}

/** 单选项的 `<input>` 标签（按 value 取出，避免受排版/文案影响） */
function radioInput(html: string, kind: ExportBookKind): string {
  return html.match(new RegExp(`<input[^>]*value="${kind}"[^>]*>`))?.[0] ?? "";
}

/** 排版勾选的 `<input type="checkbox">` 标签（无则空串） */
function checkboxInput(html: string): string {
  return html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? "";
}

describe("ExportBookDialog（受控：open=false 不渲染）", () => {
  it("open=false：整框不渲染（取消 / Esc / 遮罩关闭后 portal 不残留）", () => {
    const html = renderToString(
      <ExportBookDialog
        open={false}
        name="青云记"
        workspaceKind="novel"
        exporting={false}
        onExport={noop}
        onOpenChange={noop}
      />,
    );
    expect(html).toBe("");
  });
});

describe("ExportBookFormBody（导出类型框内容体）", () => {
  const html = renderBody();

  it("标题带书名 + 三个单选项与逐字 caption 都在", () => {
    expect(html).toContain("导出《");
    expect(html).toContain("青云记");
    for (const option of EXPORT_BOOK_OPTIONS) {
      expect(html).toContain(option.label);
      expect(html).toContain(option.caption("青云记"));
    }
    // caption 是产物说明：无损那条明写「可再导入」，有损两条明写「有损」（口径不许互换）
    expect(html).toContain("青云记.zip · 三文件 + 项目规则（若有）· 可再导入（无损）");
    expect(html).toContain("青云记-小说文档.zip · 卷/章 markdown 目录树 · 有损");
    expect(html).toContain("青云记.txt · 整本单文件 · UTF-8 · 有损");
  });

  it("默认选中第一项（项目压缩文件），小说文档 / 纯文本未选中", () => {
    expect(EXPORT_BOOK_OPTIONS[0].kind).toBe(DEFAULT_EXPORT_BOOK_KIND);
    expect(radioInput(html, "project")).toContain("checked");
    expect(radioInput(html, "novel")).not.toContain("checked");
    expect(radioInput(html, "txt")).not.toContain("checked");
  });

  it("「网文排版」勾选只在选中纯文本时出现、在单选组之外、默认不勾", () => {
    // 默认（项目压缩文件）不渲染勾选
    expect(checkboxInput(html)).toBe("");
    const txtHtml = renderBody({ kind: "txt" });
    expect(txtHtml).toContain(WEBNOVEL_LAYOUT_LABEL);
    // 默认不勾
    expect(checkboxInput(txtHtml)).not.toContain("checked");
    // 位置：单选组之外（在所有 radio 之后）
    expect(txtHtml.indexOf('type="checkbox"')).toBeGreaterThan(txtHtml.lastIndexOf('type="radio"'));
    // 勾选态照传入值渲染（不记忆 = 每次打开由容器重置）
    expect(checkboxInput(renderBody({ kind: "txt", webnovel: true }))).toContain("checked");
  });

  it("「网文排版」勾选在途禁用", () => {
    expect(checkboxInput(renderBody({ kind: "txt", webnovel: true, exporting: true }))).toContain(
      "disabled",
    );
  });

  it("Footer = [取消] + [导出]，且在途时禁用", () => {
    expect(html).toMatch(/取\s?消/);
    expect(html).toMatch(/导\s?出/);
    expect(renderBody({ exporting: true })).toContain("disabled");
  });
});

describe("exportBookOptions（按工作区 kind 收窄导出项）", () => {
  it("小说工作区 = 三项（三文件包 + 小说文档 + 纯文本），与 EXPORT_BOOK_OPTIONS 逐项同源", () => {
    expect(exportBookOptions("novel")).toEqual(EXPORT_BOOK_OPTIONS);
    expect(exportBookOptions("novel").map((option) => option.kind)).toEqual([
      "project",
      "novel",
      "txt",
    ]);
  });

  it("练习工作区 = 只有三文件包一项（小说文档 / 纯文本是小说语义）", () => {
    expect(exportBookOptions("practice").map((option) => option.kind)).toEqual(["project"]);
  });

  it("内容体：练习工作区只渲染一个单选项，小说文档 / 纯文本的 label 与 caption 都不出现", () => {
    const practiceHtml = renderBody({ workspaceKind: "practice" });
    expect(practiceHtml).toContain(EXPORT_BOOK_OPTIONS[0].caption("青云记"));
    for (const kind of ["novel", "txt"] as const) {
      const option = EXPORT_BOOK_OPTIONS.find((item) => item.kind === kind)!;
      expect(practiceHtml).not.toContain(option.label);
      expect(practiceHtml).not.toContain(option.caption("青云记"));
    }
    // 单选项仍默认选中唯一那项（默认值 = 第一项 = 三文件包）
    expect(radioInput(practiceHtml, "project")).toContain("checked");
    expect(practiceHtml.match(/<input[^>]*type="radio"/g) ?? []).toHaveLength(1);
    expect(checkboxInput(practiceHtml)).toBe("");
  });
});

describe("exportBookToast（三种产物三句话）", () => {
  it("项目压缩文件 → 「备份」；小说文档 → 「小说文档」；纯文本 → 「纯文本」", () => {
    expect(exportBookToast("project", "青云记")).toBe("已导出《青云记》备份");
    expect(exportBookToast("novel", "青云记")).toBe("已导出《青云记》小说文档");
    expect(exportBookToast("txt", "青云记")).toBe("已导出《青云记》纯文本");
  });
});
