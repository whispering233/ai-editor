// 在途读计数的 React 接线（纯逻辑在 `lib/inflight.ts`）。
// 服务端渲染快照也返回同一个值：壳层首帧不该因为「有没有在途请求」而水合不一致。
import { useSyncExternalStore } from "react";
import { getActiveReads, subscribeActiveReads } from "../lib/inflight";

export function useInflightReads(): number {
  return useSyncExternalStore(subscribeActiveReads, getActiveReads, getActiveReads);
}