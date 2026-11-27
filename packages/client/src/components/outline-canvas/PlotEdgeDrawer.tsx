// 画布连线抽屉（点边打开；契约：docs/ui/DESIGN.md `outline-canvas`「连线 = plot_edge」段）。
//
// 字段与上限全部复用 C4 的 `RelationMetadataForm`（本组件只管抽屉外壳 + 保存 + 删除入口），
// 提交 `PUT /relation/:id` 只 patch `metadata`（整体替换，其它键由 buildRelationMetadataPayload 保留）。
// 调用点按 `relation.id` 做 key ⇒ 每次打开都是该条边的当前值，不必监听 prop 变化复位草稿。
//
// zIndex 40：房内 Dialog 是 z-50（components/ui/dialog.tsx），删除确认必须压在抽屉**之上**；
// 40 又高于画布（React Flow 面板 z-index 5）与浮钮（30），所以抽屉仍盖住页面内容。
import { useState, type FormEvent } from "react";
import { Button, Drawer } from "antd";
import { ApiError, updateRelationMeta, type RelationSummaryItem } from "../../lib/api";
import {
  buildRelationMetadataPayload,
  relationMetadataDraft,
  type RelationMetadataDraft,
} from "../../lib/relation-metadata";
import { useUiStore } from "../../stores/ui";
import { RelationMetadataForm } from "../entity/relation-metadata-form";
import { FieldError } from "@/components/ui/field-error";

/** 抽屉宽度（右栏；窄屏仍按此宽贴着右边缘） */
const DRAWER_WIDTH = 360;

export function PlotEdgeDrawer({
  relation,
  headline,
  onSaved,
  onRequestDelete,
  onClose,
}: {
  relation: RelationSummaryItem;
  /** 两端说明（`第1章 章名 → 第2章 章名`） */
  headline: string;
  /** 保存成功（调用方重拉边列表） */
  onSaved: () => Promise<void>;
  /** 删除入口：交给调用点弹 ConfirmDialog（物理删，不可恢复） */
  onRequestDelete: () => void;
  onClose: () => void;
}) {
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
      useUiStore.getState().showToast("已保存连线");
      await onSaved();
      onClose();
    } catch (err) {
      // 不吞错：400 / 404 与网络失败都留在抽屉里可读，输入原样保留
      setError(err instanceof ApiError ? err.message : "保存失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open
      placement="right"
      size={DRAWER_WIDTH}
      zIndex={40}
      title="编辑连线"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between">
          <Button color="danger" variant="text" onClick={onRequestDelete}>
            删除连线
          </Button>
          <Button type="primary" htmlType="submit" form="plot-edge-form" loading={submitting}>
            保存
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">{headline}</p>
      <form id="plot-edge-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
        <RelationMetadataForm value={draft} onChange={setDraft} />
        {error !== null && <FieldError>{error}</FieldError>}
      </form>
    </Drawer>
  );
}
