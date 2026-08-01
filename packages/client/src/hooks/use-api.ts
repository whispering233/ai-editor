// 通用请求 hook（T7.2）：useApi(fn, deps) → { data, loading, error, refetch }
// 供页面组件消费 lib/api.ts 端点函数；竞态保护 + 可手动 refetch
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, CLIENT_NETWORK_ERROR } from "../lib/api";

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  /** 手动重新请求（不依赖 deps） */
  refetch: () => Promise<void>;
}

/**
 * 通用请求 hook
 * @param fn 请求函数（从 lib/api 取端点函数；内部经 ref 持有，不参与 deps）
 * @param deps 触发重新请求的依赖数组（同 useEffect 语义；变化即重跑）
 */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = []): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  // fn 存 ref：effect 只依赖 deps，调用方内联函数不会导致死循环
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // 请求序号：仅最新一次请求的结果落 state（过期响应丢弃）
  const seqRef = useRef(0);

  const run = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current();
      if (seqRef.current === seq) {
        setData(result);
        setLoading(false);
      }
    } catch (err) {
      if (seqRef.current !== seq) return;
      setError(err instanceof ApiError ? err : new ApiError(CLIENT_NETWORK_ERROR, String(err)));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    // deps 即契约：变化重新请求（fn 由 ref 持有，见上）
  }, deps);

  return { data, loading, error, refetch: run };
}
