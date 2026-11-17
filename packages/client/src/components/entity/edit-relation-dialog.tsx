// 编辑关系说明对话框（关联页行内入口；画布连线抽屉复用 `RelationMetadataForm`，不复制字段）。
// 契约：`PUT /relation/:id` 只 patch `metadata`（整体替换）；成功 toast + `onSaved`（调用方走既有重载）。
// 关闭（取消 / Esc / 遮罩）不提交；失败保留输入并在框内显示 `ApiError.message`。
import { useState, type FormEvent } from "react";
import { Button } from "antd";
import { ApiError, updateRelationMeta, type RelationSummaryItem } from "../../lib/api";
import { relationTypeLabel } from "../../lib/entity-detail";
import {
  buildRelationMetadataPayload,
  relationMetadataDraft,
  type RelationMetadataDraft,
} from "../../lib/relation-metadata";
import { useUiStore } from "../../stores/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RelationMetadataForm } from "./relation-metadata-form";

/** 端点显示名（名称缺失回退 id） */
function endpointName(r: RelationSummaryItem, side: "source" | "target"): string {
  const name = side === "source" ? r.sourceName : r.targetName;
  const id = side === "source" ? r.sourceId : r.targetId;
  return name ?? id;
}

export function EditRelationDialog({
  relation,
  onSaved,
  onClose,
}: {
  relation: RelationSummaryItem;
  /** 保存成功（调用方重拉列表） */
  onSaved: () => void;
  onClose: () => void;
}) {
  // 挂载时取初值：调用点只在选中行时挂载本组件（关窗即卸载）⇒ 每次打开都是该行的当前值
  const [draft, setDraft] = useState<RelationMetadataDraft>(() =>
    relationMetadataDraft(relation.metadata),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await updateRelationMeta(
        relation.id,
        buildRelationMetadataPayload(relation.metadata, draft),
      );
      useUiStore.getState().showToast("已保存关系说明");
      onSaved();
      onClose();
    } catch (err) {
      // 不吞错：服务端 400 / 404 与网络失败都留在框内可读，输入原样保留
      setError(err instanceof ApiError ? err.message : "保存失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑关系说明</DialogTitle>
          <DialogDescription>
            {endpointName(relation, "source")} {relationTypeLabel(relation.relationType)} →{" "}
            {endpointName(relation, "target")}
          </DialogDescription>
        </DialogHeader>
        <form id="edit-relation-meta-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
          <RelationMetadataForm value={draft} onChange={setDraft} />
          {error !== null && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
