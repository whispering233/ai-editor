// 大纲节点详情页（S12.2；麦基字段集；「节点详情页」；
// S13.2：header 加「设为阅读进度」——入口自大纲页迁入，PUT /project/config { current_position }，
// 已是阅读进度禁用；store updateConfig 自动重拉 config 联动概览页/行尾徽标/compute 默认节点）
// D2：header 加「标记为推演节点 / 移出推演节点」（仅章节点渲染）+ 元信息行推演徽标
// （提交实现与大纲行右键菜单共用 = lib/deduction.ts）
// 路由：#/outline/:nodeId（中栏大纲 tab 二级路由，main.tsx outline 分支拦截第二段，仿实体详情）
// 数据：节点由页面壳 `findNode` 派生传入（本组件不自拉 GET /outline，也不自行重拉整树）；
// **变更记录仅章**（卡片 1.2：卷/场景不渲染该区块，也不留必定 400 的入口）——
// GET /delta/node/:nodeId（NodeDeltaList 区块）；
// 相关实体 GET /relation?source_type=outline_node&source_id=:nodeId&depth=1（RelationsView scope 模式）
// 编辑：PUT /outline/:nodeId——title/summary/data 部分更新（data 浅合并）；diff 只提交变更字段：
// title 非空且有变化（shouldCommitTitle）、summary 有变化且允许清空（提交空串真正清除——
// 服务端 patch.summary !== undefined 即写入）、data diffData（lib/entity-detail，空值规约）；
// 成功后 `onReload` 由壳收敛整树（rail 标题 / 摘要跟着更新），表单回写 trimmed 值不闪回旧值。
// 引用字段（climax_scene/inciting_scene）「未设置」→ 空串（服务端 z.string.optional 不接受 null）
// 交互：详情页无面包屑（B1 移除）——返回上级走左栏 NavRail / 大纲树；header [保存] 整表单一次提交；
// VALIDATION_ERROR → 结构化信息卡底部行内错误；「+ 新建变更」（S12.3）→ 内联表单（目标/字段/op/值/
// 描述，update 自动取旧值）→ 成功后 toast + 重拉变更记录列表
// 样式 token 类（oracle 红线：禁止硬编码色类）
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  buildDeductionMarks,
  formatMonthDay,
  formatTimestamp,
  MAX_CHAPTER_RESULT_SUMMARY_CHARS,
  type OutlineNode,
} from "@whispering233/ai-editor-shared";
import {
  AimOutlined,
  BranchesOutlined,
  EditOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { CreateRelationDialog } from "../components/entity/create-relation-dialog";
import { RelationsView } from "../components/entity/relations-view";
import { NodeDeltaList } from "../components/delta/node-delta-list";
import { DeltaCreateForm } from "../components/delta/delta-create-form";
import { TYPE_LABEL } from "../components/outline/dialogs";
import { Button, Input, Select } from "antd";
import { TypeChip } from "@/components/ui/tag-chip";
import { TagsEditor } from "@/components/ui/tags-editor";
import { PanelHeader } from "@/components/ui/panel-header";
import { SectionCard } from "@/components/ui/section-card";
import { ApiError, updateOutlineNode, type UpdateOutlineBody } from "../lib/api";
import { diffData } from "../lib/entity-detail";
import {
  buildOutlineDetailPatch,
  chapterTagPool,
  detailFieldsForNodeType,
  normalizeOutlineDataForm,
  sceneNodeOptions,
  sceneSelectValue,
  toggleConflictLevel,
  type NodeFieldConfig,
} from "../lib/outline-detail";
import { shouldCommitSummary, shouldCommitTitle } from "../lib/outline-tree";
import { formatTextLength } from "../lib/manuscript";
import { useSaveShortcut } from "../lib/save-shortcut";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { isCurrentPositionHost, setCurrentPosition } from "../lib/current-position";
import {
  deductionMarkTitle,
  deductionMenuLabel,
  isDeductionMarkHost,
  submitDeductionMarks,
  toggledDeductionNodes,
} from "../lib/deduction";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

/** 详情表单是否 dirty：标题 / 摘要 / data 任一有未提交变化（纯函数，供壳的未保存守卫与测试共用）。
 * 基准 `baseline` = 上次同步 / 保存的服务端值，不是当前 node——rail 改名后 node 先变，拿 node 当基准
 * 会把旧表单误判成 dirty 并让同步 effect 跳过，保存再把旧标题 PUT 回去。 */
export function isOutlineDetailDirty(
  baseline: OutlineNode,
  titleValue: string,
  summaryValue: string,
  dataForm: Record<string, unknown>,
): boolean {
  // 两侧都归一：末尾空行（TagsEditor 续输用）不算 dirty，基线里带空格的旧值也不会一进表单就脏
  const rawBaseline = baseline.data ?? {};
  const baselineData = normalizeOutlineDataForm(rawBaseline);
  const { normalizedData } = buildOutlineDetailPatch(baselineData, dataForm);
  return (
    shouldCommitTitle(baseline.title, titleValue) ||
    shouldCommitSummary(baseline.summary, summaryValue) ||
    diffData(baselineData, normalizeDefaultStatus(baselineData, normalizedData)) !== null
  );
}

/** 状态缺省 = 草稿：两者等价（否则默认值一进表单就永久 dirty）。只在本判定内归一，不改
 * `diffData` 的通用语义——`status: undefined` 在 diffData 里是「不提交」 */
function normalizeDefaultStatus(
  baselineData: Record<string, unknown>,
  dataForm: Record<string, unknown>,
): Record<string, unknown> {
  if (baselineData.status !== undefined || dataForm.status !== "draft") return dataForm;
  return { ...dataForm, status: undefined };
}

/** 可嵌入（中栏分栏壳的右列）：节点由壳 `findNode` 派生传入（本组件不自拉大纲）；
 * `leading` = 页头标题行最左的槽（壳注入 rail 展开钮）；`headerActions` = 追加到操作组末尾
 * （壳注入右侧详情收起钮）；`onReload` = 保存后由壳收敛整树；
 * `onDirtyChange` = 未保存状态上报给壳（rail 切换 / 返回条 / 新建导航前确认）；
 * `onNavigate` = 壳的离开守卫（写正文前确认，见下），不给则退回裸 `href` 跳转。
 * 页头常驻、内容区独立滚动（DESIGN.md §Layout「页头常驻」）。 */
export default function OutlineDetail({
  node,
  nodeId,
  onReload,
  leading,
  headerActions,
  onDirtyChange,
  onNavigate,
}: {
  node: OutlineNode;
  nodeId: string;
  onReload: () => Promise<void>;
  leading?: ReactNode;
  headerActions?: ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
  onNavigate?: (path: string) => void | Promise<void>;
}) {
  const outline = useProjectStore((s) => s.outline);
  const config = useProjectStore((s) => s.config);
  // 表单（node 数据副本；干净表单跟随服务端，dirty 表单保留——见下方同步 effect）
  const [titleValue, setTitleValue] = useState(node.title);
  const [summaryValue, setSummaryValue] = useState(node.summary ?? "");
  const [dataForm, setDataForm] = useState<Record<string, unknown>>(
    () => JSON.parse(JSON.stringify(node.data ?? {})) as Record<string, unknown>,
  );
  // 表单的基线 = 上次同步 / 保存的服务端值（dirty 判定与同步 effect 的闸门都用它，不用当前 node）
  const [baseline, setBaseline] = useState<OutlineNode>(node);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 设为阅读进度提交态（防重复提交）
  const [settingCurrent, setSettingCurrent] = useState(false);
  // 推演标记提交态（防重复提交）
  const [markingDeduction, setMarkingDeduction] = useState(false);
  // 相关实体：新建关系对话框 + 重载信号
  const [relationDialogOpen, setRelationDialogOpen] = useState(false);
  const [relKey, setRelKey] = useState(0);
  // 变更记录：新建表单展开态 + 列表重载信号（S12.3）
  const [deltaFormOpen, setDeltaFormOpen] = useState(false);
  const [deltaReloadKey, setDeltaReloadKey] = useState(0);

  // 数据变更信号（问题 1）：AI 提案确认写库 / MainToolbar 刷新按钮 → 只重载相关实体与变更记录
  // 区块（AI 可能为本节点新增关系/变更记录）；整树由壳的 `useDataRefresh` 重拉一次，本组件不再
  // 触发第二棵树的 GET（DESIGN.md `outline-page`「数据与刷新」）
  useDataRefresh(() => {
    setRelKey((k) => k + 1);
    setDeltaReloadKey((k) => k + 1);
  });

  const fields = detailFieldsForNodeType(node.type);
  const sceneOptions = sceneNodeOptions(outline?.children ?? []);
  // 章标签候选 = 全书章 / 场景已用标签（使用次数降序；不新增请求——树就在 store 里）
  const tagPool = useMemo(
    () => chapterTagPool(outline?.children ?? []).map((t) => t.value),
    [outline],
  );
  const isCurrent = config?.currentPosition === nodeId;
  /** 本节点是否可承载「阅读进度」（卡片 1.1 章级收窄：仅章） */
  const currentPositionHost = isCurrentPositionHost(node.type);
  /** 本页节点的推演标记（未标记 / 非章 / 失效 id → undefined）：标记集合由 shared
   * `buildDeductionMarks` 现算（文案与章号同源），`config.deductionNodes` 由 store 重拉驱动刷新 */
  const deduction = useMemo(
    () => buildDeductionMarks(outline, config?.deductionNodes ?? []),
    [outline, config?.deductionNodes],
  );
  const deductionMark = deduction.find((mark) => mark.nodeId === nodeId);

  // 悬浮「问 AI」的页面焦点：项目**有可见推演标记** → 注入推演节点集合（只发布尔，服务端现读
  // 配置展开）；无标记 / 标记全部失效 → null（按钮回普通语义，不注入空段）。
  // 判据用 shared 派生结果而非裸 `config.deductionNodes.length`：失效 id 在读侧原样保留，按长度门控
  // 会在「标记全失效」时留下「按钮带上下文但服务端无段可注入」。
  // 依赖 `outline` 与 `config`（两者异步加载 → 加载完成后必须重跑，否则「有标记但按钮不带上下文」）
  const setCurrentFocus = useUiStore((s) => s.setCurrentFocus);
  const deductionVisible = deduction.length > 0;
  useEffect(() => {
    setCurrentFocus(deductionVisible ? { focus_deduction: true } : null);
  }, [deductionVisible, setCurrentFocus]);

  /** 本页节点是否可标记（§15 不变式 1：仅章；卷/场景不渲染入口——不留必定 400 的按钮） */
  const deductionHost = isDeductionMarkHost(node.type);
  /** 本章正文字数文案（卡 12.5；卷/场景无正文，0 或未写 → null 不显示）——
   *  数据来自 GET /outline?with_metadata=true 的 metadata.textLength（不读正文全文） */
  const textLengthLabel = formatTextLength(
    node.type === "chapter" ? (node.metadata?.textLength ?? 0) : 0,
  );

  // 节点 → 表单：换节点必同步；同节点则干净表单跟随服务端、dirty 表单保留。
  // 依赖 `node` 引用：树 reload 换了引用（rail 行内改名 / AI 写库 / MainToolbar 刷新）时，干净表单
  // 必须同步服务端的新标题 / 摘要 / data，否则之后点保存会把旧值 PUT 回去。
  useEffect(() => {
    if (node.id !== baseline.id) {
      setTitleValue(node.title);
      setSummaryValue(node.summary ?? "");
      setDataForm(JSON.parse(JSON.stringify(node.data ?? {})) as Record<string, unknown>);
      setBaseline(node);
      return;
    }
    // 上次同步后用户改过表单 → 保留；否则跟随服务端（rail 改名 / AI 写库 / 刷新）
    if (isOutlineDetailDirty(baseline, titleValue, summaryValue, dataForm)) return;
    setTitleValue(node.title);
    setSummaryValue(node.summary ?? "");
    setDataForm(JSON.parse(JSON.stringify(node.data ?? {})) as Record<string, unknown>);
    setBaseline(node);
  }, [node]);

  // 未保存状态上报壳（rail 切换 / 空白区清选中 / 窄屏返回条 / 新建导航前确认）
  const dirty = isOutlineDetailDirty(baseline, titleValue, summaryValue, dataForm);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // 详情被壳卸载（选中节点消失 / 切到空态）时清掉壳里的 detailDirty，避免残留脏标记卡住导航
  useEffect(() => () => {
    onDirtyChange?.(false);
  }, [onDirtyChange]);

  /** 保存：diff 只提交变更字段（title/summary/data 一次提交，服务端部分更新 + data 浅合并） */
  async function handleSave() {
    if (saving) return;
    const title = titleValue.trim();
    if (title === "") {
      setSaveError("标题不能为空");
      return false; // 保存失败：Ctrl+S 据此不生成备份
    }
    const patch: UpdateOutlineBody = {};
    if (shouldCommitTitle(baseline.title, titleValue)) patch.title = title;
    if (shouldCommitSummary(baseline.summary, summaryValue)) patch.summary = summaryValue.trim();
    // 归一后再 diff / 提交（lib 唯一实现）：tags 末尾空行不能进 payload（nodeTagsSchema min(1) 会 400）；
    // 带基线归一，清空实际摘要才落成 `""`（删键会被 diffData 当「不提交」）
    const { normalizedData, dataPatch } = buildOutlineDetailPatch(baseline.data ?? {}, dataForm);
    if (dataPatch !== null) patch.data = dataPatch;
    if (Object.keys(patch).length === 0) {
      // 表单已与基线同值：node 可能被外部改名（rail）/ AI 写库更新，先让表单跟随服务端再归零基线，
      // 否则旧表单会被判 dirty 卡死
      setTitleValue(node.title);
      setSummaryValue(node.summary ?? "");
      setDataForm(JSON.parse(JSON.stringify(node.data ?? {})) as Record<string, unknown>);
      setBaseline(node);
      useUiStore.getState().showToast("没有变更");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateOutlineNode(node.id, patch);
      // 回写 trimmed / 归一值并把基线前移到刚提交的值：保存后 dirty 立即归零（重拉的新 node 走同步 effect 收敛）
      setTitleValue(title);
      setSummaryValue(summaryValue.trim());
      setDataForm(normalizedData);
      setBaseline({ ...node, title, summary: summaryValue.trim(), data: normalizedData });
      useUiStore.getState().showToast("已保存");
      await onReload();
    } catch (err) {
      if (err instanceof ApiError && err.code === "OUTLINE_NODE_NOT_FOUND") {
        // 节点已被 purge：壳重拉树后自然进入坏 id 空态（节点不在树中）
        await onReload();
        return false;
      }
      setSaveError(err instanceof ApiError ? err.message : "保存失败，请重试");
      return false; // 保存失败：Ctrl+S 据此不生成备份
    } finally {
      setSaving(false);
    }
  }

  /** 设置 data 表单字段值 */
  function setDataField(key: string, value: unknown) {
    setDataForm((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * 设为阅读进度（S13.2，自大纲页迁入）：提交实现 = lib/current-position.ts 唯一入口
   * （大纲行右键菜单共用）——PUT /project/config { current_position }，store 内部 updateConfig
   * 成功后自动重拉 config，联动概览页「阅读进度」/大纲行尾徽标/compute 预览默认节点（S5.4）/
   * S9 伏笔健康指标基准。已是阅读进度 → 按钮禁用不触发；在途防重入由 settingCurrent 承担。
   * 服务端只接受章节点（卷/场景 → 400）——本页对非章节点禁用按钮（currentPositionHost），
   * 入口可见性与右键菜单同口径（卡片 1.1）。
   */
  async function handleSetCurrent() {
    if (settingCurrent || isCurrent || !currentPositionHost) return;
    setSettingCurrent(true);
    try {
      await setCurrentPosition(node.id);
    } finally {
      setSettingCurrent(false);
    }
  }

  /**
   * 标记 / 移出推演节点：提交实现 = lib/deduction.ts 唯一入口（大纲行右键菜单共用）——
   * PUT /project/config { deduction_nodes } 全量替换，store 成功后重拉 config，联动本页元信息行徽标 /
   * 大纲树行尾徽标。已标记 → 按钮文案变「移出推演节点」（点即切换，不置灰）；
   * 在途防重入由 markingDeduction 承担。
   */
  async function handleToggleDeduction() {
    if (markingDeduction || !deductionHost) return;
    setMarkingDeduction(true);
    try {
      await submitDeductionMarks(toggledDeductionNodes(deduction, node.id));
    } finally {
      setMarkingDeduction(false);
    }
  }

  // Ctrl/Cmd+S 保存（B2）：行内编辑时 rail 的保存先注册在栈顶，未编辑时落到本详情表单
  useSaveShortcut(() => handleSave());

  // ============ 渲染 ============

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      {/* 页头（工作台子栏页头，见 DESIGN.md §Layout「工作台子栏页头」）：标题 + 操作区
          （写正文 / 设为阅读进度 / 推演标记 / 保存）+ 单行元信息 + 全幅分割线（`-mx-6` 穿透列内边距）。
          窄列不折行：节点动作压成 24px icon-button（`title` + `aria-label` 保留文字语义），
          保存是唯一主操作 = `type="primary"` 图标按钮。元信息行也不折行：文字与徽标 `shrink-0`，
          日期只显示 `MM-DD`（完整时间进 `title`），超宽时尾部被裁切。 */}
      <PanelHeader
        title={node.title}
        leading={leading}
        className="-mx-6"
        insetClassName="px-6"
        actions={
          <>
            {/* 写正文：仅章节点（正文只挂章，卷/场景 → 端点 400，不留必定失败的入口）；
                入口指向写作页 #/writing/:id，`Button href` 渲染成 `<a>` ⇒ 保住导航链接语义；
                普通左键经 onNavigate 走未保存确认，修饰键 / 非主键保留浏览器原生新标签页 */}
            {node.type === "chapter" && (
              <Button
                color="default"
                variant="text"
                size="small"
                href={`#/writing/${node.id}`}
                onClick={
                  onNavigate &&
                  ((e) => {
                    // 带修饰键 / 非主键 = 浏览器原生链接行为（新标签页 / 新窗口）；新页不会清当前页表单，无需守卫
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    e.preventDefault();
                    void onNavigate(`/writing/${node.id}`);
                  })
                }
                icon={<EditOutlined />}
                title="写正文"
                aria-label="写正文"
              />
            )}
            {/* S13.2 设为阅读进度（动作入口；状态徽标在元信息行）：已是阅读进度 → 禁用 + 「阅读进度」标记，
                与 S13.1 前大纲页 disabled={isCurrent || busy} 语义一致；
                卡片 1.1 章级收窄：非章节点（卷/场景）禁用并说明原因——服务端接受非章会 400，
                留一个必定失败的按钮只会报出误导性错误（同上） */}
            <Button
              color="default"
              variant="text"
              size="small"
              disabled={isCurrent || settingCurrent || !currentPositionHost}
              icon={<AimOutlined />}
              aria-label={isCurrent ? "阅读进度" : "设为阅读进度"}
              title={
                !currentPositionHost
                  ? "仅章节点可设为阅读进度（卷/场景不可标记）"
                  : isCurrent
                    ? "当前节点已是阅读进度位置"
                    : "标记为阅读进度位置（顶栏展示 + 定位跳转基准）"
              }
              onClick={() => void handleSetCurrent()}
            />
            {/* D2 推演节点标记（动作入口；状态徽标在元信息行）：仅章节点渲染（§15 不变式 1——
                卷/场景服务端 400，不留必定失败的入口），文案按当前状态切换（已标记 → 移出） */}
            {deductionHost && (
              <Button
                color="default"
                variant="text"
                size="small"
                disabled={markingDeduction}
                icon={<BranchesOutlined />}
                aria-label={deductionMenuLabel(deductionMark !== undefined)}
                title={
                  deductionMark !== undefined
                    ? "从推演节点集合中移出（剧情推演不再以本章为边界）"
                    : "标记为推演节点（剧情推演以本章为边界）"
                }
                onClick={() => void handleToggleDeduction()}
              />
            )}
            <Button
              type="primary"
              size="small"
              icon={<SaveOutlined />}
              loading={saving}
              title="保存"
              aria-label="保存"
              onClick={() => void handleSave()}
            />
            {headerActions}
          </>
        }
        meta={
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-xs text-muted-foreground">
            <TypeChip className="shrink-0" tone={node.type === "volume" ? "default" : "soft"}>
              {TYPE_LABEL[node.type]}
            </TypeChip>
            <span className="shrink-0" title={formatTimestamp(node.updatedAt)}>
              更新于 {formatMonthDay(node.updatedAt)}
            </span>
            {textLengthLabel !== null && (
              <span className="shrink-0 tabular-nums">{textLengthLabel}</span>
            )}
            {deductionMark !== undefined && (
              <TypeChip
                className="shrink-0"
                title={deductionMarkTitle(deductionMark, deduction.length)}
              >
                {deductionMark.label}
              </TypeChip>
            )}
            {isCurrent && <TypeChip className="shrink-0">阅读进度</TypeChip>}
          </div>
        }
      />

      {/* 内容区：独立滚动（页头不跟着走） */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* 表单区：信息区（基础信息/结构化信息/变更记录/伏笔标记）在上，关联区（相关实体）在下 */}
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-4">
            {/* 基础信息：标题/摘要/实际摘要（仅章） */}
            <SectionCard title="基础信息">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="mb-1 text-sm font-medium text-foreground">标题</p>
                  <Input
                    value={titleValue}
                    onChange={(e) => setTitleValue(e.target.value)}
                    maxLength={200}
                    placeholder={`${TYPE_LABEL[node.type]}标题`}
                  />
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-foreground">摘要</p>
                  <Input.TextArea
                    value={summaryValue}
                    onChange={(e) => setSummaryValue(e.target.value)}
                    maxLength={200}
                    rows={3}
                    placeholder="一句话概括本节点内容（可选）"
                  />
                </div>
                {/* 实际摘要（章专有，`data.result_summary`）：作者手填 / AI 读正文后提案回填；
                    只在本表单出现（大纲树行不展示），空值由 normalizeOutlineDataForm 按基线决定吞不吞 */}
                {node.type === "chapter" && (
                  <div>
                    <p className="mb-1 text-sm font-medium text-foreground">实际摘要</p>
                    <Input.TextArea
                      value={
                        typeof dataForm.result_summary === "string" ? dataForm.result_summary : ""
                      }
                      onChange={(e) => setDataField("result_summary", e.target.value)}
                      maxLength={MAX_CHAPTER_RESULT_SUMMARY_CHARS}
                      rows={3}
                      placeholder="写完后本章实际发生了什么（可选）"
                    />
                  </div>
                )}
              </div>
            </SectionCard>

            {/* 结构化信息：data 字段表单（按层级渲染） */}
            <SectionCard title={`结构化信息（${TYPE_LABEL[node.type]}）`}>
              <div className="flex flex-col gap-3">
                {fields.map((f) => (
                  <div key={f.key}>
                    <p className="mb-1 text-sm font-medium text-foreground">{f.label}</p>
                    <FieldControl
                      field={f}
                      value={dataForm[f.key]}
                      sceneOptions={sceneOptions}
                      tagPool={tagPool}
                      onChange={(v) => setDataField(f.key, v)}
                    />
                  </div>
                ))}
              </div>
              {saveError && <p className="mt-3 text-sm text-destructive">{saveError}</p>}
            </SectionCard>

            {/* 变更记录（S5.4 行内面板逻辑迁入；「+ 新建变更」S12.3：内联表单 + 成功后重拉列表）
             * 卡片 1.2：锚点仅章——卷/场景节点整块不渲染（不落一个点下去必定 400 的入口） */}
            {node.type === "chapter" && (
              <SectionCard
                title="变更记录"
                action={
                  <Button size="small" onClick={() => setDeltaFormOpen((v) => !v)}>
                    {deltaFormOpen ? "收起" : "+ 新建变更"}
                  </Button>
                }
              >
                {deltaFormOpen && (
                  <DeltaCreateForm
                    nodeId={nodeId}
                    onCreated={() => {
                      setDeltaFormOpen(false);
                      setDeltaReloadKey((k) => k + 1);
                    }}
                    onClose={() => setDeltaFormOpen(false)}
                  />
                )}
                <NodeDeltaList nodeId={nodeId} reloadKey={deltaReloadKey} />
              </SectionCard>
            )}

            {/* 伏笔标记占位（S9 伏笔面板落地后接入 plants/advances/resolves 标记） */}
            <SectionCard title="伏笔标记" className="border-dashed">
              <p className="text-sm text-muted-foreground">伏笔标记将在伏笔面板（S9）落地</p>
            </SectionCard>
          </div>

          {/* 关联区：相关实体（本节点作为 source；scope 模式复用 RelationsView） */}
          <div className="flex min-w-0 flex-col gap-4">
            <SectionCard title="相关实体">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">本节点作为源的关系（1 跳）</p>
                <Button onClick={() => setRelationDialogOpen(true)}>+ 新增关联</Button>
              </div>
              <RelationsView
                scope={{ type: "outline_node", id: nodeId }}
                reloadKey={relKey}
                onOpenCreate={() => setRelationDialogOpen(true)}
              />
            </SectionCard>
          </div>
        </div>
      </div>

      {/* 新增关联对话框（详情模式：源固定为本大纲节点，S12.2 扩展） */}
      {relationDialogOpen && (
        <CreateRelationDialog
          source={{ type: "outline_node", id: node.id, name: node.title, nodeType: node.type }}
          onCreated={() => setRelKey((k) => k + 1)}
          onClose={() => setRelationDialogOpen(false)}
        />
      )}
    </section>
  );
}

/** 单个 data 字段控件（text/textarea/checkbox-group/scene-select/select/tags） */
function FieldControl({
  field,
  value,
  sceneOptions,
  tagPool,
  onChange,
}: {
  field: NodeFieldConfig;
  value: unknown;
  /** scene-select 用：场景节点选项（树中全部 scene 叶子） */
  sceneOptions: Array<{ id: string; label: string; depth: number }>;
  /** tags 用：候选标签（全书已用标签） */
  tagPool: string[];
  onChange: (v: unknown) => void;
}) {
  switch (field.control) {
    case "select": {
      const current = typeof value === "string" && value !== "" ? value : (field.defaultValue ?? "");
      return (
        <Select
          className="w-full"
          value={current}
          onChange={(v) => onChange(v)}
          options={(field.options ?? []).map((opt) => ({
            value: opt,
            label: field.optionsLabels?.[opt] ?? opt,
          }))}
        />
      );
    }
    case "tags":
      return (
        <TagsEditor
          values={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          placeholder="标签（回车添加，如：复仇线）"
          suggestions={tagPool}
          quickTags={tagPool}
        />
      );
    case "textarea":
      return (
        <Input.TextArea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          maxLength={field.maxLength}
          rows={3}
        />
      );
    case "checkbox-group": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {(field.options ?? []).map((opt) => (
            <label
              key={opt}
              className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => onChange(toggleConflictLevel(selected, opt))}
                className="size-4 accent-primary"
              />
              {field.optionsLabels?.[opt] ?? opt}
            </label>
          ))}
        </div>
      );
    }
    case "scene-select": {
      const current = sceneSelectValue(value);
      // 防御分支：当前引用不在选项集（引用节点已被删/purge）→ 追加临时 option 标注，避免 select 静默空白
      const stale = current !== "" && !sceneOptions.some((o) => o.id === current);
      return (
        <Select
          value={current}
          onChange={(value) => onChange(value)}
          options={[
            { value: "", label: "（未设置）" },
            ...(stale ? [{ value: current, label: `${current}（已删除）` }] : []),
            ...sceneOptions.map((o) => ({
              value: o.id,
              label: `${`　`.repeat(o.depth)}${o.label}`,
            })),
          ]}
        />
      );
    }
    default:
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          maxLength={field.maxLength}
        />
      );
  }
}
