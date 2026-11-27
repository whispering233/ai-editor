// 在途「读」计数（GET in flight）。
//
// 生产方唯一 = `lib/api.ts` 的 `apiFetch`（`method === "GET"` 才计数）；
// 消费方唯一 = `hooks/use-inflight-reads.ts` → `MainToolbar` 的刷新按钮。
//
// 为什么在 API 层数、而不是让各页上报自己的 `loading`：
// 1. 「读」的唯一定义就是 GET —— 一处接入覆盖刷新 / 搜索 / 翻页 / 切筛选 / 详情重载，
//    页面里再养一遍布尔只会多一套会漂移的真相（16 个订阅点里有一半拿不出干净的 flag）；
// 2. 写操作（PUT / POST / DELETE / multipart）**不计入**：它们各有自己的 `saving` / `busy`，
//    混进来会让刷新按钮在保存时也转圈，语义就错了。
//
// 不用 zustand：这不是应用状态，是一次同步进度的可观测值；`useSyncExternalStore` 直接订阅，
// `lib` 也就不必反过来依赖 `stores`。
let active = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 一次 GET 开始（`apiFetch` 内部调用） */
export function beginRead(): void {
  active += 1;
  emit();
}

/** 一次 GET 结束（含失败 / abort；`finally` 里调用） */
export function endRead(): void {
  active = Math.max(0, active - 1);
  emit();
}

export function getActiveReads(): number {
  return active;
}

export function subscribeActiveReads(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}