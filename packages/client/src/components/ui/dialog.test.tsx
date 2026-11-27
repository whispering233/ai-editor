// Dialog 换芯 antd Modal 的可测契约（DESIGN.md §Components `dialog`）。
//
// **不要断言弹窗内容的可见性**：`@rc-component/portal` 在无 DOM 环境恒 `return null`
// （`Portal.js` 的 `!canUseDom()`），`open=true` 与 `open=false` 的 `renderToString` 都是空串
// ——写这类断言只会得到一条恒真的空跑用例。可见性 / 焦点陷阱 / Esc 叠层只能浏览器核对。
// 本文件锁两件可测的事：关闭态不挂载子树、宽度档位映射是单一来源。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import {
  DIALOG_WIDTHS,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

describe("Dialog（换芯 antd Modal）", () => {
  it("open=false：SSR 不输出任何内容（关闭态不挂载子树）", () => {
    const html = renderToString(
      <Dialog open={false} onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导入书籍</DialogTitle>
          </DialogHeader>
          <DialogFooter>内容</DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(html).toBe("");
  });

  it("open=true 在 SSR 也是空串（portal 恒不渲染）——记录事实，别在这里补可见性断言", () => {
    const html = renderToString(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent>
          <DialogTitle>导入书籍</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(html).toBe("");
  });

  it("宽度档位映射是单一来源（调用点只给档位名）", () => {
    expect(DIALOG_WIDTHS).toEqual({ sm: 384, md: 448, lg: 512, xl: 576, "2xl": 672 });
    expect(DIALOG_WIDTHS.md).toBe(448);
  });
});
