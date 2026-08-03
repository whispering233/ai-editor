// 大纲节点「变更记录」列表区块（S12.2：自 S5.4 行内面板 node-delta-panel 迁移——详情页整区块形态，
//   无树缩进；契约 doc/ui/pages/outline.md「节点详情页」+ endpoints.md L436-462）
// 数据：GET /api/v1/delta/node/:nodeId → { nodeId, deltas: DeltaRecord[] }
// 交互：列表按 order 升序（客户端兜底排序）；行 = description + 创建时间 + 目标徽标
//   （targetType 中文 + targetName ?? targetId）+ changes 紧凑 chips；空态轻提示；网络失败 → 行内错误 + [重试]
// 防御分支：OUTLINE_NODE_NOT_FOUND 分支当前**不可达**——契约（endpoints.md L436-462）未定义该端点
//   404，节点缺失/软删 → 200 空数组（server delta.ts 三态过滤），缺失即空态；分支保留以防契约未来变化
import { useEffect, useState } from "react";
import { formatTimestamp } from "@ai-editor/shared";
import type { DeltaRecord } from "@ai-editor/shared";
import { ApiError, CLIENT_NETWORK_ERROR, getDeltasByNode } from "../../lib/api";
import { targetTypeLabel } from "../../lib/delta";
import { Button } from "@/components/ui/button";
import { ChangeSummary } from "./change-summary";

export function NodeDeltaList({ nodeId, reloadKey }: { nodeId: string; /** 外部刷新信号（S12.3：新建变更成功后 +1 重拉，同 RelationsView reloadKey 模式） */ reloadKey?: number }) {
  const [deltas, setDeltas] = useState<DeltaRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 重试计数（错误 [重试] 触发重拉） */
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDeltasByNode(nodeId)
      .then((res) => {
        if (cancelled) return;
        // 服务端按 order 返回，客户端兜底排序（全局单调递增，决策 3/9）
        setDeltas([...res.deltas].sort((a, b) => a.order - b.order));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId, tick, reloadKey]);

  return (
    <div>
      {/* 加载骨架（首次） */}
      {loading && deltas === null && error === null && (
        <div className="space-y-2 py-1">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      )}

      {/* 错误态：防御分支（契约当前不返回 404——缺失即空态；节点已 purge / 网络失败 → 行内提示 + 重试） */}
      {error !== null && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <span>
            {error === "OUTLINE_NODE_NOT_FOUND"
              ? "节点不存在（可能已被删除），变更记录不可用"
              : error === CLIENT_NETWORK_ERROR
                ? "无法连接服务，请确认 ai-editor 服务已启动"
                : "变更记录加载失败"}
          </span>
          {/* purge 场景重试无意义（节点已不在树中），仅网络失败可重试 */}
          {error !== "OUTLINE_NODE_NOT_FOUND" && (
            <Button variant="outline" size="xs" type="button" onClick={() => setTick((t) => t + 1)}>
              重试
            </Button>
          )}
        </div>
      )}

      {/* 空态：轻量文案 */}
      {!loading && error === null && deltas !== null && deltas.length === 0 && (
        <p className="py-1 text-xs text-muted-foreground">该节点没有变更记录</p>
      )}

      {/* Delta 列表：description + 时间；次行目标徽标 + changes chips */}
      {!loading && error === null && deltas !== null && deltas.length > 0 && (
        <ul className="divide-y divide-border/70">
          {deltas.map((d) => (
            <li key={d.id} className="py-2 first:pt-0 last:pb-0">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={d.description}>
                  {d.description}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatTimestamp(d.createdAt)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {targetTypeLabel(d.targetType)}《{d.targetName ?? d.targetId}》
                </span>
                <ChangeSummary changes={d.changes} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
