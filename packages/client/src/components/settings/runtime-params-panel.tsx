// 设置页「高级 → 运行参数」（docs/ui/DESIGN.md `tab-advanced` → `runtime-params`；卡 4）
//
// 一张表单管 `settings.json` 的三个键（重试启用 / 压缩启用 / 出站空闲超时）：读 = `getConfigFile`，
// 写 = `saveConfigFile`（服务端按 pi 读口径严格 parse + 原子写 + 立即生效，零新 API）。
// 组装 / 浅合并 / 校验全在 `lib/runtime-params.ts`（纯函数，有单测）；本文件只管状态与请求。
//
// 两个 `Select` 是三态（默认 / 启用 / 关闭）而不是 `Switch`：「默认」= **删键**，客户端不知道 pi 的
// 缺省值，两态开关会把「未设置」伪装成「关闭」。解析失败禁用编辑并指路下方 JSON 页——
// `settings.json` 是严格 JSON，不替用户改文件（也不做注释确认）。
import { useEffect, useState } from "react";
import { Button, InputNumber, Select } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { ApiError, getConfigFile, saveConfigFile } from "../../lib/api";
import {
  HTTP_IDLE_TIMEOUT_MIN_MS,
  composeSettingsText,
  httpIdleTimeoutProblem,
  readRuntimeParams,
  type RuntimeParams,
} from "../../lib/runtime-params";
import { useUiStore } from "../../stores/ui";
import { useRegisterDirty } from "../../hooks/use-leave-guard";
import { SectionCard } from "../ui/section-card";

/** 表单侧的读取态（loading / ready / 两种失败都只能重读） */
export type RuntimeParamsState =
  | { status: "loading" }
  | { status: "ready"; params: RuntimeParams; original: Record<string, unknown> }
  | { status: "load-failed"; reason: string }
  | { status: "parse-failed"; reason: string };

/** 表单草稿：`null` = 输入框留空（= 删键） */
export interface RuntimeParamsDraft {
  retryEnabled: boolean | undefined;
  compactionEnabled: boolean | undefined;
  httpIdleTimeoutMs: number | null;
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function draftFrom(params: RuntimeParams): RuntimeParamsDraft {
  return {
    retryEnabled: params.retryEnabled,
    compactionEnabled: params.compactionEnabled,
    httpIdleTimeoutMs: params.httpIdleTimeoutMs ?? null,
  };
}

function paramsFrom(draft: RuntimeParamsDraft): RuntimeParams {
  return {
    retryEnabled: draft.retryEnabled,
    compactionEnabled: draft.compactionEnabled,
    httpIdleTimeoutMs: draft.httpIdleTimeoutMs ?? undefined,
  };
}

/** 三态值 ↔ 草稿值（antd `Select` 的 value 只收字符串） */
const TRI_STATE_OPTIONS = [
  { value: "default", label: "默认（跟随 pi）" },
  { value: "true", label: "启用" },
  { value: "false", label: "关闭" },
] as const;

function triStateValue(value: boolean | undefined): string {
  return value === undefined ? "default" : String(value);
}

function triStateFrom(value: string): boolean | undefined {
  return value === "default" ? undefined : value === "true";
}

/** 草稿是否脏（三个控件任一与已加载参数不同）：展示层的「保存」置灰与容器（离开守卫）共用这一处判定 */
export function runtimeParamsDirty(
  state: RuntimeParamsState,
  draft: RuntimeParamsDraft,
): boolean {
  if (state.status !== "ready") return false;
  const next = paramsFrom(draft);
  const loaded = state.params;
  return (
    next.retryEnabled !== loaded.retryEnabled ||
    next.compactionEnabled !== loaded.compactionEnabled ||
    next.httpIdleTimeoutMs !== loaded.httpIdleTimeoutMs
  );
}

export interface RuntimeParamsFormProps {
  state: RuntimeParamsState;
  draft: RuntimeParamsDraft;
  saving: boolean;
  /** 保存失败的服务端文案（不覆盖草稿） */
  saveError: string | null;
  /** 保存前的本地校验（如下界） */
  validationError: string | null;
  onDraftChange(next: RuntimeParamsDraft): void;
  onSave(): void;
  onReload(): void;
}

/** 纯展示层（容器负责请求 + 已加载值）；`loaded` 用于判 dirty，导出以便 SSR 走查各态 */
export function RuntimeParamsForm({
  state,
  draft,
  saving,
  saveError,
  validationError,
  onDraftChange,
  onSave,
  onReload,
}: RuntimeParamsFormProps) {
  const editable = state.status === "ready";
  const dirty = runtimeParamsDirty(state, draft);

  return (
    <SectionCard
      title="运行参数"
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
          <Button type="primary" size="small" loading={saving} disabled={!dirty || saving} onClick={onSave}>
            保存
          </Button>
        </div>
      }
    >
      {state.status === "loading" && <p className="text-xs text-muted-foreground">读取中…</p>}
      {state.status === "load-failed" && (
        <p className="text-xs text-destructive">读取 settings.json 失败：{state.reason}</p>
      )}
      {state.status === "parse-failed" && (
        <p className="text-xs text-destructive">
          settings.json 无法读取：{state.reason} —— 请在下方「本机配置文件 → 运行参数」里修复后再试。
        </p>
      )}

      <div className="flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">重试启用</span>
          <Select
            size="small"
            value={triStateValue(draft.retryEnabled)}
            onChange={(value) => onDraftChange({ ...draft, retryEnabled: triStateFrom(value) })}
            disabled={!editable || saving}
            aria-label="重试启用"
            options={[...TRI_STATE_OPTIONS]}
            style={{ minWidth: 152 }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">压缩启用</span>
          <Select
            size="small"
            value={triStateValue(draft.compactionEnabled)}
            onChange={(value) => onDraftChange({ ...draft, compactionEnabled: triStateFrom(value) })}
            disabled={!editable || saving}
            aria-label="压缩启用"
            options={[...TRI_STATE_OPTIONS]}
            style={{ minWidth: 152 }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">出站空闲超时（ms）</span>
          {/* 不设 min：下界由保存前的本地校验给行内错误（antd 的 min 会在失焦时静默夹值） */}
          <InputNumber
            size="small"
            value={draft.httpIdleTimeoutMs}
            onChange={(value) => onDraftChange({ ...draft, httpIdleTimeoutMs: value })}
            precision={0}
            placeholder="默认"
            disabled={!editable || saving}
            aria-label="出站空闲超时（毫秒）"
            style={{ width: 152 }}
          />
        </div>
      </div>

      {validationError !== null && <p className="mt-2 text-xs text-destructive">{validationError}</p>}
      {saveError !== null && <p className="mt-2 text-xs text-destructive">{saveError}</p>}

      <p className="mt-2 text-xs text-muted-foreground">
        只覆盖这三个键（其余运行参数、出站代理、可见模型请在下方「本机配置文件 → 运行参数」里改，保存后原样保留）。
        「默认」= 删掉该键、跟随 pi 自己的缺省；出站空闲超时单位毫秒、下界 {HTTP_IDLE_TIMEOUT_MIN_MS}（
        {HTTP_IDLE_TIMEOUT_MIN_MS} = 关闭空闲超时），留空同样 = 跟随 pi 缺省。保存后立即生效。
      </p>
    </SectionCard>
  );
}

export function RuntimeParamsPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const [state, setState] = useState<RuntimeParamsState>({ status: "loading" });
  const [draft, setDraft] = useState<RuntimeParamsDraft>(draftFrom({} as RuntimeParams));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** 每次「重新读取」自增（effect 依赖它，避免把拉取写进事件处理器） */
  const [attempt, setAttempt] = useState(0);

  // 离开守卫：hook 放容器（展示层只按 props 渲染，不自己报到）
  useRegisterDirty(runtimeParamsDirty(state, draft));

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setSaveError(null);
    setValidationError(null);
    void getConfigFile("settings.json")
      .then((res) => {
        if (cancelled) return;
        const parsed = readRuntimeParams(res.content);
        if (!parsed.ok) {
          setState({ status: "parse-failed", reason: parsed.reason });
          return;
        }
        setDraft(draftFrom(parsed.params));
        setState({ status: "ready", params: parsed.params, original: parsed.original });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "load-failed", reason: messageOf(err, "读取失败，请重试") });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function handleSave(): Promise<void> {
    if (saving || state.status !== "ready") return;
    const next = paramsFrom(draft);
    if (next.httpIdleTimeoutMs !== undefined) {
      const problem = httpIdleTimeoutProblem(next.httpIdleTimeoutMs);
      if (problem !== null) {
        setValidationError(problem);
        return;
      }
    }
    setValidationError(null);
    setSaveError(null);
    setSaving(true);
    try {
      // 服务端按 pi 读口径严格 parse → 原子写 → 立即生效；原文里的其它字段由浅合并保住
      await saveConfigFile("settings.json", composeSettingsText(state.original, next));
      setState({ status: "ready", params: next, original: state.original });
      showToast("已保存，立即生效");
    } catch (err) {
      // 保存失败（校验 / 网络）：保留草稿，就地展示服务端原文
      setSaveError(messageOf(err, "保存失败，请重试"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RuntimeParamsForm
      state={state}
      draft={draft}
      saving={saving}
      saveError={saveError}
      validationError={validationError}
      onDraftChange={(value) => {
        setDraft(value);
        setValidationError(null);
      }}
      onSave={() => void handleSave()}
      onReload={() => setAttempt((n) => n + 1)}
    />
  );
}