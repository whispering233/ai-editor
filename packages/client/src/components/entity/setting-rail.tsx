// 设定页 rail（设定树，DESIGN.md `setting-page`，2026-11 改版）：本文件 = 中栏 master-detail 的左列
// （原整页树视图 `SettingTreeView` 收敛为栏，壳 = pages/SettingWorkbench）。
// `#/setting` / `#/setting/:id` 共用一个壳，**选中唯一来源 = URL**：本栏不再持 `selectedId`，
// 选中由 prop `nodeId` 驱动、切换经 `onSelect`（壳负责未保存守卫与导航）。
// 顶部 = PanelHeader（工作台子栏页头：标题行 40 + 预留元信息行 24 + 1px 分割线；右端组 = [全部折叠/展开] [+ 新建] [收起/展开右侧详情]）
// + 常驻控件行（搜索 / 标签 / 排序 / 描述）；
// 下面是自身滚动的行区。原 `PageHeader` + `PageDivider` 与树外层圆角卡边框已删（栏已是容器）。
// 数据：全量 setting（limit 取 `MAX_ENTITY_LIST_LIMIT` + 名称排序）+ 全量 belongs_to 层级边 →
// buildSettingTree（lib/setting-tree）组装递归树；溢出防御见 buildSettingTree（父截断提升为根）。
// 行级交互（与大纲页同一口径，2026-11）：
// - 折叠/展开：父节点箭头切换 + header「全部折叠 / 全部展开」（全部折叠 = 仅保留根级）
// - **单击行体 = 选中并进详情**（`#/setting/:id`，同 id 幂等）；空白区单击 = 清选中（回 `#/setting`）
// - **单击标题 / 描述 = 只就地编辑**（`stopPropagation`，不切换选中 / 详情）；**双击不再进详情**
//   （Enter 确认 PUT /entity/setting/:id { name }、Esc 取消、失焦保存）
// - Enter 新建子级：选中节点按 Enter → 就地输入行出现在该节点子级末尾（POST /entity/setting +
//   POST /relation belongs_to 挂父）；root 级 header「+ 新建」输入行无父
// - 新建成功 = 新条目选中（`onSelect`）+ 聚焦 + 3s 高亮：链式新建要求「选中 + 聚焦」，只聚焦会让
//   下一次 Enter 被「无选中」守卫吞掉
// - 行尾操作（标签 chip / 手动排序 ↑↓ / 新建子设定 / 删除）；删除直接软删（H2 不弹确认）
// - 拖拽调整层级：HTML5 DnD **嵌套语义**（拖到行上 = 成为该行子级、拖到空白区 = 移为顶层根）+
//   手动模式行间插入线（同级重排）；belongs_to 防环沿用（canMoveSettingTo 客户端预校验 +
//   服务端兜底 400 VALIDATION_ERROR）；改父 = 先建新边后删旧边（对齐 EntityDetail.handleSetParent）
// - 筛选 = 搜索 + 标签（树内过滤 filterSettingTree：命中节点及祖先链保留，非命中子树隐藏）；无分页
// 样式全 token 类；行级右键菜单（RowContextMenu——注入会话上下文 + 建立关联）。
import { useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode, Ref } from "react";
import { Button, Input, Select, Switch } from "antd";
import {
  DeleteOutlined,
  DownOutlined,
  NodeCollapseOutlined,
  NodeExpandOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { MAX_ENTITY_LIST_LIMIT } from "@whispering233/ai-editor-shared";
import { RowContextMenu } from "./row-context-menu";
import { PanelHeader } from "@/components/ui/panel-header";
import { PanelToggleButton } from "@/components/ui/panel-toggle-button";
import { TagChip } from "@/components/ui/tag-chip";
import { DropIndicator } from "@/components/ui/drop-indicator";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useSettingDescVisible } from "@/hooks/use-setting-desc";
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
import { focusNewItem } from "../../lib/new-item-focus";
import { useSaveShortcut } from "../../lib/save-shortcut";
import { useUiStore } from "../../stores/ui";

/** 设定树拉取上限（`MAX_ENTITY_LIST_LIMIT`；超量截断提示 + 孤儿提升防御） */
const TREE_SETTING_LIMIT = MAX_ENTITY_LIST_LIMIT;

/** 拖拽目标（嵌套语义 + 行间插入线）：
 * row.on = 拖到行中段（成为其子级）；row.before/after = 拖到行上/下方插入线（**手动模式**同级重排）；
 * root = 拖到空白区（移为顶层根） */
type SettingDragTarget =
  { kind: "row"; id: string; placement: "before" | "on" | "after" } | { kind: "root" } | null;

/** 就地新建目标：parentId null = root 顶层（无父）；非 null = 该节点子级末尾 */
type CreatingState = { parentId: string | null } | null;

/**
 * 设定树栏：header（`PanelHeader`）+ 常驻控件行 + 行区（自身纵向滚动）。
 * 宽度 / 收起态由壳持有（hooks/use-setting-rail）：本栏只消费 `width`；右侧拖拽手柄由壳作为兄弟渲染。
 * 选中唯一来源 = URL（`nodeId`）；本栏不存选中态，切换 / 清选中一律经 `onSelect`（壳负责守卫与导航）。
 * 左栏（本栏）收起 / 展开入口在详情列页头 `leading`；右侧详情收起 / 展开入口在本栏 header 右端组最右端
 * （`detailCollapsed` / `onToggleDetail`，窄屏不传 = 不渲染），见 DESIGN.md `setting-page`「宽度与两档收起」。
 */
export function SettingRail({
  railRef,
  nodeId,
  reloadKey,
  onSelect,
  width,
  className,
  detailCollapsed,
  onToggleDetail,
  onMutated,
}: {
  /** 壳要量当前渲染宽（默认宽度是 CSS 值）作拖拽起点 */
  railRef?: Ref<HTMLElement>;
  /** URL 选中 id（唯一选中来源；null = `#/setting` 无选中） */
  nodeId: string | null;
  /** 壳的重拉计数（详情保存 / 数据变更信号后 +1） */
  reloadKey: number;
  /** 选中切换（id 或 null = 清选中）；壳在此做未保存守卫 + 导航 */
  onSelect: (id: string | null) => void;
  /** 展开态宽度（CSS 值或像素）；不传 = 不设内联宽（窄屏全宽走 className） */
  width?: string;
  /** 覆盖类（窄屏 `w-full border-r-0`——`cn` 用 twMerge，同属性后者胜） */
  className?: string;
  /** 右侧详情当前是否收起（只驱动 header 按钮图标 / 无障碍状态；详情列由壳决定是否渲染） */
  detailCollapsed?: boolean;
  /** 切换右侧详情收起态（壳做未保存守卫）；不传 = 不渲染该按钮（窄屏无相邻详情列） */
  onToggleDetail?: () => void;
  /** 写操作成功（改名 / 新建 / 删除 / 移动）后通知宿主刷新外部视图（如已打开的详情页头） */
  onMutated?: () => void;
}) {
  const [roots, setRoots] = useState<SettingTreeNode[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [hasOrphanEdges, setHasOrphanEdges] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /** 内部重载计数（操作成功后刷新 / 错误重试）；壳的重拉入口是 `reloadKey` */
  const [tick, setTick] = useState(0);
  /** 折叠节点 id 集合（缺省空 = 全展开；重拉后指向已删 id 的残留无害、不清空） */
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  /** 行内编辑（点击标题）目标 id；null = 未编辑 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  /** 就地新建目标（null = 未新建；{ parentId: null } = root 顶层） */
  const [creatingAt, setCreatingAt] = useState<CreatingState>(null);
  const [createValue, setCreateValue] = useState("");
  /** 新创建节点高亮（3s 自动消失） */
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  /** 已聚焦过的新建节点 id（一次性守卫：3s 高亮窗口内重拉不重复聚焦抢焦点） */
  const focusedNewSettingRef = useRef<string | null>(null);
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
  /** 标签筛选（树内过滤；"" = 全部） */
  const [tagFilter, setTagFilter] = useState("");
  /** 标签筛选候选（聚合既有设定 tags；失败静默——仅无下拉候选，不影响树） */
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  /** 排序方式（2026-08）：name 默认（原行为）；created 创建时间；manual 手动（重排入口） */
  const [sortMode, setSortMode] = useState<SettingSortMode>("manual");
  const [showDescription, setShowDescription] = useSettingDescVisible();

  /** 操作成功后刷新（tick +1 触发加载 effect；保留旧数据渲染，避免骨架闪烁） */
  function reload() {
    setTick((t) => t + 1);
    onMutated?.();
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
            // 手动排序位（稀疏——NULL 不出现，节点侧沉底按名称）
            ...(s.sortOrder !== undefined ? { sortOrder: s.sortOrder } : {}),
          })),
          edges,
        );
        setRoots(tree.roots);
        setHasOrphanEdges(tree.hasOrphanEdges);
        setTruncated(settingRes.total > TREE_SETTING_LIMIT); // total 为准（截断提示）
        // 标签候选（统一字段 data.tags → summary.tags）
        const tags = new Set<string>();
        for (const item of settingRes.items) {
          if (Array.isArray(item.summary.tags)) {
            for (const t of item.summary.tags) {
              if (typeof t === "string" && t !== "") tags.add(t);
            }
          }
        }
        setTagOptions(Array.from(tags).sort());
        // 数据重拉后旧 id 可能失效（被删/改父）：清理编辑/新建态防残留
        // （选中态不在此清——唯一来源是 URL，坏 id 由详情列报错引导）
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

  // 新建即聚焦（A2）：高亮 id 对应的行渲染出来后（reload 完成 → roots 变化）滚动到位 + 键盘焦点落行
  useEffect(() => {
    if (highlightedId === null || focusedNewSettingRef.current === highlightedId) return;
    const t = setTimeout(() => {
      if (focusNewItem(`[data-setting-id="${highlightedId}"]`)) {
        focusedNewSettingRef.current = highlightedId;
        // 链式新建（DESIGN.md `data-row` 行级交互）：新条目 = 选中 + 聚焦——
        // 「Enter 新建子级」的守卫是 nodeId === node.id，只聚焦不选中会让下一次 Enter 静默无响应。
        // 不在此直接 onSelect：本 effect 跑在 reload 完成后的渲染，此刻新 id 已在树上
        if (nodeId !== highlightedId) onSelect(highlightedId);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [highlightedId, roots, nodeId, onSelect]);

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
        return false;
      }
      // 其余错误：保持编辑态 + 保留输入值（可修正后重试）
      useUiStore
        .getState()
        .showToast(
          err instanceof ApiError ? `保存失败：${err.message}` : "保存失败，请重试",
          "error",
        );
      return false; // 保存失败：Ctrl+S 据此不生成备份
    } finally {
      setBusy(false);
    }
  }

  // Ctrl/Cmd+S（B2）：行内编辑进行中 → 提交当前编辑（Enter 同语义）；未编辑时不参与
  useSaveShortcut(() => {
    const node = editingId !== null ? findSettingNode(roots ?? [], editingId) : null;
    if (node) return commitEdit(node);
  }, editingId !== null);

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
      // 高亮 → 聚焦效应里补选中（DESIGN.md `data-row` 链式新建）：本处不直接 onSelect——
      // reload 是异步的（tick + 加载效应），此刻 roots 还是旧树；聚焦效应在 reload 完成后才跑，
      // 那时新 id 已在树上（只聚焦不选中 → 再按 Enter 建子级静默无响应，实测踩坑）
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

  // ============ 选中与行级交互（单击行体进详情 / Enter 新建子级） ============
  // 手势（与大纲页同一口径，DESIGN.md `setting-page`）：
  // **单击行体 = 选中并进详情**（经壳 `onSelect` → `#/setting/:id`；同 id 幂等，不重复 push）；
  // **单击标题 / 描述 = 只就地编辑**（onClick stopPropagation 隔离，不切换选中 / 详情）；
  // **双击不再承担「进详情」**（旧「单击标题 + 双击详情」互斥已取消）。
  // 行内按钮 / 输入框 / 链接 / 拖拽收尾的鼠标事件不导航（closest 守卫 + stopPropagation）。

  /** 选中节点：进详情（URL 唯一来源，壳在 `onSelect` 里做未保存守卫 + 导航）；同 id 幂等 */
  function selectNode(id: string) {
    cancelEdit();
    cancelCreate();
    if (nodeId !== id) onSelect(id);
  }

  /** 行单击：非标题/按钮/输入框区 → 选中并进详情；交互元素 stopPropagation（行内按钮/输入框
   * 点击不冒泡到容器，避免清选中） */
  function handleRowClick(e: MouseEvent<HTMLDivElement>, node: SettingTreeNode) {
    if ((e.target as HTMLElement).closest("button, input, a")) {
      e.stopPropagation();
      return;
    }
    e.stopPropagation(); // 阻止冒泡到行区容器（容器 onClick 清选中）
    if (dragNodeId !== null) return; // 拖拽结束的收尾点击不导航
    selectNode(node.id);
  }

  /** 行键盘：选中节点按 Enter → 就地新建子级（子级类型 = 设定）；编辑态/新建态/拖拽中/busy 禁用；
   * 仅行 div 自身聚焦时响应（oracle 修复：子元素按钮/输入框聚焦时交给子元素处理） */
  function handleRowKeyDown(e: KeyboardEvent<HTMLDivElement>, node: SettingTreeNode) {
    if (e.key !== "Enter") return;
    if (e.target !== e.currentTarget) return;
    if (editingId !== null || creatingAt !== null || dragNodeId !== null || busy) return;
    if (nodeId !== node.id) return;
    e.preventDefault();
    startCreate(node.id);
  }

  // ============ 拖拽调整层级（嵌套语义：拖到行 = 成为其子级；空白区 = 移为根） ============
  // belongs_to 防环沿用（canMoveSettingTo 客户端预校验 + 服务端兜底）；改父 = 先建新边
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

  /** 行 dragover（三分区）：行上/下方 1/3 = 行间插入线（**手动模式**同级重排，目标组 =
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
    // on（调层级）：目标父 = 该行（防环/自指沿用）；before/after（同级重排）：目标组 = 该行同级组
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

  /** 同级组（手动序）辅助：某节点的同级列表 = 父的子级 / 根级（排序后的展示序） */
  function siblingsOf(node: SettingTreeNode): SettingTreeNode[] {
    const parentNode =
      node.parentId !== undefined ? findSettingNode(roots ?? [], node.parentId) : null;
    return sortSettingChildren(parentNode ? parentNode.children : (roots ?? []), "manual");
  }

  /** 拖放执行（复合端点）：on = 改父（append 到新父子级末尾）；before/after = 同级重排
   * （含跨父重排——服务端事务内改父 + 组内定序一次提交）；root = 移为顶层根。
   * 目标位置无变化 → no-op（不发请求）。*/
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

  /** 手动模式 ↑↓ 箭头：同级组内上移/下移一位（moveSetting order = 目标位） */
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
      // 删掉的正是 URL 选中节点：回 `#/setting`（不留死详情；壳做未保存守卫）
      if (nodeId === node.id) onSelect(null);
      reload();
    } catch (err) {
      useUiStore
        .getState()
        .showToast(err instanceof ApiError ? err.message : "删除失败，请重试", "error");
    }
  }

  // ============ 渲染 ============

  const filterActive = q !== "" || tagFilter !== "";

  /** 就地输入框（行内编辑/新建共用；autoFocus 进入即聚焦；small 档 = 24px 对齐行高） */
  function inlineInput(
    value: string,
    onChange: (v: string) => void,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void,
    onBlur: () => void,
    placeholder: string,
  ) {
    return (
      <Input
        size="small"
        className="min-w-0 flex-1"
        autoComplete="off"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        maxLength={100}
        placeholder={placeholder}
      />
    );
  }

  /** 整树递归渲染（闭包共享页面 state；行级交互：单击行体进详情 / Enter 新建子级 /
   * 点击标题行内编辑 / 拖拽嵌套改层级；同级按排序方式重排 + 手动模式
   * ↑↓ 箭头与行间插入线重排） */
  function renderNodes(nodes: SettingTreeNode[], depth: number): ReactNode {
    // 每级同级组按当前排序方式重排（name/created/manual；不改原树）
    const ordered = sortSettingChildren(nodes, sortMode);
    return ordered.map((node) => {
      const hasChildren = node.children.length > 0;
      const isCollapsed = collapsedIds.has(node.id);
      const editing = editingId === node.id;
      const selected = nodeId === node.id;
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
      // 手动模式箭头边界（同级组首/尾禁用）
      const siblingIdx = ordered.findIndex((s) => s.id === node.id);
      const canUp = sortMode === "manual" && siblingIdx > 0;
      const canDown = sortMode === "manual" && siblingIdx >= 0 && siblingIdx < ordered.length - 1;
      // 节点行根 props（右键菜单 trigger 与普通 div 共用）
      const rowProps = {
        "data-setting-id": node.id,
        draggable: !editing && !isDragging && !busy,
        tabIndex: -1,
        onDragStart: (e: DragEvent) => handleDragStart(e, node),
        onDragEnd: clearDrag,
        onDragOver: (e: DragEvent) => handleRowDragOver(e, node),
        onDragLeave: (e: DragEvent) => handleRowDragLeave(e, node),
        onDrop: (e: DragEvent) => void handleRowDrop(e, node),
        onClick: (e: MouseEvent<HTMLDivElement>) => handleRowClick(e, node),
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => handleRowKeyDown(e, node),
        "aria-current": selected ? ("page" as const) : undefined,
        className: cn(
          // 两行式——第一行 箭头|名称|计数|行尾区，第二行描述摘要（弱化）
          // group：手动模式悬停显示 ↑↓ 箭头
          "group relative flex flex-col rounded-md py-1 pr-1 transition-colors hover:bg-muted/60",
          // 临时高亮（新建成功 3s）/ 拖拽目标（将成其子级）：primary 淡染面 + 描边
          (highlighted || isDragTarget) && "bg-primary/10 ring-1 ring-primary/30 ring-inset",
          isDragging && "opacity-50",
          // 选中 = URL 选中：`bg-accent`（surface-muted）+ 文字不变色（与大纲 rail / 左栏导航同一语言）
          selected && "bg-accent",
        ),
        style: { paddingLeft: `${depth * 16 + 8}px` },
        title:
          sortMode === "manual"
            ? "拖到行中段 = 成为其子级；拖到行间插入线 = 同级重排；拖到空白区 = 移为顶层"
            : "拖到行上 = 成为其子级；拖到空白区 = 移为顶层",
      };
      // 节点行内容（折叠箭头 + 名称 + 标签 + 子设定数 + 行尾删除；
      // 行下方追加描述摘要行——summary.description 截断 100（服务端），hover title 查看完整）
      const rowDescription =
        typeof node.summary?.description === "string" && node.summary.description !== ""
          ? node.summary.description
          : null;
      const rowChildren = (
        <>
          {/* 行间插入线（手动模式拖拽：before/after 目标高亮；A3 加粗 + 端点圆点） */}
          {isDragBefore && <DropIndicator position="top" />}
          {isDragAfter && <DropIndicator position="bottom" />}
          <div className="flex min-w-0 items-center gap-1.5">
            {/* 折叠箭头（叶子占位保缩进对齐）；点击切展开态，不选中/不跳转。
                方向 = 折叠横指 / 展开下指（DESIGN.md §数据展示「缩进列对齐」）。
                图标按钮统一走 antd text 变体——DESIGN.md §Components `icon-button` */}
            {hasChildren ? (
              <Button
                color="default" variant="text"
                size="small"
                className="-ml-1"
                aria-label={isCollapsed ? "展开" : "折叠"}
                onClick={() => toggleCollapse(node.id)}
                icon={
                  <RightOutlined
                    className={cn("text-sm transition-transform", !isCollapsed && "rotate-90")}
                  />
                }
              />
            ) : (
              /* 叶子行不渲染 disabled 箭头（灰箭头看着可点却没反应）——空占位同箭头几何：
                 `-ml-1` + 24px 按钮盒 = 20px 有效宽（DESIGN.md「缩进列对齐」） */
              <span className="-ml-1 w-6 shrink-0" aria-hidden="true" />
            )}
            {/* 名称：点击行内编辑（Enter 确认 / Esc 取消 / 失焦保存）；stopPropagation 隔离——
              单击标题 = 编辑而非选中（冲突设计） */}
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
                title="点击编辑名称"
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
            {/* 行尾操作区（T1：标签徽标 + 新建子设定 + 删除——标签收进行尾、删除按钮恒贴行尾；
              行级删直接软删不弹确认（H2）；右键菜单替代行级问 AI） */}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {/* 标签徽标（summary.tags 前 3，统一字段；替代已废弃的 category 徽标） */}
              {tags.length > 0 && (
                <span className="flex shrink-0 items-center gap-0.5">
                  {tags.map((t) => (
                    <TagChip key={t}>{t}</TagChip>
                  ))}
                </span>
              )}
              {/* 手动模式 ↑↓ 箭头：同级组内上移/下移一位；悬停显示（group-hover）；
                  组首/尾禁用置灰；stopPropagation 不触发行选中/编辑 */}
              {sortMode === "manual" && (
                <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    color="default" variant="text"
                    size="small"
                    disabled={!canUp || busy}
                    title="上移"
                    aria-label={`上移「${node.name}」`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void moveSiblingByArrow(node, -1);
                    }}
                    icon={<UpOutlined className="text-sm" />}
                  />
                  <Button
                    color="default" variant="text"
                    size="small"
                    disabled={!canDown || busy}
                    title="下移"
                    aria-label={`下移「${node.name}」`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void moveSiblingByArrow(node, 1);
                    }}
                    icon={<DownOutlined className="text-sm" />}
                  />
                </span>
              )}
              {/* 新建子设定（卡 4，DESIGN.md `data-row`）：与 Enter 建子级同一路径（startCreate），
                  插在删除左侧、悬停箭头右侧；任意设定都可作父（无层级深度限制） */}
              <Button
                color="default" variant="text"
                size="small"
                title="新建子设定"
                aria-label={`在「${node.name}」下新建子设定`}
                onClick={(e) => {
                  e.stopPropagation(); // 不触发行选中（handleRowClick 的 closest 已拦截，双保险）
                  startCreate(node.id);
                }}
                icon={<PlusOutlined className="text-sm" />}
              />
              <Button
                color="default" variant="text"
                size="small"
                title="移入回收站"
                aria-label={`移入回收站「${node.name}」`}
                onClick={(e) => {
                  e.stopPropagation(); // 不触发行选中（handleRowClick 的 closest 已拦截，双保险）
                  void handleDelete(node);
                }}
                icon={<DeleteOutlined className="text-sm" />}
              />
            </span>
          </div>
          {/* 描述摘要行：弱化样式，空描述不渲染；title 查看完整摘要。
              缩进用**同一条箭头占位链**（`-ml-1 w-6` + gap）而不是手写 `pl-*` 数字——
              标题列位由箭头几何决定，硬编码会随箭头盒变化再次漂移（DESIGN.md「缩进列对齐」） */}
          {showDescription && rowDescription !== null && (
            <div className="flex min-w-0 gap-1.5">
              <span className="-ml-1 w-6 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate text-xs text-muted-foreground" title={rowDescription}>
                {rowDescription}
              </span>
            </div>
          )}
        </>
      );
      return (
        <li key={node.id}>
          {/* 节点行：折叠箭头 | 名称（点击行内编辑）| 子设定数 | 行尾区（标签徽标 + 删除，T1）；
              可拖拽（编辑态/自身拖拽中/busy 禁用，防输入误拖与嵌套拖动）；
              tabIndex=-1 使行可聚焦（选中后按 Enter 触发新建子级 onKeyDown）；
              行级右键菜单（RowContextMenu）——注入会话上下文（focus_entity_type=setting）+
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
              {/* 占位同箭头几何（输入框对齐上方子行名称） */}
              <span className="-ml-1 w-6 shrink-0" />
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

  /** 树内过滤（命中节点及祖先链保留）；树未就绪 = 空 */
  const visibleRoots = roots === null ? [] : filterSettingTree(roots, q, tagFilter);
  const canToggle = visibleRoots.length > 0;

  /** header 折叠切换：有折叠项 = 全部展开，否则全部折叠（与行内箭头同一状态） */
  function toggleAllCollapse() {
    if (collapsedIds.size > 0) expandAll();
    else collapseAll();
  }

  // 行区内容（错误 / 骨架 / 空态 / 树都挂在滚动容器里，不撑高 rail）
  let rows: ReactNode;
  if (failed && roots === null) {
    rows = (
      <div className="flex items-center justify-center gap-3 rounded-md border border-border px-3 py-6 text-sm text-muted-foreground">
        设定加载失败
        <Button onClick={() => setTick((t) => t + 1)}>重试</Button>
      </div>
    );
  } else if (loading && roots === null) {
    // 首载骨架（重拉期间保留旧树渲染不闪骨架）
    rows = (
      <div className="flex flex-col gap-1">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className={cn(skeletonClass, "h-7")}
            style={{ marginLeft: `${(i % 3) * 16}px` }}
          />
        ))}
      </div>
    );
  } else if (roots === null) {
    // 树未就绪（roots 仍为 null 且非加载/失败——理论不可达，防御兜底）
    rows = (
      <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        设定加载失败
        <Button className="ml-3" onClick={() => setTick((t) => t + 1)}>
          重试
        </Button>
      </div>
    );
  } else {
    rows = (
      <>
        {/* 重拉失败但保留旧树：顶部错误横幅（可重试） */}
        {failed && (
          <div className={cn(errorBannerClass, "mb-2 flex items-center gap-2")}>
            设定刷新失败，当前显示的是上次数据
            <Button size="small" className="ml-auto" onClick={() => setTick((t) => t + 1)}>
              重试
            </Button>
          </div>
        )}

        {/* root 级就地新建输入行（header「+ 新建」触发；无父设定） */}
        {creatingAt?.parentId === null && (
          <div className="mb-1 flex items-center gap-1.5 rounded-md py-1">
            {/* 占位同箭头几何（输入框对齐顶层名称） */}
            <span className="-ml-1 w-6 shrink-0" />
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
            padding="sm"
            className="mt-1"
            action={
              filterActive ? (
                <Button
                  onClick={() => {
                    setQInput("");
                    setQ("");
                    setTagFilter("");
                  }}
                >
                  清空筛选
                </Button>
              ) : (
                <Button type="primary" onClick={() => startCreate(null)}>
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
          <ul>{renderNodes(visibleRoots, 0)}</ul>
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
      </>
    );
  }

  return (
    <aside
      ref={railRef}
      aria-label="设定树"
      style={width === undefined ? undefined : { width }}
      // 桌面展开态分栏线归本栏；窄屏全宽由壳传 `border-r-0`
      //（DESIGN.md §Layout「分栏边线单所有权」——手柄不画线，只有面板边线能覆盖全部场景）
      className={cn("flex min-h-0 shrink-0 flex-col border-r border-border", className)}
    >
      {/* rail header（`PanelHeader`，`mb-0`：行区 / 控件行紧随分割线）：标题 +
          [全部折叠/展开] [+ 新建] [详情收起/展开]——详情钮排最右端（紧邻被收起的详情列）；
          详情按钮只在桌面态（壳传 onToggleDetail）渲染，见 DESIGN.md `setting-page`「宽度与两档收起」 */}
      <PanelHeader
        title="设定"
        className="mb-0"
        actions={
          <>
            <Button
              color="default"
              variant="text"
              size="small"
              title={collapsedIds.size > 0 ? "全部展开" : "全部折叠"}
              aria-label={collapsedIds.size > 0 ? "全部展开" : "全部折叠"}
              disabled={!canToggle}
              onClick={toggleAllCollapse}
              icon={
                collapsedIds.size > 0 ? (
                  <NodeExpandOutlined className="text-sm" />
                ) : (
                  <NodeCollapseOutlined className="text-sm" />
                )
              }
            />
            <Button
              color="default"
              variant="text"
              size="small"
              title="新建设定"
              aria-label="新建设定"
              onClick={() => startCreate(null)}
              icon={<PlusOutlined className="text-sm" />}
            />
            {onToggleDetail && (
              <PanelToggleButton
                side="right"
                collapsed={detailCollapsed ?? false}
                label="右侧详情"
                onToggle={onToggleDetail}
              />
            )}
          </>
        }
      />

      {/* 常驻控件行（不随行区滚动）：搜索 + 标签 + 排序 + 描述开关；窄 rail 按 flex-wrap 折行 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        {/* 外层 div 承担 flex-1 / 最小宽：antd 输入框自带 `min-width: 0` 且样式后注入，
            直接挂 `min-w-40` 会被压成 0px（2026-11 实测，窄 rail 只剩放大镜） */}
        <div className="min-w-40 flex-1">
          <Input
            size="small"
            prefix={<SearchOutlined />}
            allowClear
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="搜索设定名称…"
          />
        </div>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          标签
          <SearchableSelect
            value={tagFilter}
            options={tagOptions.map((t) => ({ value: t, label: t }))}
            onChange={setTagFilter}
            placeholder="全部"
            ariaLabel="标签筛选"
          />
        </span>
        {/* 排序方式（2026-08）：名称 / 创建时间 / 手动——同级组内排序；
            手动模式启用 ↑↓ 箭头与行间插入线重排（其余模式拖拽仅调层级） */}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          排序
          <Select
            size="small"
            className="min-w-24"
            value={sortMode}
            onChange={(value) => setSortMode(value as SettingSortMode)}
            aria-label="排序方式"
            options={[
              { value: "name", label: "名称" },
              { value: "created", label: "创建时间" },
              { value: "manual", label: "手动排序" },
            ]}
          />
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            size="small"
            checked={showDescription}
            onChange={setShowDescription}
            aria-label="显示设定描述"
          />
          描述
        </span>
      </div>

      {/* 行区：自身纵向滚动（p-2），同时是 root 拖放目标（拖到空白处 = 移为顶层根）；
          空白区单击 = 清选中（回 `#/setting`，壳做未保存守卫） */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto p-2",
          dragTarget?.kind === "root" && "ring-1 ring-primary/30 ring-inset",
        )}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, input, a")) return;
          if (dragNodeId !== null) return;
          if (nodeId === null) return; // 已无选中：不弹确认
          onSelect(null);
        }}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={(e) => void handleRootDrop(e)}
      >
        {rows}
      </div>
    </aside>
  );
}
