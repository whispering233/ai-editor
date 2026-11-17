// 大纲树页面（S2.4 修订：就地编辑/就地新建/拖拽移动为主，弹窗仅保留必要场景；
// S12.2：⋯ 菜单「变更记录」→「详情」（跳 #/outline/:nodeId 节点详情页），行内 Delta 面板随详情页落地移除；
// S13.1 交互重构：取消 ⋯ 操作条 → 行尾平铺图标（＋ 新建 / 详情 / 移入回收站）；删除「移动到…」对话框
// （拖拽修复后已覆盖）；拖拽上下半判定 + 插入指示线（同级排序可用）；摘要移到标题下方独立行（默认显示）；
// 删除底部回收站折叠区（Trash tab 已覆盖）；「设为阅读进度」入口迁往详情页（S13.2）；阅读进度徽标 token 化；
// S9.2 伏笔标记：title 行尾紧凑徽标（plants/advances/resolves 图标 + title tooltip 伏笔名），
// 数据 = GET /relation（source_type=outline_node）三类并行拉取聚合（lib/outline-hooks）；
// 2026-09：徽标改为**导航链接**——点击跳该伏笔详情 #/hooks/:id（行 click/dblclick 守卫排除 `a`，
// 点徽标不选中行、不进节点详情；徽标组件 = components/outline/node-hook-badge）
// 交互收敛：行级「详情」「＋ 新建」按钮移除（只留删除 + 阅读进度徽标）——单击行体进详情、
// 选中后 Enter 新建子级（类型由父层级推导）、单击标题/摘要行内编辑、拖拽排序保留；
// 行级 AskAiButton 已移除——右键菜单替代（RowContextMenu：注入会话上下文 + 建立关联
// + 「设为阅读进度」/「标记为推演节点」——卡片 1.1/D2：仅章节点行传入，卷/场景行不出现；
// 已是阅读进度则禁用，推演标记项不置灰、按当前状态切换文案）
// 2026-11（master-detail 改版）：本文件 = 中栏内分栏壳 `Outline` + 左列 `OutlineRail`（即原整页树视图）。
// 壳：`#/outline` / `#/outline/:nodeId` 都渲染同一个壳，nodeId 只决定右列（详情 / 空态）；宽度 / 收起
// 见 hooks/use-outline-rail。**选中唯一来源 = URL**：不另存组件选中态，行单击 = 导航 `#/outline/:id`
// （同 id 幂等），选中行 = `bg-accent` + `aria-current="page"`；双击不再进详情；未保存守卫 = 详情
// 上报 dirty，rail 切换 / 空白区清选中 / 窄屏返回条 / 新建导航前先 `confirm`。
// 路由：#/outline（2026-11 起只有树视图，写作入口独立成 #/writing）；数据：GET /api/v1/outline?with_metadata=true
// （整树，按页开启见 hooks/use-outline-loader）+ GET /api/v1/relation（伏笔标记，S9.2）；操作：POST/PUT/DELETE /outline、PUT /project/config（设阅读进度）
// 2026-09：卷/章行的类型徽标改为**编号徽标**（`第N卷` / `第N章`，展示口径——只计可见节点、删后重排，
// 与服务端 `deriveChapterOrder` 不同源；纯函数 = lib/outline-tree 的 numberOutline）；占位几何随徽标宽度同步（见 DESIGN.md）。
// （S2.4 + S13.1 + 版）——行内编辑标题/摘要（Enter 保存/Esc 取消/失焦保存）、
// URL 选中的节点按 Enter 就地插入子节点（类型由父决定；顶层只建卷）、拖拽移动（原生 HTML5 DnD，上下半判定：
// 目标行上半 = 插到该节点前、下半 = 插到该节点后，跨父移动按，顶层空白区 = 排末尾）、
// 软删直接执行（H2：不再弹二次确认，回收站可还原；仅彻底删除保留确认）
// 刷新策略：所有写操作成功后统一 loadOutline 重拉整树（服务端权威——move 重排 order、软删级联子树、
// 还原级联；本地补丁易与服务端不一致；本地文件读取毫秒级，重拉成本可忽略）。outline 树数据仍在
// project store（跨页共用：顶栏阅读进度标题映射、节点 id → title 映射），本页只持有 UI 态
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode, RefObject } from "react";
import { Button } from "antd";
import { buildDeductionMarks, type OutlineNode } from "@whispering233/ai-editor-shared";
import {
  ArrowLeftOutlined,
  AimOutlined,
  BranchesOutlined,
  ClearOutlined,
  DeleteOutlined,
  LeftOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { CHILD_TYPE, TYPE_LABEL } from "../components/outline/dialogs";
import { InlineInput } from "../components/outline/inline-input";
import { NodeHookMarkBadge } from "../components/outline/node-hook-badge";
import { TypeChip } from "@/components/ui/tag-chip";
import { DropIndicator } from "@/components/ui/drop-indicator";
import { PageHeader } from "@/components/ui/page-header";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { useMediaQuery } from "../hooks/use-media-query";
import {
  OUTLINE_RAIL_DEFAULT_WIDTH_CSS,
  useOutlineRail,
} from "../hooks/use-outline-rail";
import OutlineDetail from "./OutlineDetail";
import { RowContextMenu } from "@/components/entity/row-context-menu";
import { ContextMenuItem } from "@/components/ui/context-menu";
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
import { setCurrentPosition } from "../lib/current-position";
import {
  clearDeductionMarks,
  deductionMarkTitle,
  deductionMenuLabel,
  isDeductionMarkHost,
  submitDeductionMarks,
  toggledDeductionNodes,
} from "../lib/deduction";
import {
  canMoveTo,
  deleteInvalidatesSelection,
  dropInsertOrder,
  editFailureRecovery,
  findNode,
  findNodeChildren,
  findNodePath,
  isNoopDrop,
  numberOutline,
  ROOT_NODE_ID,
  resolveDropPlan,
  sameDragTarget,
  shouldCommitSummary,
  shouldCommitTitle,
  type DragTarget,
} from "../lib/outline-tree";
import { cn } from "../lib/utils";
import { focusNewItem } from "../lib/new-item-focus";
import { useSaveShortcut } from "../lib/save-shortcut";
import { navigate } from "../hooks/use-route";
import { useOutlineLoader } from "../hooks/use-outline-loader";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

/** 就地编辑目标（一次只编辑一个字段） */
type EditingState = { nodeId: string; field: "title" | "summary" } | null;

/** 就地新建目标：parentId "root" = 顶层（**只建卷**，2026-09：章只挂卷），否则父节点决定子类型（CHILD_TYPE） */
type CreatingState = { parentId: string; type: OutlineNodeType } | null;

/** 提取错误码（ApiError → 服务端码；未知 → null 走兜底文案） */
function errorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

/** 错误码 → 页级横幅文案（各页定义映射） */
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

/** root 顶层就地新建行：卷类型徽标（固定）+ 输入行——**类型不可切**（2026-09：章只挂卷，root 只建卷，
 * 类型切换按钮的去留见 DESIGN.md「大纲页页头主操作」）。
 * 树容器（renderRootCreateRow）与空态引导卡共用，避免两处重复（S2.4 oracle 补丁 + 卡 2a 去切换） */
function RootCreateRow({
  value,
  onChange,
  onKeyDown,
  onCancel,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onCancel: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 rounded-md px-2 py-1", className)}>
      {/* 占位 + 类型徽标：与树行同列（折叠箭头几何 `-ml-2 w-6` + 编号徽标 `min-w-14`）——
          新建行看上去就是即将插入的那一行卷（编号未分配前只给枚举文案，宽度与编号徽标同几何） */}
      <span className="-ml-2 w-6 shrink-0" />
      <TypeChip className="min-w-14 shrink-0 justify-center">{TYPE_LABEL.volume}</TypeChip>
      <InlineInput
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={onCancel}
        placeholder="新卷标题，Enter 创建"
      />
    </div>
  );
}

// ============ 伏笔标记徽标（S9.2） ============
// 徽标组件已上提为共享组件 components/outline/node-hook-badge.tsx（S10.1 上提为跨页复用，
// 上提约定）；本页仅消费 buildNodeHookMarks 聚合结果渲染

// ============ 页面壳（中栏内 master-detail）= 左 rail + 右详情列 ============

/**
 * 大纲页壳（DESIGN.md `outline-page`）：两种 hash（`#/outline` / `#/outline/:nodeId`）都渲染本壳，
 * `nodeId` 只决定右列内容（详情 / 各空态）——rail 的折叠 / 编辑 / 拖拽状态不会因选中变化重挂。
 * 详情列在 `OutlineDetail` 就绪前由壳给页头 + 骨架 / 错误条 / 空态（不先挂表单）。
 * 窄屏（<1024px）两级互斥：`#/outline` 只渲染 rail 全宽，`#/outline/:id` 只渲染详情全宽 + 返回条。
 */
export default function Outline({ nodeId }: { nodeId?: string }) {
  const outline = useProjectStore((s) => s.outline);
  const outlineError = useProjectStore((s) => s.outlineError);
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  // 壳是**唯一**的大纲加载者（DESIGN.md `outline-page`「数据与刷新」）：rail / 详情都不再各自挂
  // `useOutlineLoader`，`reload` 同时给保存后的整树收敛与 rail 写操作后的重拉。
  const { reload, retry: retryOutline } = useOutlineLoader({ withMetadata: true });
  // 数据变更信号（AI 提案确认写库 / MainToolbar 刷新按钮）：壳重拉树（rail 隐藏时也得刷）；
  // 详情只重载关系 / 变更记录，不另发 GET（DESIGN.md `outline-page`「数据与刷新」）
  useDataRefresh(() => void reload());
  // 详情表单未保存状态（rail 切换 / 空白区 / 窄屏返回条 / 新建导航前 confirm）
  const [detailDirty, setDetailDirty] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const {
    layout: railLayout,
    resizing,
    railRef,
    startResize,
    moveResize,
    endResize,
    toggleCollapse: toggleRailCollapse,
  } = useOutlineRail(isDesktop);

  const railCollapsed = isDesktop && railLayout.collapsed;
  // 跨页定位目标在树内、桌面收起态：先展开 rail——消费 effect 在 rail 内，不挂载则 URL/高亮都不发生
  const focusTarget = useUiStore((s) => s.focusOutlineNodeId);
  useEffect(() => {
    if (focusTarget === null || outline === null || !railCollapsed) return;
    if (findNodePath(outline.children, focusTarget) === null) return;
    toggleRailCollapse();
  }, [focusTarget, outline, railCollapsed, toggleRailCollapse]);
  const noProject = config === null && !configLoading;
  // 切节点（含回 `#/outline`）清零 dirty：新节点尚未编辑
  useEffect(() => setDetailDirty(false), [nodeId]);
  /** 未保存守卫：true = 可以离开（无修改或用户确认放弃）；取消后留在原处、表单不清 */
  async function confirmDiscard(): Promise<boolean> {
    if (!detailDirty) return true;
    return useUiStore.getState().confirm({
      title: "放弃未保存的修改？",
      description: "当前节点的修改尚未保存，切换后将丢失",
    });
  }

  const selectedNode =
    outline !== null && nodeId !== undefined ? findNode(outline.children, nodeId) : null;

  // 收起 / 展开入口：详情列页头标题行最左（`PageHeader` `leading`，同写作页）；窄屏无相邻栏不渲染
  const railToggle = isDesktop ? (
    <Button
      color="default"
      variant="text"
      size="small"
      onClick={toggleRailCollapse}
      icon={
        railCollapsed ? (
          <RightOutlined className="text-sm" />
        ) : (
          <LeftOutlined className="text-sm" />
        )
      }
      aria-label={railCollapsed ? "展开大纲树" : "收起大纲树"}
      title={railCollapsed ? "展开大纲树" : "收起大纲树"}
      aria-expanded={!railCollapsed}
    />
  ) : undefined;

  // 详情列骨架（树未就绪 / 加载中；形状同写作页正文骨架）
  const detailSkeleton = (
    <div className="space-y-2 rounded-md border border-border p-3">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={cn(skeletonClass, "h-5")} style={{ width: `${92 - i * 12}%` }} />
      ))}
    </div>
  );

  // 详情列（`#/outline` = 空态；`#/outline/:id` = 详情）：页头恒常驻，内容区独立滚动
  let detail: ReactNode;
  if (noProject) {
    detail = (
      <section className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="详情" leading={railToggle} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <EmptyState
            padding="sm"
            action={
              <a href="#/" className="text-sm text-muted-foreground underline hover:text-foreground">
                回到首页打开或创建书籍
              </a>
            }
          >
            未打开项目，无法查看大纲详情
          </EmptyState>
        </div>
      </section>
    );
  } else if (outline === null) {
    detail = (
      <section className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="详情" leading={railToggle} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {outlineError === null ? (
            detailSkeleton
          ) : (
            <div className={cn(errorBannerClass, "flex shrink-0 items-center gap-3")}>
              <span className="min-w-0 flex-1">大纲加载失败，详情暂不可用</span>
              <Button size="small" onClick={retryOutline}>
                重试
              </Button>
            </div>
          )}
        </div>
      </section>
    );
  } else if (nodeId === undefined) {
    detail = (
      <section className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="详情" leading={railToggle} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {outline.children.length === 0 ? (
            <EmptyState padding="sm">还没有大纲，先在左侧新建第一卷</EmptyState>
          ) : (
            // 桌面收起态左侧没有栏：引导指向页头左侧的展开钮（同写作页 `writing-page`）
            <p className="text-sm text-muted-foreground">
              {railCollapsed
                ? "从页头左侧展开大纲树，选择卷、章或场查看详情"
                : "从左侧选择一个卷、章或场查看详情"}
            </p>
          )}
        </div>
      </section>
    );
  } else if (selectedNode === null) {
    // 坏 id / 已删节点：页头 + 引导（不留一个空白的详情列）
    detail = (
      <section className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="详情" leading={railToggle} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <EmptyState
            padding="sm"
            action={
              // 同 OutlineDetail 的 notFound 文案与目标（DESIGN.md `outline-page` 坏 id 空态）
              <div className="flex flex-wrap justify-center gap-2">
                <a
                  href="#/trash"
                  className="whitespace-nowrap rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                >
                  去回收站
                </a>
                <Button href="#/outline" className="whitespace-nowrap">
                  返回大纲
                </Button>
              </div>
            }
          >
            该节点不存在或已被删除
          </EmptyState>
        </div>
      </section>
    );
  } else {
    detail = (
      <OutlineDetail
        key={nodeId}
        node={selectedNode}
        nodeId={nodeId}
        onReload={reload}
        leading={railToggle}
        onDirtyChange={setDetailDirty}
        onNavigate={async (path) => {
          if (await confirmDiscard()) navigate(path);
        }}
      />
    );
  }

  // rail：桌面展开态有；窄屏只在无 id（树页）时有；桌面收起态 = 0px（不渲染 rail，详情列吸收宽度）
  const showRail = !railCollapsed && (isDesktop || nodeId === undefined);

  return (
    // -m-6 / h-[calc(100%+3rem)]：抵消中栏内容区的 p-6（同写作页外壳，见 DESIGN.md
    // §Layout「大纲页的中栏内分栏」）；详情列内补回同一内边距。
    // 拖拽期间根容器禁文本选中（指针已 capture 在手柄上，兜底防边缘选中）。
    <section
      className={cn(
        "-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden",
        resizing && "select-none",
      )}
    >
      {showRail && (
        <OutlineRail
          railRef={railRef}
          nodeId={nodeId}
          reload={reload}
          retry={retryOutline}
          confirmDiscard={confirmDiscard}
          width={
            isDesktop ? (railLayout.width ?? OUTLINE_RAIL_DEFAULT_WIDTH_CSS) : undefined
          }
          // 窄屏全宽无邻栏：抹掉 rail 自带的右边线（DESIGN.md §Layout「分栏边线单所有权」）
          className={isDesktop ? undefined : "w-full border-r-0"}
        />
      )}
      {/* 桌面展开态右边界 6px 拖拽手柄；收起态 / 窄屏不渲染（手柄不画线，分栏线归 rail） */}
      {isDesktop && !railCollapsed && (
        <ResizeHandle
          label="调整大纲树宽度"
          active={resizing}
          onStart={startResize}
          onMove={moveResize}
          onEnd={endResize}
        />
      )}
      {(isDesktop || nodeId !== undefined) && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-6">
          {/* 窄屏「大纲树」返回条（32px，滚动区之外） */}
          {!isDesktop && nodeId !== undefined && (
            <a
              href="#/outline"
              onClick={(e) => {
                // dirty 时先确认（取消 = 留在详情，不清表单）
                e.preventDefault();
                void confirmDiscard().then((ok) => {
                  if (ok) navigate("/outline");
                });
              }}
              className="flex h-8 shrink-0 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeftOutlined className="text-xs" />
              大纲树
            </a>
          )}
          {detail}
        </div>
      )}
    </section>
  );
}

// ============ 左列：大纲树 rail（结构编辑的唯一入口）============

/**
 * 大纲树栏：header（40px，自定义——右端组迁自原页面页头）+ 行区（自身纵向滚动）。
 * 宽度 / 收起态由壳持有（hooks/use-outline-rail）：本栏只消费 `width`；右侧拖拽手柄由壳作为兄弟渲染。
 * 收起入口不在本栏（在详情列页头），见 DESIGN.md `outline-page`「rail header」。
 */
function OutlineRail({
  railRef,
  nodeId,
  reload,
  retry,
  confirmDiscard,
  width,
  className,
}: {
  /** 壳要量当前渲染宽（默认宽度是 CSS 值）作拖拽起点 */
  railRef: RefObject<HTMLElement | null>;
  /** URL 选中节点（唯一选中来源；undefined = `#/outline` 无选中） */
  nodeId?: string;
  /** 壳的整树重拉（写操作后收敛；本栏不自建 loader） */
  reload: () => Promise<void>;
  /** 壳的加载失败重试 */
  retry: () => void;
  /** 未保存守卫：true = 可以导航（无修改或用户确认放弃） */
  confirmDiscard: () => Promise<boolean>;
  /** 展开态宽度（CSS 值或像素）；不传 = 不设内联宽（窄屏全宽走 className） */
  width?: number | string;
  /** 覆盖类（窄屏 `w-full border-r-0`——`cn` 用 twMerge，同属性后者胜） */
  className?: string;
}) {
  const outline = useProjectStore((s) => s.outline);
  const outlineLoading = useProjectStore((s) => s.outlineLoading);
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  // 删除是异步的：完成后要看**当前** URL（而非点击时闭包里的 nodeId）才决定是否收敛
  const nodeIdRef = useRef(nodeId);
  nodeIdRef.current = nodeId;
  // 跨页定位（U4 方案 A）：ui store 的 transient 目标节点 id——概览页点击「阅读进度」
  // 设置后跳转本页；本页消费（展开祖先+滚动+高亮）后清除，不侵入 hash 路由
  const focusOutlineNodeId = useUiStore((s) => s.focusOutlineNodeId);
  const clearFocusOutlineNode = useUiStore((s) => s.clearFocusOutlineNode);
  const setCurrentFocus = useUiStore((s) => s.setCurrentFocus);

  const [error, setError] = useState<string | null>(null);
  /** 折叠的节点 id 集合（空集 = 全部展开） */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  /** 新建/跨页定位的聚焦节点 id（A2：新建成功后滚动到位 + 键盘焦点落行；3s 自动消失） */
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

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

  /** 大纲编号徽标文案（展示口径：卷序 + 全局章序，只计可见节点 ⇒ 删后重排；与
   * `docs/design/10-data-model.md` §4 的服务端章序不同源） */
  const labels = useMemo(() => numberOutline(outline).labels, [outline]);

  /** 推演节点标记（§15）：**唯一来源 = shared `buildDeductionMarks`**（过滤失效/非章 → 树序排序 →
   * 角色与文案），本页不自己算文案/章号；`config.deductionNodes` 由 store 重拉驱动刷新 */
  const deduction = useMemo(() => {
    const marks = buildDeductionMarks(outline, config?.deductionNodes ?? []);
    return { marks, byNode: new Map(marks.map((mark) => [mark.nodeId, mark])) };
  }, [outline, config?.deductionNodes]);

  // 悬浮「问 AI」的页面焦点：项目**有可见推演标记** → 注入推演节点集合（只发布尔，服务端现读
  // 配置展开）；无标记 / 标记全部失效 → null（按钮回普通语义，不注入空段）。
  // 判据用 shared 派生结果而非裸 `config.deductionNodes.length`：失效 id 在读侧原样保留，按长度门控
  // 会在「标记全失效」时留下「按钮带上下文但服务端无段可注入」。
  // 依赖 `outline` 与 `config`（两者异步加载 → 加载完成后必须重跑，否则「有标记但按钮不带上下文」）
  const deductionVisible = deduction.marks.length > 0;
  useEffect(() => {
    setCurrentFocus(deductionVisible ? { focus_deduction: true } : null);
  }, [deductionVisible, setCurrentFocus]);

  // 伏笔标记（S9.2，数据流 API → 映射 → 渲染）：大纲树就绪后并行拉取三类标记关系
  // （GET /relation，source_type=outline_node，relation_type 单值过滤，depth=1——「关系」）→
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

  // 聚焦高亮自动消失（3s）；聚焦动作（滚动 + 键盘焦点）由下方 effect 承担
  useEffect(() => {
    if (focusedNodeId === null) return;
    const t = setTimeout(() => setFocusedNodeId(null), 3000);
    return () => clearTimeout(t);
  }, [focusedNodeId]);

  // 跨页定位消费（U4 方案 A，「点击阅读进度 → 跳 #/outline 并定位该节点」）：
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
    // 展开是异步状态更新：等本轮渲染完成后再设聚焦目标（滚动 + 聚焦由下方 focusedNodeId effect 执行）
    const t = setTimeout(() => {
      // URL 收敛到目标节点（replace 不留历史）：否则从概览点阅读进度只高亮，URL 仍无 id、详情列空着
      window.location.replace(`#/outline/${targetId}`);
      setFocusedNodeId(targetId);
      clearFocusOutlineNode();
    }, 0);
    return () => clearTimeout(t);
  }, [focusOutlineNodeId, outline, clearFocusOutlineNode]);

  // 聚焦动作（A2：新建即聚焦 + U4 跨页定位共用）：下一帧查 DOM 滚动到视口中部 + 行聚焦
  // （行 tabIndex=-1 可聚焦）；节点不渲染（折叠祖先未展开/已删）→ focusNewItem 静默返回 false
  useEffect(() => {
    if (focusedNodeId === null) return;
    const id = focusedNodeId;
    const t = setTimeout(() => focusNewItem(`[data-node-id="${id}"]`), 0);
    return () => clearTimeout(t);
  }, [focusedNodeId]);

  // URL 选中收敛（DESIGN.md `outline-page`）：nodeId 变化（行单击 / 深链 / 前进后退）或树刷新后，
  // 展开该节点祖先链（否则折叠父下的节点不在 DOM）并 scrollIntoView（block: nearest）——
  // 只在 nodeId / outline 变化时跑一次，不在每次 render 滚动。坏 id 不在此处理（详情列空态引导）。
  useEffect(() => {
    if (nodeId === undefined || outline === null) return;
    const path = findNodePath(outline.children, nodeId);
    if (path === null) return;
    const ancestors = path.slice(0, -1);
    setCollapsed((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ancestors) if (next.delete(id)) changed = true;
      return changed ? next : prev;
    });
    const t = setTimeout(() => {
      document
        .querySelector(`[data-node-id="${nodeId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }, 0);
    return () => clearTimeout(t);
  }, [nodeId, outline]);

  /** 树变更后的统一刷新：展开目标父 + 重拉整树（刷新策略注释见文件头）；
   * focusNodeId：创建成功后滚动到位 + 聚焦新节点（原型「成功后自动展开父节点、新节点高亮」，A2） */
  async function afterTreeChanged(expandParentId?: string, focusNodeId?: string) {
    if (expandParentId) expand(expandParentId);
    await reload();
    if (focusNodeId) setFocusedNodeId(focusNodeId);
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
    setEditing({ nodeId: node.id, field });
    setEditingValue(field === "title" ? node.title : (node.summary ?? ""));
  }

  function cancelEdit() {
    setEditing(null);
    setEditingValue("");
  }

  /** 提交判定走纯函数（shouldCommitTitle/Summary：无变化不发请求、空标题不提交、摘要允许清空）。
   * 悲观提交（oracle 补丁）：提交期间保持编辑态，成功后退出；失败按 editFailureRecovery 决策——
   * 节点已不存在（NOT_FOUND）→ 放弃编辑 + 重拉树；其余 → 保持编辑态与输入值（不重拉树），
   * 用户可修正后重试（Enter 再提交）。busy 防重入（提交中重复 Enter/blur 不重复请求） */
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
        return false;
      }
      // 恢复编辑态并保留输入值（editing/editingValue 未动）；输入框已失焦，用户点击即可修正重试
      setError(describeOutlineError(code));
      return false; // 保存失败：Ctrl+S 据此不生成备份
    } finally {
      setBusy(false);
    }
  }

  // Ctrl/Cmd+S（B2）：行内编辑进行中 → 提交当前编辑（Enter 同语义）；未编辑时不参与
  // （返回 Promise：快捷键会等保存落定再走存档阶段）
  useSaveShortcut(() => {
    if (editing === null) return;
    const node = findNode(outline?.children ?? [], editing.nodeId);
    if (node) return commitEdit(node, editing.field);
  }, editing !== null);

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
    setCreatingAt({ parentId, type });
    setCreateValue("");
    if (parentId !== ROOT_NODE_ID) expand(parentId); // 新建输入显示在父 children 末尾
  }

  function cancelCreate() {
    setCreatingAt(null);
    setCreateValue("");
  }

  /** 空值 = 取消（不误建）；成功 → 展开父 + 高亮新节点（afterTreeChanged 第二参）+ 导航到新节点
   * （URL 选中，DESIGN.md「数据展示」链式新建：新条目 = 选中 + 聚焦，否则下一次 Enter 被无选中守卫吞掉） */
  async function commitCreate() {
    if (!creatingAt) return;
    const title = createValue.trim();
    const { parentId, type } = creatingAt;
    if (!title) {
      cancelCreate();
      return;
    }
    // 发 API 前确认（新建成功后直接导航，不再弹第二次）。确认框抢焦点会先触发 InlineInput 的
    // `onBlur=cancelCreate`，所以取消分支要把输入行与已输入卷名恢复回来（详情 dirty 不动）
    const snapshot = { creatingAt, value: createValue };
    if (!(await confirmDiscard())) {
      setCreatingAt(snapshot.creatingAt);
      setCreateValue(snapshot.value);
      return;
    }
    cancelCreate();
    try {
      const res = await createOutlineNode({ type, title, parent_id: parentId });
      useUiStore.getState().showToast(`已创建${TYPE_LABEL[type]}《${title}》`);
      await afterTreeChanged(parentId, res.id);
      navigate(`/outline/${res.id}`);
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

  // ============ URL 选中与行级交互（行单击进详情 / Enter 新建子级） ============
  // 行手势（DESIGN.md `outline-page`）：单击行体 = 导航 `#/outline/:id`（同 id 幂等，不重复 push）；
  // 标题 / 摘要单击 = 只就地编辑（stopPropagation，不切详情）；双击不再承担「进详情」。
  // 行内按钮 / 输入框 / 链接 / 右键菜单触发区不导航（closest 守卫 + stopPropagation）；
  // 拖拽收尾的鼠标事件也不导航（dragNodeId 守卫）。

  /** 行单击：非交互元素 → 导航到该节点（选中唯一来源 = URL）；交互元素（按钮/输入框/链接）
   * stopPropagation，不冒泡到树容器（容器单击 = 清选中） */
  async function handleRowClick(e: MouseEvent<HTMLDivElement>, node: OutlineNode) {
    if ((e.target as HTMLElement).closest("button, input, a")) {
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    if (dragNodeId !== null) return; // 拖拽结束的收尾点击不导航
    if (nodeId === node.id) return; // 同 id 幂等：不重复 push、不弹未保存确认
    if (!(await confirmDiscard())) return; // 取消：留在原处、不清表单
    cancelEdit();
    cancelCreate();
    navigate(`/outline/${node.id}`);
  }

  /** 行键盘：URL 选中节点按 Enter → 新建子级（子级类型由父层级推导 CHILD_TYPE，
   * 就地输入行出现在子级末尾，Enter 确认/Esc 取消——commitCreate 逻辑复用）；
   * 编辑态/新建态/拖拽中/busy/scene（无子级）时禁用；
   * 仅行 div 自身聚焦时响应（oracle 修复：子元素按钮/输入框聚焦时交给子元素处理，不劫持按钮 Enter→click） */
  function handleRowKeyDown(e: KeyboardEvent<HTMLDivElement>, node: OutlineNode) {
    if (e.key !== "Enter") return;
    if (e.target !== e.currentTarget) return; // oracle 修复：仅行自身聚焦响应，子元素（按钮/输入框）聚焦交给子元素
    const childType = CHILD_TYPE[node.type];
    if (childType === null) return; // scene 是叶子，无子级可建
    if (editing !== null || creatingAt !== null || dragNodeId !== null || busy) return;
    if (nodeId !== node.id) return; // 仅 URL 选中节点触发
    e.preventDefault();
    startCreate(node.id, childType);
  }

  // ============ 拖拽移动（S13.1：原生 HTML5 DnD，上下半判定 + 插入指示线，同级排序可用） ============
  // 语义：拖到目标行上半 = 插到该节点前（该行上边缘指示线）、下半 = 插到该节点后（下边缘指示线）；
  // 目标父 = 目标行的父；目标行的父不合法但目标行自身可承载（空卷 / 折叠卷 / 空章，也含展开的非空卷 /
  // 非空章）⇒ 整行 = 落为该行子级末尾（行体高亮）；顶层空白区 = 排 root 末尾（保留原语义）。
  // 判定单源 = resolveDropPlan。

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

  /** 行 dragover：resolveDropPlan 判定（父合法 → 同级前后；目标行可承载 → 落为子级）→
   * 设置落点（去重防高频重渲染） */
  function handleDragOver(e: DragEvent, targetNodeId: string) {
    e.stopPropagation(); // 行内事件不冒泡到顶层容器（避免目标高亮错乱）
    const nodes = outline?.children ?? [];
    const dragNode = dragNodeId ? findNode(nodes, dragNodeId) : null;
    if (!dragNode) return;
    // 上下半要先从事件取（currentTarget 只在事件回调里有效）；合法性交给 resolveDropPlan
    const plan = resolveDropPlan(nodes, dragNode.id, targetNodeId, insertSideFromEvent(e));
    if (plan === null) return;
    e.preventDefault(); // 允许 drop
    e.dataTransfer.dropEffect = "move";
    setDragTarget((prev) => (sameDragTarget(prev, plan.target) ? prev : plan.target));
  }

  /** 行 dragleave：仅真正离开该行才清除该行的插入目标（子元素间移动不触发） */
  function handleDragLeave(e: DragEvent, targetNodeId: string) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragTarget((prev) =>
        prev !== null && prev.kind !== "root-end" && prev.nodeId === targetNodeId ? null : prev,
      );
    }
  }

  /** 行 drop：resolveDropPlan → order → PUT /move（原地放置不发请求） */
  async function handleDrop(e: DragEvent, targetNodeId: string) {
    e.stopPropagation();
    e.preventDefault();
    if (!dragNodeId) return;
    const nodes = outline?.children ?? [];
    const dragNode = findNode(nodes, dragNodeId);
    if (!dragNode) return;
    // order 按 drop 瞬间的上下半重新判定（与 dragover 同一条判定，防异步渲染滞后）
    const plan = resolveDropPlan(nodes, dragNode.id, targetNodeId, insertSideFromEvent(e));
    if (plan === null) return;
    // 锚点 = 拖拽节点自身：插到自己前/后 = 原地放置（剔除后锚点消失会误回退末尾，需提前拦截）
    if (plan.insert.kind !== "end" && plan.insert.nodeId === dragNode.id) {
      setDragNodeId(null);
      setDragTarget(null);
      return;
    }
    // 剔除拖拽节点后计算（oracle M1 方案 B——同父重排锚点在下方时 pre-removal 数组会错位 1 位）
    const parentChildren = findNodeChildren(nodes, plan.parentId) ?? [];
    const order = dropInsertOrder(parentChildren, plan.insert, dragNode.id);
    // 原地放置（父不变且移动后位置不变）：不发请求，直接清理拖拽态（避免误导 toast「已移动」）
    if (isNoopDrop(nodes, dragNode.id, plan.parentId, order)) {
      setDragNodeId(null);
      setDragTarget(null);
      return;
    }
    setBusy(true);
    try {
      await moveOutlineNode(dragNode.id, { parent_id: plan.parentId, order });
      useUiStore.getState().showToast(`已移动《${dragNode.title}》`);
      await afterTreeChanged(plan.parentId);
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

  /**
   * 行级「设为阅读进度」（卡片 1.1）：仅章节点行提供入口（卷/场景行不传菜单项）——
   * 提交实现与详情页共用（lib/current-position.ts），成功后 store 重拉 config 联动
   * 概览页「阅读进度」/ 行尾徽标 / compute 预览默认节点。
   * 已是阅读进度 → 菜单项禁用（与行尾「阅读进度」徽标同判据）。
   */
  async function handleSetCurrentPosition(node: OutlineNode) {
    if (config?.currentPosition === node.id) return; // 禁用态双保险（菜单已关但状态可能刚变）
    await setCurrentPosition(node.id);
  }

  /**
   * 行级「标记为推演节点 / 移出推演节点」：仅章行给入口（`isDeductionMarkHost`，
   * 与服务端 `PUT /project/config` 同口径）——提交实现与详情页共用（lib/deduction.ts），
   * 全量数组一次提交，成功后 store 重拉 config ⇒ 本页徽标与详情页同步收敛（无需重拉树）。
   */
  async function handleToggleDeduction(node: OutlineNode) {
    // 基底 = **可见标记**（不是 raw config——失效 id 回传会被服务端 400 锁死，见 lib/deduction.ts 注释）
    await submitDeductionMarks(toggledDeductionNodes(deduction.marks, node.id));
  }

  /** 软删直接执行（H2：不再弹二次确认）；删除的是**当前 URL** 指向的节点或其祖先 → 重拉树后回 `#/outline`
   * （不留死详情）；OUTLINE_NODE_NOT_FOUND（已被 purge）→ 横幅 + 刷新树；其余错误 toast。
   * 在途交互（删除请求 / 重拉树）期间用户可能已切到别的节点 ⇒ 收尾时按 `nodeIdRef`（当前 URL）
   * 而非点击时的闭包重算，不误清刚切过去的新选中。 */
  async function handleDelete(node: OutlineNode) {
    // 先快照删除前的树：删除成功后该子树已不在树上，无法再判断「URL 节点是否在被打掉的子树里」
    const treeBefore = outline?.children ?? [];
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
      const currentId = nodeIdRef.current;
      if (
        currentId !== undefined &&
        deleteInvalidatesSelection(treeBefore, node.id, currentId)
      ) {
        window.location.replace("#/outline");
      }
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
        value={createValue}
        onChange={setCreateValue}
        onKeyDown={handleCreateKeyDown}
        onCancel={cancelCreate}
      />
    );
  }

  /** 整树渲染（内部递归函数，闭包共享页面 state；S13.1 两行结构：
   * 第一行 = 折叠箭头 | 类型/编号徽标（卷章 `min-w-14`、场 `w-7`）| 标题 | 伏笔标记 | 右端操作区（阅读进度徽标在前、删除按钮贴尾）；
   * 第二行 = 摘要（缩进对齐标题下方，默认显示、空不渲染、点击就地编辑）；
   * 拖拽：整节点块可拖，目标行上半/下半 → 插入指示线（accent 2px 绝对定位层，pointer-events-none 不拦截事件）；
   * 行可聚焦（tabIndex=-1）承载 Enter；单击行进详情（URL 选中）、选中后 Enter 新建子级 */
  function renderNodes(nodes: OutlineNode[], depth: number): ReactNode {
    return nodes.map((node) => {
      const hasChildren = node.type !== "scene" && (node.children?.length ?? 0) > 0;
      const isCollapsed = collapsed.has(node.id);
      const isCurrent = config?.currentPosition === node.id;
      const editingTitle = editing?.nodeId === node.id && editing.field === "title";
      const editingSummary = editing?.nodeId === node.id && editing.field === "summary";
      const insertBefore = dragTarget?.kind === "before" && dragTarget.nodeId === node.id;
      const insertAfter = dragTarget?.kind === "after" && dragTarget.nodeId === node.id;
      // 整行落为子级（目标行父不合法、目标行自身可承载）：行体淡染 + 描边，不画插入线
      const dropInside = dragTarget?.kind === "inside" && dragTarget.nodeId === node.id;
      const isDragging = dragNodeId === node.id;
      const creatingHere = creatingAt?.parentId === node.id;
      const focused = node.id === focusedNodeId;
      const selected = nodeId === node.id;
      // 编号徽标文案（卷/章 = `第N卷` / `第N章`；场景不编号 → undefined，徽标回落到枚举文案）
      const numberLabel = labels.get(node.id);
      // 推演标记（§15；非章 / 未标记 → undefined，不渲染徽标）
      const deductionMark = deduction.byNode.get(node.id);
      // 行级新建子级：子类型由本行层级推导；null = 叶子（场），无按钮
      const childType = CHILD_TYPE[node.type];
      // 行根元素 props（右键菜单 trigger 与普通 div 共用；编辑态退化为普通 div）
      const rowProps = {
        "data-node-id": node.id,
        draggable: !editingTitle && !editingSummary && !isDragging && !busy,
        tabIndex: -1,
        onDragStart: (e: DragEvent<HTMLDivElement>) => handleDragStart(e, node),
        onDragEnd: handleDragEnd,
        onDragOver: (e: DragEvent<HTMLDivElement>) => handleDragOver(e, node.id),
        onDragLeave: (e: DragEvent<HTMLDivElement>) => handleDragLeave(e, node.id),
        onDrop: (e: DragEvent<HTMLDivElement>) => void handleDrop(e, node.id),
        "aria-current": selected ? ("page" as const) : undefined,
        onClick: (e: MouseEvent<HTMLDivElement>) => void handleRowClick(e, node),
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => handleRowKeyDown(e, node),
        className: cn(
          "relative cursor-grab rounded-md px-2 py-1 transition-colors hover:bg-muted/60 active:cursor-grabbing",
          focused && "bg-primary/10 ring-1 ring-primary/30 ring-inset", // 新建/定位临时高亮（3s 消失）
          isDragging && "opacity-50",
          selected && "bg-accent", // 选中（URL）= surface-muted 灰面 + 文字不变色（同左栏导航）
          // 落为子级的行体高亮（拖拽态临时反馈，压在选中面之上才能看见）
          dropInside && "bg-primary/10 ring-1 ring-primary/30 ring-inset",
        ),
        style: { paddingLeft: depth * 20 + 8 },
        title: "拖动到目标行即可移动（上半=插前、下半=插后；目标行可承载时整行=落为子级）",
      };
      // 行内容（第一行 + 摘要第二行 + 插入指示线）
      const rowChildren = (
        <>
          {/* 第一行：折叠箭头 | 类型徽标 | 标题 | 伏笔标记 | 右端操作区（阅读进度徽标 + 删除按钮，删除贴行尾）
              （O2 起：操作区 ml-auto 右端对齐，时间戳显示已移除；详情/＋新建按钮移除；
               AskAiButton 移除——右键菜单替代（注入会话上下文 + 建立关联）） */}
          <div className="flex items-center gap-2">
            {/* 折叠箭头：与设定树同款（antd text 图标按钮 + chevron 旋转）——原先用 ▸/▾ 字形 +
                自绘 button，两页两套观感（arrow 占位 28px = size=small 图标按钮宽度，第二行同步占位） */}
            {hasChildren ? (
              <Button
                color="default"
                variant="text"
                size="small"
                className="-ml-2"
                onClick={(e) => {
                  e.stopPropagation(); // 行内动作不触发导航
                  toggleCollapsed(node.id);
                }}
                aria-label={isCollapsed ? "展开" : "折叠"}
                icon={
                  <RightOutlined
                    className={cn("text-sm transition-transform", !isCollapsed && "rotate-90")}
                  />
                }
              />
            ) : (
              /* 无子节点行占位：**必须与折叠箭头同几何**（icon-only small 按钮 = 24px 宽 + -ml-2）；
                 写成 w-7（28px）会让「有场/无场」两类章的类型徽标、标题、摘要、新建行各差 12px */
              <span className="-ml-2 w-6 shrink-0" />
            )}
            <TypeChip
              tone={node.type === "volume" ? "default" : "soft"}
              className={cn(
                "shrink-0 justify-center tabular-nums",
                numberLabel !== undefined ? "min-w-14" : "w-7",
              )}
            >
              {numberLabel ?? TYPE_LABEL[node.type]}
            </TypeChip>
            {/* 标题：点击就地编辑（Enter 保存 / Esc 取消 / 失焦保存）；stopPropagation 隔离——
                单击标题 = 编辑而非选中（冲突设计） */}
            {editingTitle ? (
              <InlineInput
                value={editingValue}
                onChange={setEditingValue}
                onKeyDown={handleEditKeyDown(node, "title")}
                onBlur={() => void commitEdit(node, "title")}
                placeholder="标题"
              />
            ) : (
              <span
                className={cn(
                  "min-w-0 cursor-text truncate text-sm hover:underline",
                  "text-foreground",
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
                伏笔名（多标记按 lib/outline-hooks 排序排列）；**徽标 = 导航链接**（点击跳该伏笔详情
                `#/hooks/:id`，行 click 守卫排除 `a` ⇒ 不导航、不进节点详情）；
                标记随行渲染：折叠父行自身标记仍显示、子树标记随展开可见（数据为节点自身关系，
                不聚合后代）；加载失败 hookMarks=null 不渲染 */}
            {hookMarks !== null && (hookMarks.get(node.id)?.length ?? 0) > 0 && (
              <span className="flex shrink-0 items-center gap-0.5">
                {(hookMarks.get(node.id) ?? []).map((mark) => (
                  <NodeHookMarkBadge key={`${mark.relationType}-${mark.hookId}`} mark={mark} />
                ))}
              </span>
            )}
            {/* 操作区：右端对齐（ml-auto）；状态徽标 → 行尾操作按钮；
                新建改选中后 Enter；AskAiButton 移除。徽标排在删除按钮**左侧**：删除按钮恒贴行尾
                （徽标出现不得把它往左推——跨行操作列才能对齐）。rail 内状态徽标为**图标态**
                （DESIGN.md `outline-page`：320px rail 内文字 chip 会把标题挤到不可读），完整语义进
                title / aria-label；详情页仍保留文字 chip。 */}
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {/* 推演节点徽标：排「阅读进度」**左侧**（阅读进度是单值固定标记、恒贴右；推演标记可能多个，
                  从左侧依次排开）——文案与章号均来自 shared 派生，本页只拼 title */}
              {deductionMark !== undefined && (
                <TypeChip
                  className="shrink-0"
                  title={deductionMarkTitle(deductionMark, deduction.marks.length)}
                >
                  <BranchesOutlined aria-label={deductionMark.label} />
                </TypeChip>
              )}
              {isCurrent && (
                <TypeChip className="shrink-0" title="阅读进度">
                  <AimOutlined aria-label="阅读进度" />
                </TypeChip>
              )}
              {/* 行级建子级（卡 3，DESIGN.md `data-row`）：卷 → 新建章、章 → 新建场；插在删除左侧
                  （删除恒贴行尾）；场无合法子层级 → 不渲染。与 Enter 建子级同一路径
                  （startCreate → 子级末尾就地输入行），成功后新条目选中 + 聚焦 */}
              {childType !== null && (
                <Button
                  color="default"
                  variant="text"
                  size="small"
                  title={`新建${TYPE_LABEL[childType]}`}
                  aria-label={`在《${node.title}》下新建${TYPE_LABEL[childType]}`}
                  onClick={(e) => {
                    e.stopPropagation(); // 行内动作不触发导航
                    startCreate(node.id, childType);
                  }}
                  icon={<PlusOutlined className="text-sm" />}
                />
              )}
              <Button
                color="default"
                variant="text"
                size="small"
                title="移入回收站"
                aria-label="移入回收站"
                onClick={(e) => {
                  e.stopPropagation(); // 行内动作不触发导航
                  void handleDelete(node);
                }}
                icon={<DeleteOutlined className="text-sm" />}
              />
            </span>
          </div>
          {/* 第二行：摘要（缩进对齐标题下方——首占位同折叠箭头几何（-ml-2 w-6）+ **编号徽标占位同宽**
              （卷/章行 `min-w-14`、场景行 `w-7`；不同宽即摘要行错位）；
              默认显示、空不渲染、点击就地编辑） */}
          {editingSummary || node.summary ? (
            <div className="mt-0.5 flex items-center gap-2">
              <span className="-ml-2 w-6 shrink-0" />
              <span className={cn("shrink-0", numberLabel !== undefined ? "min-w-14" : "w-7")} />
              {editingSummary ? (
                <InlineInput
                  value={editingValue}
                  onChange={setEditingValue}
                  onKeyDown={handleEditKeyDown(node, "summary")}
                  onBlur={() => void commitEdit(node, "summary")}
                  placeholder="摘要"
                />
              ) : (
                <span
                  className="min-w-0 cursor-text truncate text-xs text-muted-foreground hover:underline"
                  title="点击编辑摘要"
                  onClick={(e) => {
                    e.stopPropagation(); // 摘要单击 = 编辑而非选中（冲突设计，同标题）
                    startEdit(node, "summary");
                  }}
                >
                  {node.summary}
                </span>
              )}
            </div>
          ) : null}
          {/* 插入指示线（S13.1）：目标行上边缘（插前）/下边缘（插后）；共享 DropIndicator（primary 3px + 圆点） */}
          {insertBefore && <DropIndicator position="top" />}
          {insertAfter && <DropIndicator position="bottom" />}
        </>
      );
      return (
        <div key={node.id}>
          {/* 节点块（第一行 + 摘要第二行；整块可拖拽：编辑态/自身拖拽中禁用 draggable，避免文本选择与嵌套拖动）；
              data-node-id 为跨页定位锚点（U4：概览页点击阅读进度 → scrollIntoView 定位）；
              tabIndex=-1 使行可聚焦（URL 选中后按 Enter 触发新建子级 onKeyDown）；
              行级右键菜单（RowContextMenu）——注入会话上下文（focus_node_id）+ 建立关联
              （outline_node 源端点）+ 设为阅读进度（仅章节点行，卡片 1.1）；编辑态不挂右键菜单（行内输入框保留原生文本菜单：复制/粘贴） */}
          {editingTitle || editingSummary ? (
            <div {...rowProps}>{rowChildren}</div>
          ) : (
            <RowContextMenu
              focus={{ focus_node_id: node.id }}
              source={{ type: "outline_node", id: node.id, name: node.title, nodeType: node.type }}
              onCreated={() => useUiStore.getState().notifyDataChanged()}
              extraItems={
                isDeductionMarkHost(node.type) ? (
                  <>
                    <ContextMenuItem onClick={() => void handleToggleDeduction(node)}>
                      <BranchesOutlined className="text-sm" />
                      {deductionMenuLabel(deductionMark !== undefined)}
                    </ContextMenuItem>
                    <ContextMenuItem
                      disabled={isCurrent}
                      onClick={() => void handleSetCurrentPosition(node)}
                    >
                      <AimOutlined className="text-sm" />
                      设为阅读进度
                    </ContextMenuItem>
                  </>
                ) : undefined
              }
              trigger={<div {...rowProps} />}
            >
              {rowChildren}
            </RowContextMenu>
          )}
          {/* 子节点递归渲染（折叠态不渲染） */}
          {hasChildren && !isCollapsed && <div>{renderNodes(node.children ?? [], depth + 1)}</div>}
          {/* 就地新建输入行（父 children 末尾；父折叠时 startCreate 已自动展开） */}
          {creatingHere && (
            <div
              className="flex items-center gap-2 rounded-md px-2 py-1"
              style={{ paddingLeft: (depth + 1) * 20 + 8 }}
            >
              <span className="-ml-2 w-6 shrink-0" />
              {/* 新建行的类型徽标：编号未分配 → 只给枚举文案，但几何与建出后的编号徽标同宽
                  （卷/章 `min-w-14`、场 `w-7`，否则输入行与上面的行错位） */}
              <TypeChip
                tone={creatingAt.type === "volume" ? "default" : "soft"}
                className={cn(
                  "h-5 shrink-0 justify-center",
                  creatingAt.type === "scene" ? "w-7" : "min-w-14",
                )}
              >
                {TYPE_LABEL[creatingAt.type]}
              </TypeChip>
              <InlineInput
                value={createValue}
                onChange={setCreateValue}
                onKeyDown={handleCreateKeyDown}
                onBlur={cancelCreate}
                placeholder={`新${TYPE_LABEL[creatingAt.type]}标题，Enter 创建`}
              />
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
    <aside
      ref={railRef}
      aria-label="大纲树"
      style={width === undefined ? undefined : { width }}
      // 桌面展开态分栏线归本栏；窄屏全宽由壳传 `border-r-0`
      //（DESIGN.md §Layout「分栏边线单所有权」——手柄不画线，只有面板边线能覆盖全部场景）
      className={cn("flex min-h-0 shrink-0 flex-col border-r border-border", className)}
    >
      {/* rail header（40px，自定义非 PageHeader）：标题 + 原页头右端图标组；**不放收起钮**
          （收起 / 展开入口在详情列页头 leading，同写作页）。图标按钮均带 title / aria-label。 */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        {/* 字号档 `section-title`（16px / 600）：header 是自定义 40px 行，不用 antd 标题控件
            （避免 Typography 自带 margin / 文字色，40px 行高下要的是纯字号 + 截断） */}
        <span className="min-w-0 flex-1 truncate text-base font-semibold">大纲</span>
        <div className="flex shrink-0 items-center gap-1">
          {/* 一键清空推演标记（DESIGN.md「`推演节点` 徽标」）：仅**有可见标记**时渲染
              （无标记时清空无意义，也不给一个点了没反应的按钮）；无二次确认 */}
          {deduction.marks.length > 0 && (
            <Button
              color="default"
              variant="text"
              size="small"
              title="清除推演标记"
              aria-label="清除推演标记"
              onClick={() => void clearDeductionMarks()}
              icon={<ClearOutlined className="text-sm" />}
            />
          )}
          <Button
            color="default"
            variant="text"
            size="small"
            title={collapsed.size > 0 ? "全部展开" : "全部折叠"}
            aria-label={collapsed.size > 0 ? "全部展开" : "全部折叠"}
            disabled={!outline || outline.children.length === 0}
            onClick={toggleAllCollapse}
            icon={
              collapsed.size > 0 ? (
                <MenuUnfoldOutlined className="text-sm" />
              ) : (
                <MenuFoldOutlined className="text-sm" />
              )
            }
          />
          <Button
            color="default"
            variant="text"
            size="small"
            title="新建卷"
            aria-label="新建卷"
            // 无项目 / 树未就绪时不给入口（否则开一个必定失败的输入行）；空树已加载仍可建第一卷
            disabled={noProject || outline === null}
            onClick={() => startCreate(ROOT_NODE_ID, "volume")}
            icon={<PlusOutlined className="text-sm" />}
          />
        </div>
      </div>

      {/* 行区：自身纵向滚动（p-2 = 8px）；错误横幅挂在这里，不撑高 rail */}
      {/* 空白区 = 这个滚动容器（铺满 rail），不是内容高度的内层包裹 ⇒ 清选中挂这里 */}
      <div
        className="min-h-0 flex-1 overflow-y-auto p-2"
        onClick={(e) => {
          // 空白区单击 = 清选中（回 `#/outline`）；交互元素 / 拖拽收尾不触发
          if ((e.target as HTMLElement).closest("button, input, a")) return;
          if (dragNodeId !== null) return;
          if (nodeId === undefined) return; // 已无选中：不弹确认
          void confirmDiscard().then((ok) => {
            if (ok) navigate("/outline");
          });
        }}
      >
        {/* 页级错误横幅（destructive token 类） */}
        {error && <div className={cn(errorBannerClass, "mb-2")}>{error}</div>}

        {noProject ? (
        /* 未打开项目：引导回首页（侧栏无项目可点的现状接受项，S1.6 文档已说明） */
        <EmptyState
          padding="sm"
          action={
            <a href="#/" className="text-sm text-muted-foreground underline hover:text-foreground">
              回到首页打开或创建书籍
            </a>
          }
        >
          未打开项目，无法编辑大纲
        </EmptyState>
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
          <Button className="ml-3" onClick={retry}>
            重试
          </Button>
        </div>
      ) : outline.children.length === 0 ? (
        /* 空态：就地新建（输入行内嵌引导卡，替代原「新建第一卷」弹窗按钮） */
        creatingAt?.parentId === ROOT_NODE_ID ? (
          <EmptyState
            action={
              <div className="mx-auto max-w-sm">
                <RootCreateRow
                  value={createValue}
                  onChange={setCreateValue}
                  onKeyDown={handleCreateKeyDown}
                  onCancel={cancelCreate}
                />
              </div>
            }
          >
            输入第一卷标题，Enter 创建
          </EmptyState>
        ) : (
          <EmptyState
            action={
              <Button type="primary" onClick={() => startCreate(ROOT_NODE_ID, "volume")}>
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
          className={cn(dragTarget?.kind === "root-end" && "ring-1 ring-primary/30 ring-inset")}
          onDragOver={handleRootDragOver}
          onDragLeave={handleRootDragLeave}
          onDrop={(e) => void handleRootDrop(e)}
        >
          {renderRootCreateRow()}
          {renderNodes(outline.children, 0)}
        </div>
      )}
      </div>
    </aside>
  );
}
