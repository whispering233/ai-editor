// 大纲节点详情页（S12.2；麦基字段集；「节点详情页」；
// S13.2：header 加「设为当前位置」——入口自大纲页迁入，PUT /project/config { current_position }，
// 已是当前位置禁用；store updateConfig 自动重拉 config 联动 InfoBar/行尾徽标/compute 默认节点）
// 路由：#/outline/:nodeId（中栏大纲 tab 二级路由，main.tsx outline 分支拦截第二段，仿实体详情）
// 数据：节点本体来自 project store 的 outline 树（GET /outline 已含 data）——findNode 按 id 查找，
// 软删/缺失 → 404 态；**变更记录仅章**（卡片 1.2：卷/场景不渲染该区块，也不留必定 400 的入口）——
// GET /delta/node/:nodeId（NodeDeltaList 区块）；
// 相关实体 GET /relation?source_type=outline_node&source_id=:nodeId&depth=1（RelationsView scope 模式）
// 编辑：PUT /outline/:nodeId——title/summary/data 部分更新（data 浅合并）；diff 只提交变更字段：
// title 非空且有变化（shouldCommitTitle）、summary 有变化且允许清空（提交空串真正清除——
// 服务端 patch.summary !== undefined 即写入）、data diffData（lib/entity-detail，空值规约）；
// 引用字段（climax_scene/inciting_scene）「未设置」→ 空串（服务端 z.string.optional 不接受 null）
// 交互：详情页无面包屑（B1 移除）——返回上级走左栏 NavRail / 大纲树；header [保存] 整表单一次提交；
// VALIDATION_ERROR → 结构化信息卡底部行内错误；「+ 新建变更」（S12.3）→ 内联表单（目标/字段/op/值/
// 描述，update 自动取旧值）→ 成功后 toast + 重拉变更记录列表
// 样式 token 类（oracle 红线：禁止硬编码色类）
import { useEffect, useState } from "react";
import { formatTimestamp } from "@whispering233/ai-editor-shared";
import { CreateRelationDialog } from "../components/entity/create-relation-dialog";
import { RelationsView } from "../components/entity/relations-view";
import { NodeDeltaList } from "../components/delta/node-delta-list";
import { DeltaCreateForm } from "../components/delta/delta-create-form";
import { TYPE_LABEL } from "../components/outline/dialogs";
import { Button, Input, Select } from "antd";
import { TagChip } from "@/components/ui/tag-chip";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { ApiError, updateOutlineNode, type UpdateOutlineBody } from "../lib/api";
import { diffData } from "../lib/entity-detail";
import {
  detailFieldsForNodeType,
  sceneNodeOptions,
  sceneSelectValue,
  toggleConflictLevel,
  type NodeFieldConfig,
} from "../lib/outline-detail";
import { findNode, shouldCommitSummary, shouldCommitTitle } from "../lib/outline-tree";
import { navigate } from "../hooks/use-route";
import { useSaveShortcut } from "../lib/save-shortcut";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { isCurrentPositionHost, setCurrentPosition } from "../lib/current-position";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

export default function OutlineDetail({ nodeId }: { nodeId: string }) {
  const outline = useProjectStore((s) => s.outline);
  const outlineLoading = useProjectStore((s) => s.outlineLoading);
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const loadOutline = useProjectStore((s) => s.loadOutline);

  // 首次加载标记：loadOutline 在 store 内静默吞错，用 loadAttempted 呈现「加载失败 + 重试」（同大纲列表页）
  const [loadAttempted, setLoadAttempted] = useState(false);
  // 表单（node 数据副本；树刷新后重置为服务端权威值）
  const [titleValue, setTitleValue] = useState("");
  const [summaryValue, setSummaryValue] = useState("");
  const [dataForm, setDataForm] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 设为当前位置提交态（防重复提交）
  const [settingCurrent, setSettingCurrent] = useState(false);
  // 相关实体：新建关系对话框 + 重载信号
  const [relationDialogOpen, setRelationDialogOpen] = useState(false);
  const [relKey, setRelKey] = useState(0);
  // 变更记录：新建表单展开态 + 列表重载信号（S12.3）
  const [deltaFormOpen, setDeltaFormOpen] = useState(false);
  const [deltaReloadKey, setDeltaReloadKey] = useState(0);

  useEffect(() => {
    if (outline === null && !outlineLoading && !loadAttempted) {
      setLoadAttempted(true);
      void loadOutline();
    }
  }, [outline, outlineLoading, loadAttempted, loadOutline]);

  // 数据变更信号（问题 1）：AI 提案确认写库 / InfoBar 刷新按钮 → 重拉整树（node 变化驱动
  // 表单重置）+ 相关实体与变更记录区块重载（AI 可能为本节点新增关系/变更记录）
  useDataRefresh(() => {
    void loadOutline();
    setRelKey((k) => k + 1);
    setDeltaReloadKey((k) => k + 1);
  });

  const node = outline === null ? null : findNode(outline.children, nodeId);
  const notFound = outline !== null && node === null;
  const fields = node ? detailFieldsForNodeType(node.type) : [];
  const sceneOptions = sceneNodeOptions(outline?.children ?? []);
  const isCurrent = config?.currentPosition === nodeId;
  /** 本页节点是否可承载「当前位置」（卡片 1.1 章级收窄：仅章；节点未加载时不置灰按钮由 node===null 分支承担） */
  const currentPositionHost = node !== null && isCurrentPositionHost(node.type);

  // 节点 → 表单（依赖 node 引用：outline 未刷新则引用稳定不重置；保存后 loadOutline 新树 → 重置）
  useEffect(() => {
    if (node === null) return;
    setTitleValue(node.title);
    setSummaryValue(node.summary ?? "");
    setDataForm(JSON.parse(JSON.stringify(node.data ?? {})) as Record<string, unknown>);
  }, [node]);

  /** 保存：diff 只提交变更字段（title/summary/data 一次提交，服务端部分更新 + data 浅合并） */
  async function handleSave() {
    if (node === null || saving) return;
    const title = titleValue.trim();
    if (title === "") {
      setSaveError("标题不能为空");
      return;
    }
    const patch: UpdateOutlineBody = {};
    if (shouldCommitTitle(node.title, titleValue)) patch.title = title;
    if (shouldCommitSummary(node.summary, summaryValue)) patch.summary = summaryValue.trim();
    const dataDiff = diffData(node.data ?? {}, dataForm ?? {});
    if (dataDiff !== null) patch.data = dataDiff;
    if (Object.keys(patch).length === 0) {
      useUiStore.getState().showToast("没有变更");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateOutlineNode(node.id, patch);
      useUiStore.getState().showToast("已保存");
      await loadOutline();
    } catch (err) {
      if (err instanceof ApiError && err.code === "OUTLINE_NODE_NOT_FOUND") {
        // 节点已被 purge：重拉树后自然进入 404 态（节点不在树中）
        await loadOutline();
        return;
      }
      setSaveError(err instanceof ApiError ? err.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  /** 设置 data 表单字段值 */
  function setDataField(key: string, value: unknown) {
    setDataForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  /**
   * 设为当前位置（S13.2，自大纲页迁入）：提交实现 = lib/current-position.ts 唯一入口
   * （大纲行右键菜单共用）——PUT /project/config { current_position }，store 内部 updateConfig
   * 成功后自动重拉 config，联动 InfoBar「当前位置」/大纲行尾徽标/compute 预览默认节点（S5.4）/
   * S9 伏笔健康指标基准。已是当前位置 → 按钮禁用不触发；在途防重入由 settingCurrent 承担。
   * 服务端只接受章节点（卷/场景 → 400）——本页对非章节点禁用按钮（currentPositionHost），
   * 入口可见性与右键菜单同口径（卡片 1.1）。
   */
  async function handleSetCurrent() {
    if (node === null || settingCurrent || isCurrent || !currentPositionHost) return;
    setSettingCurrent(true);
    try {
      await setCurrentPosition(node.id);
    } finally {
      setSettingCurrent(false);
    }
  }

  // Ctrl/Cmd+S 保存（B2）：仅节点就绪时注册（notFound/无项目/加载失败时不抢快捷键）
  useSaveShortcut(() => void handleSave(), node !== null);

  // ============ 渲染 ============

  if (notFound) {
    return (
      <section>
        <EmptyState
          padding="lg"
          action={
            <div className="flex justify-center gap-2">
              <a
                href="#/trash"
                className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-muted"
              >
                去回收站
              </a>
              <Button onClick={() => navigate("/outline")}>返回大纲</Button>
            </div>
          }
        >
          该节点不存在或已被删除
        </EmptyState>
      </section>
    );
  }

  const noProject = config === null && !configLoading;

  return (
    <section>
      {/* 页头（统一壳）：标题 + 操作区（设为当前位置 / 保存）+ 元信息行 + 分割线 */}
      <PageHeader
        title={node?.title ?? "…"}
        truncateTitle
        action={
          <>
            {/* S13.2 设为当前位置（动作入口；状态徽标在元信息行）：已是当前位置 → 禁用 + 「当前位置」标记，
                与 S13.1 前大纲页 disabled={isCurrent || busy} 语义一致；
                卡片 1.1 章级收窄：非章节点（卷/场景）禁用并说明原因——服务端接受非章会 400，
                留一个必定失败的按钮只会报出误导性错误（同上） */}
            <Button
              disabled={node === null || isCurrent || settingCurrent || !currentPositionHost}
              title={
                !currentPositionHost
                  ? "仅章节点可设为当前位置（卷/场景不承载写作进度）"
                  : isCurrent
                    ? "当前节点已是创作进度位置"
                    : "标记为创作进度位置（InfoBar 展示 + 定位跳转基准）"
              }
              onClick={() => void handleSetCurrent()}
            >
              {isCurrent ? "当前位置" : "设为当前位置"}
            </Button>
            <Button
              type="primary"
              onClick={() => void handleSave()}
              disabled={node === null || saving}
            >
              {saving ? "保存中…" : "保存"}
            </Button>
          </>
        }
        description={
          /* 元信息行：类型徽标 + 更新时间 + 当前位置（文字与大纲列表页徽标语义一致） */
          node ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TagChip>{TYPE_LABEL[node.type]}</TagChip>
              <span>更新于 {formatTimestamp(node.updatedAt)}</span>
              {isCurrent && (
                <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground">
                  当前位置
                </span>
              )}
            </div>
          ) : undefined
        }
      />

      {noProject ? (
        /* 未打开项目：引导回首页（同大纲列表页） */
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
              className="h-5 animate-pulse rounded bg-muted"
              style={{ width: `${92 - (i % 3) * 24}%`, marginLeft: (i % 3) * 20 }}
            />
          ))}
        </div>
      ) : outline === null ? (
        /* 树加载失败（loadOutline 静默吞错后的兜底呈现，同大纲列表页） */
        <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
          大纲加载失败
          <Button className="ml-3" onClick={() => setLoadAttempted(false)}>
            重试
          </Button>
        </div>
      ) : node === null || dataForm === null ? null : (
        /* 表单区：左栏（基础信息/结构化信息/变更记录/伏笔标记）+ 右栏（相关实体） */
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            {/* 基础信息：标题/摘要 */}
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
                      value={dataForm?.[f.key]}
                      sceneOptions={sceneOptions}
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

          {/* 右栏：相关实体（本节点作为 source；scope 模式复用 RelationsView） */}
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
      )}

      {/* 新增关联对话框（详情模式：源固定为本大纲节点，S12.2 扩展） */}
      {relationDialogOpen && node !== null && (
        <CreateRelationDialog
          source={{ type: "outline_node", id: node.id, name: node.title, nodeType: node.type }}
          onCreated={() => setRelKey((k) => k + 1)}
          onClose={() => setRelationDialogOpen(false)}
        />
      )}
    </section>
  );
}

/** 单个 data 字段控件（text/textarea/checkbox-group/scene-select） */
function FieldControl({
  field,
  value,
  sceneOptions,
  onChange,
}: {
  field: NodeFieldConfig;
  value: unknown;
  /** scene-select 用：场景节点选项（树中全部 scene 叶子） */
  sceneOptions: Array<{ id: string; label: string; depth: number }>;
  onChange: (v: unknown) => void;
}) {
  switch (field.control) {
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
