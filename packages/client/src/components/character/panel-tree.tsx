// 能力面板树控件（卡片 3.4；视觉契约见 docs/ui/DESIGN.md `panel-tree`）
//
// 职责：结构编辑（增/删/改名/拖拽排序/拖成子级）+ 叶子赋值（自动判定类型）+ 模板/从角色复制。
// - **结构编辑是人工编辑**：产物走 `onChange` 进表单 state，由既有保存路径 `PUT partial` 落库，
//   **不产生 Delta**（只有已存在叶子可被 Delta 改——`docs/design/10-data-model.md` §14 不变式 4）
// - 树变换全部走 `lib/panel-tree.ts` 纯函数（索引路径寻址；点分**名**路径留给 Delta 解析）
// - 只读态（tab 2）：工具条与行操作**禁用而非隐藏**（字段位置稳定，同字段区约定）
import { useEffect, useMemo, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { Button, Input, Select } from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  InsertRowBelowOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import type { AbilityPanelNode, EntitySummary } from "@whispering233/ai-editor-shared";
import { cloneAbilityPanel, isAbilityBranch, parseAbilityPanel } from "@whispering233/ai-editor-shared";
import { getEntityDetail, listEntities } from "../../lib/api";
import {
  PANEL_TEMPLATES,
  insertPanelNode,
  movePanelNode,
  panelPathKey,
  panelWarningMap,
  planPanelRowDrop,
  removePanelNode,
  renamePanelNode,
  setPanelLeafValue,
  type PanelIndexPath,
} from "../../lib/panel-tree";
import { ConfirmDialog } from "../outline/dialogs";
import { DropIndicator } from "../ui/drop-indicator";
import { cn } from "../../lib/utils";
import { useUiStore } from "../../stores/ui";

/** 叶子值 → 输入框文本（空值 → 空串，由 placeholder 呈现 `—`） */
function valueText(value: string | number | undefined): string {
  return value === undefined ? "" : String(value);
}

/** 拖拽形态：索引路径字符串载荷 + 目标行（上/下插入线，中段 = 成为子级）。
 * `reject: true` = **会被拒绝的落点**（目标为带值叶子）：不显任何反馈，但需放行 drop 以给提示 */
type PanelDragTarget =
  | { path: string; placement: "before" | "on" | "after"; reject?: boolean }
  | null;

/** 「带值叶子」提示文案（新增子级 / 拖成子级两条路径**同源**——策略：拒绝而非丢值） */
const LEAF_HAS_VALUE_HINT = "该字段已有值，先清空值再添加子级";

/** 索引路径字符串 → 下标链（`panelPathKey` 的逆；空串 = 根层级） */
function parsePathKey(key: string): PanelIndexPath {
  return key === "" ? [] : key.split(".").map((s) => Number(s));
}

/** 待确认的替换（模板 / 从角色复制——两者都是**整体替换**语义） */
interface PendingReplace {
  label: string;
  panel: AbilityPanelNode[];
}

export function PanelTree({
  panel,
  onChange,
  disabled = false,
  selfId,
}: {
  /** 面板原始值（可 raw——内部先过 `parseAbilityPanel` 规范化） */
  panel: unknown;
  onChange: (next: AbilityPanelNode[]) => void;
  /** 只读态（tab 2）：输入与操作图标禁用，拖拽关闭 */
  disabled?: boolean;
  /** 本角色 id（「从角色复制」候选里排除自己） */
  selfId?: string;
}) {
  const nodes = useMemo(() => parseAbilityPanel(panel), [panel]);
  const warnings = useMemo(() => panelWarningMap(nodes), [nodes]);

  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const [editing, setEditing] = useState<{ path: string; draft: string } | null>(null);
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<PanelDragTarget>(null);
  const [pendingDelete, setPendingDelete] = useState<{ path: PanelIndexPath; name: string } | null>(
    null,
  );
  const [pendingReplace, setPendingReplace] = useState<PendingReplace | null>(null);
  const [copyCandidates, setCopyCandidates] = useState<EntitySummary[] | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);

  /** 全部行展开（新建/切换角色时重置折叠态——折叠集以索引路径为键，跨角色会错位） */
  useEffect(() => {
    setCollapsed([]);
    setEditing(null);
    setDropTarget(null);
  }, [selfId]);

  function commit(next: AbilityPanelNode[] | null): void {
    if (next === null) return; // 非法操作（空名/路径失效）→ 不改数据
    if (next === nodes) return; // 值未变化
    onChange(next);
  }

  function toggleCollapsed(key: string): void {
    setCollapsed((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  /** 新增节点（同级或子级）：插到目标位后立刻进入改名态（空名节点无意义，不允许落库） */
  function addNode(parentPath: PanelIndexPath, index: number, defaultName: string): void {
    const next = insertPanelNode(nodes, parentPath, index, defaultName);
    if (next === null) return;
    commit(next);
    const insertedPath = [...parentPath, index];
    // 展开父级并进入改名（新节点默认名只是占位，避免用户忘记命名即落库）
    setCollapsed((prev) => prev.filter((k) => k !== panelPathKey(parentPath)));
    setEditing({ path: panelPathKey(insertedPath), draft: defaultName });
  }

  /** 新增子级：目标为**带值的叶子**时先要求清空（分支不可赋值 → 静默丢值是数据损失） */
  function addChild(path: PanelIndexPath, node: AbilityPanelNode): void {
    if (isAbilityBranch(node)) {
      addNode(path, node.children?.length ?? 0, "新字段");
      return;
    }
    if (node.value !== undefined) {
      useUiStore.getState().showToast(LEAF_HAS_VALUE_HINT, "error");
      return;
    }
    addNode(path, 0, "新字段");
  }

  function commitRename(): void {
    if (editing === null) return;
    const path = parsePathKey(editing.path);
    const next = renamePanelNode(nodes, path, editing.draft);
    setEditing(null);
    commit(next);
  }

  function handleDelete(path: PanelIndexPath, node: AbilityPanelNode): void {
    if (isAbilityBranch(node)) {
      setPendingDelete({ path, name: node.name }); // 分支 = 子树一并删 → 二次确认
      return;
    }
    commit(removePanelNode(nodes, path));
  }

  // ============ 拖拽（同级插入线 + 拖到行中段成为子级；语言同大纲/设定树） ============

  function handleDragStart(e: DragEvent, key: string): void {
    e.dataTransfer.setData("text/plain", key);
    e.dataTransfer.effectAllowed = "move";
    setDragPath(key);
  }

  function rowPlacement(e: DragEvent): "before" | "on" | "after" {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    if (ratio < 0.25) return "before";
    if (ratio > 0.75) return "after";
    return "on";
  }

  /** 行落点决策（**唯一决策点**：dragover 与 drop 共用 `planPanelRowDrop`，防两处判断漂移） */
  function rowDropPlan(key: string, placement: "before" | "on" | "after") {
    if (dragPath === null) return null;
    return planPanelRowDrop(nodes, parsePathKey(dragPath), parsePathKey(key), placement);
  }

  function handleRowDragOver(e: DragEvent, key: string): void {
    if (dragPath === null) return;
    e.stopPropagation(); // 行内接管判定：非法落点不得冒泡成「拖到空白区移为末尾」
    const placement = rowPlacement(e);
    const plan = rowDropPlan(key, placement);
    if (plan === null) {
      // 非法落点（防自拖/防环）：**不显示任何反馈**（不显插入线、不显高亮），也不放行 drop
      setDropTarget(null);
      return;
    }
    e.preventDefault(); // 放行 drop（拒绝型落点也需要 drop 事件来给提示）
    if (plan.kind === "reject-value-leaf") {
      // 带值叶子：不显高亮（不可放），但松手时给提示（不丢值）
      setDropTarget({ path: key, placement, reject: true });
      return;
    }
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ path: key, placement });
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const target = dropTarget;
    setDragPath(null);
    setDropTarget(null);
    if (dragPath === null || target === null) return;
    const from = parsePathKey(dragPath);
    const plan = planPanelRowDrop(nodes, from, parsePathKey(target.path), target.placement);
    if (plan === null) return; // 非法：无动作、无提示（静默不可放）
    if (plan.kind === "reject-value-leaf") {
      useUiStore.getState().showToast(LEAF_HAS_VALUE_HINT, "error");
      return;
    }
    commit(movePanelNode(nodes, from, { parent: plan.parent, index: plan.index }));
  }

  /** 拖到列表空白区 = 移为顶层末尾（同级拖拽的兜底出口，同设定树「拖到空白区移为根」） */
  function handleRootDrop(e: DragEvent): void {
    e.preventDefault();
    if (dragPath === null) return;
    const from = parsePathKey(dragPath);
    setDragPath(null);
    setDropTarget(null);
    commit(movePanelNode(nodes, from, { parent: [], index: nodes.length }));
  }

  // ============ 模板 / 从角色复制（**整体替换**语义，均带确认） ============

  function applyTemplate(templateId: string, label: string): void {
    const template = PANEL_TEMPLATES.find((t) => t.id === templateId);
    if (template === undefined) return;
    setPendingReplace({ label, panel: cloneAbilityPanel(template.panel) });
  }

  async function loadCopyCandidates(): Promise<void> {
    if (copyCandidates !== null || copyLoading) return;
    setCopyLoading(true);
    try {
      const res = await listEntities("character", { limit: 200 });
      setCopyCandidates(res.items.filter((it) => it.id !== selfId));
    } catch {
      useUiStore.getState().showToast("无法读取角色列表，请重试", "error");
      setCopyCandidates([]);
    } finally {
      setCopyLoading(false);
    }
  }

  async function copyFromCharacter(sourceId: string): Promise<void> {
    try {
      const detail = await getEntityDetail("character", sourceId);
      setPendingReplace({
        label: `从「${detail.name}」复制结构`,
        panel: cloneAbilityPanel(detail.data.ability_panel),
      });
    } catch {
      useUiStore.getState().showToast("无法读取该角色的能力面板", "error");
    }
  }

  const isEmpty = nodes.length === 0;

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-foreground">能力面板</p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="small" disabled={disabled} onClick={() => addNode([], nodes.length, "新分组")}>
            + 新增分组
          </Button>
          <Select
            size="small"
            className="w-40"
            value=""
            disabled={disabled}
            placeholder="应用模板"
            aria-label="应用面板模板"
            popupMatchSelectWidth={false}
            options={[
              { value: "", label: "应用模板", disabled: true },
              ...PANEL_TEMPLATES.map((t) => ({ value: t.id, label: t.label })),
            ]}
            onChange={(value) => {
              const template = PANEL_TEMPLATES.find((t) => t.id === value);
              if (template !== undefined) applyTemplate(template.id, template.label);
            }}
          />
          <Select
            size="small"
            className="w-40"
            value=""
            disabled={disabled}
            placeholder={copyLoading ? "读取中…" : "从角色复制"}
            aria-label="从角色复制面板结构"
            popupMatchSelectWidth={false}
            onOpenChange={(open) => {
              if (open) void loadCopyCandidates();
            }}
            options={[
              { value: "", label: copyLoading ? "读取中…" : "从角色复制", disabled: true },
              ...(copyCandidates ?? []).map((c) => ({
                value: c.id,
                label: `${c.name}${typeof c.summary.role === "string" ? `（${c.summary.role}）` : ""}`,
              })),
            ]}
            onChange={(value: string) => void copyFromCharacter(value)}
          />
        </div>
      </div>

      {isEmpty ? (
        <p className="text-xs text-muted-foreground">暂无面板字段</p>
      ) : (
        <div
          className="flex flex-col"
          onDragOver={(e) => {
            if (dragPath !== null) e.preventDefault();
          }}
          onDrop={handleRootDrop}
        >
          <PanelRows
            nodes={nodes}
            parentPath={[]}
            depth={0}
            disabled={disabled}
            collapsed={collapsed}
            warnings={warnings}
            editing={editing}
            dropTarget={dropTarget}
            dragPath={dragPath}
            onToggleCollapsed={toggleCollapsed}
            onStartRename={(path, name) => setEditing({ path: panelPathKey(path), draft: name })}
            onEditingChange={(draft) => setEditing((prev) => (prev === null ? null : { ...prev, draft }))}
            onRenameCommit={commitRename}
            onRenameCancel={() => setEditing(null)}
            onAddSibling={(path) =>
              addNode(path.slice(0, -1), (path[path.length - 1] ?? 0) + 1, "新字段")
            }
            onAddChild={addChild}
            onDelete={handleDelete}
            onLeafValueCommit={(path, raw) => commit(setPanelLeafValue(nodes, path, raw))}
            onDragStart={handleDragStart}
            onRowDragOver={handleRowDragOver}
            onDragEnd={() => {
              setDragPath(null);
              setDropTarget(null);
            }}
            onDrop={handleDrop}
          />
        </div>
      )}

      {/* 分支删除确认（子树一并删——不可逆的编辑操作，走 ConfirmDialog） */}
      {pendingDelete !== null && (
        <ConfirmDialog
          title={`删除「${pendingDelete.name}」及其全部子字段？`}
          description="该分组下的所有子字段与取值将一并移除（保存后不可撤销）。"
          confirmLabel="删除"
          danger
          onConfirm={async () => {
            commit(removePanelNode(nodes, pendingDelete.path));
          }}
          onClose={() => setPendingDelete(null)}
        />
      )}

      {/* 替换确认（模板 / 从角色复制：整体替换当前面板结构） */}
      {pendingReplace !== null && (
        <ConfirmDialog
          title={`${pendingReplace.label}？`}
          description="将整体替换当前能力面板结构，现有字段与取值会丢失（保存后不可撤销）。"
          confirmLabel="替换"
          danger
          onConfirm={async () => {
            commit(cloneAbilityPanel(pendingReplace.panel));
          }}
          onClose={() => setPendingReplace(null)}
        />
      )}
    </div>
  );
}

/** 递归行渲染（分支 → 子行；叶子 → 值输入框） */
function PanelRows({
  nodes,
  parentPath,
  depth,
  disabled,
  collapsed,
  warnings,
  editing,
  dropTarget,
  dragPath,
  onToggleCollapsed,
  onStartRename,
  onEditingChange,
  onRenameCommit,
  onRenameCancel,
  onAddSibling,
  onAddChild,
  onDelete,
  onLeafValueCommit,
  onDragStart,
  onRowDragOver,
  onDragEnd,
  onDrop,
}: {
  nodes: readonly AbilityPanelNode[];
  parentPath: PanelIndexPath;
  depth: number;
  disabled: boolean;
  collapsed: readonly string[];
  warnings: Map<string, string>;
  editing: { path: string; draft: string } | null;
  dropTarget: PanelDragTarget;
  dragPath: string | null;
  onToggleCollapsed: (key: string) => void;
  onStartRename: (path: PanelIndexPath, name: string) => void;
  onEditingChange: (draft: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onAddSibling: (path: PanelIndexPath) => void;
  onAddChild: (path: PanelIndexPath, node: AbilityPanelNode) => void;
  onDelete: (path: PanelIndexPath, node: AbilityPanelNode) => void;
  onLeafValueCommit: (path: PanelIndexPath, raw: string) => void;
  onDragStart: (e: DragEvent, key: string) => void;
  onRowDragOver: (e: DragEvent, key: string) => void;
  onDragEnd: () => void;
  onDrop: (e: DragEvent) => void;
}) {
  return (
    <>
      {nodes.map((node, index) => {
        const path = [...parentPath, index];
        const key = panelPathKey(path);
        const branch = isAbilityBranch(node);
        const isCollapsed = collapsed.includes(key);
        const warning = warnings.get(key);
        // 视觉目标：拒绝型落点不显示任何反馈（不显插入线、不显高亮）
        const target =
          dropTarget?.path === key && dropTarget.reject !== true ? dropTarget.placement : null;
        const isDragging = dragPath === key;
        return (
          <div key={key}>
            <div
              draggable={!disabled}
              onDragStart={(e) => onDragStart(e, key)}
              onDragOver={(e) => onRowDragOver(e, key)}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
              style={{ paddingLeft: depth * 16 + 4 }}
              className={cn(
                "group relative flex items-center gap-1 rounded-md py-0.5 pr-1 hover:bg-muted/60",
                target === "on" && "bg-primary/10 ring-1 ring-primary/30 ring-inset",
                isDragging && "opacity-50",
              )}
            >
              {target === "before" && <DropIndicator position="top" />}
              {target === "after" && <DropIndicator position="bottom" />}

              {/* 展开箭头（分支）/ 占位（叶子——缩进对齐） */}
              {branch ? (
                <Button
                  color="default"
                  variant="text"
                  size="small"
                  disabled={disabled}
                  aria-label={isCollapsed ? `展开「${node.name}」` : `收起「${node.name}」`}
                  onClick={() => onToggleCollapsed(key)}
                  icon={
                    <RightOutlined
                      className={cn("text-xs transition-transform", !isCollapsed && "rotate-90")}
                    />
                  }
                />
              ) : (
                <span className="w-6 shrink-0" aria-hidden="true" />
              )}

              {/* 名称（点击进入改名；分支加粗以区分层级） */}
              {editing?.path === key ? (
                <>
                  <Input
                    size="small"
                    autoFocus
                    className="max-w-48"
                    value={editing.draft}
                    aria-label="字段名"
                    onChange={(e) => onEditingChange(e.target.value)}
                    onBlur={onRenameCommit}
                    onPressEnter={onRenameCommit}
                    onKeyDown={(e: KeyboardEvent) => {
                      if (e.key === "Escape") onRenameCancel();
                    }}
                  />
                  {editing.draft.trim() === "" && (
                    <span className="shrink-0 text-xs text-destructive">名字不能为空</span>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  title="点击改名"
                  onClick={() => onStartRename(path, node.name)}
                  className={cn(
                    "min-w-0 truncate text-left text-sm text-foreground",
                    !disabled && "hover:underline",
                    branch && "font-medium",
                  )}
                >
                  {node.name}
                </button>
              )}

              {/* 叶子值（空值显示 `—`；失焦/回车提交，类型自动判定） */}
              {!branch && (
                <LeafValueInput
                  value={node.value}
                  disabled={disabled}
                  onCommit={(raw) => onLeafValueCommit(path, raw)}
                />
              )}

              {/* 行尾操作（悬停显示；语言同设定树） */}
              <span className="ml-auto flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <Button
                  color="default"
                  variant="text"
                  size="small"
                  disabled={disabled}
                  title="新增同级"
                  aria-label={`在「${node.name}」后新增同级字段`}
                  onClick={() => onAddSibling(path)}
                  icon={<InsertRowBelowOutlined className="text-sm" />}
                />
                <Button
                  color="default"
                  variant="text"
                  size="small"
                  disabled={disabled}
                  title="新增子级"
                  aria-label={`在「${node.name}」下新增子字段`}
                  onClick={() => onAddChild(path, node)}
                  icon={<PlusOutlined className="text-sm" />}
                />
                <Button
                  color="default"
                  variant="text"
                  size="small"
                  disabled={disabled}
                  title="改名"
                  aria-label={`改名「${node.name}」`}
                  onClick={() => onStartRename(path, node.name)}
                  icon={<EditOutlined className="text-sm" />}
                />
                <Button
                  color="default"
                  variant="text"
                  size="small"
                  disabled={disabled}
                  title="删除"
                  aria-label={`删除「${node.name}」`}
                  onClick={() => onDelete(path, node)}
                  icon={<DeleteOutlined className="text-sm" />}
                />
              </span>
            </div>

            {/* 内联警告：名字含 `.` / 同层重名 → 变更记录无法按点分路径定位（不改写数据） */}
            {warning !== undefined && (
              <p
                className="flex items-center gap-1 text-xs text-muted-foreground"
                style={{ paddingLeft: depth * 16 + 34 }}
              >
                <ExclamationCircleOutlined className="text-xs" />
                {warning}
              </p>
            )}

            {branch && !isCollapsed && (
              <PanelRows
                nodes={node.children ?? []}
                parentPath={path}
                depth={depth + 1}
                disabled={disabled}
                collapsed={collapsed}
                warnings={warnings}
                editing={editing}
                dropTarget={dropTarget}
                dragPath={dragPath}
                onToggleCollapsed={onToggleCollapsed}
                onStartRename={onStartRename}
                onEditingChange={onEditingChange}
                onRenameCommit={onRenameCommit}
                onRenameCancel={onRenameCancel}
                onAddSibling={onAddSibling}
                onAddChild={onAddChild}
                onDelete={onDelete}
                onLeafValueCommit={onLeafValueCommit}
                onDragStart={onDragStart}
                onRowDragOver={onRowDragOver}
                onDragEnd={onDragEnd}
                onDrop={onDrop}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/** 叶子值输入：本地草稿 + 失焦/回车提交（外部值变化时同步——重载/位置视图切换） */
function LeafValueInput({
  value,
  disabled,
  onCommit,
}: {
  value: string | number | undefined;
  disabled: boolean;
  onCommit: (raw: string) => void;
}) {
  const external = valueText(value);
  const [draft, setDraft] = useState(external);

  useEffect(() => {
    setDraft(external);
  }, [external]);

  function commit(): void {
    if (draft === external) return;
    onCommit(draft);
  }

  return (
    <Input
      size="small"
      className="max-w-40"
      value={draft}
      disabled={disabled}
      placeholder="—"
      aria-label="字段值"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onPressEnter={commit}
    />
  );
}
