// 大纲页对话框组件（S2.4 修订：就地编辑/新建替代后仅保留不可恢复操作确认）
// 保留场景（用户反馈「减少弹窗」后的必要对话框）：
//   - ConfirmDialog：彻底删除（purge）/ 物理删关系等不可恢复操作必须二次确认（layout.md §3.2）
// 已移除：CreateNodeDialog/EditNodeDialog（由 Outline.tsx 行内就地编辑/新建替代）、
//   MoveNodeDialog（S13.1：拖拽上下半判定 + 指示线已覆盖精确插入位置）
// 契约：doc/ui/pages/outline.md「关键交互」——父节点按类型过滤（决策 19）
import { useState } from "react";
import type { OutlineNodeType } from "../../lib/api";
import { ApiError } from "../../lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** 类型徽标/按钮文案（卷/章/场） */
export const TYPE_LABEL: Record<OutlineNodeType, string> = {
  volume: "卷",
  chapter: "章",
  scene: "场",
};

/** 节点下一层类型（scene 无子节点——严格三层，决策 19）；行尾「＋ 新建」用 */
export const CHILD_TYPE: Record<OutlineNodeType, OutlineNodeType | null> = {
  volume: "chapter",
  chapter: "scene",
  scene: null,
};
/** 危险操作确认对话框（彻底删除/物理删关系等不可恢复操作；onConfirm 抛错则保持打开并显示错误） */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            variant={danger ? "destructive" : "default"}
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
