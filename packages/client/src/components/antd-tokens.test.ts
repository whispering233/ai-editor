// 选中面 token 守卫：用 antd 自己的派生管线（`theme.getDesignToken`）算出真实 token，断言选中面可读。
//
// 为什么需要它（2026-09 用户实测：「所有下拉选择列表的选中条目文字看不清」）：
// antd 的 `controlItemBgActive` / `controlItemBgActiveHover` 由 `colorPrimary` 派生
// （`theme/util/alias.js`：`: colorPrimaryBg` / `: colorPrimaryBgHover`）。本仓主色 seed 是深墨
// `#37352f`，派生出来的不是「浅主色底」而是中深灰（实测 `#787771` / `#6b6a65`），压在 `colorText`
// （同为 `#37352f`）上对比度 **2.26:1**——而弹层打开时 antd 会把已选中项自动置为 active，命中
// `select/style/dropdown.js` 的 `&-selected&-active { backgroundColor: controlItemBgActiveHover }`，
// 于是逐组件覆盖 `Select.optionSelectedBg` 完全无效（登记了灰面、像素是深灰）。
// 这类「测试全绿但像素全错」的 token 派生坑和 `cssvar-scope` / `button-variant-color` 同类，
// 必须在 token 层（而非元素层）拦——故断言派生后的**对比度**而不是某个具体色值。
import { describe, expect, it } from "vitest";
import { theme } from "antd";
import { COMPONENT_TOKENS_DARK, COMPONENT_TOKENS_LIGHT, DARK_TOKEN, LIGHT_TOKEN } from "./AntdProvider";

/** 解析颜色（`#rrggbb` / `#rgb` / `rgb(...)` / `rgba(...)`）→ [r,g,b,a] */
function parseColor(value: string): [number, number, number, number] {
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1]!;
    const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    return [r!, g!, b!, 1];
  }
  const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
  if (parts.length < 3) throw new Error(`无法解析颜色：${value}`);
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
}

/** 半透明色叠在给定底上（antd 的面/字大量是 rgba——不合成就算不出真实对比度：
 * 深色态的 rgba(255,255,255,.055) 面 + 81% 白字必须叠在深色面板上，叠白会得出 1:1 的假值） */
function over(color: string, base: [number, number, number]): [number, number, number] {
  const [r, g, b, a] = parseColor(color);
  return [0, 1, 2].map((i) => Math.round([r, g, b][i]! * a + base[i]! * (1 - a))) as [
    number,
    number,
    number,
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 对比度：bg 叠在 canvas 上、fg 叠在 bg 上（`base` = 该模式的面板底色） */
function contrast(fg: string, bg: string, base: [number, number, number]): number {
  const surface = over(bg, base);
  const text = over(fg, surface);
  const a = luminance(text);
  const b = luminance(surface);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

describe("选中面 token（全局派生 alias 覆盖）", () => {
  const cases = [
    { name: "浅色", config: { algorithm: theme.defaultAlgorithm, token: LIGHT_TOKEN } },
    { name: "深色", config: { algorithm: theme.darkAlgorithm, token: DARK_TOKEN } },
  ] as const;

  for (const { name, config } of cases) {
    it(`${name}：选中/选中+hover 面与字色对比度 ≥ 4.5:1（WCAG AA）`, () => {
      const token = theme.getDesignToken(config);
      const base = over(token.colorBgContainer, [255, 255, 255]); // 该模式的面板底色
      // **选中面家族**：只断言全局源的三个 token——组件级选中面全部由它们派生（源码为证）：
      // `select/style/token.js`：`optionSelectedBg: controlItemBgActive` / `optionActiveBg: controlItemBgHover`；
      // `menu/style/index.js`：`itemSelectedBg` / `itemActiveBg` = `controlItemBgActive`；
      // `tree`：`nodeSelectedBg`；`table`：`rowSelectedBg` = `controlItemBgActive`、`rowSelectedHoverBg` = `controlItemBgActiveHover`。
      // 断言全局源即传递覆盖整个家族（Tree/Table/Cascader/Pagination 现在没用、以后可能用——断言成本为零）。
      const faces: Record<string, string> = {
        controlItemBgActive: token.controlItemBgActive,
        controlItemBgActiveHover: token.controlItemBgActiveHover,
        controlItemBgHover: token.controlItemBgHover,
      };
      for (const [key, surface] of Object.entries(faces)) {
        const ratio = contrast(token.colorText, surface, base);
        expect(ratio, `${name} ${key}=${surface} 压 colorText=${token.colorText}`).toBeGreaterThanOrEqual(4.5);
      }
      // 选中项字重：antd 默认 fontWeightStrong（600）——面同档时靠字重区分选中与悬浮，被改掉则选中态失去标记
      expect(token.fontWeightStrong).toBeGreaterThanOrEqual(600);
    });

    it(`${name}：选中面不等于派生 colorPrimaryBg（深墨主色的中灰陷阱）`, () => {
      const token = theme.getDesignToken(config);
      expect(token.controlItemBgActive).not.toBe(token.colorPrimaryBg);
      expect(token.controlItemBgActiveHover).not.toBe(token.colorPrimaryBgHover);
    });
  }

  it("自检：裸深墨 seed（不加选中面覆盖）派生值确实不可读——守卫能捕获该坑", () => {
    // 最小重现：主色与字色同为深墨（本仓 seed 的实际情形），不加覆盖时的派生结果
    const raw = theme.getDesignToken({
      algorithm: theme.defaultAlgorithm,
      token: { colorPrimary: "#37352f", colorText: "#37352f" },
    });
    const white: [number, number, number] = [255, 255, 255];
    expect(contrast(raw.colorText, raw.controlItemBgActive, white)).toBeLessThan(4.5);
    expect(contrast(raw.colorText, raw.controlItemBgActiveHover, white)).toBeLessThan(4.5);
  });
});

describe("Tabs 组件 token（中栏页头分割线契约）", () => {
  // 为什么需要它：line 型 Tabs 的导航条**自带** 1px `colorBorderSecondary` 底线（= `{colors.hairline}`），
  // 它兼任页头分割线（DESIGN.md §Layout「中栏页头结构」）。antd 默认 `horizontalMargin: 0 0 margin(16)px 0`
  // 会在该底线与内容之间多出 16px，分割线于是悬空、与下方的显式分割线变成双线——契约值就是 `"0"`。
  it("浅/深两态 horizontalMargin 归零（否则 tab 底线与内容之间空 16px）", () => {
    expect(COMPONENT_TOKENS_LIGHT.Tabs?.horizontalMargin).toBe("0");
    expect(COMPONENT_TOKENS_DARK.Tabs?.horizontalMargin).toBe("0");
  });

  it("未选中 tab 字色 = 该模式次级文字档（选中/指示条由 antd 默认 colorPrimary 承担，不重复覆盖）", () => {
    expect(COMPONENT_TOKENS_LIGHT.Tabs?.itemColor).toBe(LIGHT_TOKEN.colorTextSecondary);
    expect(COMPONENT_TOKENS_DARK.Tabs?.itemColor).toBe(DARK_TOKEN.colorTextSecondary);
  });
});

describe("行高/缩进列几何（大纲页缩进列对齐依赖的 antd 值）", () => {
  // 为什么需要它：大纲行的「无子节点占位」必须与折叠箭头（`<Button size="small"` icon-only）同几何——
  // antd 的 icon-only 宽度取 `controlHeight`，small 档取 `controlHeightSM` = `controlHeight × 0.75`
  // （`antd/es/button/style/index.js` 的 `genSizeSmallButtonStyle`），本仓 seed 32 ⇒ 24px，
  // 于是占位写成 `-ml-2 w-6`（24px）。antd 是 `^6.6.2`（caret），上游 minor 若动 32/0.75，
  // 两类行会再次错 12px 而**无任何报错**——必须在此拦（改 antd 时同步改 `Outline.tsx` 的占位宽）。
  const SMALL_ICON_ONLY_WIDTH_PX = 24; // 与 `w-6` 同值

  it("浅/深两态 controlHeightSM 均为 24px（= 大纲行占位 `w-6` 与折叠箭头同宽的前提）", () => {
    for (const [name, config] of [
      ["light", { algorithm: theme.defaultAlgorithm, token: LIGHT_TOKEN }],
      ["dark", { algorithm: theme.darkAlgorithm, token: DARK_TOKEN }],
    ] as const) {
      const token = theme.getDesignToken(config);
      expect(token.controlHeightSM, `${name} controlHeightSM`).toBe(SMALL_ICON_ONLY_WIDTH_PX);
      expect(token.controlHeight * 0.75, `${name} controlHeight×0.75`).toBe(SMALL_ICON_ONLY_WIDTH_PX);
    }
  });
});
