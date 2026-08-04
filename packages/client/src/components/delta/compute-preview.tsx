// 实体详情「变更记录 · 状态预览」区块（S5.4；契约 doc/ui/pages/entity-detail.md + endpoints.md L464-510）
// 数据：POST /api/v1/delta/compute { target_type, target_id, at_node_id } → ComputeStateResult
//   （决策 9 修订：update from 不匹配 → 跳过 + conflicts 标注，非 409）
// 交互：at_node 选择器（默认 project store 的 currentPosition，须在大纲树中存在；未设置 → 要求手动选择）
//   + [计算] → 结果区三段：状态差异（diffStateFields，相对当前 data）/ 应用的变更记录（含 skipped 内联标注）/
//   conflicts 警示块（border-destructive/30 bg-destructive/10 text-destructive + TriangleAlert）
// 空态：deltaCount === 0 → 轻量文案（当前状态即初始状态），不展示计算控件
import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { ComputeStateResult, DeltaChange } from "@whispering233/ai-editor-shared";
import { ApiError, computeDeltaState } from "../../lib/api";
import { diffStateFields, formatDeltaValue } from "../../lib/delta";
import { flattenTree } from "../../lib/outline-tree";
import { cn } from "../../lib/utils";
import { useProjectStore } from "../../stores/project";
import { Button } from "@/components/ui/button";
import { ChangeSummary } from "./change-summary";

export function ComputePreview({
  type,
  id,
  currentData,
  deltaCount,
}: {
  /** 目标实体类型（target_type） */
  type: string;
  /** 目标实体 id（target_id） */
  id: string;
  /** 实体当前 data（GET /entity/:type/:id 响应；状态差异比较基准） */
  currentData: Record<string, unknown>;
  /** 实体 Delta 计数（0 条 → 轻量空态，不展示计算控件） */
  deltaCount: number;
}) {
  const outline = useProjectStore((s) => s.outline);
  const config = useProjectStore((s) => s.config);
  const loadOutline = useProjectStore((s) => s.loadOutline);

  const [atNodeId, setAtNodeId] = useState<string>(() => {
    // 默认取当前位置：须在大纲树中存在（软删后选择无意义，回退为空要求手动选择）
    const cp = useProjectStore.getState().config?.currentPosition ?? "";
    const tree = useProjectStore.getState().outline?.children ?? [];
    return cp !== "" && flattenTree(tree).some((o) => o.id === cp) ? cp : "";
  });
  const [computing, setComputing] = useState(false);
  const [result, setResult] = useState<ComputeStateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // config/outline 异步到位后的回填：惰性初始化只跑一次，若当时 currentPosition 未加载
  // （或树未就绪）会得到空——此处补上；用户已手动选择（prev 非空）不覆盖
  useEffect(() => {
    setAtNodeId((prev) => {
      if (prev !== "") return prev;
      const cp = config?.currentPosition ?? "";
      return cp !== "" && flattenTree(outline?.children ?? []).some((o) => o.id === cp) ? cp : "";
    });
  }, [config?.currentPosition, outline]);

  const options = flattenTree(outline?.children ?? []);
  const nodeTitles = new Map(options.map((o) => [o.id, o.label]));

  /** [计算] → POST /delta/compute；OUTLINE_NODE_NOT_FOUND → 行内提示重新选择 */
  async function handleCompute() {
    if (!atNodeId || computing) return;
    setComputing(true);
    setError(null);
    try {
      const res = await computeDeltaState({ target_type: type, target_id: id, at_node_id: atNodeId });
      setResult(res);
    } catch (err) {
      setResult(null);
      if (err instanceof ApiError && err.code === "OUTLINE_NODE_NOT_FOUND") {
        setError("该节点已不存在，请重新选择计算节点");
      } else {
        setError(err instanceof ApiError ? err.message : "无法连接服务，请确认 ai-editor 服务已启动");
      }
    } finally {
      setComputing(false);
    }
  }

  return (
    <div className="mb-4 rounded-md border border-border p-4">
      {/* 区块头 */}
      <h2 className="mb-2 text-sm font-semibold text-foreground">
        变更记录 · 状态预览
        <span className="ml-2 text-xs font-normal text-muted-foreground">{deltaCount} 条</span>
      </h2>

      {deltaCount === 0 ? (
        /* 空态：无 Delta 时轻量提示（当前状态即初始状态），不展示计算控件 */
        <p className="text-sm text-muted-foreground">暂无变更记录——实体当前状态即初始状态</p>
      ) : (
        <>
          {/* 计算节点选择 + [计算] */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">计算节点（到达该节点时的累积状态）</span>
              {outline === null ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">大纲未加载</span>
                  <Button variant="outline" size="xs" type="button" onClick={() => void loadOutline()}>
                    加载大纲
                  </Button>
                </div>
              ) : (
                <select
                  value={atNodeId}
                  onChange={(e) => setAtNodeId(e.target.value)}
                  aria-label="计算节点"
                  className={cn(
                    "min-w-56 rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    atNodeId === "" && "text-muted-foreground",
                  )}
                >
                  <option value="">请选择大纲节点</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {"　".repeat(o.depth)}
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={!atNodeId || computing}
              onClick={() => void handleCompute()}
            >
              {computing ? "计算中…" : "计算"}
            </Button>
          </div>
          {config?.currentPosition == null && (
            <p className="mt-1 text-xs text-muted-foreground">未设置当前位置，请手动选择计算节点</p>
          )}

          {/* 计算失败：行内提示（不阻塞表单操作） */}
          {error !== null && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* 计算中骨架 */}
          {computing && (
            <div className="mt-3 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-16 animate-pulse rounded bg-muted/60" />
            </div>
          )}

          {/* 结果区 */}
          {!computing && result !== null && (
            <ComputeResult result={result} currentData={currentData} nodeTitles={nodeTitles} />
          )}
        </>
      )}
    </div>
  );
}

/** 计算结果展示（三段：conflicts 警示 / 状态差异 / 应用的变更记录） */
function ComputeResult({
  result,
  currentData,
  nodeTitles,
}: {
  result: ComputeStateResult;
  currentData: Record<string, unknown>;
  nodeTitles: Map<string, string>;
}) {
  const diffs = diffStateFields(currentData, result.state);
  const atNodeTitle = nodeTitles.get(result.atNodeId) ?? result.atNodeId;

  return (
    <div className="mt-3 space-y-3">
      {/* ① conflicts 警示块（醒目弱化样式；决策 9 修订：跳过 + 标注，非 409） */}
      {result.conflicts.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" />
            发现 {result.conflicts.length} 处状态冲突
          </div>
          <p className="mt-0.5 text-xs text-destructive/90">
            手动编辑的数据与变更记录不一致，以下变更未应用（可直接修改当前数据，或调整变更记录）：
          </p>
          <ul className="mt-1 space-y-0.5">
            {result.conflicts.map((c, i) => (
              <li key={i} className="text-xs text-destructive">
                {c.field}：记录应为 {formatDeltaValue(c.expected)}，实际为 {formatDeltaValue(c.actual)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ② 状态差异（相对当前 data） */}
      <div>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
          状态差异（相对当前数据 · 到达《{atNodeTitle}》{diffs.length > 0 ? `，${diffs.length} 处` : ""}）
        </h3>
        {diffs.length === 0 ? (
          <p className="text-xs text-muted-foreground">计算状态与当前数据一致</p>
        ) : (
          <ul className="space-y-1">
            {diffs.map((d) => (
              <li key={d.field} className="flex items-baseline gap-2 text-xs">
                <span className="shrink-0 font-medium text-foreground">{d.field}</span>
                <span className="text-muted-foreground">
                  {d.from === undefined ? "（无）" : formatDeltaValue(d.from)} →{" "}
                  {d.to === undefined ? "（已移除）" : formatDeltaValue(d.to)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ③ 应用的变更记录（含 skipped 内联标注） */}
      <div>
        <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
          应用的变更记录（{result.appliedDeltas.length}）
        </h3>
        {result.appliedDeltas.length === 0 ? (
          <p className="text-xs text-muted-foreground">到达该节点前没有变更被应用</p>
        ) : (
          <ul className="divide-y divide-border/70 rounded-md border border-border">
            {result.appliedDeltas.map((d, i) => (
              <li key={i} className="px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={d.description}>
                    {d.description}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    《{nodeTitles.get(d.nodeId) ?? d.nodeId}》
                  </span>
                </div>
                {/* skipped：该 delta 中被跳过的 change（决策 9 修订），destructive 弱化标注 */}
                {d.skipped !== undefined && d.skipped.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {d.skipped.map((s) => (
                      <li key={s.index} className="text-xs text-destructive">
                        {s.field}：记录应为 {formatDeltaValue(s.expected)}，实际 {formatDeltaValue(s.actual)}
                        （已跳过）
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-1.5">
                  <ChangeSummary changes={d.changes as DeltaChange[]} skipped={d.skipped?.map((s) => s.index)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
