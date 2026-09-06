// ContextMenu 自绘换芯走查（批次十七 3-7：Base UI → 原生；#31 契约退役）
// SSR 语义：菜单默认关闭 → Content portal 不渲染；Trigger clone 注入 children 可在 SSR 验证；
// 裸 Label 渲染不再依赖 Group 上下文（自绘实现无此约束）。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";

describe("ContextMenu 自绘实现走查", () => {
  it("完整结构渲染不抛异常（关闭态 Content 不输出）", () => {
    const html = renderToString(
      <ContextMenuRoot>
        <ContextMenuTrigger render={<div>行</div>} />
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuLabel>设定「宗门」</ContextMenuLabel>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuItem>注入会话上下文</ContextMenuItem>
          <ContextMenuItem>建立关联</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuRoot>,
    );
    expect(html).toContain("行"); // trigger 原样渲染
    expect(html).not.toContain("注入会话上下文"); // 关闭态菜单不渲染
  });

  it("Trigger 行内容 children 注入 render 元素内部（右键菜单触发区=整行）", () => {
    const html = renderToString(
      <ContextMenuRoot>
        <ContextMenuTrigger render={<div data-kind="row" />}>
          <span>行内容</span>
        </ContextMenuTrigger>
        <ContextMenuContent />
      </ContextMenuRoot>,
    );
    expect(html).toContain("行内容");
  });

  it("裸 ContextMenuLabel 渲染文本（自绘无 Group 上下文依赖——旧 #31 契约退役）", () => {
    const html = renderToString(<ContextMenuLabel>设定「宗门」</ContextMenuLabel>);
    expect(html).toContain("设定「宗门」");
  });
});
