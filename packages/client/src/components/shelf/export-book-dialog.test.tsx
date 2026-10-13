// `export-book-dialog` 渲染走查（卡 E5）：仓内无 jsdom，用 react-dom/server 直渲染
// **内容体** `ExportBookFormBody`（弹窗外壳走 `createPortal`，SSR 不支持，见 `ui/dialog.test.tsx`）。
// 契约 = docs/ui/DESIGN.md §书架主页 `export-book-dialog`：标题 `导出《书名》` + 竖排单选项
// （默认 `项目压缩文件`，小说工作区两项）+ 两条 caption + Footer `[取消]` / `[导出]`；
// 练习工作区**只给三文件包一项**（「小说文档」是小说语义，服务端 `export-novel` 对练习 400
// `KIND_MISMATCH`）——`exportBookOptions(workspaceKind)` 是这层过滤的唯一实现。
// 注意：antd `Button` 会在两字中文之间插空格（「导 出」/「取 消」）⇒ 这些断言用正则。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPORT_BOOK_KIND,
  EXPORT_BOOK_OPTIONS,
  ExportBookDialog,
  ExportBookFormBody,
  exportBookOptions,
  exportBookToast,
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

describe("exportBookOptions（按工作区 kind 收窄导出项）", () => {
  it("小说工作区 = 两项（三文件包 + 小说文档），与 EXPORT_BOOK_OPTIONS 逐项同源", () => {
    expect(exportBookOptions("novel")).toEqual(EXPORT_BOOK_OPTIONS);
  });

  it("练习工作区 = 只有三文件包一项（小说文档是小说语义）", () => {
    expect(exportBookOptions("practice").map((option) => option.kind)).toEqual(["project"]);
  });

  it("内容体：练习工作区只渲染一个单选项，小说文档的 label / caption 都不出现", () => {
    const practiceHtml = renderBody({ workspaceKind: "practice" });
    const novelOption = EXPORT_BOOK_OPTIONS.find((option) => option.kind === "novel")!;
    expect(practiceHtml).toContain(EXPORT_BOOK_OPTIONS[0].caption("青云记"));
    expect(practiceHtml).not.toContain(novelOption.label);
    expect(practiceHtml).not.toContain(novelOption.caption("青云记"));
    // 单选项仍默认选中唯一那项（默认值 = 第一项 = 三文件包）
    expect(radioInput(practiceHtml, "project")).toContain("checked");
    expect(practiceHtml.match(/<input[^>]*type="radio"/g) ?? []).toHaveLength(1);
  });
});

describe("exportBookToast（两种产物两句话）", () => {
  it("项目压缩文件 → 「备份」；小说文档 → 「小说文档」", () => {
    expect(exportBookToast("project", "青云记")).toBe("已导出《青云记》备份");
    expect(exportBookToast("novel", "青云记")).toBe("已导出《青云记》小说文档");
  });
});
