// 设置页「AI 模型」分区（自 Settings.tsx 下沉；二级 tab 的一个 pane）
// 数据：GET/PUT /api/v1/settings/llm——模型下拉点选即激活（provider+model 成对）、
// 各家 key 独立配置（掩码状态行 + 新 key 输入 + 保存/清除）
// 常驻说明：key 只存本机用户配置（~/.ai-editor/config.json），不入项目文件；
// 环境变量 DEEPSEEK_API_KEY 优先于此处配置（页面仍可保存，实际生效以环境变量为准）
import { useEffect, useState } from "react";
import { Alert, Button, Card, Input, Select, Tag, theme } from "antd";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  getSettingsLlm,
  updateSettingsLlm,
  type SettingsLlmConfig,
} from "../../lib/api";
import { useUiStore, type ErrorBanner } from "../../stores/ui";

/** 从任意错误提取错误码（ApiError → 服务端/客户端码；未知 → 网络错误） */
function errorCodeOf(err: unknown): ErrorBanner["code"] {
  return err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR;
}

export function LlmSection() {
  const { token } = theme.useToken();
  const showToast = useUiStore((s) => s.showToast);
  const showError = useUiStore((s) => s.showError);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** 模型激活错误（区块顶部内联） */
  const [modelError, setModelError] = useState<string | null>(null);
  /** 当前 LLM 配置快照（激活 provider/model + 各家 key 状态 + 目录） */
  const [settings, setSettings] = useState<SettingsLlmConfig | null>(null);
  /** 各家 key 输入草稿（provider id → 输入值） */
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  /** 卡内 key 表单内联错误（provider id → 错误文案） */
  const [keyErrors, setKeyErrors] = useState<Record<string, string | null>>({});

  /** 拉取当前配置（保存/清除后刷新掩码状态） */
  async function refresh() {
    try {
      const config = await getSettingsLlm();
      setSettings(config);
    } catch (err) {
      showError(errorCodeOf(err), "读取 LLM 配置失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  /** 激活某 provider 的模型（卡内下拉即存：provider+model 成对——跨 provider 切换语义） */
  async function handleActivate(providerId: string, modelId: string) {
    setModelError(null);
    try {
      await updateSettingsLlm({ provider: providerId, model: modelId });
      setSettings((s) => (s ? { ...s, provider: providerId, model: modelId } : s));
      showToast("已切换模型，仅影响新请求");
    } catch (err) {
      if (errorCodeOf(err) === CLIENT_NETWORK_ERROR) {
        showError("CLIENT_NETWORK_ERROR", "无法连接服务，模型未切换");
      } else {
        setModelError("切换失败，请重试");
      }
    }
  }

  /** 保存该家 key（草稿非空；成功后清草稿 + 刷新 key 状态；覆盖旧 key） */
  async function handleSaveKey(providerId: string) {
    const draft = (keyDrafts[providerId] ?? "").trim();
    if (!draft) {
      setKeyErrors((m) => ({ ...m, [providerId]: "请输入新 key" }));
      return;
    }
    setKeyErrors((m) => ({ ...m, [providerId]: null }));
    setSaving(true);
    try {
      await updateSettingsLlm({ api_keys: { [providerId]: draft } });
      setKeyDrafts((d) => ({ ...d, [providerId]: "" }));
      showToast("Key 已保存，仅影响新请求");
      await refresh();
    } catch (err) {
      if (errorCodeOf(err) === CLIENT_NETWORK_ERROR) {
        showError("CLIENT_NETWORK_ERROR", "无法连接服务，Key 未保存");
      } else {
        setKeyErrors((m) => ({ ...m, [providerId]: "保存失败，请重试" }));
      }
    } finally {
      setSaving(false);
    }
  }

  /** 清除该家已保存 key（PUT api_keys 空串，清除语义） */
  async function handleClearKey(providerId: string) {
    setKeyErrors((m) => ({ ...m, [providerId]: null }));
    setSaving(true);
    try {
      await updateSettingsLlm({ api_keys: { [providerId]: "" } });
      setKeyDrafts((d) => ({ ...d, [providerId]: "" }));
      showToast("Key 已清除");
      await refresh();
    } catch (err) {
      if (errorCodeOf(err) === CLIENT_NETWORK_ERROR) {
        showError("CLIENT_NETWORK_ERROR", "无法连接服务，Key 未清除");
      } else {
        setKeyErrors((m) => ({ ...m, [providerId]: "清除失败，请重试" }));
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">加载中…</p>;

  return (
    <div className="flex flex-col gap-4">
      {modelError && <p className="text-sm text-destructive">{modelError}</p>}

      {(settings?.providers ?? []).map((p) => {
        const isActive = settings?.provider === p.id;
        return (
          <Card
            key={p.id}
            size="small"
            styles={{
              body: { display: "flex", flexDirection: "column", gap: 10 },
              ...(isActive ? { header: { borderColor: "transparent" } } : {}),
            }}
            style={isActive ? { borderColor: token.colorPrimary } : undefined}
            title={
              <span className="text-sm font-medium">
                {p.displayName}
                {isActive && <Tag className="ml-2">当前</Tag>}
              </span>
            }
          >
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">模型（点选即激活）</span>
              <Select
                size="small"
                className="w-full"
                value={isActive ? (settings?.model ?? undefined) : undefined}
                placeholder={isActive ? "选择模型" : ""}
                disabled={saving}
                onChange={(value) => {
                  if (value !== undefined && value !== "")
                    void handleActivate(p.id, String(value));
                }}
                aria-label={`选择 ${p.displayName} 模型`}
                options={p.models.map((m) => ({
                  value: m.id,
                  label: m.displayName ?? m.id,
                }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {p.apiKeySet ? `key: 已配置（${p.apiKeyMasked ?? ""}）` : "key: 未配置"}
              </span>
              {!p.apiKeySet && (
                <span className="text-xs text-destructive">
                  未配 key：聊天下拉已禁用此组，聊天不可用
                </span>
              )}
              <div className="flex gap-1.5">
                <Input
                  size="small"
                  className="min-w-0 flex-1"
                  value={keyDrafts[p.id] ?? ""}
                  onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  placeholder="输入新 key（覆盖旧 key）"
                />
                <Button size="small" onClick={() => void handleSaveKey(p.id)} disabled={saving}>
                  保存
                </Button>
                {p.apiKeySet && (
                  <Button
                    size="small"
                    onClick={() => void handleClearKey(p.id)}
                    disabled={saving}
                  >
                    清除
                  </Button>
                )}
              </div>
              {keyErrors[p.id] && <span className="text-xs text-destructive">{keyErrors[p.id]}</span>}
            </div>
          </Card>
        );
      })}

      {settings === null && (
        <p className="text-xs text-muted-foreground">模型配置读取失败，请刷新页面重试。</p>
      )}

      {/* 常驻说明（每 provider 独立解析链） */}
      <Alert
        type="info"
        showIcon
        message={
          <div className="text-xs leading-relaxed">
            <p>
              · key 不进项目文件；每 provider 独立解析：环境变量（DEEPSEEK_API_KEY /
              OPENCODE_API_KEY）&gt; 用户配置 ~/.ai-editor/config.json &gt; pi-agent 配置
              ~/.pi/agent/auth.json（只读兜底）
            </p>
            <p>· 保存的 key 与模型切换仅影响新请求；进行中的对话不受扰动</p>
          </div>
        }
      />
    </div>
  );
}
