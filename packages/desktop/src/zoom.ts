// 界面缩放档位（`docs/design/50-desktop.md` §4.1）：桌面版整站缩放走 Electron 的 layout zoom
// （`webContents.setZoomFactor`）——layout viewport 的 CSS px 变少、DPR 变大，语义与浏览器
// `Ctrl/Cmd + =/-/0` 完全一致。**不是** `transform: scale`（不参与布局，会破 ProseMirror 命中测试
// 与画布拖拽坐标），也不改任何 `--writing-*` 偏好（正文视觉字号另由写作设置四档决定）。
//
// 档位是**契约**：取 Chromium 自己的 `kPresetZoomFactors`（`components/zoom/page_zoom_constants.cc`）
// 在 80%–200% 的那一段——没理由发明第二套；靠近 100% 步长更细，200% 满足 WCAG 1.4.4
// 「放大 200% 不丢内容」。⚠ 不要照抄 `1.2^level` 的连乘链（`0.83 / 1.2 / 1.44`）：那是 Electron
// 菜单 role 的 ±0.5 level 与 VS Code 整数 level 的工程产物，Chromium 的 UI 档位就是这张整齐表。
//
// 本模块是纯函数（主进程侧接线见 `main.ts`，持久化见 `config.ts` 的 `zoom`），改档位必须同步
// `50-desktop.md` §4.1 那张表与 `zoom.test.ts` 的字面值断言。
export const ZOOM_FACTORS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

/**
 * 浮点比较容差，与 Chromium 判「两个缩放值相等」的口径同值（`page_zoom` 的 0.001）。
 *
 * 必要性：`webContents.getZoomFactor()` 读回的是 Chromium 由内部 ratio 反算的 double，
 * 1.1 会回成 `1.0999999999999999`——严格 `===` 判档位会把它当成「不在阶梯上」，
 * 于是按一次放大直接跳过 1.25 落到 1.5。
 */
export const ZOOM_EPSILON = 0.001;

/** 是否是阶梯上的档位（容差比较；非数值 / NaN / Infinity 一律不是） */
export function isZoomFactor(value: unknown): value is number {
  // NaN 与 Infinity 过不了 `Math.abs(...) <= ZOOM_EPSILON`，不需要额外的 `Number.isFinite`。
  return typeof value === "number" && ZOOM_FACTORS.some((factor) => Math.abs(factor - value) <= ZOOM_EPSILON);
}

/**
 * 阶梯上的上/下一档（`direction: 1` 放大、`-1` 缩小），**严格**跨到相邻档位。
 *
 * 当前值不在阶梯上时（盘上被手改过、或旧版本遗留）按位置就近跨：1.37 放大 → 1.5、缩小 → 1.25。
 * 到端点夹住（2 再放大仍是 2、0.8 再缩小仍是 0.8）——调用方据此判「值没变就别写盘」。
 */
export function nextZoomFactor(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    for (const factor of ZOOM_FACTORS) {
      if (factor > current + ZOOM_EPSILON) return factor;
    }
    return ZOOM_FACTORS[ZOOM_FACTORS.length - 1];
  }
  for (let i = ZOOM_FACTORS.length - 1; i >= 0; i -= 1) {
    if (ZOOM_FACTORS[i] < current - ZOOM_EPSILON) return ZOOM_FACTORS[i];
  }
  return ZOOM_FACTORS[0];
}

/** 因子 → 百分比整数（菜单「实际大小 · N%」与「回 100%」的 1 都从这里出，避免各处各写一份取整） */
export function zoomPercent(factor: number): number {
  return Math.round(factor * 100);
}