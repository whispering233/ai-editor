// 大纲树页面（S2.4 修订：就地编辑/就地新建/拖拽移动为主，弹窗仅保留必要场景；
//   S12.2：⋯ 菜单「变更记录」→「详情」（跳 #/outline/:nodeId 节点详情页），行内 Delta 面板随详情页落地移除；
//   S13.1 交互重构：取消 ⋯ 操作条 → 行尾平铺图标（＋ 新建 / 详情 / 移入回收站）；删除「移动到…」对话框
//   （拖拽修复后已覆盖）；拖拽上下半判定 + 插入指示线（同级排序可用）；摘要移到标题下方独立行（默认显示）；
//   删除底部回收站折叠区（Trash tab 已覆盖）；「设为当前位置」入口迁往详情页（S13.2）；当前位置徽标 token 化；
//   S9.2 伏笔标记：title 行尾紧凑徽标（plants/advances/resolves 图标 + title tooltip 伏笔名），
//   数据 = GET /relation（source_type=outline_node）三类并行拉取聚合（lib/outline-hooks）
//   决策 37 交互收敛：行级「详情」「＋ 新建」按钮移除（只留删除 + 当前位置徽标）——单击行选中、
//   选中后 Enter 新建子级（类型由父层级推导）、双击行跳详情、单击标题/摘要行内编辑、拖拽排序保留；
//   AskAiButton 保留（任务卡 1+4 决策 40 另行移除）
// 路由：#/outline；数据：GET /api/v1/outline（整树）+ GET /api/v1/relation（伏笔标记，S9.2）；操作：POST/PUT/DELETE /outline、PUT /project/config（设当前位置）
// 设计契约：doc/ui/pages/outline.md（S2.4 + S13.1 + 决策 37 修订版）——行内编辑标题/摘要（Enter 保存/Esc 取消/失焦保存）、
//   选中节点按 Enter 就地插入子节点（类型由父决定，root 可切卷/章）、拖拽移动（原生 HTML5 DnD，上下半判定：
//   目标行上半 = 插到该节点前、下半 = 插到该节点后，跨父移动按决策 19 过滤，顶层空白区 = 排末尾）、
//   双击行跳详情（#/outline/:nodeId）、软删直接执行（H2：不再弹二次确认，回收站可还原；仅彻底删除保留确认）
// 刷新策略：所有写操作成功后统一 loadOutline() 重拉整树（服务端权威——move 重排 order、软删级联子树、
//   还原级联；本地补丁易与服务端不一致；本地文件读取毫秒级，重拉成本可忽略）。outline 树数据仍在
//   project store（跨页共用：顶栏当前位置标题映射、节点 id → title 映射），本页只持有 UI 态
import { useEffect, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { OutlineNode } from "@whispering233/ai-editor-shared";
import { Trash2 } from "lucide-react";
import { CHILD_TYPE, TYPE_LABEL } from "../components/outline/dialogs";
import { NodeHookMarkBadge } from "../components/outline/node-hook-badge";
import { Button } from "@/components/ui/button";
import { AskAiButton } from "@/components/chat/AskAiButton";
import { EmptyState } from "@/components/ui/empty-state";
import { errorBannerClass, skeletonClass } from "@/lib/styles";
import {
  ApiError,
  createOutlineNode,
  deleteOutlineNode,
  listRelations,
  moveOutlineNode,
  updateOutlineNode,
  type OutlineNodeType,
} from "../lib/api";
import { buildNodeHookMarks, HOOK_MARK_TYPES, type NodeHookMark } from "../lib/outline-hooks";
import {
  canMoveTo,
  dropInsertOrder,
  editFailureRecovery,
  findNode,
  findNodeChildren,
  findNodePath,
  findParentIdOf,
  isNoopDrop,
  ROOT_NODE_ID,
  sameDragTarget,
  shouldCommitSummary,
  shouldCommitTitle,
  type DragTarget,
} from "../lib/outline-tree";
import { cn } from "../lib/utils";
import { navigate } from "../hooks/use-route";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

/** 就地编辑目标（一次只编辑一个字段） */
type EditingState = { nodeId: string; field: "title" | "summary" } | null;

/** 就地新建目标：parentId "root" = 顶层（卷/章可切），否则父节点决定子类型（CHILD_TYPE） */
type CreatingState = { parentId: string; type: OutlineNodeType } | null;

/** 提取错误码（ApiError → 服务端码；未知 → null 走兜底文案） */
function errorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

/** 错误码 → 页级横幅文案（layout.md §3.2：各页定义映射） */
function describeOutlineError(code: string | null): string {
  switch (code) {
    case "OUTLINE_NODE_NOT_FOUND":
      return "节点不存在（可能已被彻底删除），大纲已刷新";
    case "CLIENT_NETWORK_ERROR":
      return "无法连接服务，请确认 ai-editor 服务已启动";
    default:
      return "操作失败，请稍后重试";
  }
}

/** 就地输入行（标题/摘要/新建共用样式；autoFocus 进入即聚焦——组件级复用，无页面 state 依赖） */
function inlineInput(
  value: string,
  onChange: (v: string) => void,
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void,
  onBlur: () => void,
  placeholder: string,
) {
  return (
    <input
      autoComplete="off"
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      maxLength={200}
      placeholder={placeholder}
      className="min-w-0 flex-1 rounded border border-border bg-card px-1.5 py-0.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

/** root 顶层就地新建行：卷/章切换（决策 19 chapter 可挂 root）+ 输入行。
 * 树容器（renderRootCreateRow）与空态引导卡共用，避免两处重复（S2.4 oracle 补丁） */
function RootCreateRow({
  type,
  onTypeChange,
  value,
  onChange,
  onKeyDown,
  onCancel,
  className,
}: {
  type: OutlineNodeType;
  onTypeChange: (t: OutlineNodeType) => void;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onCancel: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 rounded-md px-2 py-1", className)}>
      <div className="flex shrink-0 gap-1">
        {(["volume", "chapter"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTypeChange(t)}
            className={cn(
              "rounded border px-2 py-0.5 text-xs transition-colors",
              type === t
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      {inlineInput(value, onChange, onKeyDown, onCancel, `新${TYPE_LABEL[type]}标题，Enter 创建`)}
    </div>
  );
}

// ============ 伏笔标记徽标（S9.2） ============
// 徽标组件已上提为共享组件 components/outline/node-hook-badge.tsx（S10.1 上提为跨页复用，
// layout.md §5 上提约定）；本页仅消费 buildNodeHookMarks 聚合结果渲染

export default function Outline() {
  const outline = useProjectStore((s) => s.outline);
  const outlineLoading = useProjectStore((s) => s.outlineLoading);
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const loadOutline = useProjectStore((s) => s.loadOutline);
  // 跨页定位（U4 方案 A）：ui store 的 transient 目标节点 id——InfoBar/概览页点击「当前位置」
  // 设置后跳转本页；本页消费（展开祖先+滚动+高亮）后清除，不侵入 hash 路由
  const focusOutlineNodeId = useUiStore((s) => s.focusOutlineNodeId);
  const clearFocusOutlineNode = useUiStore((s) => s.clearFocusOutlineNode);

  // 数据变更信号（问题 1）：AI 提案确认写库 / InfoBar 刷新按钮 → 重拉整树；
  // 伏笔标记 effect 依赖 outline 对象，树重拉后自动联动刷新（见该 effect 注释）
  useDataRefresh(() => void loadOutline());

  // 首次加载标记：loadOutline 在 store 内静默吞错，用 loadAttempted 呈现「加载失败 + 重试」
  const [loadAttempted, setLoadAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 折叠的节点 id 集合（空集 = 全部展开） */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  /** 新创建节点高亮（原型「成功后新节点高亮」；3s 自动消失） */
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  /** 跨页定位节点高亮（U4：InfoBar 点击当前位置 → 跳转定位，bg-accent 临时高亮几秒） */
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  /** 选中节点 id（决策 37：单击行选中，选中后按 Enter 新建子级）；null = 无选中 */
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // S2.4 就地交互状态
  const [editing, setEditing] = useState<EditingState>(null);
  const [editingValue, setEditingValue] = useState("");
  const [creatingAt, setCreatingAt] = useState<CreatingState>(null);
  const [createValue, setCreateValue] = useState("");
  /** 拖拽中的节点 id；null = 无 */
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  /** 拖拽插入目标（S13.1：行上下半判定 + 顶层空白末尾）；null = 无有效目标 */
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  /** 伏笔标记映射（S9.2）：节点 id → 标记列表；null = 未加载/树置空；加载失败 → 空 Map（等效隐藏降级，不阻塞大纲） */
  const [hookMarks, setHookMarks] = useState<Map<string, NodeHookMark[]> | null>(null);

  const noProject = config === null && !configLoading;

  // 首次加载：outline 未加载且未尝试过 → loadOutline
  useEffect(() => {
    if (outline === null && !outlineLoading && !loadAttempted) {
      setLoadAttempted(true);
      void loadOutline();
    }
  }, [outline, outlineLoading, loadAttempted, loadOutline]);

  // 伏笔标记（S9.2，数据流 API → 映射 → 渲染）：大纲树就绪后并行拉取三类标记关系
  // （GET /relation，source_type=outline_node，relation_type 单值过滤，depth=1——endpoints.md「关系」）→
  // buildNodeHookMarks 按 source_id 聚合为「节点 → 标记列表」；任一类型失败降级为该类型空集、
  // 全部失败 → 标记列整体隐藏（纯展示增强，不阻塞大纲渲染、无错误横幅——注释见 hookMarks 定义）。
  // 依赖 outline 对象：树重拉（afterTreeChanged）后自动刷新，跨项目切换同效
  useEffect(() => {
    if (outline === null) {
      // 树置空（未打开项目/加载失败/切换项目间隙）：清空标记防跨项目残留（旧树 id 对新树无意义）
      setHookMarks(null);
      return;
    }
    let cancelled = false;
    void Promise.all(
      HOOK_MARK_TYPES.map((relationType) =>
        listRelations({ source_type: "outline_node", relation_type: relationType, depth: 1 })
          .then((res) => res.relations)
          .catch(() => []),
      ),
    ).then((groups) => {
      if (cancelled) return;
      setHookMarks(buildNodeHookMarks(groups.flat()));
    });
    return () => {
      cancelled = true;
    };
  }, [outline]);

  // 新节点高亮自动消失（3s；每次设置高亮重开定时器）
  useEffect(() => {
    if (highlightedNodeId === null) return;
    const t = setTimeout(() => setHighlightedNodeId(null), 3000);
    return () => clearTimeout(t);
  }, [highlightedNodeId]);

  // 跨页定位消费（U4 方案 A，layout.md §2.1「点击当前位置 → 跳 #/outline 并定位该节点」）：
  // 读取 ui store 的 transient 目标——展开折叠祖先使节点进入 DOM（折叠态节点不渲染无法滚动），
  // 渲染完成后再 scrollIntoView + 临时高亮（bg-accent 3s），最后清除 store（一次性请求）；
  // 节点不存在（软删/purge 后）直接放弃定位
  useEffect(() => {
    if (focusOutlineNodeId === null || outline === null) return;
    const targetId = focusOutlineNodeId;
    const path = findNodePath(outline.children, targetId);
    if (path === null) {
      clearFocusOutlineNode();
      return;
    }
    // 展开全部祖先（含节点自身——目标不可能是折叠父，无害）
    setCollapsed((prev) => {
      if (path.every((id) => !prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of path) next.delete(id);
      return next;
    });
    // 展开是异步状态更新：等本轮渲染完成后再查 DOM 定位（setTimeout 0 落下一帧）
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-node-id="${targetId}"]`);
      if (el) {
        el.scrollIntoView({ block: "center" });
        setFocusedNodeId(targetId);
      }
      clearFocusOutlineNode();
    }, 0);
    return () => clearTimeout(t);
  }, [focusOutlineNodeId, outline, clearFocusOutlineNode]);

  // 定位高亮自动消失（3s，同新节点高亮模式）
  useEffect(() => {
    if (focusedNodeId === null) return;
    const t = setTimeout(() => setFocusedNodeId(null), 3000);
    return () => clearTimeout(t);
  }, [focusedNodeId]);

  // 选中节点失效清理（决策 37）：树重拉后选中节点不存在（被删除/purge）→ 清除选中，防残留
  useEffect(() => {
    if (selectedNodeId === null || outline === null) return;
    if (!findNode(outline.children, selectedNodeId)) setSelectedNodeId(null);
  }, [outline, selectedNodeId]);

  /** 树变更后的统一刷新：展开目标父 + 重拉整树（刷新策略注释见文件头）；
   * highlightNodeId：创建成功后高亮新节点（原型「成功后自动展开父节点、新节点高亮」） */
  async function afterTreeChanged(expandParentId?: string, highlightNodeId?: string) {
    if (expandParentId) expand(expandParentId);
    await loadOutline();
    if (highlightNodeId) setHighlightedNodeId(highlightNodeId);
  }

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 展开节点（collapsed 中移除该 id） */
  function expand(id: string) {
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  /** 收集所有有子节点的 id（「全部折叠」用）；scene 是叶子（判别收窄：node.type !== "scene"） */
  function collectParentIds(nodes: OutlineNode[], acc: string[] = []): string[] {
    for (const n of nodes) {
      if (n.type !== "scene" && n.children && n.children.length > 0) {
        acc.push(n.id);
        collectParentIds(n.children, acc);
      }
    }
    return acc;
  }

  // ============ 就地编辑（标题/摘要：点击进入，Enter 保存 / Esc 取消 / 失焦保存） ============

  function startEdit(node: OutlineNode, field: "title" | "summary") {
    cancelCreate();
    setSelectedNodeId(null); // 决策 37：选中态与编辑态互斥（编辑输入框接管 Enter）
    setEditing({ nodeId: node.id, field });
    setEditingValue(field === "title" ? node.title : (node.summary ?? ""));
  }

  function cancelEdit() {
    setEditing(null);
    setEditingValue("");
  }

  /** 提交判定走纯函数（shouldCommitTitle/Summary：无变化不发请求、空标题不提交、摘要允许清空）。
   * 悲观提交（oracle 补丁）：提交期间保持编辑态，成功后退出；失败按 editFailureRecovery 决策——
   *   节点已不存在（NOT_FOUND）→ 放弃编辑 + 重拉树；其余 → 保持编辑态与输入值（不重拉树），
   *   用户可修正后重试（Enter 再提交）。busy 防重入（提交中重复 Enter/blur 不重复请求） */
  async function commitEdit(node: OutlineNode, field: "title" | "summary") {
    if (!editing || editing.nodeId !== node.id || editing.field !== field || busy) return;
    const value = editingValue;
    const commit =
      field === "title"
        ? shouldCommitTitle(node.title, value)
        : shouldCommitSummary(node.summary, value);
    if (!commit) {
      cancelEdit(); // 无变化/空值：直接退出编辑态，不发请求
      return;
    }
    setBusy(true);
    try {
      // summary 显式提交空串（S13.1 oracle S2：`|| undefined` 会被 JSON.stringify 丢弃导致清空不生效；
      // 服务端 patch.summary !== undefined 即写入，空串真正清除——与 S12.2 详情页语义一致）
      await updateOutlineNode(
        node.id,
        field === "title" ? { title: value.trim() } : { summary: value.trim() },
      );
      cancelEdit();
      useUiStore.getState().showToast("已保存");
      await afterTreeChanged();
    } catch (err) {
      const code = errorCode(err);
      if (editFailureRecovery(code) === "abandon") {
        // 节点已不存在（被 purge/并发删除）：放弃编辑，重拉树同步视图
        cancelEdit();
        setError(describeOutlineError(code));
        await afterTreeChanged();
        return;
      }
      // 恢复编辑态并保留输入值（editing/editingValue 未动）；输入框已失焦，用户点击即可修正重试
      setError(describeOutlineError(code));
    } finally {
      setBusy(false);
    }
  }

  function handleEditKeyDown(node: OutlineNode, field: "title" | "summary") {
    return (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void commitEdit(node, field);
      } else if (e.key === "Escape") {
        cancelEdit();
      }
    };
  }

  // ============ 就地新建（行尾「＋」/顶部按钮 → 行内输入，Enter 创建 / Esc 或失焦取消） ============

  function startCreate(parentId: string, type: OutlineNodeType) {
    cancelEdit();
    setSelectedNodeId(null); // 决策 37：选中态与新建态互斥（创建输入框接管 Enter）
    setCreatingAt({ parentId, type });
    setCreateValue("");
    if (parentId !== ROOT_NODE_ID) expand(parentId); // 新建输入显示在父 children 末尾
  }

  function cancelCreate() {
    setCreatingAt(null);
    setCreateValue("");
  }

  /** 空值 = 取消（不误建）；成功 → 展开父 + 高亮新节点（afterTreeChanged 第二参） */
  async function commitCreate() {
    if (!creatingAt) return;
    const title = createValue.trim();
    const { parentId, type } = creatingAt;
    if (!title) {
      cancelCreate();
      return;
    }
    cancelCreate();
    try {
      const res = await createOutlineNode({ type, title, parent_id: parentId });
      useUiStore.getState().showToast(`已创建${TYPE_LABEL[type]}《${title}》`);
      await afterTreeChanged(parentId, res.id);
    } catch (err) {
      setError(describeOutlineError(errorCode(err)));
    }
  }

  function handleCreateKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitCreate();
    } else if (e.key === "Escape") {
      cancelCreate();
    }
  }

  // ============ 选中与行级交互（决策 37：单击选中 / Enter 新建子级 / 双击详情） ============
  // 交互冲突设计（决策 37 要求）：
  //   标题/摘要单击 = 行内编辑（onClick stopPropagation 隔离，不触发行选中）；
  //   行区（非标题/摘要/按钮）单击 = 选中；行区双击 = 详情。
  // 双击会先触发两次单击——第一击仅设置选中高亮（无害），第二击后 dblclick 才跳转，无需延迟判定；
  // 双击标题时第一击已把 span 换成输入框，dblclick 的 e.target 是输入框（closest("input") 拦截），
  //   极端时序下 target 仍是标题 span 时由 editing 守卫拦截——双击标题 = 编辑，不误跳详情。

  /** 选中节点（决策 37）：与编辑/新建态互斥——取消就地编辑与就地新建 */
  function selectNode(nodeId: string) {
    cancelEdit();
    cancelCreate();
    setSelectedNodeId(nodeId);
  }

  /** 行单击（决策 37）：非标题/摘要/按钮区 → 选中该节点；折叠箭头/操作按钮/输入框等交互元素跳过——
   * 交互元素同样 stopPropagation（oracle 修复：行内按钮/输入框点击不冒泡到容器，避免清除选中） */
  function handleRowClick(e: MouseEvent<HTMLDivElement>, node: OutlineNode) {
    if ((e.target as HTMLElement).closest("button, input, a")) {
      e.stopPropagation(); // oracle 修复：行内按钮/输入框交互不视为「点击空白区」，不触发容器清除选中
      return;
    }
    e.stopPropagation(); // 阻止冒泡到树容器（容器 onClick 清除选中）
    selectNode(node.id);
  }

  /** 行双击（决策 37）：双击 = 详情（#/outline/:nodeId）；
   * 冲突防护：双击标题 = 编辑（第一击已把标题换成输入框，dblclick 的 target 是输入框被 closest 拦截；
   * 极端时序下 target 仍是标题 span 时由 editing 守卫拦截）；双击按钮区同样不跳详情 */
  function handleRowDoubleClick(e: MouseEvent<HTMLDivElement>, node: OutlineNode) {
    if ((e.target as HTMLElement).closest("button, input, a")) return;
    if (editing?.nodeId === node.id) return;
    navigate(`/outline/${node.id}`);
  }

  /** 行键盘（决策 37）：选中节点按 Enter → 新建子级（子级类型由父层级推导 CHILD_TYPE，
   * 就地输入行出现在子级末尾，Enter 确认/Esc 取消——commitCreate 逻辑复用）；
   * 编辑态/新建态/拖拽中/busy/scene（无子级）时禁用；
   * 仅行 div 自身聚焦时响应（oracle 修复：子元素按钮/输入框聚焦时交给子元素处理，不劫持按钮 Enter→click） */
  function handleRowKeyDown(e: KeyboardEvent<HTMLDivElement>, node: OutlineNode) {
    if (e.key !== "Enter") return;
    if (e.target !== e.currentTarget) return; // oracle 修复：仅行自身聚焦响应，子元素（按钮/输入框）聚焦交给子元素
    const childType = CHILD_TYPE[node.type];
    if (childType === null) return; // scene 是叶子，无子级可建
    if (editing !== null || creatingAt !== null || dragNodeId !== null || busy) return;
    if (selectedNodeId !== node.id) return; // 仅选中节点触发
    e.preventDefault();
    startCreate(node.id, childType);
  }

  // ============ 拖拽移动（S13.1：原生 HTML5 DnD，上下半判定 + 插入指示线，同级排序可用） ============
  // 语义：拖到目标行上半 = 插到该节点前（该行上边缘指示线）、下半 = 插到该节点后（下边缘指示线）；
  //   目标父 = 目标行的父（canMoveTo 过滤：决策 19 层级约束 + 不自挂/子树）；顶层空白区 = 排 root 末尾（保留原语义）

  function handleDragStart(e: DragEvent, node: OutlineNode) {
    e.dataTransfer.setData("text/plain", node.id);
    e.dataTransfer.effectAllowed = "move";
    setDragNodeId(node.id);
    setDragTarget(null);
  }

  function handleDragEnd() {
    setDragNodeId(null);
    setDragTarget(null);
  }

  /** 拖拽点相对目标行的位置：上半 → before、下半 → after（e.clientY 与行 rect 中点比较） */
  function insertSideFromEvent(e: DragEvent): "before" | "after" {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  /** 行 dragover：canMoveTo 过滤（**目标父 = 目标行的父**，决策 19）→ 设置插入目标（去重防高频重渲染） */
  function handleDragOver(e: DragEvent, targetNodeId: string) {
    e.stopPropagation(); // 行内事件不冒泡到顶层容器（避免目标高亮错乱）
    const dragNode = dragNodeId ? findNode(outline?.children ?? [], dragNodeId) : null;
    if (!dragNode) return;
    // 目标父 = 目标行的父（root 下的行 → ROOT_NODE_ID）——插到该行前/后 = 作为该行父的子节点；
    // 注意不能检查 canMoveTo(dragNode, targetNodeId)：那会让 scene 拖到 chapter 行通过（scene 可挂
    // chapter）但实际插入目标父是 volume（400 INVALID_HIERARCHY）
    const targetParentId = findParentIdOf(outline?.children ?? [], targetNodeId) ?? ROOT_NODE_ID;
    if (!canMoveTo(dragNode, targetParentId, outline?.children ?? [])) return;
    e.preventDefault(); // 允许 drop
    e.dataTransfer.dropEffect = "move";
    const next: DragTarget = { kind: insertSideFromEvent(e), nodeId: targetNodeId };
    setDragTarget((prev) => (sameDragTarget(prev, next) ? prev : next));
  }

  /** 行 dragleave：仅真正离开该行才清除该行的插入目标（子元素间移动不触发） */
  function handleDragLeave(e: DragEvent, targetNodeId: string) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragTarget((prev) =>
        prev !== null && prev.kind !== "root-end" && prev.nodeId === targetNodeId ? null : prev,
      );
    }
  }

  /** 行 drop：按插入位置计算 order → PUT /move（原地放置不发请求） */
  async function handleDrop(e: DragEvent, targetNodeId: string) {
    e.stopPropagation();
    e.preventDefault();
    if (!dragNodeId) return;
    const dragNode = findNode(outline?.children ?? [], dragNodeId);
    if (!dragNode) return;
    const parentId = findParentIdOf(outline?.children ?? [], targetNodeId) ?? ROOT_NODE_ID;
    if (!canMoveTo(dragNode, parentId, outline?.children ?? [])) return;
    // 锚点 = 拖拽节点自身：插到自己前/后 = 原地放置（剔除后锚点消失会误回退末尾，需提前拦截）
    if (targetNodeId === dragNode.id) {
      setDragNodeId(null);
      setDragTarget(null);
      return;
    }
    // order 按 drop 瞬间的上下半重新判定（防异步渲染滞后）；剔除拖拽节点后计算（oracle M1 方案 B——
    // 同父重排锚点在下方时 pre-removal 数组会错位 1 位）
    const parentChildren = findNodeChildren(outline?.children ?? [], parentId) ?? [];
    const order = dropInsertOrder(
      parentChildren,
      { kind: insertSideFromEvent(e), nodeId: targetNodeId },
      dragNode.id,
    );
    // 原地放置（父不变且移动后位置不变）：不发请求，直接清理拖拽态（避免误导 toast「已移动」）
    if (isNoopDrop(outline?.children ?? [], dragNode.id, parentId, order)) {
      setDragNodeId(null);
      setDragTarget(null);
      return;
    }
    setBusy(true);
    try {
      await moveOutlineNode(dragNode.id, { parent_id: parentId, order });
      useUiStore.getState().showToast(`已移动《${dragNode.title}》`);
      await afterTreeChanged(parentId);
    } catch (err) {
      setError(describeOutlineError(errorCode(err)));
    } finally {
      setBusy(false);
      setDragNodeId(null);
      setDragTarget(null);
    }
  }

  /** 顶层容器 dragover（空白区）：排 root 末尾（保留原语义；scene 会被 canMoveTo 拒绝） */
  function handleRootDragOver(e: DragEvent) {
    const dragNode = dragNodeId ? findNode(outline?.children ?? [], dragNodeId) : null;
    if (!dragNode || !canMoveTo(dragNode, ROOT_NODE_ID, outline?.children ?? [])) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragTarget((prev) =>
      sameDragTarget(prev, { kind: "root-end" }) ? prev : { kind: "root-end" },
    );
  }

  function handleRootDragLeave(e: DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragTarget((prev) => (prev?.kind === "root-end" ? null : prev));
    }
  }

  /** 顶层容器 drop：排 root 末尾（剔除拖拽节点后计算 order；原地放置同样跳过） */
  async function handleRootDrop(e: DragEvent) {
    e.preventDefault();
    if (!dragNodeId) return;
    const dragNode = findNode(outline?.children ?? [], dragNodeId);
    if (!dragNode || !canMoveTo(dragNode, ROOT_NODE_ID, outline?.children ?? [])) return;
    // 末尾语义 = 剔除拖拽节点后的 children.length（拖自身到空白区 → order === 自身 index → noop）
    const order = dropInsertOrder(outline?.children ?? [], { kind: "end" }, dragNode.id);
    if (isNoopDrop(outline?.children ?? [], dragNode.id, ROOT_NODE_ID, order)) {
      setDragNodeId(null);
      setDragTarget(null);
      return;
    }
    setBusy(true);
    try {
      await moveOutlineNode(dragNode.id, { parent_id: ROOT_NODE_ID, order });
      useUiStore.getState().showToast(`已移动《${dragNode.title}》`);
      await afterTreeChanged();
    } catch (err) {
      setError(describeOutlineError(errorCode(err)));
    } finally {
      setBusy(false);
      setDragNodeId(null);
      setDragTarget(null);
    }
  }

  /** 软删直接执行（H2：不再弹二次确认）；OUTLINE_NODE_NOT_FOUND（已被 purge）→ 横幅 + 刷新树；其余错误 toast */
  async function handleDelete(node: OutlineNode) {
    if (selectedNodeId === node.id) setSelectedNodeId(null); // 决策 37：删除选中节点即清除选中
    try {
      const res = await deleteOutlineNode(node.id);
      const { children, relations, deltas } = res.cascaded;
      const parts: string[] = [];
      if (children > 0) parts.push(`${children} 个子节点`);
      if (relations > 0) parts.push(`${relations} 条关联`);
      if (deltas > 0) parts.push(`${deltas} 条变化记录`);
      useUiStore
        .getState()
        .showToast(`已移入回收站${parts.length > 0 ? `（含 ${parts.join("、")}）` : ""}`);
      await afterTreeChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code === "OUTLINE_NODE_NOT_FOUND") {
        setError(describeOutlineError("OUTLINE_NODE_NOT_FOUND"));
        await afterTreeChanged();
        return;
      }
      useUiStore
        .getState()
        .showToast(err instanceof ApiError ? err.message : "删除失败，请重试", "error");
    }
  }

  /** root 创建行（树容器内顶部；空态引导卡复用 RootCreateRow，见空态分支） */
  function renderRootCreateRow() {
    if (creatingAt?.parentId !== ROOT_NODE_ID) return null;
    return (
      <RootCreateRow
        className="mb-1"
        type={creatingAt.type}
        onTypeChange={(t) => setCreatingAt({ parentId: ROOT_NODE_ID, type: t })}
        value={createValue}
        onChange={setCreateValue}
        onKeyDown={handleCreateKeyDown}
        onCancel={cancelCreate}
      />
    );
  }

  /** 整树渲染（内部递归函数，闭包共享页面 state；S13.1 两行结构：
   * 第一行 = 折叠箭头 | 类型徽标（w-7 固定宽，第二行占位精确对齐）| 标题 | 伏笔标记 | 右端操作区（问AI/回收站）| 当前位置徽标；
   * 第二行 = 摘要（缩进对齐标题下方，默认显示、空不渲染、点击就地编辑）；
   * 拖拽：整节点块可拖，目标行上半/下半 → 插入指示线（accent 2px 绝对定位层，pointer-events-none 不拦截事件）；
   * 决策 37：行可聚焦（tabIndex=-1）承载选中/Enter/双击；单击行选中、双击行跳详情、选中后 Enter 新建子级 */
  function renderNodes(nodes: OutlineNode[], depth: number): ReactNode {
    return nodes.map((node) => {
      const hasChildren = node.type !== "scene" && (node.children?.length ?? 0) > 0;
      const isCollapsed = collapsed.has(node.id);
      const isCurrent = config?.currentPosition === node.id;
      const editingTitle = editing?.nodeId === node.id && editing.field === "title";
      const editingSummary = editing?.nodeId === node.id && editing.field === "summary";
      const insertBefore = dragTarget?.kind === "before" && dragTarget.nodeId === node.id;
      const insertAfter = dragTarget?.kind === "after" && dragTarget.nodeId === node.id;
      const isDragging = dragNodeId === node.id;
      const creatingHere = creatingAt?.parentId === node.id;
      const focused = node.id === focusedNodeId;
      const selected = selectedNodeId === node.id;
      return (
        <div key={node.id}>
          {/* 节点块（第一行 + 摘要第二行；整块可拖拽：编辑态/自身拖拽中禁用 draggable，避免文本选择与嵌套拖动）；
              data-node-id 为跨页定位锚点（U4：InfoBar 点击当前位置 → scrollIntoView 定位）；
              tabIndex=-1 使行可聚焦（决策 37：单击选中后按 Enter 触发新建子级 onKeyDown） */}
          <div
            data-node-id={node.id}
            draggable={!editingTitle && !editingSummary && !isDragging && !busy}
            tabIndex={-1}
            onDragStart={(e) => handleDragStart(e, node)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, node.id)}
            onDragLeave={(e) => handleDragLeave(e, node.id)}
            onDrop={(e) => void handleDrop(e, node.id)}
            onClick={(e) => handleRowClick(e, node)}
            onDoubleClick={(e) => handleRowDoubleClick(e, node)}
            onKeyDown={(e) => handleRowKeyDown(e, node)}
            className={cn(
              "relative cursor-grab rounded-md px-2 py-1 transition-colors hover:bg-muted/60 active:cursor-grabbing",
              node.id === highlightedNodeId && "bg-accent/40", // 新建成功临时高亮（3s）
              focused && "bg-accent ring-1 ring-ring ring-inset", // 跨页定位临时高亮（U4，3s 消失）
              isDragging && "opacity-50",
              selected && "bg-primary/10 ring-1 ring-primary/30 ring-inset", // 选中态（决策 37：primary 淡染 + 描边，区别于临时高亮）
            )}
            style={{ paddingLeft: depth * 20 + 8 }}
            title="拖动到目标行即可移动（上半=插前、下半=插后）"
          >
            {/* 第一行：折叠箭头 | 类型徽标 | 标题 | 伏笔标记 | 右端操作区（问AI/回收站）| 当前位置徽标（O2 起：操作区 ml-auto 右端对齐，时间戳显示已移除；决策 37：详情/＋新建按钮移除） */}
            <div className="flex items-center gap-2">
              {hasChildren ? (
                <button
                  type="button"
                  className="w-4 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => toggleCollapsed(node.id)}
                  aria-label={isCollapsed ? "展开" : "折叠"}
                >
                  {isCollapsed ? "▸" : "▾"}
                </button>
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <span className="flex h-5 w-7 shrink-0 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                {TYPE_LABEL[node.type]}
              </span>
              {/* 标题：点击就地编辑（Enter 保存 / Esc 取消 / 失焦保存）；stopPropagation 隔离——
                  单击标题 = 编辑而非选中（决策 37 冲突设计） */}
              {editingTitle ? (
                inlineInput(
                  editingValue,
                  setEditingValue,
                  handleEditKeyDown(node, "title"),
                  () => void commitEdit(node, "title"),
                  "标题",
                )
              ) : (
                <span
                  className={cn(
                    "min-w-0 cursor-text truncate text-sm hover:underline",
                    focused ? "text-accent-foreground" : "text-foreground", // 定位高亮时切换前景色保对比度（深色主题 bg-accent 是暗底）
                  )}
                  title="点击编辑标题"
                  onClick={(e) => {
                    e.stopPropagation();
                    startEdit(node, "title");
                  }}
                >
                  {node.title}
                </span>
              )}
              {/* 伏笔标记（S9.2）：title 行尾紧凑徽标——plants/advances/resolves 图标 + title tooltip
                  伏笔名（多标记按 lib/outline-hooks 排序排列）；标记随行渲染：折叠父行自身标记仍显示、
                  子树标记随展开可见（数据为节点自身关系，不聚合后代）；加载失败 hookMarks=null 不渲染 */}
              {hookMarks !== null && (hookMarks.get(node.id)?.length ?? 0) > 0 && (
                <span className="flex shrink-0 items-center gap-0.5">
                  {(hookMarks.get(node.id) ?? []).map((mark) => (
                    <NodeHookMarkBadge key={`${mark.relationType}-${mark.hookId}`} mark={mark} />
                  ))}
                </span>
              )}
              {/* 操作区（决策 37 修订）：右端对齐（ml-auto）；固定顺序 问AI → 回收站 → 当前位置徽标；
                  详情/＋ 就地新建按钮已移除——详情改双击、新建改选中后 Enter */}
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {/* 行级「带上下文问 AI」（决策 35 修订：方案 A 显式有焦点入口；任务卡 1+4 决策 40 另行移除） */}
                <AskAiButton
                  focus={{ focus_node_id: node.id }}
                  title={`带节点「${node.title}」问 AI`}
                />
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                  title="移入回收站"
                  aria-label="移入回收站"
                  onClick={() => void handleDelete(node)}
                >
                  <Trash2 className="size-3.5" />
                </button>
                {isCurrent && (
                  <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground">
                    当前位置
                  </span>
                )}
              </span>
            </div>
            {/* 第二行：摘要（缩进对齐标题下方——w-4/w-7 占位与第一行同列；默认显示、空不渲染；点击就地编辑） */}
            {editingSummary || node.summary ? (
              <div className="mt-0.5 flex items-center gap-2">
                <span className="w-4 shrink-0" />
                <span className="w-7 shrink-0" />
                {editingSummary ? (
                  inlineInput(
                    editingValue,
                    setEditingValue,
                    handleEditKeyDown(node, "summary"),
                    () => void commitEdit(node, "summary"),
                    "摘要",
                  )
                ) : (
                  <span
                    className="min-w-0 cursor-text truncate text-xs text-muted-foreground hover:underline"
                    title="点击编辑摘要"
                    onClick={(e) => {
                      e.stopPropagation(); // 摘要单击 = 编辑而非选中（决策 37 冲突设计，同标题）
                      startEdit(node, "summary");
                    }}
                  >
                    {node.summary}
                  </span>
                )}
              </div>
            ) : null}
            {/* 插入指示线（S13.1）：目标行上边缘（插前）/下边缘（插后），accent 2px；绝对定位层不遮挡内容 */}
            {insertBefore && (
              <span className="pointer-events-none absolute inset-x-0 -top-px h-0.5 rounded bg-accent" />
            )}
            {insertAfter && (
              <span className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 rounded bg-accent" />
            )}
          </div>
          {/* 子节点递归渲染（折叠态不渲染） */}
          {hasChildren && !isCollapsed && <div>{renderNodes(node.children ?? [], depth + 1)}</div>}
          {/* 就地新建输入行（父 children 末尾；父折叠时 startCreate 已自动展开） */}
          {creatingHere && (
            <div
              className="flex items-center gap-2 rounded-md px-2 py-1"
              style={{ paddingLeft: (depth + 1) * 20 + 8 }}
            >
              <span className="w-4 shrink-0" />
              <span className="flex h-5 w-7 shrink-0 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                {TYPE_LABEL[creatingAt.type]}
              </span>
              {inlineInput(
                createValue,
                setCreateValue,
                handleCreateKeyDown,
                cancelCreate,
                `新${TYPE_LABEL[creatingAt.type]}标题，Enter 创建`,
              )}
            </div>
          )}
        </div>
      );
    });
  }

  /** 全部展开/折叠切换 */
  function toggleAllCollapse() {
    if (!outline) return;
    if (collapsed.size > 0) setCollapsed(new Set());
    else setCollapsed(new Set(collectParentIds(outline.children)));
  }

  return (
    <section>
      {/* 标题区：操作工具条 */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">大纲</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            type="button"
            onClick={toggleAllCollapse}
            disabled={!outline || outline.children.length === 0}
          >
            {collapsed.size > 0 ? "全部展开" : "全部折叠"}
          </Button>
          <Button type="button" onClick={() => startCreate(ROOT_NODE_ID, "volume")}>
            + 新建
          </Button>
        </div>
      </div>

      {/* 页级错误横幅（layout.md §4.3：destructive token 类） */}
      {error && <div className={cn(errorBannerClass, "mb-3")}>{error}</div>}

      {noProject ? (
        /* 未打开项目：引导回首页（侧栏无项目可点的现状接受项，S1.6 文档已说明） */
        <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">未打开项目，无法编辑大纲</p>
          <a
            href="#/"
            className="mt-2 inline-block text-sm text-muted-foreground underline hover:text-foreground"
          >
            回到首页打开或创建书籍
          </a>
        </div>
      ) : outlineLoading && outline === null ? (
        /* 加载骨架 */
        <div className="space-y-2 rounded-md border border-border p-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className={cn(skeletonClass, "h-5")}
              style={{ width: `${92 - (i % 3) * 24}%`, marginLeft: (i % 3) * 20 }}
            />
          ))}
        </div>
      ) : outline === null ? (
        /* 加载失败（loadOutline 静默吞错后的兜底呈现） */
        <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
          大纲加载失败
          <Button
            variant="outline"
            className="ml-3"
            type="button"
            onClick={() => setLoadAttempted(false)}
          >
            重试
          </Button>
        </div>
      ) : outline.children.length === 0 ? (
        /* 空态：就地新建（输入行内嵌引导卡，替代原「新建第一卷」弹窗按钮） */
        creatingAt?.parentId === ROOT_NODE_ID ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">输入第一卷标题，Enter 创建</p>
            <div className="mx-auto mt-4 max-w-sm">
              <RootCreateRow
                type={creatingAt.type}
                onTypeChange={(t) => setCreatingAt({ parentId: ROOT_NODE_ID, type: t })}
                value={createValue}
                onChange={setCreateValue}
                onKeyDown={handleCreateKeyDown}
                onCancel={cancelCreate}
              />
            </div>
          </div>
        ) : (
          <EmptyState
            action={
              <Button type="button" onClick={() => startCreate(ROOT_NODE_ID, "volume")}>
                新建第一卷
              </Button>
            }
          >
            大纲还是空的，先建第一卷
            <span className="mt-1 block text-xs text-muted-foreground/70">
              大纲是三层结构：卷 → 章 → 场景
            </span>
          </EmptyState>
        )
      ) : (
        /* 整树渲染（容器同时是 root 拖放目标：拖到空白处 = 排顶层末尾；scene 会被 canMoveTo 拒绝） */
        <div
          className={cn(
            "rounded-md border border-border p-2",
            dragTarget?.kind === "root-end" && "ring-1 ring-accent ring-inset",
          )}
          onClick={() => setSelectedNodeId(null)} // 决策 37：点击空白区清除选中（行点击已 stopPropagation 隔离）
          onDragOver={handleRootDragOver}
          onDragLeave={handleRootDragLeave}
          onDrop={(e) => void handleRootDrop(e)}
        >
          {renderRootCreateRow()}
          {renderNodes(outline.children, 0)}
        </div>
      )}
    </section>
  );
}
