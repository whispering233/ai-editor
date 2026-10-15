// 文风练习列表页（`#/practice`，卡 4 改版）——范文样本按作品分组的列表 + 新建样本弹窗（含范文文件导入）。
//
// 契约：
// - 视觉 / 几何 = `docs/ui/DESIGN.md` §作家文风练习区「文风练习列表」+ §Layout「中栏页头结构」
//   （页头常驻模板：`section: h-full min-h-0 flex flex-col` + 内容进内层 `flex min-h-0 flex-1 flex-col
//   overflow-y-auto`）；行语言 = `data-row` / `section-title` / `caption-text` / `type-badge`
//   （不新增色值 / 字号 / 圆角）
// - 数据 = `docs/api/120-api-practice.md`「范文样本」：一次拿全部样本（列表不回正文与卡体），
//   **分组在客户端做**（服务端不复制作品名——第二事实源）；创建成功后**重拉列表**，不做乐观更新
// - 分组顺序 / 作品名兜底 / 状态徽标三态的唯一派生入口 = `lib/practice.ts`（页面不各写一份）；
//   相对时间复用 shared `formatRelativeTime`（全站同一套，不新造第二套格式化）
// - 用户侧文案只用「范文 / 我的稿 / 点评 / 作品」（`60-practice.md` §文案口径）
//
// 分层：`PracticeList` / `PracticeWorkGroup` / `PracticeSampleRow` = 纯展示（无 effect、无请求，
// 导出供 SSR 走查——仓内无 jsdom）；默认导出 = 容器（取数 + 弹窗开关）。
import { useEffect, useMemo, useState } from "react";
import type { PracticeSampleSummary } from "@whispering233/ai-editor-shared";
import { formatRelativeTime, resolveAuthor } from "@whispering233/ai-editor-shared";
import { Alert, Button, Skeleton, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { ApiError, getPracticeSamples } from "../lib/api";
import { practiceSampleGroups, practiceSampleStatus, type PracticeSampleGroup } from "../lib/practice";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { TypeChip } from "@/components/ui/tag-chip";
import { CreateSampleDialog } from "@/components/practice/create-sample-dialog";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";

// ============ 纯展示层（导出供 SSR 走查） ============

export interface PracticeSampleRowProps {
  sample: PracticeSampleSummary;
}

/** 样本行（`data-row` 行语言）：片段说明（`truncate`；**空着不占文本**）+ 状态徽标 + 相对时间；
 * 整行 = 进练习页（`#/practice/:sampleId`）的链接——hash 导航不另接 onClick，键盘/中键也照常工作 */
export function PracticeSampleRow({ sample }: PracticeSampleRowProps) {
  const label = sample.excerptLabel.trim();
  return (
    <a
      href={`#/practice/${sample.id}`}
      className="flex items-center gap-3 border-b border-border/50 py-2 transition-colors last:border-b-0 hover:bg-muted"
    >
      {/* 片段说明控件留着撑开中间段（徽标与时间仍靠右），内容为空时就是空的，不占文本 */}
      <span
        className="min-w-0 flex-1 truncate text-sm text-foreground"
        title={label === "" ? undefined : label}
      >
        {label}
      </span>
      <TypeChip className="shrink-0">{practiceSampleStatus(sample)}</TypeChip>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatRelativeTime(sample.updatedAt)}
      </span>
    </a>
  );
}

export interface PracticeWorkGroupProps {
  group: PracticeSampleGroup;
  /** 组内「+ 新建样本」（该组作品预选；弹窗由容器开） */
  onCreateSample: (workId: string | null) => void;
}

/** 作品分组：`section-title` 作品名 + `caption-text` 计数 + 组内 `[+ 新建样本]` + 样本行 */
export function PracticeWorkGroup({ group, onCreateSample }: PracticeWorkGroupProps) {
  return (
    <section>
      <div className="flex items-center gap-3">
        <Typography.Title level={5} className="min-w-0 truncate">
          {group.name}
        </Typography.Title>
        <Typography.Text type="secondary" className="shrink-0">
          {group.samples.length} 篇范文
        </Typography.Text>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <Button size="small" icon={<PlusOutlined />} onClick={() => onCreateSample(group.workId)}>
            新建样本
          </Button>
        </span>
      </div>

      <div className="mt-2">
        {group.samples.map((sample) => (
          <PracticeSampleRow key={sample.id} sample={sample} />
        ))}
      </div>
    </section>
  );
}

export interface PracticeListProps {
  /** `null` = 加载中（骨架）；`[]` = 无样本（空态） */
  groups: PracticeSampleGroup[] | null;
  onCreateSample: (workId: string | null) => void;
}

/** 列表主体：加载态 / 空态 / 作品分组（页头之外的全部滚动内容） */
export function PracticeList({ groups, onCreateSample }: PracticeListProps) {
  if (groups === null) return <Skeleton active title={false} paragraph={{ rows: 3 }} />;
  if (groups.length === 0) {
    return (
      <EmptyState padding="sm">还没有范文——点「新建样本」导入或粘贴一段</EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <PracticeWorkGroup
          key={group.workId ?? "other"}
          group={group}
          onCreateSample={onCreateSample}
        />
      ))}
    </div>
  );
}

// ============ 容器 ============

export default function Practice() {
  /** 预置作家 id（练习工作区特有；`project.json` 缺失 / 未知 → null，作品一律归「其他」） */
  const authorId = useProjectStore((s) => s.config?.authorId ?? null);
  const [samples, setSamples] = useState<PracticeSampleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  /** 新建样本弹窗的预选作品（`null` = 关窗；`{ workId: null }` = 预选「其他」） */
  const [sampleDialog, setSampleDialog] = useState<{ workId: string | null } | null>(null);

  // AI 提案确认 / InfoBar 刷新后重拉（列表数据统一订阅 dataVersion）
  useDataRefresh(() => setReloadTick((t) => t + 1));

  // 作家解析放渲染期（配置可能晚于样本到达）：分组只依赖当前作家，不缓存一份可能过期的
  const author = resolveAuthor(authorId);
  const groups = useMemo(
    () => (samples === null ? null : practiceSampleGroups(author, samples)),
    [author, samples],
  );

  useEffect(() => {
    let cancelled = false;
    setSamples(null);
    setError(null);
    getPracticeSamples()
      .then((res) => {
        if (!cancelled) setSamples(res.samples);
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

  // 未解析到预置作家（配置未到 / 不在清单）时不能建样本：服务端同样按 400 拒（`120-api-practice.md` 前置条件）
  const disabled = author === null;

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* 页头（常驻）：标题 + 控件行右端组 [+ 新建样本]（默认「其他」）+ 分割线 */}
      <PageHeader
        title="文风练习"
        controls={
          <span className="ml-auto flex items-center gap-2">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={disabled}
              onClick={() => setSampleDialog({ workId: null })}
            >
              新建样本
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
        <PracticeList groups={groups} onCreateSample={(workId) => setSampleDialog({ workId })} />
      </div>

      {/* 每次打开都是新挂载（初值 = 预选作品、表单干净），关窗即卸载，不残留上一条范文 */}
      {sampleDialog !== null && (
        <CreateSampleDialog
          author={author}
          defaultWorkId={sampleDialog.workId}
          onOpenChange={(open) => {
            if (!open) setSampleDialog(null);
          }}
          onCreated={reload}
        />
      )}
    </section>
  );
}