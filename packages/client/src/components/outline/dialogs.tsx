// 大纲页对话框组件（S2.3）：创建（类型 + 父节点按类型过滤）/ 编辑 / 移动到… / 危险操作确认
// 契约：doc/ui/pages/outline.md「关键交互」——创建父节点按类型过滤（决策 19）、MVP 兜底用
//   「移动到…」对话框（拖拽实现成本高时先做对话框，交互语义一致）、软删确认展示级联影响
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { OutlineNode } from "@ai-editor/shared";
import {
  createOutlineNode,
  moveOutlineNode,
  updateOutlineNode,
  type OutlineNodeType,
} from "../../lib/api";
import { ApiError } from "../../lib/api";
import { findNodeChildren, parentOptionsForType, resolveParentId } from "../../lib/outline-tree";
import { useUiStore } from "../../stores/ui";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Modal } from "../ui/modal";

/** 类型徽标/按钮文案（卷/章/场） */
export const TYPE_LABEL: Record<OutlineNodeType, string> = {
  volume: "卷",
  chapter: "章",
  scene: "场",
};

const NODE_TYPES: OutlineNodeType[] = ["volume", "chapter", "scene"];

/** 节点下一层类型（scene 无子节点——严格三层，决策 19） */
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

/** 创建节点对话框：类型单选 + 父节点按类型过滤 + title/summary */
export function CreateNodeDialog({
  nodes,
  initialType = "volume",
  initialParentId,
  lockedType,
  onCreated,
  onClose,
}: {
  nodes: OutlineNode[];
  initialType?: OutlineNodeType;
  initialParentId?: string;
  /** 锁定类型（空态「新建第一卷」用：隐藏类型选择器） */
  lockedType?: OutlineNodeType;
  /** 创建成功回调：回传实际挂载的父节点 id + 新节点 id（页面展开父 + 高亮新节点） */
  onCreated: (parentId: string, newNodeId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<OutlineNodeType>(initialType);
  const [parentId, setParentId] = useState<string>(initialParentId ?? "");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 父节点选择规则（oracle 修复）：入口 initialParentId 合法则保留，不合法（类型切换后旧父失效）才重置。
  // 用函数式 setState 读当前值 + 依赖仅 [type, nodes]，避免 parentId 入依赖自触发
  useEffect(() => {
    setParentId((current) => resolveParentId(current, type, nodes));
  }, [type, nodes]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const name = title.trim();
    if (!name) {
      setError("请输入标题");
      return;
    }
    if (type !== "volume" && !parentId) {
      setError("请选择父节点（场景必须挂在章节下）");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await createOutlineNode({ type, title: name, parent_id: parentId, summary: summary.trim() || undefined });
      useUiStore.getState().showToast(`已创建${TYPE_LABEL[type]}《${name}》`);
      await onCreated(parentId, res.id);
      onClose();
    } catch (err) {
      setError(describeDialogError(errorCode(err)));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="新建节点"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="create-node-form" disabled={submitting}>
            创建
          </Button>
        </>
      }
    >
      <form id="create-node-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
        {/* 类型单选（lockedType 时隐藏——空态「新建第一卷」锁定 volume） */}
        {!lockedType && (
          <div>
            <p className="mb-1 text-sm font-medium text-zinc-700">类型</p>
            <div className="flex gap-2">
              {NODE_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`rounded-md border px-3 py-1 text-sm ${
                    type === t
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-300 text-zinc-600 hover:bg-zinc-100"
                  }`}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* 父节点（volume 固定根；chapter/scene 按类型过滤） */}
        <div>
          <p className="mb-1 text-sm font-medium text-zinc-700">父节点</p>
          {type === "volume" ? (
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-500">
              （根）——卷挂在最顶层
            </p>
          ) : (
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              {parentOptions(nodes, type)}
            </select>
          )}
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-zinc-700">标题（必填）</p>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={TYPE_LABEL[type] === "卷" ? "如：第一卷·风起" : "标题"} maxLength={200} />
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-zinc-700">摘要（可选）</p>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            placeholder="一句话说明这卷/章/场景写什么"
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}

/** 编辑节点对话框：标题/摘要 → PUT /outline/:nodeId */
export function EditNodeDialog({
  node,
  onSaved,
  onClose,
}: {
  node: OutlineNode;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(node.title);
  const [summary, setSummary] = useState(node.summary ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const name = title.trim();
    if (!name) {
      setError("请输入标题");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await updateOutlineNode(node.id, { title: name, summary: summary.trim() || undefined });
      useUiStore.getState().showToast("已保存");
      await onSaved();
      onClose();
    } catch (err) {
      setError(describeDialogError(errorCode(err)));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={`编辑${TYPE_LABEL[node.type]}：${node.title}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="edit-node-form" disabled={submitting}>
            保存
          </Button>
        </>
      }
    >
      <form id="edit-node-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <p className="mb-1 text-sm font-medium text-zinc-700">标题</p>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-zinc-700">摘要</p>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}

/** 移动到…对话框（MVP 拖拽兜底，原型「交互语义一致」）：目标父 + 插入位置 → PUT /move */
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
    <Modal
      title={`移动到…：《${node.title}》`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="move-node-form" disabled={submitting}>
            移动
          </Button>
        </>
      }
    >
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
    </Modal>
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
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
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
        </>
      }
    >
      <p className="text-sm text-zinc-600">{description}</p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}
