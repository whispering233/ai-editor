// 章正文页（卡 12.5）的可测逻辑：自动保存调度器 + 相邻章推导 + 字数文案 + 端点错误分流。
// 全部是无副作用纯函数 / 工厂（node 环境可测；仓内无 jsdom，页面组件不参与单测——BlockNote 的
// 编辑器内部不测，由浏览器走查承担）。契约：docs/api/110-api-manuscript.md。
import type { OutlineTree } from "@whispering233/ai-editor-shared";
import { numberOutline, type OutlineChapterRow } from "./outline-tree";

/** 自动保存空闲时长：停止输入 ~1.5s 落盘（卡 12.5 口径） */
export const AUTOSAVE_DELAY_MS = 1500;

/** 自动保存调度器 */
export interface Autosave {
 /** 内容变化：记录最新内容并重置空闲计时（连续输入只落最后一次） */
  schedule(content: string): void;
 /** 立即提交待存内容（无待存 = no-op，返回已兑现的 Promise）；卸载 / 切路由前 flush 用 */
  flush(): Promise<void>;
 /** 丢弃待存内容并停止计时（409 冲突「重新加载」后调用，防旧内容回写） */
  reset(): void;
}

/**
 * 创建自动保存调度器（纯逻辑，不依赖 DOM/React）：
 * - 空闲触发：`delayMs` 内无新输入才落盘；每次 `schedule` 重置计时
 * - `save` 的失败由调用方（页面）自行呈现，本调度器不持有失败内容——内容失败后由页面记录并重试
 */
export function createAutosave({
  delayMs,
  save,
}: {
  delayMs: number;
  save: (content: string) => Promise<void>;
}): Autosave {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;

  const stopTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  function flush(): Promise<void> {
    stopTimer();
    if (pending === null) return Promise.resolve();
    const content = pending;
    pending = null;
    return save(content);
  }

  return {
    schedule(content) {
      pending = content;
      stopTimer();
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    reset() {
      stopTimer();
      pending = null;
    },
  };
}

/**
 * 章在阅读序里的相邻章（上一章 / 下一章）：阅读序 = 卷序 → 卷内章序，即 `numberOutline` 的章视图行序
 * （同一份纯函数，不在本页另算一遍章序）；章不在树上（已软删/已 purge）→ 两侧皆 null。
 */
export function chapterNeighbors(
  tree: OutlineTree | null,
  chapterId: string,
): { prev: OutlineChapterRow | null; next: OutlineChapterRow | null } {
  const rows = numberOutline(tree).chapterRows;
  const index = rows.findIndex((row) => row.chapter.id === chapterId);
  if (index === -1) return { prev: null, next: null };
  return { prev: rows[index - 1] ?? null, next: rows[index + 1] ?? null };
}

/**
 * 字数文案（章正文页的 charCount 与大纲页的章 `metadata.textLength` 共用同一口径）：
 * 0 / 非法值 → null（**不显示**，调用方据此省略该处文案），<1000 → 「N 字」，其余 → 「1.2 千字」。
 */
export function formatTextLength(length: number): string | null {
  if (!Number.isFinite(length) || length <= 0) return null;
  const whole = Math.floor(length);
  if (whole < 1000) return `${whole} 字`;
  return `${(whole / 1000).toFixed(1).replace(/\.0$/, "")} 千字`;
}

/**
 * 保存时刻文案（卡 13.6）：本地时区 24 小时制 `HH:MM`（两位补零）——只表示**这一次保存完成**的
 * 本地时刻，不显示日期（跨天也只给时刻）；页面不持久化它（重新加载 / 换章后无旧时间）。
 */
export function formatSavedAt(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * 可见浮层的选择器（专注模式的 `Esc` 开层守卫，卡 13.4）：antd 三类根
 * （`Popover` / `Dropdown` / `Modal`·自绘 `Dialog`）+ 块编辑器自带的两类 ariakit 浮层
 * （写作设置下拉 / 斜杠菜单等）。关闭后元素通常仍留在 DOM（只是 `display:none`）
 * ⇒ 判据必须是「可见」而非「存在」。
 */
export const OVERLAY_SELECTOR =
  ".ant-popover, .ant-dropdown, [role='dialog'], .bn-ak-popover, .bn-ak-menu";

/** 当前是否有可见浮层（有 ⇒ 这次 `Esc` 归它消费；专注模式退出退让，一次按键只做一件事） */
export function hasVisibleOverlay(): boolean {
  for (const el of document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)) {
    if (el.checkVisibility()) return true;
  }
  return false;
}

/** 正文端点错误码 → 页面动作（加载与保存两条路径共用同一判据） */
export type ManuscriptErrorAction = "conflict" | "missing" | "retry";

/**
 * - `DOCUMENT_STALE`（409，仅携带 base_updated_at 时可能）→ `conflict`：冲突对话框（重新加载 / 覆盖保存）
 * - `OUTLINE_NODE_NOT_FOUND`（404，章不存在或已软删）→ `missing`：页面 404 态
 * - 其余（400 非章节点 / 网络层 CLIENT_NETWORK_ERROR / 未知码）→ `retry`：可见错误条 + 重试
 */
export function manuscriptErrorAction(code: string | null): ManuscriptErrorAction {
  if (code === "DOCUMENT_STALE") return "conflict";
  if (code === "OUTLINE_NODE_NOT_FOUND") return "missing";
  return "retry";
}
