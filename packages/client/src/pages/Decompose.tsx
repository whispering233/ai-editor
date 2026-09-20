// 拆解进度页（卡 21.9）：`#/decompose`
//
// 契约：docs/ui/DESIGN.md §拆解小说（进度页结构 / **页头常驻**模板 / 阶段条 5 段 / antd Progress
// 无组件级 token 覆盖 / 批次列表可展开 / 失败批行内错误 / done 批重跑二次确认 / 完成总结卡）+
// docs/api/120-api-decompose.md §job / §batches / §pause / §resume / §rerun。
//
// 四态渲染点（同一份 job 投影，状态文案见 `lib/decompose.ts` 的 `describeJobStatus`）：
// - `pending` / `running`：阶段条 + 进度条 + 批列表；页头操作 = 中止
// - `paused`：同上；页头操作 = 续拆；状态文案区分「已暂停」与「上次拆解中断」（paused + running 批）
// - `failed`：同上 + job 级错误行（页头无操作）；失败批行内错误 + 重跑
// - `done`：本页内容变总结卡（计数 + 三个跳转），**不自动跳转**
//
// 数据：job / 批结果走 `hooks/use-decompose-job.ts`（轮询）+ `GET /decompose/job/batches/:seq`（展开按需）；
// 完成总结计数 = 库内当前计数（同概览页「创作要素」口径，不解析报告正文）。
import { useEffect, useState } from "react";
import type { DecomposeBatchResult, EntityType } from "@whispering233/ai-editor-shared";
import { Button, Progress, Typography } from "antd";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { TypeChip } from "@/components/ui/tag-chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  getDecomposeBatch,
  getSettingsLlm,
  listEntities,
  listRelations,
  pauseDecomposeJob,
  rerunDecomposeBatch,
  resumeDecomposeJob,
} from "../lib/api";
import { describeDecomposeError } from "../lib/error-messages";
import {
  DECOMPOSE_STAGE_LABELS,
  activeModelLabel,
  batchPercent,
  batchResultGroups,
  batchStatusLabel,
  canRerunBatch,
  describeJobStatus,
  formatBatchChapters,
  formatBatchProgress,
  formatCharCount,
  formatCompletionCounts,
  formatJobMeta,
  jobActionFor,
  stageProgress,
  type CompletionCounts,
} from "../lib/decompose";
import { useDecomposeJob } from "../hooks/use-decompose-job";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

/** 展开行的批结果（按 seq 缓存；重跑后作废重拉） */
interface BatchDetail {
  loading: boolean;
  result: DecomposeBatchResult | null;
  error: string | null;
}

/** 完成总结计数要取的实体类型（顺序 = 展示顺序；关系另取 `GET /relation`） */
const COUNT_TYPES: EntityType[] = ["character", "setting", "location"];

export default function Decompose() {
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const { job, errorCode, refresh } = useDecomposeJob(config?.id ?? null);

  /** 页头 meta 的「当前模型」段（取不到 = null ⇒ 该段不渲染） */
  const [model, setModel] = useState<string | null>(null);
  /** 页头操作（中止 / 续拆）进行态（防连点） */
  const [acting, setActing] = useState(false);
  /** 展开的批序号（可多个同时展开——核查多批再决定重跑哪一批） */
  const [expanded, setExpanded] = useState<number[]>([]);
  const [details, setDetails] = useState<Record<number, BatchDetail>>({});
  /** 待确认重跑的 done 批（受控 Dialog；failed 行重跑是明确的补救动作，不确认） */
  const [confirmRerunSeq, setConfirmRerunSeq] = useState<number | null>(null);
  /** 完成总结计数（仅 done 态拉取；null 字段渲染「–」而不是 0） */
  const [counts, setCounts] = useState<CompletionCounts | null>(null);

  const hasJob = job !== null;
  const status = job?.status ?? null;
  /** 页头操作（按状态显示其一：中止 / 续拆 / 无） */
  const action = status === null ? null : jobActionFor(status);

  // 当前模型（仅用于页头元信息）：未配置 / 请求失败 → 不显示该段（不留空占位、不报错打断页面）
  useEffect(() => {
    if (!hasJob) return;
    let cancelled = false;
    getSettingsLlm()
      .then((llm) => {
        if (!cancelled) setModel(activeModelLabel(llm));
      })
      .catch(() => {
        if (!cancelled) setModel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [hasJob]);

  // 完成总结计数（done 态；四项各自失败只影响那一项——占位「–」，不把失败说成 0）
  useEffect(() => {
    if (status !== "done") return;
    let cancelled = false;
    const totals = COUNT_TYPES.map(async (type) => ({
      type,
      total: (await listEntities(type, { limit: 1 })).total,
    }));
    Promise.allSettled([
      ...totals,
      listRelations({ depth: 1 }).then((res) => ({ type: "relation", total: res.relations.length })),
    ]).then((results) => {
      if (cancelled) return;
      const next: CompletionCounts = {
        character: null,
        setting: null,
        location: null,
        relation: null,
      };
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { type, total } = result.value;
        if (type === "relation") next.relation = total;
        else if (type === "character" || type === "setting" || type === "location") {
          next[type] = total;
        }
      }
      setCounts(next);
    });
    return () => {
      cancelled = true;
    };
  }, [status]);

  /** 中止 / 续拆：成功后立即重拉（轮询重启）；失败走 toast（页面此时没有行内错误位） */
  async function runJobAction(action: "pause" | "resume") {
    if (acting) return;
    setActing(true);
    try {
      if (action === "pause") await pauseDecomposeJob();
      else await resumeDecomposeJob();
      refresh();
    } catch (err) {
      useUiStore
        .getState()
        .showToast(
          describeDecomposeError(
            err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR,
            err instanceof Error ? err.message : "",
          ),
          "error",
        );
    } finally {
      setActing(false);
    }
  }

  /** 展开 / 收起一批（首次展开时按需拉该批结果） */
  function toggleBatch(seq: number) {
    const opening = !expanded.includes(seq);
    setExpanded((list) => (opening ? [...list, seq] : list.filter((value) => value !== seq)));
    if (opening && details[seq] === undefined) void loadBatch(seq);
  }

  async function loadBatch(seq: number) {
    setDetails((map) => ({ ...map, [seq]: { loading: true, result: null, error: null } }));
    try {
      const res = await getDecomposeBatch(seq);
      setDetails((map) => ({ ...map, [seq]: { loading: false, result: res.result, error: null } }));
    } catch (err) {
      setDetails((map) => ({
        ...map,
        [seq]: {
          loading: false,
          result: null,
          error: describeDecomposeError(
            err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR,
            err instanceof Error ? err.message : "",
          ),
        },
      }));
    }
  }

  /** 重跑单批：作废该批本地摘要（服务端要重算）→ 立刻重拉 job（回到 running，轮询重启） */
  async function runRerun(seq: number) {
    setConfirmRerunSeq(null);
    try {
      await rerunDecomposeBatch(seq);
      setDetails((map) => {
        const next = { ...map };
        delete next[seq];
        return next;
      });
      setExpanded((list) => list.filter((value) => value !== seq));
      refresh();
    } catch (err) {
      useUiStore
        .getState()
        .showToast(
          describeDecomposeError(
            err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR,
            err instanceof Error ? err.message : "",
          ),
          "error",
        );
    }
  }

  // ============ 页头（四态常驻：加载 / 空态 / 错误态同样保留标题行与分割线） ============
  const header =
    config !== null && configLoading ? (
      <PageHeader title="拆解小说" />
    ) : (
      <PageHeader
        title="拆解小说"
        description={
          job !== null ? (
            <p className="text-sm text-muted-foreground">
              {formatJobMeta({
                name: config?.name ?? null,
                scopeStart: job.scopeStart,
                scopeEnd: job.scopeEnd,
                model,
              })}
            </p>
          ) : undefined
        }
        action={
          job === null || action === null ? undefined : (
            <Button loading={acting} onClick={() => void runJobAction(action)}>
              {action === "pause" ? "中止" : "续拆"}
            </Button>
          )
        }
      />
    );

  function renderBody() {
    // 首帧（config 拉取中）：不判定形态，避免先闪「没有打开的书」
    if (configLoading && config === null) {
      return <p className="text-sm text-muted-foreground">加载中…</p>;
    }
    if (config === null) {
      return (
        <EmptyState
          padding="sm"
          action={
            <Button href="#/" size="small">
              回到书架
            </Button>
          }
        >
          <span className="block text-base font-semibold text-foreground">还没有打开的书</span>
          <span className="mt-1 block">拆解进度属于当前打开的书</span>
        </EmptyState>
      );
    }
    if (job === null) {
      if (errorCode === "DECOMPOSE_JOB_NOT_FOUND" || errorCode === "NO_PROJECT_OPEN") {
        return (
          <EmptyState
            padding="sm"
            action={
              <Button href="#/" size="small">
                回到书架
              </Button>
            }
          >
            <span className="block text-base font-semibold text-foreground">这本书没有拆解任务</span>
            <span className="mt-1 block">在书架的「新建一本…」行点「拆解小说」可以导入一本 txt 开始</span>
          </EmptyState>
        );
      }
      if (errorCode !== null) {
        return (
          <div className="flex items-center gap-2 text-sm text-destructive">
            拆解状态加载失败
            <Button size="small" onClick={refresh}>
              重试
            </Button>
          </div>
        );
      }
      return <p className="text-sm text-muted-foreground">加载中…</p>;
    }
    if (job.status === "done") return renderSummary(job.report);
    return renderProgress(job);
  }

  /** 完成态：本页变总结卡（不自动跳转——用户自己决定去看报告还是大纲） */
  function renderSummary(report: { entityId: string; name: string } | null) {
    return (
      <SectionCard title="拆解完成">
        <p className="text-sm text-foreground">
          {formatCompletionCounts(
            counts ?? { character: null, setting: null, location: null, relation: null },
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            href={report === null ? undefined : `#/references/${report.entityId}`}
            disabled={report === null}
            title={report === null ? "报告尚未生成" : report.name}
          >
            拆解报告
          </Button>
          <Button href="#/outline">大纲</Button>
          <Button href="#/characters">人物</Button>
        </div>
      </SectionCard>
    );
  }

  function renderProgress(current: NonNullable<typeof job>) {
    const stage = stageProgress(current.stage);
    return (
      <>
        {/* 阶段条：当前段 primary 加粗 / 已完成段 success 圆点 / 未开始 tertiary（DESIGN §拆解小说） */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {DECOMPOSE_STAGE_LABELS.map((label, index) => (
            <span
              key={label}
              className={
                index === stage.current
                  ? "flex items-center gap-1 text-sm font-medium text-primary"
                  : "flex items-center gap-1 text-sm text-muted-foreground"
              }
            >
              {index < stage.completed && (
                <Typography.Text type="success" aria-hidden>
                  ●
                </Typography.Text>
              )}
              {label}
            </span>
          ))}
        </div>

        {/* 进度条：antd Progress 走全局 colorPrimary（**不加组件级 token 覆盖**）+ 批进度文案 */}
        <div className="mt-4 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Progress percent={batchPercent(current.progress)} showInfo={false} />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatBatchProgress(current.progress)}
          </span>
        </div>

        {/* 状态行（同一口径也用于概览卡片）：运行中 N/M 批 / 已暂停 · 可续拆 / 上次拆解中断，可续拆 */}
        <p className="mt-3 text-sm text-foreground">{describeJobStatus(current)}</p>

        {/* job 级失败摘要（批级错误在各自行内） */}
        {current.error !== null && (
          <p className="mt-2 text-sm text-destructive">{current.error}</p>
        )}

        {/* 批次列表：批序号 / 覆盖章范围 / 字数 / 状态徽标 / 展开 / 重跑 */}
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {current.batches.map((batch) => {
            const open = expanded.includes(batch.seq);
            const detail = details[batch.seq];
            return (
              <li key={batch.seq}>
                <div className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted">
                  <span className="w-16 shrink-0 text-sm text-muted-foreground tabular-nums">
                    第 {batch.seq} 批
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-sm text-foreground"
                    title={batch.chapterTitles.join("、")}
                  >
                    {formatBatchChapters(batch.chapterIndexes)}
                  </span>
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                    {formatCharCount(batch.charCount)} 字
                  </span>
                  <TypeChip className="shrink-0">{batchStatusLabel(batch.status)}</TypeChip>
                  <Button size="small" onClick={() => toggleBatch(batch.seq)}>
                    {open ? "收起" : "展开"}
                  </Button>
                  {canRerunBatch(current.status, batch.status) && (
                    <Button
                      size="small"
                      onClick={() =>
                        // done 批重跑会重建归并与报告（有 LLM 成本）⇒ 二次确认；failed 批重跑是补救动作
                        batch.status === "done" ? setConfirmRerunSeq(batch.seq) : void runRerun(batch.seq)
                      }
                    >
                      重跑
                    </Button>
                  )}
                </div>

                {/* 失败批：行内错误文案（不折叠在展开区里——失败必须一眼可见） */}
                {batch.error !== null && (
                  <p className="px-3 pb-2 text-sm text-destructive">{batch.error}</p>
                )}

                {/* 展开区：该批抽取结果的只读摘要（分组文字列表，不倾倒原始 JSON） */}
                {open && (
                  <div className="border-t border-border bg-muted px-3 py-2">
                    {detail === undefined || detail.loading ? (
                      <p className="text-sm text-muted-foreground">读取批结果…</p>
                    ) : detail.error !== null ? (
                      <p className="text-sm text-destructive">{detail.error}</p>
                    ) : detail.result === null ? (
                      <p className="text-sm text-muted-foreground">该批还没有抽取结果</p>
                    ) : (
                      <div className="space-y-1">
                        {batchResultGroups(detail.result).map((group) => (
                          <p key={group.label} className="text-sm text-foreground">
                            <span className="text-muted-foreground">{group.label}：</span>
                            {group.names.length === 0 ? "—" : group.names.join("、")}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* done 批重跑二次确认（受控 Dialog；文案写明会重建归并与报告） */}
        <Dialog
          open={confirmRerunSeq !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmRerunSeq(null);
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>重跑第 {confirmRerunSeq} 批</DialogTitle>
              <DialogDescription>
                将重新生成该批抽取结果，并重建归并与报告（会再调用一次模型，其余批的结果保留）。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setConfirmRerunSeq(null)}>取消</Button>
              <Button
                type="primary"
                onClick={() => confirmRerunSeq !== null && void runRerun(confirmRerunSeq)}
              >
                重跑
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    /* 页头常驻（DESIGN.md §Layout「中栏页头结构 → 页头常驻」）：section 用 `h-full` 恰好等于中栏
       滚动容器的内容区 ⇒ 外壳不滚，滚动只发生在内层容器里，页头（标题 / 元信息 / 中止·续拆）留在视口 */
    <section className="flex h-full min-h-0 flex-col">
      {header}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{renderBody()}</div>
    </section>
  );
}
