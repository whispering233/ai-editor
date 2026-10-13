// 文风练习列表页（`#/practice`，卡 9）——目标分组 + 样本行 + 两个新建弹窗 + 空态。
//
// 契约：
// - 视觉 / 几何 = `docs/ui/DESIGN.md` §文风练习区「练习列表页」+ §Layout「中栏页头结构」（页头常驻模板：
//   `section: h-full min-h-0 flex flex-col` + 内容进内层 `flex min-h-0 flex-1 flex-col overflow-y-auto`）；
//   行语言 = `data-row` / `section-title` / `caption-text` / `type-badge`（不新增色值 / 字号 / 圆角）
// - 数据 = `docs/api/120-api-practice.md`：目标列表 + 逐目标样本列表（列表不回正文与卡体）；
//   创建成功后**重拉列表**，不做乐观更新
// - 状态徽标三态（未写稿 / 待点评 / 已点评）的**唯一派生入口 = `lib/practice.ts`**；
//   相对时间复用 shared `formatRelativeTime`（全站同一套，不新造第二套格式化）
// - 用户侧文案只用「范文 / 我的稿 / 点评 / 我的观察」（`60-practice.md` §文案口径）
//
// 分层：`PracticeList` / `PracticeTargetGroup` / `PracticeSampleRow` = 纯展示（无 effect、无请求，
// 导出供 SSR 走查——仓内无 jsdom）；默认导出 = 容器（取数 + 弹窗开关）。
import { useEffect, useState } from "react";
import type { PracticeSampleItem, PracticeTargetItem } from "@whispering233/ai-editor-shared";
import { formatRelativeTime } from "@whispering233/ai-editor-shared";
import { Alert, Button, Skeleton, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { ApiError, getPracticeSamples, getPracticeTargets } from "../lib/api";
import { practiceObservationText, practiceSampleStatus } from "../lib/practice";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { TypeChip } from "@/components/ui/tag-chip";
import { CreateTargetDialog } from "@/components/practice/create-target-dialog";
import { CreateSampleDialog } from "@/components/practice/create-sample-dialog";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";

/** 一个目标分组（目标行 + 该目标下的样本行） */
export interface PracticeGroup {
  target: PracticeTargetItem;
  samples: PracticeSampleItem[];
}

// ============ 纯展示层（导出供 SSR 走查） ============

export interface PracticeSampleRowProps {
  sample: PracticeSampleItem;
}

/** 样本行（`data-row` 行语言）：来源说明（`truncate`）+ 状态徽标 + 相对时间 */
export function PracticeSampleRow({ sample }: PracticeSampleRowProps) {
  return (
    <div className="flex items-center gap-3 border-b border-border/50 py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={sample.sourceLabel}>
        {sample.sourceLabel}
      </span>
      <TypeChip className="shrink-0">{practiceSampleStatus(sample)}</TypeChip>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatRelativeTime(sample.updatedAt)}
      </span>
    </div>
  );
}

export interface PracticeTargetGroupProps {
  group: PracticeGroup;
  /** 「+ 新建样本」（该目标下建样本，弹窗由容器开） */
  onCreateSample: (target: PracticeTargetItem) => void;
}

/** 目标分组：`section-title` 目标名 + `caption-text` 计数 +（有观察时）观察行 + 样本行 */
export function PracticeTargetGroup({ group, onCreateSample }: PracticeTargetGroupProps) {
  const { target, samples } = group;
  // 观察留空 = 不渲染该行（空值取舍单一定义 = lib/practice.ts）
  const observation = practiceObservationText(target.observation);
  return (
    <section>
      <div className="flex items-center gap-3">
        <Typography.Title level={5} className="min-w-0 truncate">
          {target.name}
        </Typography.Title>
        <Typography.Text type="secondary" className="shrink-0">
          {target.sampleCount} 篇范文
        </Typography.Text>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <Button size="small" icon={<PlusOutlined />} onClick={() => onCreateSample(target)}>
            新建样本
          </Button>
        </span>
      </div>

      {observation !== null && (
        <Typography.Text type="secondary" className="mt-1 block whitespace-pre-wrap">
          我的观察：{observation}
        </Typography.Text>
      )}

      {samples.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">还没有范文——点「新建样本」粘贴一段范文</p>
      ) : (
        <div className="mt-2">
          {samples.map((sample) => (
            <PracticeSampleRow key={sample.id} sample={sample} />
          ))}
        </div>
      )}
    </section>
  );
}

export interface PracticeListProps {
  /** `null` = 加载中（骨架）；`[]` = 无目标（空态） */
  groups: PracticeGroup[] | null;
  onCreateTarget: () => void;
  onCreateSample: (target: PracticeTargetItem) => void;
}

/** 列表主体：加载态 / 空态 / 目标分组（页头之外的全部滚动内容） */
export function PracticeList({ groups, onCreateTarget, onCreateSample }: PracticeListProps) {
  if (groups === null) return <Skeleton active title={false} paragraph={{ rows: 3 }} />;
  if (groups.length === 0) {
    return (
      <EmptyState
        padding="sm"
        action={
          <Button type="primary" onClick={onCreateTarget}>
            新建目标
          </Button>
        }
      >
        还没有文风目标——先建一个目标，粘贴一段范文，再写下我的稿，让 AI 对照点评
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <PracticeTargetGroup key={group.target.id} group={group} onCreateSample={onCreateSample} />
      ))}
    </div>
  );
}

// ============ 容器 ============

export default function Practice() {
  const config = useProjectStore((s) => s.config);
  const [groups, setGroups] = useState<PracticeGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  /** 新建样本弹窗的目标（`null` = 关窗） */
  const [sampleDialogTarget, setSampleDialogTarget] = useState<PracticeTargetItem | null>(null);

  // AI 提案确认 / InfoBar 刷新后重拉（列表数据统一订阅 dataVersion）
  useDataRefresh(() => setReloadTick((t) => t + 1));

  useEffect(() => {
    let cancelled = false;
    setGroups(null);
    setError(null);
    // 先拉目标、再逐目标拉样本（REST 无聚合端点）：样本列表只给计数位，不带正文与卡体
    getPracticeTargets()
      .then(async (res) => {
        const loaded = await Promise.all(
          res.targets.map(async (target) => ({
            target,
            samples: (await getPracticeSamples(target.id)).samples,
          })),
        );
        if (!cancelled) setGroups(loaded);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "加载失败，请重试");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  /** 创建成功 → 重拉列表（不做乐观更新） */
  function reload(): void {
    setReloadTick((t) => t + 1);
  }

  const disabled = config === null;

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* 页头（常驻）：标题 + 控件行右端组 [+ 新建目标] + 分割线 */}
      <PageHeader
        title="文风练习"
        controls={
          <span className="ml-auto flex items-center gap-2">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={disabled}
              onClick={() => setTargetDialogOpen(true)}
            >
              新建目标
            </Button>
          </span>
        }
      />

      {/* 错误条（页头之下、滚动区之上：页头常驻模板，见 DESIGN.md §Layout） */}
      {error !== null && (
        <Alert
          className="mb-2"
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={reload}>
              重试
            </Button>
          }
        />
      )}

      {/* 滚动区：列表（页头不随内容滚动） */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PracticeList
          groups={groups}
          onCreateTarget={() => setTargetDialogOpen(true)}
          onCreateSample={setSampleDialogTarget}
        />
      </div>

      <CreateTargetDialog
        open={targetDialogOpen}
        onOpenChange={setTargetDialogOpen}
        onCreated={reload}
      />
      <CreateSampleDialog
        target={sampleDialogTarget}
        onOpenChange={(open) => {
          if (!open) setSampleDialogTarget(null);
        }}
        onCreated={reload}
      />
    </section>
  );
}
