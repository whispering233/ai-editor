// Dialog 自绘实现走查（修复：Content 缺 open 守卫导致关闭失效——
// 取消/Esc 置 open=false 后 portal 仍常驻渲染）
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./dialog";

describe("Dialog 自绘实现", () => {
  it("open=false：Content 不渲染（受控守卫——修复「无法关闭」根因）", () => {
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
});
