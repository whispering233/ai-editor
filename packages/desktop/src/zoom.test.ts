// 界面缩放档位单测：钉住 `50-desktop.md` §4.1 那张表的字面值，以及主进程接线依赖的三条判定
// （读回容差、严格跨档、端点夹住）。改档位先改文档那张表，再改这里。
import { describe, expect, it } from "vitest";
import { ZOOM_EPSILON, ZOOM_FACTORS, isZoomFactor, nextZoomFactor, zoomPercent } from "./zoom.js";

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