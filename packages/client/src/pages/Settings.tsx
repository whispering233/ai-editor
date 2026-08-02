// Settings 设置页（S1.4，替换占位壳）
// 路由：#/settings；数据：GET/PUT /api/v1/settings/llm（doc/ui/pages/settings.md 原型）
// 交互：模型名输入 + 保存；API key 状态行（掩码）+ 新 key 输入 + 保存/清除；
//   常驻说明：key 只存本机用户配置（~/.ai-editor/config.json），不入项目文件（决策 17）；
//   环境变量 DEEPSEEK_API_KEY 优先于此处配置（页面仍可保存，实际生效以环境变量为准）
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, CLIENT_NETWORK_ERROR, getSettingsLlm, updateSettingsLlm } from "../lib/api";
import { useUiStore, type ErrorBanner } from "../stores/ui";

/** 从任意错误提取错误码（ApiError → 服务端/客户端码；未知 → 网络错误） */
function errorCodeOf(err: unknown): ErrorBanner["code"] {
  return err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR;
}

export default function Settings() {
  const showToast = useUiStore((s) => s.showToast);
  const showError = useUiStore((s) => s.showError);

  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState<string | undefined>(undefined);
  const [newKey, setNewKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  /** key 区表单内联错误（原型 settings.md「错误态：VALIDATION_ERROR → 表单内联错误」） */
  const [keyError, setKeyError] = useState<string | null>(null);

  /** 拉取当前配置（保存/清除后刷新掩码状态） */
  async function refresh() {
    try {
      const config = await getSettingsLlm();
      setModel(config.model);
      setApiKeySet(config.apiKeySet);
      setApiKeyMasked(config.apiKeyMasked);
    } catch (err) {
      showError(errorCodeOf(err), "读取 LLM 配置失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  /** 保存模型名（非空校验，原型：保存时非空校验）；表单错误内联，网络错误走全局横幅 */
  async function handleSaveModel() {
    if (!model.trim()) {
      setModelError("模型名不能为空");
      return;
    }
    setModelError(null);
    setSaving(true);
    try {
      await updateSettingsLlm({ model: model.trim() });
      showToast("已保存，仅影响新请求");
      setModel(model.trim());
    } catch (err) {
      if (errorCodeOf(err) === CLIENT_NETWORK_ERROR) {
        showError("CLIENT_NETWORK_ERROR", "无法连接服务，模型配置未保存");
      } else {
        setModelError("保存失败，请重试");
      }
    } finally {
      setSaving(false);
    }
  }

  /** 保存新 key（输入为空时内联提示；覆盖旧 key） */
  async function handleSaveKey() {
    if (!newKey.trim()) {
      setKeyError("请输入新 key");
      return;
    }
    setKeyError(null);
    setSaving(true);
    try {
      await updateSettingsLlm({ api_key: newKey.trim() });
      setNewKey("");
      showToast("Key 已保存，仅影响新请求");
      await refresh();
    } catch (err) {
      if (errorCodeOf(err) === CLIENT_NETWORK_ERROR) {
        showError("CLIENT_NETWORK_ERROR", "无法连接服务，Key 未保存");
      } else {
        setKeyError("保存失败，请重试");
      }
    } finally {
      setSaving(false);
    }
  }

  /** 清除已保存 key（PUT api_key: ""，endpoints.md 语义） */
  async function handleClearKey() {
    setKeyError(null);
    setSaving(true);
    try {
      await updateSettingsLlm({ api_key: "" });
      setNewKey("");
      showToast("Key 已清除");
      await refresh();
    } catch (err) {
      if (errorCodeOf(err) === CLIENT_NETWORK_ERROR) {
        showError("CLIENT_NETWORK_ERROR", "无法连接服务，Key 未清除");
      } else {
        setKeyError("清除失败，请重试");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-lg">
      <h1 className="mb-4 text-xl font-semibold">设置</h1>
      {loading ? (
        <p className="text-sm text-zinc-500">加载中…</p>
      ) : (
        <div className="flex flex-col gap-6">
          {/* AI 模型 */}
          <div>
            <h2 className="mb-1 text-sm font-semibold text-zinc-700">AI 模型</h2>
            <p className="mb-2 text-xs text-zinc-500">默认 deepseek-v4-flash（可在服务端设置页或环境变量覆盖）</p>
            <div className="flex max-w-sm gap-2">
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-v4-flash" />
              <Button onClick={() => void handleSaveModel()} disabled={saving} type="button">
                保存设置
              </Button>
            </div>
            {modelError && <p className="mt-1 text-sm text-red-600">{modelError}</p>}
          </div>

          {/* API Key */}
          <div>
            <h2 className="mb-1 text-sm font-semibold text-zinc-700">API Key</h2>
            <p className="mb-2 text-xs text-zinc-500">
              状态：{apiKeySet ? `已配置（${apiKeyMasked ?? ""}）` : "未配置"}
            </p>
            <div className="flex max-w-sm gap-2">
              <Input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="输入新 key（覆盖旧 key）"
              />
              <Button onClick={() => void handleSaveKey()} disabled={saving} type="button">
                保存 Key
              </Button>
              <Button variant="outline" onClick={() => void handleClearKey()} disabled={saving} type="button">
                清除 Key
              </Button>
            </div>
            {keyError && <p className="mt-1 text-sm text-red-600">{keyError}</p>}
          </div>

          {/* 常驻说明（决策 17；原型「说明」区） */}
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600">
            <p>· key 保存在用户目录配置文件（~/.ai-editor/config.json），不写入项目文件（决策 17）</p>
            <p>· 环境变量 DEEPSEEK_API_KEY 优先于此处配置；保存的 key 仅影响新请求</p>
          </div>
        </div>
      )}
    </section>
  );
}
