// Settings 设置页（S1.4，替换占位壳）
// 路由：#/settings；数据：GET/PUT /api/v1/settings/llm（ 原型）
// 交互：模型名输入 + 保存；API key 状态行（掩码）+ 新 key 输入 + 保存/清除；
// 常驻说明：key 只存本机用户配置（~/.ai-editor/config.json），不入项目文件；
// 环境变量 DEEPSEEK_API_KEY 优先于此处配置（页面仍可保存，实际生效以环境变量为准）
// （2026-08 批次十）：项目规则区改为编辑项目目录 文件内容——
// GET/PUT /project/agents（项目规则唯一事实源，取代 project.json `prompt`）；
// 载入优先读 project store 已缓存 agents；保存后 toast + dataVersion +1（中栏数据页刷新）；
// 外部修改检测：GET 返回 mtime，与上次读取比对不一致提示「文件已被外部修改，请刷新/重新加载」；
// 无项目打开灰显禁用
import { useEffect, useState } from "react";
import { Alert, Button, Card, Input, Select, Tag, theme, Typography } from "antd";
import { PageTitle } from "@/components/ui/page-title";
import { ApiError, CLIENT_NETWORK_ERROR, getSettingsLlm, updateSettingsLlm, type SettingsLlmConfig } from "../lib/api";
import { useProjectStore } from "../stores/project";
import { useUiStore, type ErrorBanner } from "../stores/ui";
import { BackupSection } from "../components/settings/backup-section";

/** 从任意错误提取错误码（ApiError → 服务端/客户端码；未知 → 网络错误） */
function errorCodeOf(err: unknown): ErrorBanner["code"] {
  return err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR;
}

export default function Settings() {
  const { token } = theme.useToken();
  const showToast = useUiStore((s) => s.showToast);
  const showError = useUiStore((s) => s.showError);
  const notifyDataChanged = useUiStore((s) => s.notifyDataChanged);
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const agents = useProjectStore((s) => s.agents);
  const agentsProjectId = useProjectStore((s) => s.agentsProjectId);
  const agentsLoading = useProjectStore((s) => s.agentsLoading);
  const agentsError = useProjectStore((s) => s.agentsError);
  const agentsExternalModified = useProjectStore((s) => s.agentsExternalModified);
  const loadAgents = useProjectStore((s) => s.loadAgents);
  const saveAgents = useProjectStore((s) => s.saveAgents);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
 /** 模型激活错误（卡片区顶部内联） */
  const [modelError, setModelError] = useState<string | null>(null);
 /** 当前 LLM 配置快照（激活 provider/model + 各家 key 状态 + 目录） */
  const [settings, setSettings] = useState<SettingsLlmConfig | null>(null);
 /** 各家 key 输入草稿（provider id → 输入值） */
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
 /** 卡内 key 表单内联错误（provider id → 错误文案；「错误态：VALIDATION_ERROR → 表单内联错误」） */
  const [keyErrors, setKeyErrors] = useState<Record<string, string | null>>({});
 // —— 项目规则 ——
  const [agentsContent, setAgentsContent] = useState("");
 /** 已加载 的项目 id（null = 尚未/无项目）：id 变化（切换项目）→ 重新加载；
 * 同项目内 store 重拉（loadAgents）→ 不覆盖用户草稿 */
  const [agentsLoadedFor, setAgentsLoadedFor] = useState<string | null>(null);
  const [agentsSaving, setAgentsSaving] = useState(false);
 /** 规则区表单内联错误（原型「错误态：VALIDATION_ERROR → 表单内联错误」） */
  const [agentsErrorLocal, setAgentsErrorLocal] = useState<string | null>(null);
 /** 外部修改提示：store 检测到 mtime 变化 → 展示「文件已被外部修改，请刷新/重新加载」 */
  const [externalModified, setExternalModified] = useState(false);

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

 // 载入：进入设置页优先用 project store 已缓存 config（AppShell 挂载时已拉取）；
 // 无缓存（store 尚未拉取）补拉一次——仅本挂载触发一次（store 内部有并发防抖），
 // 避免「无项目/失败后 config 恒为 null」时本 effect 反复重拉
  useEffect(() => {
    const state = useProjectStore.getState();
    if (state.config === null && !state.configLoading) {
      void state.loadConfig();
    }
  }, []);

 // config 就绪后按项目身份加载 ：关闭项目（null）→ 重置；切换项目（id 变化）→
 // 重新加载（清空旧草稿，等待新项目加载完成）；同项目内 store 重拉 → 不覆盖用户正在编辑的草稿
  useEffect(() => {
    if (config === null) {
      setAgentsLoadedFor(null);
      setAgentsContent("");
      setExternalModified(false);
      return;
    }
    if (config.id !== agentsLoadedFor) {
      setAgentsLoadedFor(config.id);
      setAgentsContent(""); // 切换项目：清空旧草稿，等待新项目加载
      setExternalModified(false);
      void loadAgents();
    }
  }, [config, agentsLoadedFor]);

 // agents 加载完成 → 填充（仅当前项目：agentsProjectId 与 config.id 一致才填充，防串项目）；
 // 外部修改检测结果同步展示
  useEffect(() => {
    if (agents !== null && agentsProjectId === config?.id) {
      setAgentsContent(agents.content);
      setExternalModified(agentsExternalModified);
    }
  }, [agents, agentsProjectId, config, agentsExternalModified]);

 /** 保存规则：整体替换 内容（空值 = 清空规则文件，保留空文件）；
 * store saveAgents 内部 PUT 成功后更新本地基线（新 mtime）；toast + dataVersion +1 触发中栏数据页刷新 */
  async function handleSaveAgents() {
    setAgentsErrorLocal(null);
    setAgentsSaving(true);
    try {
      await saveAgents(agentsContent);
      showToast("规则已保存，仅影响新请求");
      notifyDataChanged();
    } catch (err) {
      if (errorCodeOf(err) === CLIENT_NETWORK_ERROR) {
        showError("CLIENT_NETWORK_ERROR", "无法连接服务，规则未保存");
      } else {
        setAgentsErrorLocal("保存失败，请重试");
      }
    } finally {
      setAgentsSaving(false);
    }
  }

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

 /** 清除该家已保存 key（PUT api_keys 空串， 语义） */
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

  return (
    <section className="mx-auto w-full max-w-2xl px-4">
      <PageTitle>设置</PageTitle>
      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">加载中…</p>
      ) : (
        <div className="mt-4 flex flex-col gap-6">
          {/* AI 模型（批次十六：每 provider 一张卡片，平铺） */}
          <div>
            <Typography.Title level={5}>AI 模型</Typography.Title>
            <p className="mt-1 mb-2 text-xs text-muted-foreground">
              每提供商一卡：模型下拉点选即激活；key 独立配置。未配 key 的 provider 聊天下拉整组禁用。
            </p>
            {modelError && (
              <p className="mb-2 text-sm text-destructive">{modelError}</p>
            )}
            <div className="flex flex-col gap-4">
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
                          if (value !== undefined && value !== "") void handleActivate(p.id, String(value));
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
                          <Button size="small" onClick={() => void handleClearKey(p.id)} disabled={saving}>
                            清除
                          </Button>
                        )}
                      </div>
                      {keyErrors[p.id] && (
                        <span className="text-xs text-destructive">{keyErrors[p.id]}</span>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
            {!loading && settings === null && (
              <p className="mt-2 text-xs text-muted-foreground">
                模型配置读取失败，请刷新页面重试。
              </p>
            )}
          </div>

          {/* 常驻说明（批次十六：每 provider 独立解析链） */}
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

          {/* 项目规则：编辑项目目录 AGENTS.md（GET/PUT /project/agents）；注入 AI 上下文
              「## 项目设定」段；外部修改检测（mtime 比对）提示刷新 */}
          <div>
            <Typography.Title level={5}>项目规则</Typography.Title>
            <p className="mt-1 mb-1 text-xs text-muted-foreground">
              编辑项目目录下 AGENTS.md 文件内容，注入 AI 上下文「## 项目设定」段（每轮有效）；空 = 整段跳过
            </p>
            <p className="mb-2 text-xs text-muted-foreground">
              可直接在文件管理器中编辑 AGENTS.md（外部修改后此处会提示刷新/重新加载）
            </p>
            {externalModified && (
              <p className="mb-2 text-sm text-destructive">文件已被外部修改，请刷新/重新加载</p>
            )}
            <Input.TextArea
              value={agentsContent}
              onChange={(e) => setAgentsContent(e.target.value)}
              rows={6}
 // 首填完成前不可输入（含 config 拉取中/切换项目后未加载），消除草稿被首填覆盖窗口
              disabled={config === null || config.id !== agentsLoadedFor || agentsLoading}
              placeholder="输入项目规则/行业要求…"
            />
            <div className="mt-2 flex items-center gap-3">
              <Button
                type="primary"
                onClick={() => void handleSaveAgents()}
                disabled={agentsSaving || config === null || config.id !== agentsLoadedFor}
                
              >
                保存规则
              </Button>
              {config === null && !configLoading && (
                <span className="text-xs text-muted-foreground">打开项目后可用</span>
              )}
            </div>
            {agentsErrorLocal && (
              <p className="mt-1 text-sm text-destructive">{agentsErrorLocal}</p>
            )}
            {agentsError !== null && agentsError !== "NO_PROJECT_OPEN" && (
              <p className="mt-1 text-sm text-destructive">规则文件加载失败，请重试</p>
            )}
          </div>

          {/* 自动备份（B2）：频率下拉（选择即保存）/ 立即备份 / 历史备份列表 + 加载强确认 */}
          <BackupSection />
        </div>
      )}
    </section>
  );
}
