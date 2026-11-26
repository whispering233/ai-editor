// 今日目标卡（DESIGN.md「码字统计页」→「今日目标」；口径 = docs/api/130-api-writing-stats.md
// 「每日目标与连续天数」）：全宽放在摘要四卡之后、码字日历之前。
//
// 四条形态约束：
// ① 关闭态整卡只留标题 + 一行说明，**开关仍在**（它是唯一重开入口）；
// ② 进度条自绘（宽度百分比 + `bg-primary`，不引 antd `Progress`）；
// ③ 达标只把数字染主色 + 尾部 `✓`（不新增色值 / 字号），**不弹任何浮层**（无 toast / 系统通知）；
// ④ 今日 0 字照常渲染 0 进度，不打 `EmptyState`；档位与写作日标签全部取常量表，不写数字字面量。
import { Checkbox, Segmented, Switch } from "antd";
import { useWritingGoal } from "../../hooks/use-writing-goal";
import { cn } from "../../lib/utils";
import {
  currentStreak,
  goalProgress,
  WRITING_GOAL_PRESETS,
  WRITING_WEEKDAY_INDEXES,
} from "../../lib/writing-goal";
import { formatChars, WRITING_STATS_WEEKDAYS, type WritingStatsDay } from "../../lib/writing-stats";
import { SectionCard } from "@/components/ui/section-card";

/** 档位选项（值 = `WRITING_GOAL_PRESETS` 单源，标签形如「500 字」） */
const GOAL_OPTIONS = WRITING_GOAL_PRESETS.map((preset) => ({
  value: preset,
  label: `${preset} 字`,
}));

/** 写作日选项（周序号取 `WRITING_WEEKDAY_INDEXES`，标签取星期表头——两处都同源） */
const WEEKDAY_OPTIONS = WRITING_WEEKDAY_INDEXES.map((index) => ({
  value: index,
  label: `周${WRITING_STATS_WEEKDAYS[index]}`,
}));

export interface GoalCardProps {
  /** 服务端 `days[]`（日字数只来自这里，组件不另生成「今天」） */
  days: readonly WritingStatsDay[];
  /** 服务端本地日（同日键权威值） */
  today: string;
  /** 偏好按书隔离（null = 未打开项目，用缺省值且不落盘） */
  projectId: string | null;
}

/** 今日目标卡（进度 / 连续天数 / 档位 / 写作日；纯展示 + 本机偏好） */
export function GoalCard({ days, today, projectId }: GoalCardProps) {
  const { preference, setGoal, setEnabled, setWritingDays } = useWritingGoal(projectId);
  const progress = goalProgress(days, today, preference.goal);
  const streak = currentStreak(days, today, preference.goal, preference.writingDays);
  /** 超额不把条撑出轨道（目标恒正 ⇒ 不会除零） */
  const percent = Math.min(100, (progress.chars / preference.goal) * 100);

  return (
    <SectionCard
      title="今日目标"
      action={
        <Switch
          size="small"
          checked={preference.enabled}
          onChange={setEnabled}
          aria-label="每日目标"
        />
      }
    >
      {!preference.enabled ? (
        <div className="text-xs text-muted-foreground">每日目标已关闭</div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent">
            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </div>

          <div
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums",
              progress.reached && "text-primary",
            )}
          >
            <span>
              {formatChars(progress.chars)} / {formatChars(preference.goal)} 字
            </span>
            <span>连续 {streak} 天</span>
            {progress.reached && <span aria-hidden>✓</span>}
          </div>

          <Segmented<number>
            size="small"
            options={GOAL_OPTIONS}
            value={preference.goal}
            onChange={setGoal}
          />

          <div className="flex flex-col gap-1">
            <Checkbox.Group
              options={WEEKDAY_OPTIONS}
              value={preference.writingDays}
              onChange={(values) =>
                setWritingDays(values.filter((value): value is number => typeof value === "number"))
              }
            />
            <div className="text-xs text-muted-foreground">
              未勾的日子不计入连续天数；全部不勾按每天都要写处理
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
