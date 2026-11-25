// 界面缩放档位单测：钉住 `50-desktop.md` §4.1 那张表的字面值，以及主进程接线依赖的三条判定
// （读回容差、严格跨档、端点夹住）。改档位先改文档那张表，再改这里。
import { describe, expect, it } from "vitest";
import { ZOOM_EPSILON, ZOOM_FACTORS, isZoomFactor, nextZoomFactor, zoomKeyIntent, zoomPercent } from "./zoom.js";

describe("ZOOM_FACTORS", () => {
  it("与 50-desktop.md §4.1 的档位表逐项同值（80/90/100/110/125/150/175/200 %）", () => {
    expect(ZOOM_FACTORS).toEqual([0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]);
    expect(ZOOM_FACTORS.map(zoomPercent)).toEqual([80, 90, 100, 110, 125, 150, 175, 200]);
  });

  it("严格升序（nextZoomFactor 的「严格跨档」依赖这一点）", () => {
    const sorted = [...ZOOM_FACTORS].sort((a, b) => a - b);
    expect([...ZOOM_FACTORS]).toEqual(sorted);
  });

  it("ZOOM_EPSILON 与 Chromium page_zoom 同值", () => {
    expect(ZOOM_EPSILON).toBe(0.001);
  });
});

describe("isZoomFactor", () => {
  it("接受阶梯上的每个档位", () => {
    for (const factor of ZOOM_FACTORS) expect(isZoomFactor(factor)).toBe(true);
  });

  it("接受 getZoomFactor() 读回的 1.0999999999999999（浮点反算，容差内即 1.1）", () => {
    expect(isZoomFactor(1.0999999999999999)).toBe(true);
    expect(isZoomFactor(0.7999999999999999)).toBe(true);
    expect(nextZoomFactor(1.0999999999999999, 1)).toBe(1.25);
  });

  it("拒绝非数值 / NaN / Infinity", () => {
    expect(isZoomFactor("1.25")).toBe(false);
    expect(isZoomFactor(null)).toBe(false);
    expect(isZoomFactor(undefined)).toBe(false);
    expect(isZoomFactor(Number.NaN)).toBe(false);
    expect(isZoomFactor(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isZoomFactor(Number.NEGATIVE_INFINITY)).toBe(false);
    expect(isZoomFactor({ factor: 1 })).toBe(false);
  });

  it("拒绝不在阶梯上的数值（含容差外的近邻）", () => {
    expect(isZoomFactor(0.83)).toBe(false);
    expect(isZoomFactor(1.2)).toBe(false);
    expect(isZoomFactor(1.37)).toBe(false);
    expect(isZoomFactor(1.202)).toBe(false);
    expect(isZoomFactor(0.5)).toBe(false);
    expect(isZoomFactor(2.5)).toBe(false);
  });
});

describe("nextZoomFactor", () => {
  it("沿阶梯逐档上/下走", () => {
    expect(nextZoomFactor(0.8, 1)).toBe(0.9);
    expect(nextZoomFactor(1, 1)).toBe(1.1);
    expect(nextZoomFactor(1.1, 1)).toBe(1.25);
    expect(nextZoomFactor(1.75, 1)).toBe(2);
    expect(nextZoomFactor(2, -1)).toBe(1.75);
    expect(nextZoomFactor(1.25, -1)).toBe(1.1);
    expect(nextZoomFactor(1, -1)).toBe(0.9);
  });

  it("两端夹住（端点值不变 ⇒ 调用方据此不写盘、菜单项置灰）", () => {
    expect(nextZoomFactor(2, 1)).toBe(2);
    expect(nextZoomFactor(0.8, -1)).toBe(0.8);
  });

  it("当前值不在阶梯上时按位置就近跨：1.37 放大 → 1.5、缩小 → 1.25", () => {
    expect(nextZoomFactor(1.37, 1)).toBe(1.5);
    expect(nextZoomFactor(1.37, -1)).toBe(1.25);
  });

  it("阶梯外的端点外侧同样夹住", () => {
    expect(nextZoomFactor(3, 1)).toBe(2);
    expect(nextZoomFactor(0.5, -1)).toBe(0.8);
  });
});

describe("zoomPercent", () => {
  it("因子取整成百分比（1.0999999999999999 × 100 = 110.00000000000001 也必须是 110）", () => {
    expect(zoomPercent(0.8)).toBe(80);
    expect(zoomPercent(1)).toBe(100);
    expect(zoomPercent(1.1)).toBe(110);
    expect(zoomPercent(1.0999999999999999)).toBe(110);
    expect(zoomPercent(1.25)).toBe(125);
    expect(zoomPercent(1.75)).toBe(175);
    expect(zoomPercent(2)).toBe(200);
  });
});

/** `before-input-event` 的 `input` 子集，缺省 = 主键盘、按下的 Ctrl+键 */
function keyInput(overrides: Partial<Parameters<typeof zoomKeyIntent>[0]>): Parameters<typeof zoomKeyIntent>[0] {
  return { type: "keyDown", key: "", code: "", control: false, meta: false, alt: false, ...overrides };
}

describe("zoomKeyIntent", () => {
  it("主键盘 = / + / - / 0", () => {
    expect(zoomKeyIntent(keyInput({ key: "=", code: "Equal", control: true }))).toBe("in");
    // Shift+= 出来的 `+`：key 变了、modifier 不含 shift 以外的差别，必须同样放大
    expect(zoomKeyIntent(keyInput({ key: "+", code: "Equal", control: true }))).toBe("in");
    expect(zoomKeyIntent(keyInput({ key: "-", code: "Minus", control: true }))).toBe("out");
    expect(zoomKeyIntent(keyInput({ key: "0", code: "Digit0", control: true }))).toBe("reset");
  });

  it("小键盘按 code 兜住（NumLock 关闭时 key 会变成 Insert / End / ArrowDown）", () => {
    expect(zoomKeyIntent(keyInput({ key: "+", code: "NumpadAdd", control: true }))).toBe("in");
    expect(zoomKeyIntent(keyInput({ key: "-", code: "NumpadSubtract", control: true }))).toBe("out");
    expect(zoomKeyIntent(keyInput({ key: "0", code: "Numpad0", control: true }))).toBe("reset");
    // NumLock 关闭的真实形态
    expect(zoomKeyIntent(keyInput({ key: "Insert", code: "Numpad0", control: true }))).toBe("reset");
    expect(zoomKeyIntent(keyInput({ key: "End", code: "NumpadSubtract", control: true }))).toBe("out");
  });

  it("没有 Ctrl / Meta 时一律不吃（不是缩放键）", () => {
    expect(zoomKeyIntent(keyInput({ key: "=", code: "Equal" }))).toBeNull();
    expect(zoomKeyIntent(keyInput({ key: "-", code: "Minus" }))).toBeNull();
    expect(zoomKeyIntent(keyInput({ key: "0", code: "Digit0" }))).toBeNull();
  });

  it("只有 Meta（macOS 的 Cmd）同样有效", () => {
    expect(zoomKeyIntent(keyInput({ key: "=", code: "Equal", meta: true }))).toBe("in");
    expect(zoomKeyIntent(keyInput({ key: "-", code: "Minus", meta: true }))).toBe("out");
    expect(zoomKeyIntent(keyInput({ key: "0", code: "Digit0", meta: true }))).toBe("reset");
  });

  it("Alt / AltGr（Windows 上报 Ctrl+Alt）组合一律不动（否则部分布局打不出 + ）", () => {
    expect(zoomKeyIntent(keyInput({ key: "+", code: "Equal", control: true, alt: true }))).toBeNull();
    expect(zoomKeyIntent(keyInput({ key: "-", code: "Minus", control: true, alt: true }))).toBeNull();
    expect(zoomKeyIntent(keyInput({ key: "0", code: "Digit0", control: true, alt: true }))).toBeNull();
    expect(zoomKeyIntent(keyInput({ key: "=", code: "Equal", meta: true, alt: true }))).toBeNull();
  });

  it("只有 keyDown 才算（keyUp / char 不重复计数）", () => {
    for (const type of ["keyUp", "char", "rawKeyDown"]) {
      expect(zoomKeyIntent(keyInput({ type, key: "=", code: "Equal", control: true }))).toBeNull();
    }
  });

  it("其它按键不吃（Ctrl+C 等必须照常传到渲染层）", () => {
    expect(zoomKeyIntent(keyInput({ key: "c", code: "KeyC", control: true }))).toBeNull();
    expect(zoomKeyIntent(keyInput({ key: "?", code: "Slash", control: true }))).toBeNull();
  });
});