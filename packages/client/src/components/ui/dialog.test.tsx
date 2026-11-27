// Dialog 换芯 antd Modal 的可测契约（DESIGN.md §Components `dialog`）。
//
// **不要在这里断言弹窗内容的可见性**：`@rc-component/portal` 在无 DOM 环境恒 `return null`
// （`Portal.js` 的 `!canUseDom()`），且 `DialogWrap` 在 `destroyOnHidden && !animatedVisible` 时
// 自己也 `return null` —— `open=true` 与 `open=false` 的 `renderToString` **都是空串**，
// 这类断言无论实现对错都不会红（本文件曾有一条这样的空跑用例，2026-11 复核删除）。
// 可见性 / 焦点陷阱 / 叠层行为只能浏览器核对；实现层面的守卫在 `design-discipline.test.ts`
// 的 `dialog-width-prop`（宽度只走 prop）。
// 本文件只锁一件可测的事：宽度档位映射是单一来源。
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
  it("SSR 恒为空串：open=true / false 都不输出（记录事实，别在此补可见性断言）", () => {
    const render = (open: boolean) =>
      renderToString(
        <Dialog open={open} onOpenChange={() => {}}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>导入书籍</DialogTitle>
            </DialogHeader>
            <DialogFooter>内容</DialogFooter>
          </DialogContent>
        </Dialog>,
      );
    expect(render(false)).toBe("");
    expect(render(true)).toBe("");
  });

  it("宽度档位映射是单一来源（调用点只给档位名）", () => {
    expect(DIALOG_WIDTHS).toEqual({ sm: 384, md: 448, lg: 512, xl: 576, "2xl": 672 });
    expect(DIALOG_WIDTHS.md).toBe(448);
  });
});
