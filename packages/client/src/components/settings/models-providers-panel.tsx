// 设置页「高级 → 自定义模型」（docs/ui/DESIGN.md `tab-advanced` → `models-providers`；卡 3b）
//
// 一张列表 + 一个受控弹窗，管 `models.json` 里**自定义 provider** 的常用字段：读 = `getConfigFile`，
// 写 = `saveConfigFile`（服务端按 pi 读口径校验 + 原子写 + 立即生效 + `models.json.bak` 备份，零新 API）。
// 组装 / 透传 / 校验全在 `lib/models-config.ts`（纯函数，有单测）；本文件只管状态与请求。
//
// 三条从 `search-key` 借来的口径：解析失败禁用编辑并指路下方 JSON 编辑器；保存失败**不清空输入**；
// 标题行常备「重新读取」——JSON 分页保存后没有跨面板刷新信号，缺这个入口只能刷新整页。
// `parse → stringify` 会丢注释：`countJsoncLosses > 0` 时先确认（原文由服务端备份为 `models.json.bak`）。
import { useEffect, useState } from "react";
import { Button, Input, Switch } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  ApiError,
  getConfigFile,
  getSettingsLlm,
  saveConfigFile,
} from "../../lib/api";
import {
  commentsLostOnSave,
  composeModelsText,
  emptyProviderForm,
  hasProviderErrors,
  readCustomProviders,
  validateProviderForm,
  type CustomModelRowForm,
  type CustomProviderForm,
  type ProviderFormErrors,
} from "../../lib/models-config";
import { useUiStore } from "../../stores/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { EmptyState } from "../ui/empty-state";
import { SectionCard } from "../ui/section-card";
import { FieldError } from "@/components/ui/field-error";

/** 列表侧的读取态（loading / ready / 两种失败都只能重读） */
export type ModelsProvidersState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "load-failed"; reason: string }
  | { status: "parse-failed"; reason: string };

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** 保存链路的结果：cancelled = 用户在「会丢注释」确认里点了取消 */
type CommitOutcome = { status: "saved" } | { status: "cancelled" } | { status: "failed"; error: string };

export interface ModelsProvidersCardProps {
  state: ModelsProvidersState;
  providers: readonly CustomProviderForm[];
  onAdd(): void;
  onEdit(id: string): void;
  onDelete(id: string): void;
  onReload(): void;
}

/** 纯展示层（容器负责请求）；导出以便 SSR 走查各态 */
export function ModelsProvidersCard({
  state,
  providers,
  onAdd,
  onEdit,
  onDelete,
  onReload,
}: ModelsProvidersCardProps) {
  const editable = state.status === "ready";

  return (
    <SectionCard
      title="自定义模型"
      action={
        <div className="flex items-center gap-1">
          <Button
            color="default"
            variant="text"
            size="small"
            icon={<ReloadOutlined />}
            aria-label="重新读取"
            title="重新读取"
            onClick={onReload}
          />
          <Button type="primary" size="small" disabled={!editable} onClick={onAdd}>
            添加
          </Button>
        </div>
      }
    >
      {state.status === "loading" && <p className="text-xs text-muted-foreground">读取中…</p>}
      {state.status === "load-failed" && (
        <FieldError>读取 models.json 失败：{state.reason}</FieldError>
      )}
      {state.status === "parse-failed" && (
        <FieldError>
          models.json 无法读取：{state.reason} —— 请在下方「本机配置文件 → 自定义模型」里修复后再试。
        </FieldError>
      )}

      {editable &&
        (providers.length === 0 ? (
          <EmptyState padding="sm">还没有自定义模型服务</EmptyState>
        ) : (
          <ul>
            {providers.map((provider) => (
              <li
                key={provider.id}
                className="flex items-center gap-2 border-b border-border/50 py-2 transition-colors last:border-b-0 hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{provider.name || provider.id}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{provider.id}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{provider.models.length} 个模型</span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    color="default"
                    variant="text"
                    size="small"
                    icon={<EditOutlined />}
                    aria-label={`编辑 ${provider.id}`}
                    title="编辑"
                    onClick={() => onEdit(provider.id)}
                  />
                  <Button
                    color="danger"
                    variant="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    aria-label={`删除 ${provider.id}`}
                    title="删除"
                    onClick={() => onDelete(provider.id)}
                  />
                </span>
              </li>
            ))}
          </ul>
        ))}

      <p className="mt-2 text-xs text-muted-foreground">
        只列 models.json 里的自定义 provider（pi 内置家见「AI 模型」页）。两个入口写同一份文件：先保存 JSON 再回来用表单；
        表单只管常用字段，保存时会去掉 // 注释与尾逗号（原文备份为 models.json.bak）。
      </p>
    </SectionCard>
  );
}

function FormField({
  label,
  children,
  error,
}: {
  label: string;
  children: React.ReactNode;
  error?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
      {error !== undefined && error !== null && <FieldError as="span">{error}</FieldError>}
    </div>
  );
}

interface ProviderDialogProps {
  draft: CustomProviderForm;
  isNew: boolean;
  /** 非空 = 已尝试保存过，校验错误就地展示 */
  errors: ProviderFormErrors | null;
  saving: boolean;
  /** 保存失败的服务端文案（不覆盖输入） */
  saveError: string | null;
  /** 该 id 与 pi 内置 provider 同名（= 覆盖而非新增家）；目录取不到时恒 false */
  isBuiltinId(id: string): boolean;
  onChange(next: CustomProviderForm): void;
  onSave(): void;
  onCancel(): void;
}

function ProviderDialog({
  draft,
  isNew,
  errors,
  saving,
  saveError,
  isBuiltinId,
  onChange,
  onSave,
  onCancel,
}: ProviderDialogProps) {
  function patchModel(index: number, patch: Partial<CustomModelRowForm>): void {
    onChange({ ...draft, models: draft.models.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  }

  const modelErrors = errors?.models ?? [];

  return (
    // 保存中不允许关闭（Esc / 遮罩 / X 都走 onOpenChange）：同 cloud-conflict-dialog 的 busy 守卫
    <Dialog open onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent width="2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "添加自定义 provider" : `编辑 ${draft.id}`}</DialogTitle>
          <DialogDescription>
            只写这里负责的字段；cost / compat / samplingParams 等其余键原样保留。id 建好后不可改，改名 = 删旧建新。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <FormField label="provider id" error={errors?.id}>
            <Input
              autoFocus={isNew}
              value={draft.id}
              disabled={!isNew}
              placeholder="my-gateway"
              onChange={(e) => onChange({ ...draft, id: e.target.value })}
              aria-label="provider id"
            />
            {isBuiltinId(draft.id) && (
              <span className="text-xs text-muted-foreground">
                「{draft.id.trim()}」与 pi 内置 provider 同名：保存后是覆盖该内置家，不是新增家。
              </span>
            )}
          </FormField>
          <FormField label="名称">
            <Input
              value={draft.name}
              placeholder="我的网关"
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              aria-label="provider 名称"
            />
          </FormField>
          <div className="col-span-2">
            <FormField label="baseUrl">
              <Input
                value={draft.baseUrl}
                placeholder="https://api.example.com/v1"
                onChange={(e) => onChange({ ...draft, baseUrl: e.target.value })}
                aria-label="baseUrl"
              />
            </FormField>
          </div>
          <FormField label="api">
            <Input
              value={draft.api}
              placeholder="openai-completions / anthropic-messages / …"
              onChange={(e) => onChange({ ...draft, api: e.target.value })}
              aria-label="api"
            />
          </FormField>
          <div className="flex flex-col justify-end gap-1 pb-1">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                size="small"
                checked={draft.authHeader}
                onChange={(checked) => onChange({ ...draft, authHeader: checked })}
                aria-label="发送 Authorization: Bearer"
              />
              发送 Authorization: Bearer
            </span>
          </div>
          <div className="col-span-2">
            <FormField label="apiKey">
              <Input
                value={draft.apiKey}
                placeholder="字面 key / $ENV_VAR / !命令"
                onChange={(e) => onChange({ ...draft, apiKey: e.target.value })}
                aria-label="apiKey"
              />
            </FormField>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">模型行</span>
            <Button size="small" icon={<PlusOutlined />} onClick={() => onChange({ ...draft, models: [...draft.models, emptyModelRow()] })}>
              添加模型
            </Button>
          </div>
          {draft.models.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              还没有模型行——只填 baseUrl / api 也可以（用来覆盖 pi 内置家的地址）。
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {/* 列头单独一行：每行都挂 label 会让输入框高低不齐 */}
              <div className="grid grid-cols-[1.2fr_1fr_6rem_6rem_2rem_1.5rem] gap-1 text-xs text-muted-foreground">
                <span>模型 id</span>
                <span>名称</span>
                <span>上下文窗口</span>
                <span>最大输出</span>
                <span>思考</span>
                <span />
              </div>
              {draft.models.map((row, index) => (
                <div key={index} className="grid grid-cols-[1.2fr_1fr_6rem_6rem_2rem_1.5rem] items-start gap-1">
                  <div className="flex flex-col gap-0.5">
                    <Input
                      size="small"
                      value={row.id}
                      onChange={(e) => patchModel(index, { id: e.target.value })}
                      aria-label="模型 id"
                    />
                    {modelErrors[index]?.id != null && (
                      <FieldError as="span">{modelErrors[index]?.id}</FieldError>
                    )}
                  </div>
                  <Input
                    size="small"
                    value={row.name}
                    onChange={(e) => patchModel(index, { name: e.target.value })}
                    aria-label="模型名称"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Input
                      size="small"
                      value={row.contextWindow}
                      placeholder="128000"
                      onChange={(e) => patchModel(index, { contextWindow: e.target.value })}
                      aria-label="上下文窗口"
                    />
                    {modelErrors[index]?.contextWindow != null && (
                      <FieldError as="span">填正整数或留空</FieldError>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <Input
                      size="small"
                      value={row.maxTokens}
                      placeholder="16384"
                      onChange={(e) => patchModel(index, { maxTokens: e.target.value })}
                      aria-label="最大输出"
                    />
                    {modelErrors[index]?.maxTokens != null && (
                      <FieldError as="span">填正整数或留空</FieldError>
                    )}
                  </div>
                  <Switch
                    size="small"
                    checked={row.reasoning}
                    onChange={(checked) => patchModel(index, { reasoning: checked })}
                    aria-label="模型支持思考"
                  />
                  <Button
                    color="danger"
                    variant="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    aria-label={`删除第 ${index + 1} 个模型`}
                    title="删除这一行"
                    onClick={() => onChange({ ...draft, models: draft.models.filter((_, i) => i !== index) })}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {saveError !== null && <FieldError>{saveError}</FieldError>}

        <DialogFooter>
          <Button onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button type="primary" loading={saving} disabled={saving} onClick={onSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 新加的一行模型（表单值全空，保存时按校验规则补） */
function emptyModelRow(): CustomModelRowForm {
  return { id: "", name: "", contextWindow: "", maxTokens: "", reasoning: false, extra: {} };
}

export function ModelsProvidersPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const [state, setState] = useState<ModelsProvidersState>({ status: "loading" });
  const [providers, setProviders] = useState<CustomProviderForm[]>([]);
  /** 读到的顶层原始对象（未知键透传的基底） */
  const [original, setOriginal] = useState<Record<string, unknown>>({});
  /** 读到的原文（注释计数用；保存后重读会变成格式化结果） */
  const [loadedText, setLoadedText] = useState("");
  /** 文件里已有的 provider id（内置冲突警告要把它排除掉：目录里也含自定义家） */
  const [loadedIds, setLoadedIds] = useState<ReadonlySet<string>>(new Set());
  /** pi provider 目录的 id（拿不到 = null ⇒ 只给通用文案，不阻塞表单） */
  const [catalogIds, setCatalogIds] = useState<ReadonlySet<string> | null>(null);
  /** 每次「重新读取」/ 保存成功后自增（effect 依赖它，避免把拉取写进事件处理器） */
  const [attempt, setAttempt] = useState(0);

  const [draft, setDraft] = useState<CustomProviderForm | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void getConfigFile("models.json")
      .then((res) => {
        if (cancelled) return;
        const parsed = readCustomProviders(res.content);
        if (!parsed.ok) {
          setState({ status: "parse-failed", reason: parsed.reason });
          return;
        }
        setOriginal(parsed.original);
        setProviders(parsed.providers);
        setLoadedIds(new Set(parsed.providers.map((provider) => provider.id)));
        setLoadedText(res.content);
        setState({ status: "ready" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "load-failed", reason: messageOf(err, "读取失败，请重试") });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // 内置 provider id 只取一次：保存后目录里会混进自定义家，再取一次就会把它们全当成「内置同名」。
  // 取失败 = 降级（只留弹窗里那句通用说明），不阻塞表单。
  useEffect(() => {
    let cancelled = false;
    void getSettingsLlm()
      .then((config) => {
        if (!cancelled) setCatalogIds(new Set(config.providers.map((provider) => provider.id)));
      })
      .catch(() => {
        if (!cancelled) setCatalogIds(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function isBuiltinId(id: string): boolean {
    const trimmed = id.trim();
    return catalogIds !== null && trimmed !== "" && !loadedIds.has(trimmed) && catalogIds.has(trimmed);
  }

  /** 组装 → 注释确认 → 保存 → toast + 重读（服务端会落格式化结果，本地不自己改列表） */
  async function commit(next: readonly CustomProviderForm[]): Promise<CommitOutcome> {
    const losses = commentsLostOnSave(loadedText);
    if (losses > 0) {
      const ok = await useUiStore.getState().confirm({
        title: "保存会丢掉注释",
        description: `models.json 里有 ${losses} 处注释 / 尾逗号，表单保存后会去掉；原文会先备份为 models.json.bak。`,
      });
      if (!ok) return { status: "cancelled" };
    }
    try {
      await saveConfigFile("models.json", composeModelsText(original, next));
    } catch (err) {
      return { status: "failed", error: messageOf(err, "保存失败，请重试") };
    }
    showToast("已保存，立即生效");
    setAttempt((n) => n + 1);
    return { status: "saved" };
  }

  function openNew(): void {
    setDraft(emptyProviderForm());
    setIsNew(true);
    setShowErrors(false);
    setSaveError(null);
  }

  function openEdit(id: string): void {
    const found = providers.find((provider) => provider.id === id);
    if (found === undefined) return;
    setDraft(found);
    setIsNew(false);
    setShowErrors(false);
    setSaveError(null);
  }

  function closeDialog(): void {
    setDraft(null);
    setSaveError(null);
  }

  async function handleSave(): Promise<void> {
    if (draft === null || saving) return;
    setShowErrors(true);
    const takenIds = providers.filter((provider) => provider.id !== draft.id).map((provider) => provider.id);
    if (hasProviderErrors(validateProviderForm(draft, takenIds))) return;
    const next = isNew
      ? [...providers, draft]
      : providers.map((provider) => (provider.id === draft.id ? draft : provider));
    setSaving(true);
    const outcome = await commit(next);
    setSaving(false);
    if (outcome.status === "saved") closeDialog();
    else if (outcome.status === "failed") setSaveError(outcome.error);
  }

  async function handleDelete(id: string): Promise<void> {
    const found = providers.find((provider) => provider.id === id);
    if (found === undefined) return;
    const ok = await useUiStore.getState().confirm({
      title: `删除自定义 provider「${found.name || found.id}」`,
      description: `会连同它下面的 ${found.models.length} 个模型一起从 models.json 删掉，无法撤销（原文会先备份为 models.json.bak）。`,
      danger: true,
    });
    if (!ok) return;
    const outcome = await commit(providers.filter((provider) => provider.id !== id));
    if (outcome.status === "failed") showToast(outcome.error, "error");
  }

  const errors = draft !== null && showErrors ? validateProviderForm(draft, providers.filter((p) => p.id !== draft.id).map((p) => p.id)) : null;

  return (
    <>
      <ModelsProvidersCard
        state={state}
        providers={providers}
        onAdd={openNew}
        onEdit={openEdit}
        onDelete={(id) => void handleDelete(id)}
        onReload={() => setAttempt((n) => n + 1)}
      />
      {draft !== null && (
        <ProviderDialog
          draft={draft}
          isNew={isNew}
          errors={errors}
          saving={saving}
          saveError={saveError}
          isBuiltinId={isBuiltinId}
          onChange={setDraft}
          onSave={() => void handleSave()}
          onCancel={closeDialog}
        />
      )}
    </>
  );
}
