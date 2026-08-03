// 大纲页对话框组件（S2.4 修订：就地编辑/新建替代后仅保留两处弹窗）
// 保留场景（用户反馈「减少弹窗」后的必要对话框）：
//   - MoveNodeDialog：拖拽的兜底（复杂目标选择/精确位置，⋯ 菜单「移动到…」入口）
//   - ConfirmDialog：危险操作必须二次确认（layout.md §3.2——软删、purge）
// 已移除：CreateNodeDialog/EditNodeDialog（由 Outline.tsx 行内就地编辑/新建替代）
// 契约：doc/ui/pages/outline.md「关键交互」——父节点按类型过滤（决策 19）
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { OutlineNode } from "@ai-editor/shared";
import { moveOutlineNode, type OutlineNodeType } from "../../lib/api";
import { ApiError } from "../../lib/api";
import { findNodeChildren, parentOptionsForType } from "../../lib/outline-tree";
import { useUiStore } from "../../stores/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

/** 提取错误码（ApiError → 服务端码；未知 → null 走兜底文案） */
function errorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

/** 错误码 → 对话框内联文案（VALIDATION_ERROR 为主；其余兜底） */
function describeDialogError(code: string | null): string {
  return code === "VALIDATION_ERROR"
    ? "输入不合法：请检查标题长度（1-200 字）与父节点层级"
    : "操作失败，请稍后重试";
}

/** 父节点下拉选项渲染（depth 缩进：root=0、卷=1、章=2） */
function parentOptions(nodes: OutlineNode[], type: OutlineNodeType) {
  return parentOptionsForType(nodes, type).map((o) => (
    <option key={o.id} value={o.id}>
      {"　".repeat(o.depth)}
      {o.label}
    </option>
  ));
}

/** 移动到…对话框（拖拽兜底：复杂目标选择/精确位置）：目标父 + 插入位置 → PUT /move */
export function MoveNodeDialog({
  node,
  nodes,
  onMoved,
  onClose,
}: {
  node: OutlineNode;
  nodes: OutlineNode[];
  onMoved: (parentId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [parentId, setParentId] = useState("");
  const [order, setOrder] = useState<number>(-1); // -1 = 排最后
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 初始化：默认排到最后
  useEffect(() => {
    const options = parentOptionsForType(nodes, node.type);
    if (options.length > 0) setParentId(options[0].id);
  }, [nodes, node.type]);

  const siblings = parentId ? (findNodeChildren(nodes, parentId) ?? []) : [];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!parentId) {
      setError("请选择目标父节点");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const targetOrder = order === -1 ? siblings.length : order;
      await moveOutlineNode(node.id, { parent_id: parentId, order: targetOrder });
      useUiStore.getState().showToast(`已移动《${node.title}》`);
      await onMoved(parentId);
      onClose();
    } catch (err) {
      setError(describeDialogError(errorCode(err)));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>移动到…：《{node.title}》</DialogTitle>
        </DialogHeader>
        <form id="move-node-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <p className="mb-1 text-sm font-medium text-zinc-700">目标父节点（按层级过滤）</p>
          <select
            value={parentId}
            onChange={(e) => {
              setParentId(e.target.value);
              setOrder(-1);
            }}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            {parentOptions(nodes, node.type)}
          </select>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-zinc-700">插入位置</p>
          <select
            value={order}
            onChange={(e) => setOrder(Number(e.target.value))}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            {siblings.map((sib, i) => (
              <option key={sib.id} value={i + 1}>
                排在《{sib.title}》之后（位置 {i + 2}）
              </option>
            ))}
            <option value={0}>排最前</option>
            <option value={-1}>排最后</option>
          </select>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="move-node-form" disabled={submitting}>
            移动
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 危险操作确认对话框（软删/彻底删除共用；onConfirm 抛错则保持打开并显示错误） */
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
