// 续拆入口（卡 22.7）：完成态的 `button-default`「继续拆解」+ 受控 Dialog（**跳过「选文件」段**）。
//
// 契约：docs/ui/DESIGN.md §拆解小说「续拆入口」（按钮 + 受控 Dialog：统计行 + 章列表（已拆章带
// `type-badge`）+ 范围 + 预估行，全部来自 `GET /decompose/plan`；无未拆章 → 按钮禁用 + `caption-text`
// 说明；启动走 `POST /decompose/continue`）+ docs/api/120-api-decompose.md §plan / §continue。
//
// 分层同 `decompose-dialog.tsx`：presenter（`ContinueDecomposeButton` / `DecomposeContinueDialogView`）
// 用 react-dom/server 直渲染走查（仓内无 jsdom），容器 `DecomposeContinueDialog` 管请求副作用；
// 提交动作抽成 `submitContinueDecompose` 供测试直调（同 `chat-panel.test.tsx` 的 `sessionItemMenu` 惯例）。
import { useEffect, useRef, useState } from "react";
import { Button } from "antd";
import type { DecomposePlanRes } from "@whispering233/ai-editor-shared";
import { ApiError, CLIENT_NETWORK_ERROR, continueDecompose, getDecomposePlan } from "../../lib/api";
import {
  continueDisabledReason,
  describeContinueScope,
  formatCharCount,
  formatEstimate,
  formatPlanStats,
} from "../../lib/decompose";
import { describeDecomposeError } from "../../lib/error-messages";
import { TypeChip } from "../ui/tag-chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

/**
 * 完成态入口按钮。`plan` = 页面在完成态拉的续拆预览（null = 尚未取到 / 读取失败——**不禁用**：
 * 「未知」不等于「没有」，读取失败由对话框内的文案承担）。
 * 无未拆章 → 禁用 + 一行 `caption-text` 说明（`w-full` 让它在 flex 行里换到下一行）。
 */
export function ContinueDecomposeButton({
  plan,
  onOpen,
}: {
  plan: DecomposePlanRes | null;
  onOpen: () => void;
}) {
  const disabledReason = continueDisabledReason(plan);
  return (
    <>
      <Button disabled={disabledReason !== null} onClick={onOpen}>
        继续拆解
      </Button>
      {disabledReason !== null && (
        <p className="w-full text-xs text-muted-foreground">{disabledReason}</p>
      )}
    </>
  );
}

export interface DecomposeContinueViewProps {
  /** 续拆预览（null = 尚未取到） */
  plan: DecomposePlanRes | null;
  loading: boolean;
  /** 框内错误文案（plan 拉取 / continue 失败） */
  error: string | null;
  starting: boolean;
  handlers: {
    onConfirm: () => void;
    onClose: () => void;
  };
}

/** presenter：无「选文件」段——直接统计行 + 章列表（已拆章带徽标）+ 范围 + 预估行 */
export function DecomposeContinueDialogView({
  plan,
  loading,
  error,
  starting,
  handlers,
}: DecomposeContinueViewProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>继续拆解</DialogTitle>
        <DialogDescription>
          接着拆还没拆的章——不用再选文件（正文已在库里）；已拆过的章落在范围内会重拆，归并会复用已有实体
        </DialogDescription>
      </DialogHeader>

      {plan === null ? (
        <p className="text-sm text-muted-foreground">
          {loading ? "正在读取未拆章…" : "未能读取续拆范围"}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{formatPlanStats(plan)}</p>
          <p className="text-sm text-foreground">{describeContinueScope(plan)}</p>

          {/* 章列表：全量渲染（与预览页同口径，不引虚拟滚动），已拆章标 `type-badge` */}
          <div className="max-h-64 overflow-y-auto rounded-md border border-border">
            <ul className="divide-y divide-border">
              {plan.chapters.map((chapter) => (
                <li key={chapter.index} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <span className="w-10 shrink-0 text-muted-foreground tabular-nums">
                    {chapter.index}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={chapter.title}>
                    {chapter.title}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {formatCharCount(chapter.charCount)}
                  </span>
                  {chapter.decomposed && <TypeChip className="shrink-0">已拆</TypeChip>}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-sm">{formatEstimate(plan.estimate)}</p>
        </>
      )}

      {error !== null && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button onClick={handlers.onClose} disabled={starting}>
          取消
        </Button>
        {/* 主操作只在「有未拆章」时出现：没有可拆范围就没什么可确认（服务端会 400 NOTHING_TO_DO） */}
        {plan !== null && plan.remainingCount > 0 && (
          <Button type="primary" onClick={handlers.onConfirm} loading={starting} disabled={starting}>
            开始续拆
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

export interface DecomposeContinueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 续拆已启动：调用方立即刷新 job 轮询（**复用既有轮询，不新增定时器**） */
  onStarted: () => void;
}

/** 容器：开框拉一次 `GET /decompose/plan`（每次开都拉——拆解期间章数 / 已拆集合会变）+ 确认副作用 */
export function DecomposeContinueDialog({ open, onOpenChange, onStarted }: DecomposeContinueDialogProps) {
  const [plan, setPlan] = useState<DecomposePlanRes | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  /** 请求序号：关框 / 重开后，在途 plan 响应不得覆盖新一轮（同 decompose-dialog 的流身份守卫） */
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setStarting(false);
    getDecomposePlan({}, controller.signal)
      .then((res) => {
        if (mine === seq.current) setPlan(res);
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        setPlan(null);
        setError(describeError(err));
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
    return () => {
      seq.current += 1; // 在途请求的迟到响应作废
      controller.abort();
    };
  }, [open]);

  function handleConfirm() {
    if (starting) return;
    setStarting(true);
    setError(null);
    // 成功 = 关框 + 刷新轮询（进度页停在原页看新一轮跑）；失败 = 框内文案（同 start 口径）
    void submitContinueDecompose().then((result) => {
      if (!result.ok) {
        setError(result.error);
        setStarting(false);
        return;
      }
      onOpenChange(false);
      onStarted();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          seq.current += 1;
          setError(null);
          setStarting(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DecomposeContinueDialogView
          plan={plan}
          loading={loading}
          error={error}
          starting={starting}
          handlers={{
            onConfirm: handleConfirm,
            onClose: () => onOpenChange(false),
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * 确认续拆（容器与测试共用同一实现）：成功 → 调用方关框 + 刷新轮询；失败 → 返回框内错误文案。
 * 不传范围 = 服务端缺省（未拆章最小覆盖区间，与框里展示的范围同源）。
 */
export async function submitContinueDecompose(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await continueDecompose();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

/** unknown → 拆解错误文案（取码口径与 `decompose-dialog.tsx` 一致：非 ApiError 视为未知码） */
function describeError(err: unknown): string {
  return describeDecomposeError(
    err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR,
    err instanceof Error ? err.message : "",
  );
}
