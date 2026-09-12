// 设置页「AI 模型」分区（自 Settings.tsx 下沉；二级 tab 的一个 pane）
// 布局：左侧三级导航（**已配置的 provider**，160px，选中面 = `menu-item-selected`）、导航下方「添加」
// （展开未配置 provider 的选择区：搜索框 + 紧凑行列表）、右侧该 provider 的面板（裸区块：标题行 +
// 「当前」徽标 + 模型只读行 + key 行）；常驻说明 Alert 跨整宽置底。
//
// 「配置了多少显示多少」（2026-09 用户需求）：pi 的 provider 目录有 40 家（含未配置认证的），
// 全列进导航等于不可用——导航 = `authConfigured ∪ 当前激活 ∪ 刚点选`，其余走「添加」列表按需选择；
// 某家**保存 key 成功后**才进入导航（未保存不落导航，不出现「列了却用不了」的项）。
// 品牌 logo 见 DESIGN.md §Components `provider-icon` / `lib/llm-providers.ts`。
//
// 三级导航选中态是**节点 state**（不进 URL）：缺省跟随当前激活 provider，用户点选后保持选择。
// 数据：GET/PUT /api/v1/settings/llm——本分区只写 api_key（单家：认证状态行 + 新 key 输入 + 保存/清除）；
// 模型只读展示（模型激活唯一入口在聊天栏 ComposerConfigRow——「浏览 provider 目录」与「切换全局激活模型」是两种意图，
// 同处一个入口会误改）
// 常驻说明：key 存 pi 凭据库 ~/.pi/agent/auth.json，不入项目文件；
// 环境变量 DEEPSEEK_API_KEY 优先于此处配置（页面仍可保存，实际生效以环境变量为准）
import { useEffect, useState } from "react";
import { Alert, Button, Input, Menu, Tag, Typography } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  getSettingsLlm,
  updateSettingsLlm,
  type SettingsLlmConfig,
  type SettingsProviderInfo,
} from "../../lib/api";
import { navProviderIds, unconfiguredProviders } from "../../lib/llm-providers";
import { ProviderIcon } from "./provider-icon";
import { useUiStore, type ErrorBanner } from "../../stores/ui";

/** 从任意错误提取错误码（ApiError → 服务端/客户端码；未知 → 网络错误） */
function errorCodeOf(err: unknown): ErrorBanner["code"] {
  return err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR;
}

export function LlmSection() {
  const showToast = useUiStore((s) => s.showToast);
  const showError = useUiStore((s) => s.showError);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** 当前 LLM 配置快照（激活 provider/model + 各家 key 状态 + 目录） */
  const [settings, setSettings] = useState<SettingsLlmConfig | null>(null);
  /** 三级导航选中的 provider（null = 跟随激活 provider） */
  const [pickedProviderId, setPickedProviderId] = useState<string | null>(null);
  /** 各家 key 输入草稿（provider id → 输入值） */
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  /** 卡内 key 表单内联错误（provider id → 错误文案） */
  const [keyErrors, setKeyErrors] = useState<Record<string, string | null>>({});
  /** 「添加」选择区展开态（含搜索框；选中一家或再点按钮即收起） */
  const [adding, setAdding] = useState(false);
  /** 「添加」列表搜索词（关掉选择区时清空） */
  const [query, setQuery] = useState("");

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
      await updateSettingsLlm({ api_key: { provider: providerId, key: draft } });
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

  /** 清除该家已保存凭据（PUT api_key.key 空串，清除语义） */
  async function handleClearKey(providerId: string) {
    setKeyErrors((m) => ({ ...m, [providerId]: null }));
    setSaving(true);
    try {
      await updateSettingsLlm({ api_key: { provider: providerId, key: "" } });
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

  /** 关掉「添加」选择区（并清搜索词，下次打开是干净列表） */
  function closeAddPicker() {
    setAdding(false);
    setQuery("");
  }

  if (loading) return <p className="text-sm text-muted-foreground">加载中…</p>;

  const providers = settings?.providers ?? [];
  const activeProviderId = settings?.provider ?? "";
  // 三级导航 = 已配置 ∪ 当前激活 ∪ 刚点选（纯函数：lib/llm-providers.navProviderIds）
  const navIds = new Set(navProviderIds(providers, activeProviderId, pickedProviderId));
  const navProviders = providers.filter((p) => navIds.has(p.id));
  // 面板展示的家：点选优先 → 激活 → 第一家已配置（纯派生，无需同步 effect）
  const panelProvider: SettingsProviderInfo | null =
    providers.find((p) => p.id === pickedProviderId) ??
    providers.find((p) => p.id === activeProviderId) ??
    providers.find((p) => p.authConfigured) ??
    null;
  const panelIsCurrent = panelProvider !== null && activeProviderId === panelProvider.id;
  // 只读当前模型名：在激活 provider 目录内查 displayName（模型属于激活 provider 目录是不变式，查不到则回退裸 id）
  const currentModelLabel =
    providers
      .find((p) => p.id === activeProviderId)
      ?.models.find((m) => m.id === settings?.model)?.displayName ??
    settings?.model ??
    "";
  // 「添加」列表：未配置的家（搜索过滤在纯函数里）+ 全配置完成态
  const addCandidates = unconfiguredProviders(providers, query);
  const allConfigured = providers.length > 0 && providers.every((p) => p.authConfigured);

  return (
    <div className="flex flex-col gap-4">
      {settings === null ? (
        <p className="text-xs text-muted-foreground">模型配置读取失败，请刷新页面重试。</p>
      ) : (
        <div className="flex gap-4">
          {/* 三级导航（sub-nav，DESIGN.md §Components）：已配置的 provider 列表 160px；
              选中面 = `menu-item-selected` 灰面——不新增设计语言。宽度由外层容器承载（antd 根元素不挂布局类） */}
          <div className="w-40 shrink-0">
            {navProviders.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">还没有配置 provider</p>
            ) : (
              <Menu
                mode="inline"
                selectedKeys={panelProvider === null ? [] : [panelProvider.id]}
                onClick={({ key }) => {
                  setPickedProviderId(key);
                  closeAddPicker();
                }}
                items={navProviders.map((p) => ({
                  key: p.id,
                  // 窄栏（160px）超宽截断；title = 全文提示
                  label: <span className="block truncate">{p.displayName}</span>,
                  title: p.displayName,
                  icon: <ProviderIcon id={p.id} />,
                }))}
              />
            )}

            {/* 添加：展开未配置 provider 的选择区（搜索 + 紧凑行列表） */}
            <div className="mt-2">
              <Button
                size="small"
                block
                icon={<PlusOutlined />}
                aria-expanded={adding}
                onClick={() => (adding ? closeAddPicker() : setAdding(true))}
              >
                添加
              </Button>
            </div>
            {adding && (
              <div className="mt-2 flex flex-col gap-1">
                <Input
                  size="small"
                  allowClear
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  prefix={<SearchOutlined className="text-muted-foreground" />}
                  placeholder="搜索 provider…"
                  aria-label="搜索 provider"
                />
                {addCandidates.length === 0 ? (
                  <p className="px-1 py-1.5 text-xs text-muted-foreground">
                    {allConfigured ? "全部 provider 都已配置" : "没有匹配的 provider"}
                  </p>
                ) : (
                  <ul className="max-h-72 overflow-y-auto">
                    {addCandidates.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          title={p.displayName}
                          onClick={() => {
                            setPickedProviderId(p.id);
                            closeAddPicker();
                          }}
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                        >
                          <ProviderIcon id={p.id} />
                          <span className="min-w-0 flex-1 truncate">{p.displayName}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* provider 面板（裸区块：标题行 + 模型只读行 + key） */}
          <div className="min-w-0 flex-1">
            {panelProvider === null ? (
              <p className="text-sm text-muted-foreground">
                还没有配置任何 AI 模型——点左下方的「添加」选择要接入的 provider，保存 key 后即出现在左侧列表。
              </p>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <ProviderIcon id={panelProvider.id} size={18} />
                  <Typography.Title level={5}>{panelProvider.displayName}</Typography.Title>
                  {panelIsCurrent && <Tag>当前</Tag>}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">模型</span>
                  {panelIsCurrent ? (
                    <span className="text-sm">当前激活：{currentModelLabel}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      打开项目后，在聊天栏切换激活模型
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">
                    {panelProvider.authConfigured
                      ? `凭证：已配置${panelProvider.authSource === undefined ? "" : `（来源：${panelProvider.authSource}）`}`
                      : "凭证：未配置"}
                  </span>
                  {!panelProvider.authConfigured && (
                    <span className="text-xs text-destructive">
                      未配置凭证：聊天下拉已禁用此组，聊天不可用
                    </span>
                  )}
                  <div className="flex gap-1.5">
                    <Input
                      size="small"
                      className="min-w-0 flex-1"
                      value={keyDrafts[panelProvider.id] ?? ""}
                      onChange={(e) =>
                        setKeyDrafts((d) => ({ ...d, [panelProvider.id]: e.target.value }))
                      }
                      placeholder="输入新 key（覆盖旧 key）"
                    />
                    <Button
                      size="small"
                      onClick={() => void handleSaveKey(panelProvider.id)}
                      disabled={saving}
                    >
                      保存
                    </Button>
                    {/* 环境变量来源的凭据不可清除（清掉存量凭据也回落到 env，只会给出误导性的「已清除」提示） */}
                    {panelProvider.authConfigured &&
                      panelProvider.authSource !== "environment" && (
                        <Button
                          size="small"
                          onClick={() => void handleClearKey(panelProvider.id)}
                          disabled={saving}
                        >
                          清除
                        </Button>
                      )}
                  </div>
                  {keyErrors[panelProvider.id] && (
                    <span className="text-xs text-destructive">
                      {keyErrors[panelProvider.id]}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 常驻说明（每 provider 独立解析链；跨整宽） */}
      <Alert
        type="info"
        showIcon
        message={
          <div className="text-xs leading-relaxed">
            <p>
              · key 不进项目文件；存于 pi 凭据库 ~/.pi/agent/auth.json，环境变量
              （如 DEEPSEEK_API_KEY）优先于此处的配置
            </p>
            <p>· 保存的 key 与模型切换仅影响新请求；进行中的对话不受扰动</p>
          </div>
        }
      />
    </div>
  );
}
