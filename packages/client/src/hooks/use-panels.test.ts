// use-panels 纯函数测试（F7 三栏布局）：默认值换算（1:5:4 按视口）、localStorage 防御解析、
// 宽度收敛（min/max 与取整）。hook 本体依赖 window/localStorage（含拖拽/持久化副作用），
// node 环境不渲染（仓库无 jsdom，与 chat-panel.test.tsx 同约定）；纯函数已从 hook 抽出独立可测。
import { describe, expect, it } from "vitest";
import {
  CHAT_MAX_WIDTH,
  CHAT_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampPanelWidth,
  defaultPanelLayout,
  parsePanelLayout,
} from "./use-panels";

describe("clampPanelWidth", () => {
  it("区间内保留并取整（防 subpixel 渲染抖动）", () => {
    expect(clampPanelWidth(200.6, 140, 400)).toBe(201);
    expect(clampPanelWidth(200.4, 140, 400)).toBe(200);
    expect(clampPanelWidth(140, 140, 400)).toBe(140);
    expect(clampPanelWidth(400, 140, 400)).toBe(400);
  });

  it("越界收敛到 min/max", () => {
    expect(clampPanelWidth(50, 140, 400)).toBe(140);
    expect(clampPanelWidth(999, 140, 400)).toBe(400);
  });
});

describe("defaultPanelLayout", () => {
  it("按视口 1:5:4 换算（左 10% / 右 40%），默认未收起", () => {
    // 1600 视口下 10% = 160、40% = 640 均在可读区间内，比例严格还原
    const layout = defaultPanelLayout(1600);
    expect(layout.sidebarWidth).toBe(160);
    expect(layout.chatWidth).toBe(640);
    expect(layout.collapsedSidebar).toBe(false);
    expect(layout.collapsedChat).toBe(false);
  });

  it("极端视口收敛到可读区间（min/max）", () => {
    const narrow = defaultPanelLayout(800);
    expect(narrow.sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
    expect(narrow.chatWidth).toBe(CHAT_MIN_WIDTH);
    const wide = defaultPanelLayout(6000);
    expect(wide.sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);
    expect(wide.chatWidth).toBe(CHAT_MAX_WIDTH);
  });
});

describe("parsePanelLayout（防御解析）", () => {
  it("无存储值 → 默认", () => {
    expect(parsePanelLayout(null, 1600)).toEqual(defaultPanelLayout(1600));
  });

  it("非法 JSON / 非对象 / 缺字段 / 类型错 → 整体回退默认", () => {
    expect(parsePanelLayout("not-json", 1600)).toEqual(defaultPanelLayout(1600));
    expect(parsePanelLayout("[]", 1600)).toEqual(defaultPanelLayout(1600));
    expect(parsePanelLayout("{}", 1600)).toEqual(defaultPanelLayout(1600));
    expect(parsePanelLayout('{"sidebarWidth": 200}', 1600)).toEqual(defaultPanelLayout(1600));
    expect(parsePanelLayout('{"sidebarWidth": "200", "chatWidth": 300}', 1600)).toEqual(
      defaultPanelLayout(1600),
    );
  });

  it("合法值完整读取，收起态仅严格 true 生效", () => {
    const layout = parsePanelLayout(
      JSON.stringify({
        sidebarWidth: 200,
        chatWidth: 300,
        collapsedSidebar: true,
        collapsedChat: false,
      }),
      1600,
    );
    expect(layout).toEqual({
      sidebarWidth: 200,
      chatWidth: 300,
      collapsedSidebar: true,
      collapsedChat: false,
    });
  });

  it("越界宽度收敛，非法布尔按 false", () => {
    const clamped = parsePanelLayout(
      JSON.stringify({
        sidebarWidth: 30,
        chatWidth: 5000,
        collapsedSidebar: "yes",
        collapsedChat: 1,
      }),
      1600,
    );
    expect(clamped.sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
    expect(clamped.chatWidth).toBe(CHAT_MAX_WIDTH);
    expect(clamped.collapsedSidebar).toBe(false);
    expect(clamped.collapsedChat).toBe(false);
  });
});
