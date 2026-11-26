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

/** 缩放意图（键位 / 菜单 / preload 三处共用的唯一取值域；档位映射只在 `stepZoom`） */
export type ZoomIntent = "in" | "out" | "reset";

/**
 * 缩放状态的对外形状（菜单、IPC 下发、推送共用；渲染层也用它，但客户端**不重算**）。
 *
 * 三个端点布尔是给调用方的「还能不能动」信号：客户端据此置灰按钮，从而不需要在渲染层持一份
 * `ZOOM_FACTORS`（数值单源：档位表只在本文件）。
 */
export interface ZoomState {
  /** 百分比整数（如 125） */
  percent: number;
  /** 已在阶梯最小档 */
  atMin: boolean;
  /** 已在阶梯最大档 */
  atMax: boolean;
  /** 已在 100%（「恢复 100%」无事可做） */
  atDefault: boolean;
}

/** 当前因子 → 对外状态（端点判定只在处；比较走 `ZOOM_EPSILON`，因为 1.1 会读回 1.0999999999999999） */
export function zoomStateFrom(factor: number): ZoomState {
  return {
    percent: zoomPercent(factor),
    atMin: Math.abs(factor - ZOOM_FACTORS[0]) <= ZOOM_EPSILON,
    atMax: Math.abs(factor - ZOOM_FACTORS[ZOOM_FACTORS.length - 1]) <= ZOOM_EPSILON,
    atDefault: Math.abs(factor - 1) <= ZOOM_EPSILON,
  };
}

/**
 * 缩放键位判定（`50-desktop.md` §4.1）：`Ctrl/Cmd + =` 放大、`-` 缩小、`0` 回 100%。
 *
 * 按 `key` 而不是 `code` 判，天生吃各键盘布局（德语 `+` 是不带 Shift 的独立键）；小键盘的 `key`
 * 在 NumLock 关闭时会变成 `Insert` / `End` / `ArrowDown`，所以另按 `code` 兜一层。
 *
 * 为什么不用菜单 accelerator：`CommandOrControl+Plus` 曾整条不触发（electron#14742）、macOS 上显示成
 * `Shift Cmd =`（#1507）、非美布局绑不上，而且 accelerator 与本判定会**双触发**。
 *
 * 入参就是 Electron `before-input-event` 的 `input` 子集（事件本身不可单测，判定才可）。
 */
export function zoomKeyIntent(input: {
  type: string;
  key: string;
  code: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
}): "in" | "out" | "reset" | null {
  // 只认按下：keyUp 也判会让一次按键走两遍（放大一次跳两档）
  if (input.type !== "keyDown") return null;
  if (!(input.control || input.meta)) return null;
  // AltGr 在 Windows 上同时报 Ctrl + Alt，且会产出 `+` 一类的字符（如波兰语布局）——吃掉它会让
  // 那些布局里打不出 `+`。菜单项没有 accelerator，所以拦不到的正常按键不受影响。
  if (input.alt) return null;
  if (input.key === "=" || input.key === "+") return "in";
  if (input.key === "-") return "out";
  if (input.key === "0") return "reset";
  if (input.code === "NumpadAdd") return "in";
  if (input.code === "NumpadSubtract") return "out";
  if (input.code === "Numpad0") return "reset";
  return null;
}
