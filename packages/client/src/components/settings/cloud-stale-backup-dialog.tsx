// `cloud-stale-backup-dialog`（卡 B）：旧包上传确认框——**「有改动未进最新备份」时用户主动同步的二选一**。
//
// 背景（`docs/design/40-cloud-sync.md` §5「职责分离」）：**云端永不创建备份**（云端只是本地备份的镜像），
// 自动路径（定时 / 关闭项目）在该状态下**跳过不推**（推旧包会把 `lastSyncAt` 前移 → 状态显示「已同步」
// 而云端内容落后，另一台拉下去会覆盖自己的新内容）。所以选择权交给用户：
//
//   `[立即手动备份并推送]` = 先 `POST /project/backup`（新格式、统计为当下真实值）再推送；
//   `[上传旧备份]`         = 照推当前最新那份（明确承认云端会落后）。
//
// 形态契约：两个选项**等权，都用 `button-default`**（不用主色、不用 danger）——两者都是合法选择，
// 主色会诱导用户点「备份」（那是更慢、更耗流量的一条）。
import { Button } from "antd";
import { useCloudStore } from "../../stores/cloud";
import { BACKUP_KIND_LABELS, formatBackupTime } from "../../lib/backup";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export function CloudStaleBackupDialog() {
  const open = useCloudStore((s) => s.staleDialogOpen);
  const localLatest = useCloudStore((s) => s.localLatest);
  const busy = useCloudStore((s) => s.busy);
  const lastError = useCloudStore((s) => s.lastError);
  const closeStaleDialog = useCloudStore((s) => s.closeStaleDialog);
  const pushAfterFreshBackup = useCloudStore((s) => s.pushAfterFreshBackup);
  const push = useCloudStore((s) => s.push);

  if (!open) return null;

  const latest = localLatest;
  const backupLine =
    latest === null
      ? "本机还没有任何备份"
      : `${formatBackupTime(latest.createdAt)} · ${BACKUP_KIND_LABELS[latest.kind]}${
          latest.name !== undefined ? ` · ${latest.name}` : ""
        }`;

  return (
    <Dialog open onOpenChange={(v) => !v && busy === null && closeStaleDialog()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>有改动还没进备份</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          最新一份本地备份是「{backupLine}」，比本机最新改动要早——现在同步的话，云端只能拿到这份旧内容。
          云端不会自动替你生成备份（备份始终归本机）：
        </p>
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          <li>· 立即手动备份并推送：先生成一份包含当前改动的备份，再推上去（推荐，换机器时内容完整）。</li>
          <li>· 上传旧备份：只把上面那份旧包推上去（云端内容会落后于本机）。</li>
        </ul>

        {lastError !== null && <p className="text-xs text-destructive">{lastError}</p>}

        <DialogFooter>
          <Button disabled={busy !== null} loading={busy === "push"} onClick={() => void push()}>
            上传旧备份
          </Button>
          <Button disabled={busy !== null} onClick={() => void pushAfterFreshBackup()}>
            立即手动备份并推送
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 供设置页面板复用的文案（状态行提示与对话框必须同一套口径，避免「同一状态两种说法」） */
export const STALE_BACKUP_HINT = "本机有改动未进最新备份，云端只能上传旧份——先「立即备份」";
