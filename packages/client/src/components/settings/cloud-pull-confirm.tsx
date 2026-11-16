// `cloud-pull-confirm`（DESIGN.md §544/§548）：拉取确认框——**面板行内「拉取」与左栏「同步云端」
// 共用同一个实例**（状态在 `stores/cloud.ts` 的 `pullTarget`，宿主挂在 AppShell）。
//
// 文案要点：云端那份的元信息 + 两句后果声明（本机当前状态会先自动快照到本地备份 / 正文、参考资料与项目规则随覆盖被云端那份替换；本机对话历史不受影响——会话纯本地、不进任何 zip）。
// 确认按钮走 **danger**：拉取会覆盖三文件与项目规则，红色警示比主色更诚实（与本地 restore 的 `[加载]` 同口径）。
import { resolveWorkspaceKind } from "@whispering233/ai-editor-shared";
import { useCloudStore } from "../../stores/cloud";
import { useProjectStore } from "../../stores/project";
import { BACKUP_KIND_LABELS, formatBackupMeta, formatBackupTime, formatBytes } from "../../lib/backup";
import { ConfirmDialog } from "../outline/dialogs";

export function CloudPullConfirm() {
  const target = useCloudStore((s) => s.pullTarget);
  const busy = useCloudStore((s) => s.busy);
  const closePullConfirm = useCloudStore((s) => s.closePullConfirm);
  const pull = useCloudStore((s) => s.pull);
  const configKind = useProjectStore((s) => s.config?.kind);
  const workspaceKind = resolveWorkspaceKind(configKind);

  if (target === null) return null;

  const meta = formatBackupMeta(target, workspaceKind);
  return (
    <ConfirmDialog
      title="从云端拉取"
      description={`${formatBackupTime(target.createdAt)} · ${BACKUP_KIND_LABELS[target.kind]}${
        target.name !== undefined ? ` · ${target.name}` : ""
      } · ${meta} · ${formatBytes(
        target.size,
      )}。本机当前状态将先自动快照到本地备份（可回退）；正文/参考资料/项目规则会随覆盖被云端那份替换（包内没有规则时本机规则会被清除）；本机对话历史不受影响——会话不进云端。`}
      confirmLabel="拉取"
      danger
      onConfirm={() => pull(target)}
      onClose={() => {
        if (busy === null) closePullConfirm();
      }}
    />
  );
}
