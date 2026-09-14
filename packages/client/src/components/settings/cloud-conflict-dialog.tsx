// `cloud-conflict-dialog`（DESIGN.md §548）：冲突裁决框——**左栏「同步云端」与设置页面板共用同一个实例**
//（开关在 `stores/cloud.ts` 的 `conflictOpen`，宿主挂在 AppShell，左栏收起时也在）。
//
// 形态契约：并排对比「云端那份」与「本机最新份」（时间 / 设备 / 统计 / 大小）+ 一句「两边都会各留一份备份」；
// Footer = `[保留云端（拉取覆盖本机）]` + `[用本机覆盖云端]`——**两个选项等权，都用 `button-default`**
//（不用主色、不用 danger：任何一方都不比另一方「正确」，主色按钮会诱导误点）。
//
// 两条语义要点（卡 5 oracle 复核的债）：
// - 「用本机覆盖云端」走 `force` 推送，**成功后 `conflictOpen` 归位**；若云端仍有更晚的他机份，角标会再次亮起
//   ——点击可**再次强推**（不是一次性动作）。
// - 本机没有可推送的备份时该按钮禁用并给出「先立即备份」提示（服务端会 404 拒绝）。
import { Button } from "antd";
import { useCloudStore } from "../../stores/cloud";
import { BACKUP_KIND_LABELS, formatBackupMeta, formatBackupTime, formatBytes } from "../../lib/backup";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

/** 对比行（两列同一组标签：时间 / 设备 / 统计 / 大小） */
function CompareColumn({
  title,
  lines,
}: {
  title: string;
  lines: { label: string; value: string }[];
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 text-sm font-medium">{title}</p>
      <dl className="flex flex-col gap-1 text-xs">
        {lines.map((line) => (
          <div key={line.label} className="flex gap-2">
            <dt className="w-10 shrink-0 text-muted-foreground">{line.label}</dt>
            <dd className="min-w-0 flex-1 break-all">{line.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function CloudConflictDialog() {
  const open = useCloudStore((s) => s.conflictOpen);
  const status = useCloudStore((s) => s.status);
  const localLatest = useCloudStore((s) => s.localLatest);
  const busy = useCloudStore((s) => s.busy);
  const lastError = useCloudStore((s) => s.lastError);
  const closeConflict = useCloudStore((s) => s.closeConflict);
  const push = useCloudStore((s) => s.push);
  const pull = useCloudStore((s) => s.pull);

  if (!open) return null;

  const remote = status?.remote?.backups[0] ?? null;
  const remoteMeta = remote !== null ? formatBackupMeta(remote) : "";
  const localMeta = localLatest !== null ? formatBackupMeta(localLatest) : "";

  return (
    <Dialog open onOpenChange={(v) => !v && busy === null && closeConflict()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>两边都有改动</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          云端和本机各自都有新备份——选一边作为当前内容，另一边不会丢：两边都会各留一份备份
          （保留云端 = 本机当前状态先自动快照；用本机覆盖 = 云端那份先下载存进本机备份）。
        </p>

        <div className="mt-1 grid grid-cols-2 gap-3">
          <CompareColumn
            title="云端那份"
            lines={
              remote === null
                ? [{ label: "状态", value: "（无法读取云端列表）" }]
                : [
                    { label: "时间", value: formatBackupTime(remote.createdAt) },
                    { label: "类型", value: BACKUP_KIND_LABELS[remote.kind] },
                    ...(remote.name !== undefined ? [{ label: "标签", value: remote.name }] : []),
                    { label: "设备", value: remote.device },
                    { label: "统计", value: remoteMeta },
                    { label: "大小", value: formatBytes(remote.size) },
                  ]
            }
          />
          <CompareColumn
            title="本机最新份"
            lines={
              localLatest === null
                ? [{ label: "状态", value: "（本机还没有备份）" }]
                : [
                    { label: "时间", value: formatBackupTime(localLatest.createdAt) },
                    { label: "类型", value: BACKUP_KIND_LABELS[localLatest.kind] },
                    ...(localLatest.name !== undefined ? [{ label: "标签", value: localLatest.name }] : []),
                    { label: "设备", value: localLatest.device },
                    { label: "统计", value: localMeta },
                    { label: "大小", value: formatBytes(localLatest.size) },
                  ]
            }
          />
        </div>

        {lastError !== null && <p className="mt-1 text-xs text-destructive">{lastError}</p>}
        {localLatest === null && (
          <p className="mt-1 text-xs text-muted-foreground">
            本机还没有备份，先在设置页「立即备份」生成一份，才能用本机覆盖云端。
          </p>
        )}

        <DialogFooter>
          <Button disabled={busy !== null || remote === null} loading={busy === "pull"} onClick={() => void pull()}>
            保留云端（拉取覆盖本机）
          </Button>
          <Button
            disabled={busy !== null || localLatest === null}
            loading={busy === "push"}
            onClick={() => void push({ force: true })}
          >
            用本机覆盖云端
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
