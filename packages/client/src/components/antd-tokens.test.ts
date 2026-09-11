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
import { DARK_TOKEN, LIGHT_TOKEN } from "./AntdProvider";

/** 解析 antd 派生出的颜色（`#rrggbb` / `#rgb` / `rgb(...)` / `rgba(...)`）→ [r,g,b]（半透明视为已叠在白底上） */
function rgb(value: string): [number, number, number] {
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1]!;
    const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
  if (parts.length < 3) throw new Error(`无法解析颜色：${value}`);
  let [r, g, b] = parts as [number, number, number];
  if (parts.length >= 4) {
    // 半透明面按「叠在 canvas 上」还原（antd 的深色面多是 rgba 白）
    const a = parts[3] ?? 1;
    r = Math.round(r * a + 255 * (1 - a));
    g = Math.round(g * a + 255 * (1 - a));
    b = Math.round(b * a + 255 * (1 - a));
  }
  return [r, g, b];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 对比度（bg 已按不透明处理） */
function contrast(fg: string, bg: string): number {
  const a = luminance(rgb(fg));
  const b = luminance(rgb(bg));
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
      for (const [key, surface] of Object.entries({
        controlItemBgActive: token.controlItemBgActive,
        controlItemBgActiveHover: token.controlItemBgActiveHover,
      })) {
        const ratio = contrast(token.colorText, surface);
        expect(ratio, `${name} ${key}=${surface} 压 colorText=${token.colorText}`).toBeGreaterThanOrEqual(4.5);
      }
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
    expect(contrast(raw.colorText, raw.controlItemBgActive)).toBeLessThan(4.5);
    expect(contrast(raw.colorText, raw.controlItemBgActiveHover)).toBeLessThan(4.5);
  });
});
