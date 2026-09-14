// `cloud-pull-confirm`（DESIGN.md §544/§548）：拉取确认框——**面板行内「拉取」与左栏「同步云端」
// 共用同一个实例**（状态在 `stores/cloud.ts` 的 `pullTarget`，宿主挂在 AppShell）。
//
// 文案要点：云端那份的元信息 + 两句后果声明（覆盖三文件 / 本机当前状态会先自动快照 + 打包目录并集保留）。
// 确认按钮走 **danger**：拉取会覆盖三文件，红色警示比主色更诚实（与本地 restore 的 `[加载]` 同口径）。
import { useCloudStore } from "../../stores/cloud";
import { BACKUP_KIND_LABELS, formatBackupMeta, formatBackupTime, formatBytes } from "../../lib/backup";
import { ConfirmDialog } from "../outline/dialogs";

export function CloudPullConfirm() {
  const target = useCloudStore((s) => s.pullTarget);
  const busy = useCloudStore((s) => s.busy);
  const closePullConfirm = useCloudStore((s) => s.closePullConfirm);
  const pull = useCloudStore((s) => s.pull);

  if (target === null) return null;

  const meta = formatBackupMeta(target);
  return (
    <ConfirmDialog
      title="从云端拉取"
      description={`${formatBackupTime(target.createdAt)} · ${BACKUP_KIND_LABELS[target.kind]}${
        target.name !== undefined ? ` · ${target.name}` : ""
      } · ${meta} · ${formatBytes(
        target.size,
      )}。将用云端那份覆盖当前项目的三文件（id/书名不变）；本机当前状态会先自动快照到本地备份（可回退），本机独有的对话与资料按并集保留（不会被删）。`}
      confirmLabel="拉取"
      danger
      onConfirm={() => pull(target)}
      onClose={() => {
        if (busy === null) closePullConfirm();
      }}
    />
  );
}
