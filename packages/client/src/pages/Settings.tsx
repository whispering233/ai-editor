// Settings 设置页（S1.4，替换占位壳）
// 路由：#/settings；数据：GET/PUT /api/v1/settings/llm（doc/ui/pages/settings.md 原型）
// 交互：模型名输入 + 保存；API key 状态行（掩码）+ 新 key 输入 + 保存/清除；
//   常驻说明：key 只存本机用户配置（~/.ai-editor/config.json），不入项目文件（决策 17）；
//   环境变量 DEEPSEEK_API_KEY 优先于此处配置（页面仍可保存，实际生效以环境变量为准）
//   B1（决策 25）：项目提示词区——GET/PUT /project/config → prompt；载入优先读 project store
//   已缓存 config；保存后 toast + dataVersion +1（中栏数据页刷新）；无项目打开灰显禁用
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, CLIENT_NETWORK_ERROR, getSettingsLlm, updateSettingsLlm } from "../lib/api";
import { useProjectStore } from "../stores/project";
import { useUiStore, type ErrorBanner } from "../stores/ui";
import { BackupSection } from "../components/settings/backup-section";

/** 从任意错误提取错误码（ApiError → 服务端/客户端码；未知 → 网络错误） */
function errorCodeOf(err: unknown): ErrorBanner["code"] {
  return err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR;
}

export default function Settings() {
  const showToast = useUiStore((s) => s.showToast);
  const showError = useUiStore((s) => s.showError);
  const notifyDataChanged = useUiStore((s) => s.notifyDataChanged);
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const updateConfig = useProjectStore((s) => s.updateConfig);

  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState<string | undefined>(undefined);
  const [newKey, setNewKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  /** key 区表单内联错误（原型 settings.md「错误态：VALIDATION_ERROR → 表单内联错误」） */
  const [keyError, setKeyError] = useState<string | null>(null);
  // —— B1 项目提示词（决策 25）——
  const [prompt, setPrompt] = useState("");
  /** 已填充提示词的项目 id（null = 尚未/无项目）：id 变化（切换项目）→ 重新填充；
   *  同项目内 store 重拉（updateConfig 内部 loadConfig）→ 不覆盖用户草稿 */
  const [promptLoadedFor, setPromptLoadedFor] = useState<string | null>(null);
  const [promptSaving, setPromptSaving] = useState(false);
  /** 提示词区表单内联错误（原型「错误态：VALIDATION_ERROR → 表单内联错误」） */
  const [promptError, setPromptError] = useState<string | null>(null);

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

  // B1 载入：进入设置页优先用 project store 已缓存 config（AppShell 挂载时已拉取）；
  //   无缓存（store 尚未拉取）补拉一次——仅本挂载触发一次（store 内部有并发防抖），
  //   避免「无项目/失败后 config 恒为 null」时本 effect 反复重拉
  useEffect(() => {
    const state = useProjectStore.getState();
    if (state.config === null && !state.configLoading) {
      void state.loadConfig();
    }
  }, []);

  // config 就绪后按项目身份填充提示词：关闭项目（null）→ 重置；切换项目（id 变化）→
  // 重新填充（丢弃旧项目草稿是正确行为）；同项目内 store 重拉 → 不覆盖用户正在编辑的草稿
  useEffect(() => {
    if (config === null) {
      setPromptLoadedFor(null);
      return;
    }
    if (config.id !== promptLoadedFor) {
      setPrompt(config.prompt);
      setPromptLoadedFor(config.id);
    }
  }, [config, promptLoadedFor]);

  /** B1 保存提示词：空值/纯空白 = 清除（服务端「## 项目设定」整段跳过，决策 25）；
   *  store updateConfig 内部 PUT 成功后自动重拉 config；toast + dataVersion +1 触发中栏数据页刷新 */
  async function handleSavePrompt() {
    setPromptError(null);
    setPromptSaving(true);
    try {
      const value = prompt.trim();
      await updateConfig({ prompt: value });
      setPrompt(value);
      showToast("提示词已保存，仅影响新请求");
      notifyDataChanged();
    } catch (err) {
      if (errorCodeOf(err) === CLIENT_NETWORK_ERROR) {
        showError("CLIENT_NETWORK_ERROR", "无法连接服务，提示词未保存");
      } else {
        setPromptError("保存失败，请重试");
      }
    } finally {
      setPromptSaving(false);
    }
  }

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
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : (
        <div className="flex flex-col gap-6">
          {/* AI 模型 */}
          <div>
            <h2 className="mb-1 text-sm font-semibold text-foreground">AI 模型</h2>
            <p className="mb-2 text-xs text-muted-foreground">
              默认 deepseek-v4-flash（可在服务端设置页或环境变量覆盖）
            </p>
            <div className="flex max-w-sm gap-2">
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="deepseek-v4-flash"
              />
              <Button onClick={() => void handleSaveModel()} disabled={saving} type="button">
                保存设置
              </Button>
            </div>
            {modelError && <p className="mt-1 text-sm text-destructive">{modelError}</p>}
          </div>

          {/* API Key */}
          <div>
            <h2 className="mb-1 text-sm font-semibold text-foreground">API Key</h2>
            <p className="mb-2 text-xs text-muted-foreground">
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
              <Button
                variant="outline"
                onClick={() => void handleClearKey()}
                disabled={saving}
                type="button"
              >
                清除 Key
              </Button>
            </div>
            {keyError && <p className="mt-1 text-sm text-destructive">{keyError}</p>}
          </div>

          {/* 常驻说明（决策 17；原型「说明」区） */}
          <div className="rounded-md border border-border bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              · key 保存在用户目录配置文件（~/.ai-editor/config.json），不写入项目文件（决策 17）
            </p>
            <p>· 环境变量 DEEPSEEK_API_KEY 优先于此处配置；保存的 key 仅影响新请求</p>
          </div>

          {/* 项目提示词（B1，决策 25）：注入 AI 上下文「## 项目设定」段（每轮有效）；
              空值保存 = 清除（服务端整段跳过）；无项目打开灰显禁用 + 提示 */}
          <div>
            <h2 className="mb-1 text-sm font-semibold text-foreground">项目提示词</h2>
            <p className="mb-2 text-xs text-muted-foreground">
              注入 AI 上下文「## 项目设定」段（每轮有效）；承载项目级规则/行业要求；空 = 整段跳过
            </p>
            <p className="mb-2 text-xs text-muted-foreground/70">
              建议用 ### 及以下层级的小标题组织内容（如「### 写作规则」）；避免使用 ##
              顶层标题（与系统分段标题冲突）
            </p>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              // 首填完成前不可输入（含 config 拉取中/切换项目后未填充），消除草稿被首填覆盖窗口
              disabled={config === null || config.id !== promptLoadedFor}
              placeholder="输入项目级规则/行业要求…"
              className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div className="mt-2 flex items-center gap-3">
              <Button
                onClick={() => void handleSavePrompt()}
                disabled={promptSaving || config === null || config.id !== promptLoadedFor}
                type="button"
              >
                保存提示词
              </Button>
              {config === null && !configLoading && (
                <p className="text-xs text-muted-foreground/70">打开项目后可用</p>
              )}
            </div>
            {promptError && <p className="mt-1 text-sm text-destructive">{promptError}</p>}
          </div>

          {/* 自动备份（B2，决策 27）：频率下拉（选择即保存）/ 立即备份 / 历史备份列表 + 加载强确认 */}
          <BackupSection />
        </div>
      )}
    </section>
  );
}
