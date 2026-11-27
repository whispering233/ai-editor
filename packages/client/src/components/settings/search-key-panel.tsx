// 设置页「高级 → 联网搜索」（docs/ui/DESIGN.md `tab-advanced` → `search-key`；卡 2）
//
// 一张表单管 `~/.ai-editor/search.json` 的一个字段 `apiKey`：读 = `getConfigFile`，
// 写 = `saveConfigFile`（服务端 strict 校验 + 原子写 + 立即生效，零新 API）。
// 不复用「配置文件」那套四槽位草稿机（`lib/config-file-draft.ts`）：这里只有一份文件一个字段。
// 解析失败（用户手改坏 / 未知键被 strict 拒之前）时输入与保存都禁用，指路下方 JSON 编辑器——
// 客户端不替用户改文件。
import { useEffect, useState } from "react";
import { Button, Input } from "antd";
import { ApiError, getConfigFile, saveConfigFile } from "../../lib/api";
import { composeSearchConfigText, parseSearchKey } from "../../lib/search-key";
import { useRegisterDirty } from "../../hooks/use-leave-guard";
import { useUiStore } from "../../stores/ui";
import { SectionCard } from "../ui/section-card";
import { FieldError } from "@/components/ui/field-error";

/** 表单侧的读取态（loading / ready / 两种失败都只能重读） */
export type SearchKeyState =
  | { status: "loading" }
  | { status: "ready"; loadedKey: string }
  | { status: "load-failed"; reason: string }
  | { status: "parse-failed"; reason: string };

/** 表单是否脏（草稿差已加载 key）：展示层与容器（离开守卫报到）共用这一处判定 */
export function searchKeyDirty(state: SearchKeyState, draft: string): boolean {
  return state.status === "ready" && draft.trim() !== state.loadedKey.trim();
}

export interface SearchKeyFormProps {
  state: SearchKeyState;
  draft: string;
  saving: boolean;
  /** 保存失败的服务端文案（不覆盖 draft） */
  saveError: string | null;
  onDraftChange(value: string): void;
  onSave(): void;
  onReload(): void;
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** 纯展示层（容器负责请求）；导出以便 SSR 走查各态 */
export function SearchKeyForm({ state, draft, saving, saveError, onDraftChange, onSave, onReload }: SearchKeyFormProps) {
  const dirty = searchKeyDirty(state, draft);
  const editable = state.status === "ready";
  const canReload = state.status === "load-failed" || state.status === "parse-failed";

  return (
    <SectionCard
      title="联网搜索"
      action={
        <Button type="primary" size="small" loading={saving} disabled={!dirty || saving} onClick={onSave}>
          保存
        </Button>
      }
    >
      {/* 弹性宽度挂外层：antd Input 会给自身注入 min-width: 0（见 AGENTS.md） */}
      <div className="flex-1">
        <Input.Password
          value={draft}
          disabled={!editable}
          placeholder={
            state.status === "ready" ? "未配置（留空 = 关闭联网搜索）" : state.status === "loading" ? "读取中…" : ""
          }
          onChange={(e) => onDraftChange(e.target.value)}
          onPressEnter={() => {
            if (dirty && !saving) onSave();
          }}
          aria-label="联网搜索 API key"
        />
      </div>

      {state.status === "load-failed" && (
        <FieldError className="mt-1">读取 search.json 失败：{state.reason}</FieldError>
      )}
      {state.status === "parse-failed" && (
        <FieldError className="mt-1">
          search.json 现在是 {state.reason} —— 请在下方「本机配置文件 → 搜索凭据」里修复后再试。
        </FieldError>
      )}
      {saveError !== null && <FieldError className="mt-1">{saveError}</FieldError>}
      {canReload && (
        <div className="mt-2">
          <Button size="small" onClick={onReload}>
            重新读取
          </Button>
        </div>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        key 只存本机 ~/.ai-editor/search.json；搜索按次计费，与对话用的模型 key 是两份独立配置。未配置时联网搜索工具会报错并指回这里。
      </p>
    </SectionCard>
  );
}

export function SearchKeyPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const [state, setState] = useState<SearchKeyState>({ status: "loading" });
  const [draft, setDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** 每次「重新读取」自增（effect 依赖它，避免把拉取写进事件处理器） */
  const [attempt, setAttempt] = useState(0);

  // 离开守卫：hook 放容器（展示层只按 props 渲染，不自己报到）
  useRegisterDirty(searchKeyDirty(state, draft));

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setSaveError(null);
    void getConfigFile("search.json")
      .then((res) => {
        if (cancelled) return;
        const parsed = parseSearchKey(res.content);
        if (!parsed.ok) {
          setState({ status: "parse-failed", reason: parsed.reason });
          return;
        }
        setDraft(parsed.apiKey);
        setState({ status: "ready", loadedKey: parsed.apiKey });
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
    setSaving(true);
    setSaveError(null);
    try {
      await saveConfigFile("search.json", composeSearchConfigText(draft));
      const saved = draft.trim();
      setDraft(saved);
      setState({ status: "ready", loadedKey: saved });
      showToast("已保存，立即生效");
    } catch (err) {
      // 保存失败（校验 / 网络）：保留输入，就地展示服务端原文；本表单产物恒为单键 `{ apiKey }`，未知键不会由这里产生
      setSaveError(messageOf(err, "保存失败，请重试"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SearchKeyForm
      state={state}
      draft={draft}
      saving={saving}
      saveError={saveError}
      onDraftChange={setDraft}
      onSave={() => void handleSave()}
      onReload={() => setAttempt((n) => n + 1)}
    />
  );
}
