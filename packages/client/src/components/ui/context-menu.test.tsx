// Base UI ContextMenu 契约护栏（决策 40，批次十：右键菜单替代行级 AskAiButton）
// 同 dropdown-menu 契约（Base UI error #31）：ContextMenuLabel（= Menu.GroupLabel）**必须**由
// ContextMenuGroup（= Menu.Group）包裹——GroupLabel 读取 Group 上下文，缺失即抛
// 「MenuGroupContext is missing」。Item/Separator 无此要求。
// 护栏说明：打开态菜单无法在 SSR 复现（MenuPortal 返回 null 不渲染 Popup），直接渲染
// GroupLabel 本体命中同一契约（hooks 在 SSR 同样执行）——同 chat-panel.test.tsx 既有护栏模式。
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

describe("Base UI ContextMenu 契约（error #31 根因护栏，决策 40）", () => {
  it("裸 ContextMenuLabel（无 Group）→ 抛 MenuGroupContext is missing（#31 契约）", () => {
    // 生产态压缩为「Base UI error #31; visit ...code=31」；测试环境 NODE_ENV=test → dev 完整消息
    expect(() => renderToString(<ContextMenuLabel>设定「宗门」</ContextMenuLabel>)).toThrow(
      /MenuGroupContext is missing/,
    );
  });

  it("ContextMenuGroup 包裹 ContextMenuLabel → 正常渲染（修复后的正确结构）", () => {
    const html = renderToString(
      <ContextMenuGroup>
        <ContextMenuLabel>设定「宗门」</ContextMenuLabel>
      </ContextMenuGroup>,
    );
    expect(html).toContain("设定「宗门」");
  });

  it("完整菜单结构（Trigger + Content + Group/Label + Item + Separator）渲染不抛异常", () => {
    // 行级右键菜单结构合法性（RowContextMenu 同构）；打开态崩溃由上面两个契约用例覆盖
    expect(() =>
      renderToString(
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
      ),
    ).not.toThrow();
  });
});
