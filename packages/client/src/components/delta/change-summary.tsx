// Delta changes 紧凑摘要（S5.4）：每条 change 一个 chip（op 徽标 + describeChange 摘要）
// 大纲节点变更记录面板与实体详情状态预览共用；skipped（compute 中被跳过的 change，
// 决策 9 修订）用 destructive 弱化样式标注
// 样式 token 类（layout.md §3，禁止硬编码色类）
import type { DeltaChange } from "@whispering233/ai-editor-shared";
import { DELTA_OP_LABEL, describeChange } from "../../lib/delta";
import { cn } from "../../lib/utils";

export function ChangeSummary({
  changes,
  skipped,
}: {
  changes: DeltaChange[];
  /** 被跳过的 change 下标（compute appliedDeltas[].skipped[].index）；空 = 无跳过 */
  skipped?: number[];
}) {
  const skippedSet = skipped ? new Set(skipped) : null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {changes.map((c, i) => {
        const isSkipped = skippedSet?.has(i) ?? false;
        return (
          <span
            key={i}
            title={isSkipped ? "该变更未应用（数据与变更记录不一致，见冲突标注）" : undefined}
            className={cn(
              "inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs",
              isSkipped ? "text-destructive" : "text-muted-foreground",
            )}
          >
            <span className={cn("shrink-0 font-medium", isSkipped ? "text-destructive" : "text-foreground/70")}>
              {DELTA_OP_LABEL[c.op]}
            </span>
            {describeChange(c)}
          </span>
        );
      })}
    </div>
  );
}
