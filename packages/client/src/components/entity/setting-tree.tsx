// 设定树形视图（决策 42，2026-08 批次十任务卡 6）：实体关系页「设定」tab 的交互式树形视图，
// 与原「设定树」tab（批次四 I4 只读树）合并——#/entities/setting 即树形视图，原 #/entities/setting-tree
// 路由已移除（main.tsx 重定向到设定 tab）。
// 契约：doc/ui/pages/entity-list.md「设定 Tab（树形视图）」——全量 setting（limit 200 + 名称排序）+
// 全量 belongs_to 层级边 → buildSettingTree 组装递归树；行级交互对齐大纲（决策 37/38 模式，layout.md §4.5）：
//   - 折叠/展开：父节点 ▾/▸ 切换 + 顶栏「全部展开 / 全部折叠」（全部折叠 = 仅保留根级）
//   - 行内编辑（点击标题）：Enter 确认 PUT /entity/setting/:id { name }、Esc 取消、失焦保存
//   - Enter 新建子级：选中节点按 Enter → 就地输入行出现在该节点子级末尾（POST /entity/setting +
//     POST /relation belongs_to 挂父；子级类型 = 设定）；root 级「+ 新建」输入行无父
//   - 双击详情：双击行 → #/entities/setting/:id（详情页含层级区块与全部关联）
//   - 行级只留删除：行尾 Trash2 → 直接软删（H2 不弹确认）→ DELETE /entity/setting/:id
//   - 拖拽调整层级：HTML5 DnD **嵌套语义**（拖到行上 = 成为该行子级、拖到空白区 = 移为顶层根）——
//     belongs_to 防环沿用决策 30（canMoveSettingTo 客户端预校验 + 服务端兜底 400 VALIDATION_ERROR）；
//     改父 = 先建新边后删旧边（对齐 EntityDetail.handleSetParent 先建后删防数据丢失）；
//     **设定无 sort_order（API 约束，勿改数据模型）**——同级顺序 = 名称序，同父拖拽为 no-op
//   - 筛选 = 搜索 + 标签（树内过滤 filterSettingTree：命中节点及祖先链保留，非命中子树隐藏）；无分页
// 溢出防御：设定 > 200 截断提示 + 父截断提升为根（buildSettingTree 既有语义）。
// 样式全 token 类（layout.md §3）；文字按钮带边框（H4）；决策 40：行级右键菜单（RowContextMenu——
//   注入会话上下文 + 建立关联）替代行级问 AI 入口（本视图原本无 AskAiButton，右键菜单补齐）。
import { useEffect, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { RowContextMenu } from "./row-context-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { errorBannerClass, skeletonClass } from "@/lib/styles";
import {
  ApiError,
  createEntity,
  createRelation,
  deleteEntity,
  listEntities,
  listRelations,
  moveSetting,
  updateEntity,
} from "../../lib/api";
import {
  buildSettingTree,
  canMoveSettingTo,
  expandableSettingNodeIds,
  filterSettingTree,
  findSettingNode,
  nodeTags,
  sortSettingChildren,
  type SettingSortMode,
  type SettingTreeNode,
} from "../../lib/setting-tree";
import { cn } from "../../lib/utils";
import { navigate } from "../../hooks/use-route";
import { useUiStore } from "../../stores/ui";

/** 设定树拉取上限（listEntities limit 最大 200；超量截断提示 + 孤儿提升防御） */
const TREE_SETTING_LIMIT = 200;

/** 拖拽目标（决策 42 嵌套语义 + 决策 46 行间插入线）：
 * row.on = 拖到行中段（成为其子级）；row.before/after = 拖到行上/下方插入线（**手动模式**同级重排）；
 * root = 拖到空白区（移为顶层根） */
type SettingDragTarget =
  { kind: "row"; id: string; placement: "before" | "on" | "after" } | { kind: "root" } | null;

/** 就地新建目标：parentId null = root 顶层（无父）；非 null = 该节点子级末尾 */
type CreatingState = { parentId: string | null } | null;

export function SettingTreeView({ reloadKey }: { reloadKey: number }) {
  const [roots, setRoots] = useState<SettingTreeNode[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [hasOrphanEdges, setHasOrphanEdges] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 内部重载计数（操作成功后刷新 / 错误重试） */
  const [tick, setTick] = useState(0);
  /** 折叠节点 id 集合（缺省空 = 全展开；重拉后指向已删 id 的残留无害、不清空） */
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  /** 选中节点 id（决策 42：单击行选中，选中后按 Enter 新建子级）；null = 无选中 */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 行内编辑（点击标题）目标 id；null = 未编辑 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  /** 就地新建目标（null = 未新建；{ parentId: null } = root 顶层） */
  const [creatingAt, setCreatingAt] = useState<CreatingState>(null);
  const [createValue, setCreateValue] = useState("");
  /** 新创建节点高亮（3s 自动消失） */
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  /** 拖拽中的节点 id；null = 无 */
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  /** 拖拽目标（悬停高亮 + drop 落点）；null = 无有效目标 */
  const [dragTarget, setDragTarget] = useState<SettingDragTarget>(null);
  /** 提交在途（防并发；拖拽/编辑/新建共用） */
  const [busy, setBusy] = useState(false);
  /** 搜索框即时值（防抖输入） */
  const [qInput, setQInput] = useState("");
  /** 防抖后的查询关键词（空 = 不过滤） */
  const [q, setQ] = useState("");
  /** 标签筛选（决策 42 树内过滤；"" = 全部） */
  const [tagFilter, setTagFilter] = useState("");
  /** 标签筛选候选（聚合既有设定 tags；失败静默——仅无下拉候选，不影响树） */
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  /** 排序方式（决策 46，2026-08 批次十三）：name 默认（原行为）；created 创建时间；manual 手动（重排入口） */
  const [sortMode, setSortMode] = useState<SettingSortMode>("name");

  /** 操作成功后刷新（tick +1 触发加载 effect；保留旧数据渲染，避免骨架闪烁） */
  function reload() {
    setTick((t) => t + 1);
  }

  // 数据加载：全量 setting + 全量 belongs_to 层级边 → buildSettingTree 组装树；
  // 同时产出关系 id 映射（删旧边用）与标签候选（筛选下拉）。重拉期间保留旧数据渲染
  // （roots 不清空——操作后刷新不闪骨架，仅首载 roots === null 显示骨架）。
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    (async () => {
      try {
        const [settingRes, edgesRes] = await Promise.all([
          listEntities("setting", { limit: TREE_SETTING_LIMIT, sort: "name" }),
          listRelations({
            source_type: "setting",
            target_type: "setting",
            relation_type: "belongs_to",
            depth: 1,
          }),
        ]);
        if (cancelled) return;
        const edges = edgesRes.relations.map((r) => ({
          childId: r.sourceId,
          parentId: r.targetId,
        }));
        const tree = buildSettingTree(
          settingRes.items.map((s) => ({
            id: s.id,
            name: s.name,
            category: s.summary.category,
            summary: s.summary,
            parentId: s.parentId,
            createdAt: s.createdAt,
            // 决策 46：手动排序位（稀疏——NULL 不出现，节点侧沉底按名称）
            ...(s.sortOrder !== undefined ? { sortOrder: s.sortOrder } : {}),
          })),
          edges,
        );
        setRoots(tree.roots);
        setHasOrphanEdges(tree.hasOrphanEdges);
        setTruncated(settingRes.total > TREE_SETTING_LIMIT); // total 为准（截断提示）
        // 标签候选（决策 31 统一字段 data.tags → summary.tags）
        const tags = new Set<string>();
        for (const item of settingRes.items) {
          if (Array.isArray(item.summary.tags)) {
            for (const t of item.summary.tags) {
              if (typeof t === "string" && t !== "") tags.add(t);
            }
          }
        }
        setTagOptions(Array.from(tags).sort());
        // 数据重拉后旧 id 可能失效（被删/改父）：清理选中/编辑/新建态防残留
        setSelectedId(null);
        setEditingId(null);
        setEditingValue("");
        setCreatingAt(null);
        setCreateValue("");
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, tick]);

  // 搜索防抖 300ms（与列表页搜索同节奏）
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // 新节点高亮自动消失（3s；每次设置高亮重开定时器）
  useEffect(() => {
    if (highlightedId === null) return;
    const t = setTimeout(() => setHighlightedId(null), 3000);
    return () => clearTimeout(t);
  }, [highlightedId]);

  // 选中节点失效清理（树重拉后选中节点不存在 → 清除选中，防残留）
  useEffect(() => {
    if (selectedId === null || roots === null) return;
    if (!findSettingNode(roots, selectedId)) setSelectedId(null);
  }, [roots, selectedId]);

  // ============ 折叠/展开 ============

  function toggleCollapse(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 展开节点（collapsed 中移除该 id） */
  function expand(id: string) {
    setCollapsedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  /** 全部折叠：收集当前可见（过滤后）树的所有非叶子 id，仅保留根级 */
  function collapseAll() {
    if (roots === null) return;
    setCollapsedIds(new Set(expandableSettingNodeIds(filterSettingTree(roots, q, tagFilter))));
  }

  /** 全部展开：清空折叠集合 */
  function expandAll() {
    setCollapsedIds(new Set());
  }

  // ============ 行内编辑（点击标题：Enter 确认 / Esc 取消 / 失焦保存） ============

  function startEdit(node: SettingTreeNode) {
    cancelCreate();
    setSelectedId(null); // 编辑态与选中态互斥（编辑输入框接管 Enter）
    setEditingId(node.id);
    setEditingValue(node.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingValue("");
  }

  /** 提交编辑（悲观提交）：trim 后空/未变 → 退出不发请求；成功退出编辑态 + 刷新；
   * 失败按错误码分流（对齐大纲 editFailureRecovery 语义）：
   * - ENTITY_NOT_FOUND（设定被并发删除/purge）→ 放弃编辑 + 重拉树同步视图（编辑态可退出）
   * - 其余错误 → 保持编辑态 + 保留输入值（输入框已失焦，点击即可修正重试） */
  async function commitEdit(node: SettingTreeNode) {
    if (busy || editingId !== node.id) return;
    const name = editingValue.trim();
    if (name === "" || name === node.name) {
      cancelEdit();
      return;
    }
    setBusy(true);
    try {
      await updateEntity("setting", node.id, { name });
      useUiStore.getState().showToast("已保存");
      cancelEdit();
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === "ENTITY_NOT_FOUND") {
        // 设定已不存在（被删除/purge）：放弃编辑 + 重拉树（对齐大纲 abandon 分支）
        cancelEdit();
        useUiStore.getState().showToast("设定已不存在，列表已刷新", "error");
        reload();
        return;
      }
      // 其余错误：保持编辑态 + 保留输入值（可修正后重试）
      useUiStore
        .getState()
        .showToast(
          err instanceof ApiError ? `保存失败：${err.message}` : "保存失败，请重试",
          "error",
        );
    } finally {
      setBusy(false);
    }
  }

  function handleEditKeyDown(node: SettingTreeNode) {
    return (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault(); // 对齐大纲：防未来被包进 form 触发提交
        void commitEdit(node);
      } else if (e.key === "Escape") {
        cancelEdit();
      }
    };
  }

  // ============ 就地新建（Enter 子级 / 工具栏 root 级）：Enter 创建 / Esc 或失焦取消 ============

  function startCreate(parentId: string | null) {
    cancelEdit();
    setSelectedId(null); // 新建态与选中态互斥（创建输入框接管 Enter）
    setCreatingAt({ parentId });
    setCreateValue("");
    if (parentId !== null) expand(parentId); // 新建输入显示在父子级末尾
  }

  function cancelCreate() {
    setCreatingAt(null);
    setCreateValue("");
  }

  /** 空值 = 取消（不误建）；成功 → 展开父 + 高亮新节点 + 刷新；带父补建 belongs_to 关系
   * （失败不阻塞创建，toast 提示后可在详情页重设——同 EntityList 既有语义） */
  async function commitCreate() {
    if (creatingAt === null) return;
    const name = createValue.trim();
    const { parentId } = creatingAt;
    if (!name) {
      cancelCreate();
      return;
    }
    cancelCreate();
    try {
      const res = await createEntity("setting", { name });
      if (parentId !== null) {
        try {
          await createRelation({
            source_type: "setting",
            source_id: res.id,
            target_type: "setting",
            target_id: parentId,
            relation_type: "belongs_to",
          });
        } catch {
          useUiStore
            .getState()
            .showToast(`已创建《${name}》，但上级设定关联失败，可进详情页重新设置`, "error");
          reload();
          return;
        }
      }
      useUiStore.getState().showToast(`已创建设定《${name}》`);
      if (parentId !== null) expand(parentId);
      setHighlightedId(res.id);
      reload();
    } catch (err) {
      useUiStore
        .getState()
        .showToast(err instanceof ApiError ? err.message : "创建失败，请重试", "error");
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

  // ============ 选中与行级交互（决策 42：单击选中 / Enter 新建子级 / 双击详情） ============
  // 交互冲突设计（对齐大纲决策 37）：
  //   标题单击 = 行内编辑（onClick stopPropagation 隔离，不触发行选中）；
  //   行区（非标题/按钮）单击 = 选中；行区双击 = 详情。
  // 双击会先触发两次单击——第一击仅设置选中高亮（无害），第二击后 dblclick 才跳转；
  // 双击标题时第一击已把 span 换成输入框，dblclick 的 e.target 是输入框（closest("input") 拦截），
  // 极端时序下 target 仍是标题 span 时由 editing 守卫拦截——双击标题 = 编辑，不误跳详情。

  /** 选中节点：与编辑/新建态互斥 */
  function selectNode(id: string) {
    cancelEdit();
    cancelCreate();
    setSelectedId(id);
  }

  /** 行单击：非标题/按钮/输入框区 → 选中该节点；交互元素 stopPropagation（oracle 修复：
   * 行内按钮/输入框点击不冒泡到容器，避免清除选中） */
  function handleRowClick(e: MouseEvent<HTMLDivElement>, node: SettingTreeNode) {
    if ((e.target as HTMLElement).closest("button, input, a")) {
      e.stopPropagation();
      return;
    }
    e.stopPropagation(); // 阻止冒泡到树容器（容器 onClick 清除选中）
    selectNode(node.id);
  }

  /** 行双击：双击 = 详情（#/entities/setting/:id）；按钮区/编辑态不触发（同大纲冲突防护） */
  function handleRowDoubleClick(e: MouseEvent<HTMLDivElement>, node: SettingTreeNode) {
    if ((e.target as HTMLElement).closest("button, input, a")) return;
    if (editingId === node.id) return;
    navigate(`/entities/setting/${node.id}`);
  }

  /** 行键盘：选中节点按 Enter → 就地新建子级（子级类型 = 设定）；编辑态/新建态/拖拽中/busy 禁用；
   * 仅行 div 自身聚焦时响应（oracle 修复：子元素按钮/输入框聚焦时交给子元素处理） */
  function handleRowKeyDown(e: KeyboardEvent<HTMLDivElement>, node: SettingTreeNode) {
    if (e.key !== "Enter") return;
    if (e.target !== e.currentTarget) return;
    if (editingId !== null || creatingAt !== null || dragNodeId !== null || busy) return;
    if (selectedId !== node.id) return;
    e.preventDefault();
    startCreate(node.id);
  }

  // ============ 拖拽调整层级（决策 42 嵌套语义：拖到行 = 成为其子级；空白区 = 移为根） ============
  // belongs_to 防环沿用决策 30（canMoveSettingTo 客户端预校验 + 服务端兜底）；改父 = 先建新边
  // 后删旧边（对齐 EntityDetail.handleSetParent）；设定无 sort_order，同父拖拽为 no-op。

  function handleDragStart(e: DragEvent, node: SettingTreeNode) {
    e.dataTransfer.setData("text/plain", node.id);
    e.dataTransfer.effectAllowed = "move";
    setDragNodeId(node.id);
    setDragTarget(null);
  }

  function clearDrag() {
    setDragNodeId(null);
    setDragTarget(null);
  }

  /** 行 dragover（决策 46 三分区）：行上/下方 1/3 = 行间插入线（**手动模式**同级重排，目标组 =
   * 该行的同级组 → 新父 = 该行父）；中段 = 调层级（成为该行子级，canMoveSettingTo 预校验）；
   * stopPropagation 防冒泡到容器（容器空白区 = 移根语义，行内不触发） */
  function handleRowDragOver(e: DragEvent, node: SettingTreeNode) {
    e.stopPropagation();
    const dragNode = dragNodeId ? findSettingNode(roots ?? [], dragNodeId) : null;
    if (!dragNode || dragNode.id === node.id) return;
    // 三分区：pointerY 相对行高比例 < 1/3 → before；> 2/3 → after；中段 → on（调层级）
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / Math.max(1, rect.height);
    const placement: "before" | "on" | "after" =
      sortMode === "manual" && ratio < 1 / 3
        ? "before"
        : sortMode === "manual" && ratio > 2 / 3
          ? "after"
          : "on";
    // on（调层级）：目标父 = 该行（防环/自指沿用决策 30）；before/after（同级重排）：目标组 = 该行同级组
    // （新父 = 该行父——可能跨父重排，同样防环校验）
    const targetParentId = placement === "on" ? node.id : (node.parentId ?? null);
    if (!canMoveSettingTo(dragNode, targetParentId, roots ?? [])) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragTarget((prev) =>
      prev?.kind === "row" && prev.id === node.id && prev.placement === placement
        ? prev
        : { kind: "row", id: node.id, placement },
    );
  }

  /** 行 dragleave：仅真正离开该行才清除该行的目标高亮（子元素间移动不触发） */
  function handleRowDragLeave(e: DragEvent, node: SettingTreeNode) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragTarget((prev) => (prev?.kind === "row" && prev.id === node.id ? null : prev));
    }
  }

  /** 行 drop：按悬停分区执行（on = 改父；before/after = 同级重排） */
  async function handleRowDrop(e: DragEvent, node: SettingTreeNode) {
    e.stopPropagation();
    e.preventDefault();
    const target = dragTarget;
    if (target?.kind !== "row" || target.id !== node.id) return;
    await executeDrop(target);
  }

  /** 容器（空白区）dragover：移到根（无上级） */
  function handleRootDragOver(e: DragEvent) {
    const dragNode = dragNodeId ? findSettingNode(roots ?? [], dragNodeId) : null;
    if (!dragNode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragTarget((prev) => (prev?.kind === "root" ? prev : { kind: "root" }));
  }

  function handleRootDragLeave(e: DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragTarget((prev) => (prev?.kind === "root" ? null : prev));
    }
  }

  /** 容器 drop：空白区 = 移为顶层根 */
  async function handleRootDrop(e: DragEvent) {
    e.preventDefault();
    await executeDrop({ kind: "root" });
  }

  /** 同级组（手动序）辅助：某节点的同级列表 = 父的子级 / 根级（决策 46 排序后的展示序） */
  function siblingsOf(node: SettingTreeNode): SettingTreeNode[] {
    const parentNode =
      node.parentId !== undefined ? findSettingNode(roots ?? [], node.parentId) : null;
    return sortSettingChildren(parentNode ? parentNode.children : (roots ?? []), "manual");
  }

  /** 拖放执行（决策 46 复合端点）：on = 改父（append 到新父子级末尾）；before/after = 同级重排
   * （含跨父重排——服务端事务内改父 + 组内定序一次提交）；root = 移为顶层根。
   * 目标位置无变化 → no-op（不发请求）。 */
  async function executeDrop(
    target: Extract<SettingDragTarget, { kind: "row" }> | { kind: "root" },
  ) {
    if (dragNodeId === null || busy) return;
    const dragNode = findSettingNode(roots ?? [], dragNodeId);
    if (!dragNode) return;
    setBusy(true);
    try {
      if (target.kind === "root") {
        // 已是根 → 原地放置（no-op）
        if (dragNode.parentId === undefined) {
          clearDrag();
          return;
        }
        await moveSetting(dragNode.id, { parentId: null });
        useUiStore.getState().showToast("已移至顶层（无上级）");
      } else if (target.placement === "on") {
        // 已是该行子级（同父）→ no-op
        if (dragNode.parentId === target.id) {
          clearDrag();
          return;
        }
        await moveSetting(dragNode.id, { parentId: target.id });
        useUiStore.getState().showToast("已调整层级");
      } else {
        const targetNode = findSettingNode(roots ?? [], target.id);
        if (!targetNode) return;
        const siblings = siblingsOf(targetNode); // 含 dragNode（同组时）
        const targetIdx = siblings.findIndex((s) => s.id === target.id);
        const dragIdx = siblings.findIndex((s) => s.id === dragNode.id);
        // 服务端 order 语义 = 移除 dragNode 后的组内位置：目标行在组内的下标需扣除
        // dragNode 自身占位（dragIdx < 0 = 跨组，目标组不含 dragNode，下标即最终位）
        const targetPost =
          dragIdx < 0 ? targetIdx : targetIdx > dragIdx ? targetIdx - 1 : targetIdx;
        const order = target.placement === "before" ? targetPost : targetPost + 1;
        // 同位拖放（同组且重插位置 = 当前位置）→ no-op
        if (dragIdx >= 0 && order === dragIdx) {
          clearDrag();
          return;
        }
        await moveSetting(dragNode.id, { parentId: targetNode.parentId ?? null, order });
        useUiStore.getState().showToast("已调整顺序");
      }
      reload();
    } catch (err) {
      useUiStore
        .getState()
        .showToast(
          err instanceof ApiError ? `调整失败：${err.message}` : "调整失败，请重试",
          "error",
        );
    } finally {
      setBusy(false);
      clearDrag();
    }
  }

  /** 手动模式 ↑↓ 箭头（决策 46）：同级组内上移/下移一位（moveSetting order = 目标位） */
  async function moveSiblingByArrow(node: SettingTreeNode, delta: -1 | 1) {
    if (busy) return;
    const siblings = siblingsOf(node);
    const idx = siblings.findIndex((s) => s.id === node.id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= siblings.length) return; // 边界（首/尾）不动作
    setBusy(true);
    try {
      await moveSetting(node.id, { parentId: node.parentId ?? null, order: target });
      useUiStore.getState().showToast("已调整顺序");
      reload();
    } catch (err) {
      useUiStore
        .getState()
        .showToast(
          err instanceof ApiError ? `调整失败：${err.message}` : "调整失败，请重试",
          "error",
        );
    } finally {
      setBusy(false);
    }
  }

  // ============ 软删（H2：直接执行不弹确认） ============

  async function handleDelete(node: SettingTreeNode) {
    if (selectedId === node.id) setSelectedId(null); // 删除选中节点即清除选中
    try {
      const res = await deleteEntity("setting", node.id);
      const parts: string[] = [];
      if (res.cascaded.relations > 0) parts.push(`${res.cascaded.relations} 条关联`);
      if (res.cascaded.deltas > 0) parts.push(`${res.cascaded.deltas} 条变更记录`);
      useUiStore
        .getState()
        .showToast(
          `已移入回收站，可随时还原${parts.length > 0 ? `（含 ${parts.join("、")}）` : ""}`,
        );
      reload();
    } catch (err) {
      useUiStore
        .getState()
        .showToast(err instanceof ApiError ? err.message : "删除失败，请重试", "error");
    }
  }

  // ============ 渲染 ============

  const filterActive = q !== "" || tagFilter !== "";

  /** 就地输入框（行内编辑/新建共用样式；autoFocus 进入即聚焦） */
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
        maxLength={100}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded border border-border bg-card px-1.5 py-0.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    );
  }

  /** 整树递归渲染（闭包共享页面 state；决策 42 行级交互：单击选中 / Enter 新建子级 / 双击详情 /
   * 点击标题行内编辑 / 拖拽嵌套改层级 / 行尾只留删除；决策 46：同级按排序方式重排 + 手动模式
   * ↑↓ 箭头与行间插入线重排） */
  function renderNodes(nodes: SettingTreeNode[], depth: number): ReactNode {
    // 决策 46：每级同级组按当前排序方式重排（name/created/manual；不改原树）
    const ordered = sortSettingChildren(nodes, sortMode);
    return ordered.map((node) => {
      const hasChildren = node.children.length > 0;
      const isCollapsed = collapsedIds.has(node.id);
      const editing = editingId === node.id;
      const selected = selectedId === node.id;
      const creatingHere = creatingAt?.parentId === node.id;
      const isDragging = dragNodeId === node.id;
      const isDragTarget =
        dragTarget?.kind === "row" && dragTarget.id === node.id && dragTarget.placement === "on";
      const isDragBefore =
        dragTarget?.kind === "row" &&
        dragTarget.id === node.id &&
        dragTarget.placement === "before";
      const isDragAfter =
        dragTarget?.kind === "row" && dragTarget.id === node.id && dragTarget.placement === "after";
      const highlighted = highlightedId === node.id;
      const tags = nodeTags(node);
      // 手动模式箭头边界（决策 46：同级组首/尾禁用）
      const siblingIdx = ordered.findIndex((s) => s.id === node.id);
      const canUp = sortMode === "manual" && siblingIdx > 0;
      const canDown = sortMode === "manual" && siblingIdx >= 0 && siblingIdx < ordered.length - 1;
      // 节点行根 props（右键菜单 trigger 与普通 div 共用）
      const rowProps = {
        draggable: !editing && !isDragging && !busy,
        tabIndex: -1,
        onDragStart: (e: DragEvent) => handleDragStart(e, node),
        onDragEnd: clearDrag,
        onDragOver: (e: DragEvent) => handleRowDragOver(e, node),
        onDragLeave: (e: DragEvent) => handleRowDragLeave(e, node),
        onDrop: (e: DragEvent) => void handleRowDrop(e, node),
        onClick: (e: MouseEvent<HTMLDivElement>) => handleRowClick(e, node),
        onDoubleClick: (e: MouseEvent<HTMLDivElement>) => handleRowDoubleClick(e, node),
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => handleRowKeyDown(e, node),
        className: cn(
          // 决策 45（批次十三）：两行式——第一行 箭头|名称|计数|行尾区，第二行描述摘要（弱化）
          // group：手动模式悬停显示 ↑↓ 箭头（决策 46）
          "group relative flex flex-col rounded-md py-1 pr-1 transition-colors hover:bg-muted/60",
          highlighted && "bg-accent/40", // 新建成功临时高亮（3s）
          isDragTarget && "bg-accent/40 ring-1 ring-accent ring-inset", // 拖拽目标（将成其子级）
          isDragging && "opacity-50",
          selected && "bg-primary/10 ring-1 ring-primary/30 ring-inset", // 选中态
        ),
        style: { paddingLeft: `${depth * 16 + 8}px` },
        title:
          sortMode === "manual"
            ? "拖到行中段 = 成为其子级；拖到行间插入线 = 同级重排；拖到空白区 = 移为顶层"
            : "拖到行上 = 成为其子级；拖到空白区 = 移为顶层",
      };
      // 节点行内容（折叠箭头 + 名称 + 标签 + 子设定数 + 行尾删除；决策 45 批次十三：
      // 行下方追加描述摘要行——summary.description 截断 100（服务端），hover title 查看完整）
      const rowDescription =
        typeof node.summary?.description === "string" && node.summary.description !== ""
          ? node.summary.description
          : null;
      const rowChildren = (
        <>
          {/* 决策 46 行间插入线（手动模式拖拽：before/after 目标高亮） */}
          {isDragBefore && <div className="absolute inset-x-1 top-0 h-0.5 rounded bg-primary" />}
          {isDragAfter && <div className="absolute inset-x-1 bottom-0 h-0.5 rounded bg-primary" />}
          <div className="flex min-w-0 items-center gap-1.5">
            {/* 折叠箭头（叶子占位保缩进对齐）；点击切展开态，不选中/不跳转 */}
            <button
              type="button"
              aria-label={hasChildren ? (isCollapsed ? "展开" : "折叠") : undefined}
              className={cn(
                "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground",
                !hasChildren && "invisible",
              )}
              onClick={() => toggleCollapse(node.id)}
              disabled={!hasChildren}
            >
              <svg
                viewBox="0 0 16 16"
                className={cn("size-3.5 transition-transform", isCollapsed && "-rotate-90")}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="m6 4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {/* 名称：点击行内编辑（Enter 确认 / Esc 取消 / 失焦保存）；stopPropagation 隔离——
              单击标题 = 编辑而非选中（决策 42 冲突设计） */}
            {editing ? (
              inlineInput(
                editingValue,
                setEditingValue,
                handleEditKeyDown(node),
                () => void commitEdit(node),
                "设定名称",
              )
            ) : (
              <span
                className="min-w-0 cursor-text truncate text-sm text-foreground hover:underline"
                title="点击编辑名称，双击查看详情"
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit(node);
                }}
              >
                {node.name}
              </span>
            )}
            {/* 直接子设定数（>0 时显示） */}
            {hasChildren && (
              <span className="shrink-0 text-xs text-muted-foreground/70">
                {node.children.length} 个子设定
              </span>
            )}
            {/* 行尾操作区（批次十二 T1：标签徽标 + 删除按钮——标签收进行尾、删除按钮左边，
              不紧跟名称干扰树呈现；决策 42：行级只留删除，H2 直接软删不弹确认；
              决策 40：右键菜单替代行级问 AI） */}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {/* 标签徽标（summary.tags 前 3，决策 31 统一字段；替代已废弃的 category 徽标） */}
              {tags.length > 0 && (
                <span className="flex shrink-0 items-center gap-0.5">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-primary/80 px-1.5 py-0.5 text-xs text-primary-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </span>
              )}
              {/* 手动模式 ↑↓ 箭头（决策 46）：同级组内上移/下移一位；悬停显示（group-hover）；
                  组首/尾禁用置灰；stopPropagation 不触发行选中/编辑 */}
              {sortMode === "manual" && (
                <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    disabled={!canUp || busy}
                    title="上移"
                    aria-label={`上移「${node.name}」`}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    onClick={(e) => {
                      e.stopPropagation();
                      void moveSiblingByArrow(node, -1);
                    }}
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={!canDown || busy}
                    title="下移"
                    aria-label={`下移「${node.name}」`}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    onClick={(e) => {
                      e.stopPropagation();
                      void moveSiblingByArrow(node, 1);
                    }}
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </span>
              )}
              <button
                type="button"
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                title="移入回收站"
                aria-label={`移入回收站「${node.name}」`}
                onClick={(e) => {
                  e.stopPropagation(); // 不触发行选中（handleRowClick 的 closest 已拦截，双保险）
                  void handleDelete(node);
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            </span>
          </div>
          {/* 描述摘要行（决策 45 批次十三）：弱化样式，空描述不渲染；title 查看完整摘要 */}
          {rowDescription !== null && (
            <span
              className="min-w-0 truncate pl-5 text-xs text-muted-foreground"
              title={rowDescription}
            >
              {rowDescription}
            </span>
          )}
        </>
      );
      return (
        <li key={node.id}>
          {/* 节点行：折叠箭头 | 名称（点击行内编辑）| 子设定数 | 行尾区（标签徽标 + 删除，批次十二 T1）；
              可拖拽（编辑态/自身拖拽中/busy 禁用，防输入误拖与嵌套拖动）；
              tabIndex=-1 使行可聚焦（选中后按 Enter 触发新建子级 onKeyDown）；
              决策 40：行级右键菜单（RowContextMenu）——注入会话上下文（focus_entity_type=setting）+
              建立关联（setting 源端点）；编辑态不挂右键菜单（行内输入框保留原生文本菜单：复制/粘贴） */}
          {editing ? (
            <div {...rowProps}>{rowChildren}</div>
          ) : (
            <RowContextMenu
              focus={{ focus_entity_type: "setting", focus_entity_id: node.id }}
              source={{ type: "setting", id: node.id, name: node.name }}
              onCreated={reload}
              trigger={<div {...rowProps} />}
            >
              {rowChildren}
            </RowContextMenu>
          )}
          {/* 子节点递归渲染（折叠态不渲染） */}
          {hasChildren && !isCollapsed && <ul>{renderNodes(node.children, depth + 1)}</ul>}
          {/* 就地新建输入行（父 children 末尾；父折叠时 startCreate 已自动展开） */}
          {creatingHere && (
            <div
              className="flex items-center gap-1.5 py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              <span className="w-4 shrink-0" />
              {inlineInput(
                createValue,
                setCreateValue,
                handleCreateKeyDown,
                cancelCreate,
                "新设定名称，Enter 创建",
              )}
            </div>
          )}
        </li>
      );
    });
  }

  // 加载失败（首载 roots 为 null）→ 整区错误态
  if (failed && roots === null) {
    return (
      <div className="mt-3 flex items-center justify-center gap-3 rounded-md border border-border px-3 py-6 text-sm text-muted-foreground">
        设定加载失败
        <Button variant="outline" type="button" size="sm" onClick={() => setTick((t) => t + 1)}>
          重试
        </Button>
      </div>
    );
  }

  // 首载骨架（roots 为 null；重拉期间保留旧树渲染不闪骨架）
  if (loading && roots === null) {
    return (
      <div className="mt-3 flex flex-col gap-1">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className={cn(skeletonClass, "h-7")}
            style={{ marginLeft: `${(i % 3) * 16}px` }}
          />
        ))}
      </div>
    );
  }

  // 树未就绪（roots 仍为 null 且非加载/失败——理论不可达，防御兜底）
  if (roots === null) {
    return (
      <div className="mt-3 rounded-md border border-border p-4 text-sm text-muted-foreground">
        设定加载失败
        <Button
          variant="outline"
          className="ml-3"
          type="button"
          onClick={() => setTick((t) => t + 1)}
        >
          重试
        </Button>
      </div>
    );
  }

  // 树已就绪（上方 roots === null 分支已 return）：树内过滤（命中节点及祖先链保留）
  const visibleRoots = filterSettingTree(roots, q, tagFilter);
  const canToggle = visibleRoots.length > 0;

  return (
    <div className="mt-3">
      {/* 重拉失败但保留旧树：顶部错误横幅（可重试） */}
      {failed && (
        <div className={cn(errorBannerClass, "mb-3 flex items-center gap-2")}>
          设定刷新失败，当前显示的是上次数据
          <Button
            variant="outline"
            className="ml-auto h-7 px-2 text-xs"
            type="button"
            onClick={() => setTick((t) => t + 1)}
          >
            重试
          </Button>
        </div>
      )}

      {/* 工具栏：搜索 + 标签筛选（树内过滤）+ 全部展开/折叠 + 新建（root 级） */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="搜索设定名称…"
          className="w-48"
        />
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          标签:
          <SearchableSelect
            value={tagFilter}
            options={tagOptions.map((t) => ({ value: t, label: t }))}
            onChange={setTagFilter}
            placeholder="全部"
            ariaLabel="标签筛选"
          />
        </span>
        {/* 排序方式（决策 46，2026-08 批次十三）：名称 / 创建时间 / 手动——同级组内排序；
            手动模式启用 ↑↓ 箭头与行间插入线重排（其余模式拖拽仅调层级） */}
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          排序:
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SettingSortMode)}
            aria-label="排序方式"
            className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="name">名称</option>
            <option value="created">创建时间</option>
            <option value="manual">手动排序</option>
          </select>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            type="button"
            size="sm"
            disabled={!canToggle}
            onClick={expandAll}
          >
            全部展开
          </Button>
          <Button
            variant="outline"
            type="button"
            size="sm"
            disabled={!canToggle}
            onClick={collapseAll}
          >
            全部折叠
          </Button>
          <Button type="button" size="sm" onClick={() => startCreate(null)}>
            + 新建
          </Button>
        </span>
      </div>

      {/* root 级就地新建输入行（工具栏「+ 新建」触发；无父设定） */}
      {creatingAt?.parentId === null && (
        <div className="mb-2 flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
          <span className="w-4 shrink-0" />
          {inlineInput(
            createValue,
            setCreateValue,
            handleCreateKeyDown,
            cancelCreate,
            "新设定名称，Enter 创建",
          )}
        </div>
      )}

      {/* 筛选/空态/树 */}
      {visibleRoots.length === 0 ? (
        <EmptyState
          className="mt-2"
          action={
            filterActive ? (
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  setQInput("");
                  setQ("");
                  setTagFilter("");
                }}
              >
                清空筛选
              </Button>
            ) : (
              <Button type="button" onClick={() => startCreate(null)}>
                + 新建设定
              </Button>
            )
          }
        >
          {filterActive
            ? q
              ? `没有匹配「${q}」的设定`
              : `没有带「${tagFilter}」标签的设定`
            : "还没有设定，新建一个"}
        </EmptyState>
      ) : (
        /* 树容器（同时是 root 拖放目标：拖到空白处 = 移为顶层根） */
        <div
          className={cn(
            "rounded-md border border-border p-2",
            dragTarget?.kind === "root" && "ring-1 ring-accent ring-inset",
          )}
          onClick={() => setSelectedId(null)} // 点击空白区清除选中（行点击已 stopPropagation 隔离）
          onDragOver={handleRootDragOver}
          onDragLeave={handleRootDragLeave}
          onDrop={(e) => void handleRootDrop(e)}
        >
          <ul>{renderNodes(visibleRoots, 0)}</ul>
        </div>
      )}

      {/* 溢出/孤儿提示（buildSettingTree 防御语义） */}
      {(truncated || hasOrphanEdges) && (
        <p className="mt-3 text-xs text-muted-foreground">
          {truncated
            ? `设定数量超过 ${TREE_SETTING_LIMIT}，仅展示前 ${TREE_SETTING_LIMIT} 个设定；`
            : ""}
          {hasOrphanEdges ? "部分设定的上级未在展示范围内，已作为独立节点展示。" : ""}
        </p>
      )}
    </div>
  );
}
