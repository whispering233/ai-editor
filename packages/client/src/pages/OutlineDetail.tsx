// 大纲节点详情页（S12.2；决策 23 麦基字段集；契约 doc/ui/pages/outline.md「节点详情页」；
//   S13.2：header 加「设为当前位置」——入口自大纲页迁入，PUT /project/config { current_position }，
//   已是当前位置禁用；store updateConfig 自动重拉 config 联动 InfoBar/行尾徽标/compute 默认节点）
// 路由：#/outline/:nodeId（中栏大纲 tab 二级路由，main.tsx outline 分支拦截第二段，仿实体详情）
// 数据：节点本体来自 project store 的 outline 树（GET /outline 已含 data）——findNode 按 id 查找，
//   软删/缺失 → 404 态；变更记录 GET /delta/node/:nodeId（NodeDeltaList 区块）；
//   相关实体 GET /relation?source_type=outline_node&source_id=:nodeId&depth=1（RelationsView scope 模式）
// 编辑：PUT /outline/:nodeId——title/summary/data 部分更新（data 浅合并）；diff 只提交变更字段：
//   title 非空且有变化（shouldCommitTitle）、summary 有变化且允许清空（提交空串真正清除——
//   服务端 patch.summary !== undefined 即写入）、data diffData（lib/entity-detail，空值规约）；
//   引用字段（climax_scene/inciting_scene）「未设置」→ 空串（服务端 z.string().optional() 不接受 null）
// 交互：面包屑「大纲 › … › 节点名」（父级段跳 #/outline/:parentId）；header [保存] 整表单一次提交；
//   VALIDATION_ERROR → 结构化信息卡底部行内错误；「+ 新建变更」（S12.3）→ 内联表单（目标/字段/op/值/
//   描述，update 自动取旧值）→ 成功后 toast + 重拉变更记录列表
// 样式 token 类（layout.md §3，oracle 红线：禁止硬编码色类）
import { useEffect, useState } from "react";
import { formatTimestamp } from "@ai-editor/shared";
import { CreateRelationDialog } from "../components/entity/create-relation-dialog";
import { RelationsView } from "../components/entity/relations-view";
import { NodeDeltaList } from "../components/delta/node-delta-list";
import { DeltaCreateForm } from "../components/delta/delta-create-form";
import { TYPE_LABEL } from "../components/outline/dialogs";
import { Breadcrumb, type BreadcrumbItem } from "../components/page-nav/Breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  updateOutlineNode,
  type UpdateOutlineBody,
} from "../lib/api";
import { diffData } from "../lib/entity-detail";
import {
  detailFieldsForNodeType,
  sceneNodeOptions,
  sceneSelectValue,
  toggleConflictLevel,
  type NodeFieldConfig,
} from "../lib/outline-detail";
import { findNode, findNodePath, shouldCommitSummary, shouldCommitTitle } from "../lib/outline-tree";
import { cn } from "../lib/utils";
import { navigate } from "../hooks/use-route";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

/** 表单控件通用样式（token 类：select/textarea） */
const FIELD_CLASS =
  "w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** 区块卡样式（layout.md §2.5：rounded-xl border bg-card p-4 + font-serif 标题；action = 标题行右侧操作区） */
function Card({
  title,
  children,
  className,
  action,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-serif text-base">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function OutlineDetail({ nodeId }: { nodeId: string }) {
  const outline = useProjectStore((s) => s.outline);
  const outlineLoading = useProjectStore((s) => s.outlineLoading);
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const loadOutline = useProjectStore((s) => s.loadOutline);
  // S13.2：设为当前位置（写 project.json current_position；store 内部自动重拉 config，联动 InfoBar/行尾徽标/compute 默认节点）
  const updateConfig = useProjectStore((s) => s.updateConfig);

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
   * 设为当前位置（S13.2，自大纲页迁入）：PUT /project/config { current_position: nodeId }——
   * store 内部 updateConfig 成功后自动重拉 config，联动 InfoBar「当前位置」/大纲行尾徽标/
   * compute 预览默认节点（S5.4）/S9 伏笔健康指标基准（决策 21）。已是当前位置 → 按钮禁用不触发。
   * 失败：泛化 error toast（与 S13.1 前大纲页语义一致；节点能渲染说明在树中，失败主要为网络/服务端拒绝）
   */
  async function handleSetCurrent() {
    if (node === null || settingCurrent || isCurrent) return;
    setSettingCurrent(true);
    try {
      await updateConfig({ current_position: node.id });
      useUiStore.getState().showToast("已设为当前位置");
    } catch {
      useUiStore.getState().showToast("设置失败：该节点可能已删除，无法设为当前位置", "error");
    } finally {
      setSettingCurrent(false);
    }
  }

  // ============ 渲染 ============

  if (notFound) {
    return (
      <section>
        <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">该节点不存在或已被删除</p>
          <div className="mt-4 flex justify-center gap-2">
            <a
              href="#/trash"
              className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            >
              去回收站
            </a>
            <Button variant="outline" type="button" onClick={() => navigate("/outline")}>
              返回大纲
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const noProject = config === null && !configLoading;

  // 面包屑：大纲 › 父链…（可点跳 #/outline/:parentId）› 当前节点（高亮不可点）
  const breadcrumbItems: BreadcrumbItem[] = [{ label: "大纲", href: "/outline" }];
  if (node !== null) {
    const pathIds = findNodePath(outline?.children ?? [], nodeId) ?? [];
    for (const pid of pathIds.slice(0, -1)) {
      const parent = findNode(outline?.children ?? [], pid);
      if (parent) breadcrumbItems.push({ label: parent.title, href: `/outline/${pid}` });
    }
    breadcrumbItems.push({ label: node.title });
  }

  return (
    <section>
      {/* header：面包屑（返回上级）+ 标题 + 操作区（设为当前位置 / 保存） */}
      <div className="mb-1 flex items-center gap-3">
        <Breadcrumb items={breadcrumbItems} />
        <h1 className="min-w-0 truncate text-xl font-semibold">{node?.title ?? "…"}</h1>
        <div className="ml-auto flex items-center gap-2">
          {/* S13.2 设为当前位置（动作入口；状态徽标在元信息行）：已是当前位置 → 禁用 + 「当前位置」标记，
              与 S13.1 前大纲页 disabled={isCurrent || busy} 语义一致 */}
          <Button
            variant="outline"
            type="button"
            disabled={node === null || isCurrent || settingCurrent}
            title={isCurrent ? "当前节点已是创作进度位置" : "标记为创作进度位置（InfoBar 展示 + 定位跳转基准）"}
            onClick={() => void handleSetCurrent()}
          >
            {isCurrent ? "当前位置" : "设为当前位置"}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={node === null || saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>

      {/* 元信息行：类型徽标 + 更新时间 + 当前位置（文字与大纲列表页徽标语义一致） */}
      {node && (
        <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs">{TYPE_LABEL[node.type]}</span>
          <span>更新于 {formatTimestamp(node.updatedAt)}</span>
          {isCurrent && (
            <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground">
              当前位置
            </span>
          )}
        </div>
      )}

      {noProject ? (
        /* 未打开项目：引导回首页（同大纲列表页） */
        <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">未打开项目，无法编辑大纲</p>
          <a href="#/" className="mt-2 inline-block text-sm text-muted-foreground underline hover:text-foreground">
            回到首页打开或创建书籍
          </a>
        </div>
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
          <Button variant="outline" className="ml-3" type="button" onClick={() => setLoadAttempted(false)}>
            重试
          </Button>
        </div>
      ) : node === null || dataForm === null ? null : (
        /* 表单区：左栏（基础信息/结构化信息/变更记录/伏笔标记）+ 右栏（相关实体） */
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            {/* 基础信息：标题/摘要 */}
            <Card title="基础信息">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="mb-1 text-sm font-medium text-foreground">标题</p>
                  <Input
                    value={titleValue}
                    onChange={(e) => setTitleValue(e.target.value)}
                    maxLength={200}
                    placeholder={`${TYPE_LABEL[node.type]}标题`}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-foreground">摘要</p>
                  <textarea
                    value={summaryValue}
                    onChange={(e) => setSummaryValue(e.target.value)}
                    maxLength={200}
                    rows={3}
                    placeholder="一句话概括本节点内容（可选）"
                    className={FIELD_CLASS}
                  />
                </div>
              </div>
            </Card>

            {/* 结构化信息：data 字段表单（按层级渲染，决策 23） */}
            <Card title={`结构化信息（${TYPE_LABEL[node.type]}）`}>
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
            </Card>

            {/* 变更记录（S5.4 行内面板逻辑迁入；「+ 新建变更」S12.3：内联表单 + 成功后重拉列表） */}
            <Card
              title="变更记录"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setDeltaFormOpen((v) => !v)}
                >
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
            </Card>

            {/* 伏笔标记占位（S9 伏笔面板落地后接入 plants/advances/resolves 标记） */}
            <Card title="伏笔标记" className="border-dashed">
              <p className="text-sm text-muted-foreground">伏笔标记将在伏笔面板（S9）落地</p>
            </Card>
          </div>

          {/* 右栏：相关实体（本节点作为 source；scope 模式复用 RelationsView） */}
          <div className="flex min-w-0 flex-col gap-4">
            <Card title="相关实体">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">本节点作为源的关系（1 跳）</p>
                <Button
                  variant="outline"
                  type="button"
                  className="h-8 px-2 text-xs"
                  onClick={() => setRelationDialogOpen(true)}
                >
                  + 新增关联
                </Button>
              </div>
              <RelationsView
                scope={{ type: "outline_node", id: nodeId }}
                reloadKey={relKey}
                onOpenCreate={() => setRelationDialogOpen(true)}
              />
            </Card>
          </div>
        </div>
      )}

      {/* 新增关联对话框（详情模式：源固定为本大纲节点，S12.2 扩展） */}
      {relationDialogOpen && node !== null && (
        <CreateRelationDialog
          source={{ type: "outline_node", id: node.id, name: node.title }}
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
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          maxLength={field.maxLength}
          rows={3}
          className={FIELD_CLASS}
        />
      );
    case "checkbox-group": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {(field.options ?? []).map((opt) => (
            <label key={opt} className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
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
        <select
          value={current}
          onChange={(e) => onChange(e.target.value)}
          className={cn(FIELD_CLASS, current === "" && "text-muted-foreground")}
        >
          <option value="">（未设置）</option>
          {stale && (
            <option value={current}>
              {current}（已删除）
            </option>
          )}
          {sceneOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {"　".repeat(o.depth)}
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    default:
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          maxLength={field.maxLength}
          className="h-8 text-sm"
        />
      );
  }
}
