// 新建人物弹窗（卡片 3.5）
//
// 契约：`docs/ui/DESIGN.md` §数据展示 `character-create-dialog` 与 `character-workbench`
//   （左栏行头「+ 新建」`button-primary` / 空态主操作 / 受控 `Dialog` + 不新增色值字号）、
//   `docs/db/schema.md`「人物 data 分层」（`description` 必填=**仅前端**）与「能力面板结构」。
// 分层：`CreateCharacterFormView` = 纯展示（SSR 走查用，仓内无 jsdom）；`CreateCharacterDialog` = 容器（取数/提交）。
// 单窗两段（基础信息 / 可选字段 / 能力面板），不做多步向导；能力面板三选 = 空白 / 内置模板 / 从已有角色复制。
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Input, Select } from "antd";
import type { AbilityPanelNode, EntitySummary } from "@whispering233/ai-editor-shared";
import { createEntity, getEntityDetail, listEntities } from "../../lib/api";
import {
  characterFieldsByKeys,
  CHARACTER_BASICS_DATA_KEYS,
  CHARACTER_MUTABLE_DATA_KEYS,
} from "../../lib/character-detail";
import {
  CHARACTER_CANDIDATE_LIMIT,
  DEFAULT_PANEL_CHOICE,
  PANEL_MODE_OPTIONS,
  findDuplicateCharacterName,
  panelFromCharacterData,
  panelFromTemplate,
  panelNodeCount,
  submitCharacterCreate,
  type CharacterCreateErrors,
  type PanelChoice,
} from "../../lib/character-create";
import { PANEL_TEMPLATES } from "../../lib/panel-tree";
import { useUiStore } from "../../stores/ui";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CharacterFieldsForm } from "./character-detail";

/** 模板下拉项：排除 `blank`（与「空白面板」模式重复） */
const TEMPLATE_OPTIONS = PANEL_TEMPLATES.filter((t) => t.id !== "blank");

const NO_ERRORS: CharacterCreateErrors = { name: null, role: null, description: null };

/** 弹窗字段标签（与详情页同款字色/字重；DESIGN `section-title` 之下的一档） */
const SECTION_LABEL_CLASS = "text-sm font-medium text-foreground";

export interface CreateCharacterFormViewProps {
  name: string;
  onNameChange: (value: string) => void;
  /** 基础信息区 + 可选字段区的值（`role`/`description` + 可变字段） */
  values: Record<string, unknown>;
  onFieldChange: (key: string, value: unknown) => void;
  errors: CharacterCreateErrors;
  /** 重名软提示（命中时给既有条目原文名；不阻断提交） */
  duplicateName: string | null;
  panelChoice: PanelChoice;
  onPanelChoiceChange: (patch: Partial<PanelChoice>) => void;
  /** 「从已有角色复制」候选（`null` = 未加载） */
  copyCandidates: EntitySummary[] | null;
  copyLoading: boolean;
  copyError: string | null;
  /** 已解析的面板结构（预览计数用） */
  panel: AbilityPanelNode[];
  /** 面板区提示（如「该角色没有能力面板结构」；`null` = 不提示） */
  panelHint: string | null;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}

/** 新建人物表单视图（纯展示：无 effect、无请求——SSR 可直渲染） */
export function CreateCharacterFormView(props: CreateCharacterFormViewProps) {
  return (
    <Dialog open onOpenChange={(v) => !v && props.onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>新建人物</DialogTitle>
        </DialogHeader>
        <CreateCharacterFormBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

/** 新建人物表单内容体（纯展示：无 effect、无请求；portal 不能在 SSR 渲染，故拆出本层供 `renderToString` 走查） */
export function CreateCharacterFormBody({
  name,
  onNameChange,
  values,
  onFieldChange,
  errors,
  duplicateName,
  panelChoice,
  onPanelChoiceChange,
  copyCandidates,
  copyLoading,
  copyError,
  panel,
  panelHint,
  submitting,
  submitError,
  onSubmit,
  onCancel,
}: CreateCharacterFormViewProps) {
  // 弹窗自持两段标题（必填段 / 可选段）：分段仅服务“留空不写 data”的边界，不是数据层可变性分区
  const basicsFields = characterFieldsByKeys(CHARACTER_BASICS_DATA_KEYS);
  const mutableFields = characterFieldsByKeys(CHARACTER_MUTABLE_DATA_KEYS);
  const panelCount = panelNodeCount(panel);
  const countLabel =
    panel.length === 0 ? "空白面板：不创建任何字段" : `将创建 ${panelCount} 个字段`;

  return (
    <form id="create-character-form" onSubmit={onSubmit} className="flex flex-col gap-4">
      {/* 段 1：基础信息（必填三项） */}
      <div className="flex flex-col gap-3">
        <p className={SECTION_LABEL_CLASS}>基础信息</p>
        <div>
          <p className="mb-1 text-sm font-medium text-foreground">姓名</p>
          <Input value={name} onChange={(e) => onNameChange(e.target.value)} autoFocus />
          {errors.name !== null && <p className="mt-1 text-xs text-destructive">{errors.name}</p>}
        </div>
        <CharacterFieldsForm
          fields={basicsFields}
          values={values}
          onChange={onFieldChange}
          fieldErrors={{ role: errors.role, description: errors.description }}
        />
      </div>

      {/* 段 2：可选字段（留空即不写入 data） */}
      <div className="flex flex-col gap-3 border-t border-border pt-3">
        <p className={SECTION_LABEL_CLASS}>可选字段</p>
        <CharacterFieldsForm fields={mutableFields} values={values} onChange={onFieldChange} />
      </div>

      {/* 段 3：能力面板（三选；结构快照深拷贝，见卡 3.5 契约） */}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <p className={SECTION_LABEL_CLASS}>能力面板</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-40"
            value={panelChoice.mode}
            onChange={(value: PanelChoice["mode"]) => onPanelChoiceChange({ mode: value })}
            options={PANEL_MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            popupMatchSelectWidth={false}
            aria-label="能力面板来源"
          />
          {panelChoice.mode === "template" && (
            <Select
              className="w-56"
              value={panelChoice.templateId === "" ? undefined : panelChoice.templateId}
              onChange={(value: string) => onPanelChoiceChange({ templateId: value })}
              placeholder="选择模板"
              options={TEMPLATE_OPTIONS.map((t) => ({ value: t.id, label: t.label }))}
              popupMatchSelectWidth={false}
              aria-label="内置模板"
            />
          )}
          {panelChoice.mode === "copy" && (
            <Select
              className="w-56"
              value={panelChoice.sourceId === "" ? undefined : panelChoice.sourceId}
              onChange={(value: string) => onPanelChoiceChange({ sourceId: value })}
              placeholder={copyLoading ? "读取中…" : "选择源角色"}
              loading={copyLoading}
              options={(copyCandidates ?? []).map((c) => ({
                value: c.id,
                label:
                  typeof c.summary.role === "string" && c.summary.role !== ""
                    ? `${c.name}（${c.summary.role}）`
                    : c.name,
              }))}
              popupMatchSelectWidth={false}
              aria-label="源角色"
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">{countLabel}</p>
        {copyError !== null && <p className="text-xs text-destructive">{copyError}</p>}
        {copyError === null && panelHint !== null && (
          <p className="text-xs text-muted-foreground">{panelHint}</p>
        )}
      </div>

      {/* 重名软提示（不阻断）+ 提交错误 */}
      {duplicateName !== null && (
        <p className="text-xs text-muted-foreground">已有同名角色：{duplicateName}（仍可创建）</p>
      )}
      {submitError !== null && <p className="text-sm text-destructive">{submitError}</p>}

      <DialogFooter>
        <Button onClick={onCancel}>取消</Button>
        <Button type="primary" htmlType="submit" loading={submitting}>
          创建
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * 新建人物弹窗容器：取候选角色（同时供重名判据 + 复制来源）、解析所选面板、提交 `POST /entity/character`。
 * 成功后关闭弹窗并把新角色 id 交回调用方（工作台负责选中与左栏刷新）。
 */
export function CreateCharacterDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<CharacterCreateErrors>(NO_ERRORS);
  const [panelChoice, setPanelChoice] = useState<PanelChoice>(DEFAULT_PANEL_CHOICE);
  const [characters, setCharacters] = useState<EntitySummary[] | null>(null);
  const [copyPanel, setCopyPanel] = useState<{
    sourceId: string;
    panel: AbilityPanelNode[];
  } | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 打开即重置（上次残留不带到下一次）+ 拉候选角色（重名判据与复制来源共用一份）
  useEffect(() => {
    if (!open) return;
    setName("");
    setValues({});
    setErrors(NO_ERRORS);
    setPanelChoice(DEFAULT_PANEL_CHOICE);
    setCopyPanel(null);
    setCopyError(null);
    setSubmitError(null);
    setCharacters(null);
    let cancelled = false;
    listEntities("character", { limit: CHARACTER_CANDIDATE_LIMIT })
      .then((res) => {
        if (!cancelled) setCharacters(res.items);
      })
      .catch(() => {
        if (!cancelled) setCharacters([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 复制来源：选中即读源角色详情取面板结构（深拷贝快照）
  useEffect(() => {
    if (panelChoice.mode !== "copy" || panelChoice.sourceId === "") return;
    const sourceId = panelChoice.sourceId;
    setCopyLoading(true);
    setCopyError(null);
    let cancelled = false;
    getEntityDetail("character", sourceId)
      .then((detail) => {
        if (!cancelled) setCopyPanel({ sourceId, panel: panelFromCharacterData(detail.data) });
      })
      .catch(() => {
        if (!cancelled) {
          setCopyPanel(null);
          setCopyError("无法读取该角色的能力面板，请重试");
        }
      })
      .finally(() => {
        if (!cancelled) setCopyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [panelChoice.mode, panelChoice.sourceId]);

  const panel = useMemo((): AbilityPanelNode[] => {
    if (panelChoice.mode === "blank") return [];
    if (panelChoice.mode === "template") {
      return panelChoice.templateId === "" ? [] : panelFromTemplate(panelChoice.templateId);
    }
    if (copyPanel !== null && copyPanel.sourceId === panelChoice.sourceId) return copyPanel.panel;
    return [];
  }, [panelChoice.mode, panelChoice.templateId, panelChoice.sourceId, copyPanel]);

  const panelHint = useMemo((): string | null => {
    if (panelChoice.mode === "template" && panelChoice.templateId === "") return "请选择模板";
    if (panelChoice.mode === "copy") {
      if (panelChoice.sourceId === "") return "请选择源角色";
      if (copyLoading) return "读取中…";
      if (copyPanel !== null && panel.length === 0) return "该角色没有能力面板结构";
    }
    return null;
  }, [
    panelChoice.mode,
    panelChoice.templateId,
    panelChoice.sourceId,
    copyLoading,
    copyPanel,
    panel,
  ]);

  const duplicateName = useMemo(
    () => (characters === null ? null : findDuplicateCharacterName(characters, name)),
    [characters, name],
  );

  /** 面板来源变化：切到模板时预选首个模板；其余按 patch 合并 */
  function handlePanelChoiceChange(patch: Partial<PanelChoice>): void {
    setPanelChoice((prev) => {
      const next = { ...prev, ...patch };
      if (patch.mode === "template" && next.templateId === "") {
        next.templateId = TEMPLATE_OPTIONS[0]?.id ?? "";
      }
      return next;
    });
  }

  function handleFieldChange(key: string, value: unknown): void {
    setValues((prev) => ({ ...prev, [key]: value }));
    // 错误态随输入即时消解（首次提交前的 errors 恒为空，不会误报）
    setErrors((prev) => {
      if (prev[key as keyof CharacterCreateErrors] === undefined) return prev;
      if (key === "role" || key === "description") return { ...prev, [key]: null };
      return prev;
    });
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const result = await submitCharacterCreate(
      { name, values, panel },
      {
        createEntity,
        onSubmittingStart: () => {
          setSubmitting(true);
          setSubmitError(null);
        },
        onSubmittingEnd: () => setSubmitting(false),
      },
    );
    if (result.kind === "invalid") {
      setErrors(result.errors);
      return;
    }
    if (result.kind === "created") {
      useUiStore.getState().showToast("已创建人物");
      onOpenChange(false);
      onCreated(result.id);
      return;
    }
    setSubmitError(result.message);
  }

  if (!open) return null;

  return (
    <CreateCharacterFormView
      name={name}
      onNameChange={(value) => {
        setName(value);
        setErrors((prev) => (prev.name === null ? prev : { ...prev, name: null }));
      }}
      values={values}
      onFieldChange={handleFieldChange}
      errors={errors}
      duplicateName={duplicateName}
      panelChoice={panelChoice}
      onPanelChoiceChange={handlePanelChoiceChange}
      copyCandidates={characters}
      copyLoading={copyLoading}
      copyError={copyError}
      panel={panel}
      panelHint={panelHint}
      submitting={submitting}
      submitError={submitError}
      onSubmit={(e) => void handleSubmit(e)}
      onCancel={() => onOpenChange(false)}
    />
  );
}
