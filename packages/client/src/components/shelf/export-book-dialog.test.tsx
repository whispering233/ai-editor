// `export-book-dialog` 渲染走查（卡 E5）：仓内无 jsdom，用 react-dom/server 直渲染
// **内容体** `ExportBookFormBody`（弹窗外壳走 `createPortal`，SSR 不支持，见 `ui/dialog.test.tsx`）。
// 契约 = docs/ui/DESIGN.md §书架主页 `export-book-dialog`：标题 `导出《书名》` + 竖排两个单选项
// （默认 `项目压缩文件`）+ 两条 caption + Footer `[取消]` / `[导出]`。
// 注意：antd `Button` 会在两字中文之间插空格（「导 出」/「取 消」）⇒ 这些断言用正则。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPORT_BOOK_KIND,
  EXPORT_BOOK_OPTIONS,
  ExportBookDialog,
  ExportBookFormBody,
  exportBookToast,
  type ExportBookKind,
} from "./export-book-dialog";

const noop = () => {};

function renderBody(over: Partial<Parameters<typeof ExportBookFormBody>[0]> = {}): string {
  return renderToString(
    <ExportBookFormBody
      name="青云记"
      kind={DEFAULT_EXPORT_BOOK_KIND}
      onKindChange={noop}
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

describe("ExportBookDialog（受控：open=false 不渲染）", () => {
  it("open=false：整框不渲染（取消 / Esc / 遮罩关闭后 portal 不残留）", () => {
    const html = renderToString(
      <ExportBookDialog
        open={false}
        name="青云记"
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

  it("标题带书名 + 两个单选项与逐字 caption 都在", () => {
    expect(html).toContain("导出《");
    expect(html).toContain("青云记");
    for (const option of EXPORT_BOOK_OPTIONS) {
      expect(html).toContain(option.label);
      expect(html).toContain(option.caption("青云记"));
    }
    // caption 是产物说明：无损那条明写「可再导入」，有损那条明写「有损」（口径不许互换）
    expect(html).toContain("青云记.zip · 三文件 · 可再导入（无损）");
    expect(html).toContain("青云记-小说文档.zip · 卷/章 markdown 目录树 · 有损");
  });

  it("默认选中第一项（项目压缩文件），小说文档未选中", () => {
    expect(EXPORT_BOOK_OPTIONS[0].kind).toBe(DEFAULT_EXPORT_BOOK_KIND);
    expect(radioInput(html, "project")).toContain("checked");
    expect(radioInput(html, "novel")).not.toContain("checked");
  });

  it("Footer = [取消] + [导出]，且在途时禁用", () => {
    expect(html).toMatch(/取\s?消/);
    expect(html).toMatch(/导\s?出/);
    expect(renderBody({ exporting: true })).toContain("disabled");
  });
});

describe("exportBookToast（两种产物两句话）", () => {
  it("项目压缩文件 → 「备份」；小说文档 → 「小说文档」", () => {
    expect(exportBookToast("project", "青云记")).toBe("已导出《青云记》备份");
    expect(exportBookToast("novel", "青云记")).toBe("已导出《青云记》小说文档");
  });
});
