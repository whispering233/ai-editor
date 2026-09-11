// 设置页「AI 模型」分区（自 Settings.tsx 下沉；二级 tab 的一个 pane）
// 布局：左侧三级导航（provider 列表，160px，选中面 = `menu-item-selected`）+ 右侧该 provider 的面板
// （裸区块：标题行 + 「当前」徽标 + 模型只读行 + key 行）；常驻说明 Alert 跨整宽置底。
// 三级导航选中态是**节点 state**（不进 URL）：缺省跟随当前激活 provider，用户点选后保持选择（切二级 tab 回来仍保留）。
// 数据：GET/PUT /api/v1/settings/llm——本分区只写 api_keys（各家独立：掩码状态行 + 新 key 输入 + 保存/清除）；
// 模型只读展示（模型激活唯一入口在聊天栏 ComposerConfigRow——「浏览 provider 目录」与「切换全局激活模型」是两种意图，
// 同处一个入口会误改）
// 常驻说明：key 只存本机用户配置（~/.ai-editor/config.json），不入项目文件；
// 环境变量 DEEPSEEK_API_KEY 优先于此处配置（页面仍可保存，实际生效以环境变量为准）
import { useEffect, useState } from "react";
import { Alert, Button, Input, Menu, Tag, Typography } from "antd";
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

  const providers = settings?.providers ?? [];
  // 选中的 provider：用户点选优先，否则跟随当前激活 provider（缺省第一家）——纯派生，无需同步 effect
  const activeProvider =
    providers.find((p) => p.id === (pickedProviderId ?? settings?.provider)) ??
    providers[0] ??
    null;
  const activeIsCurrent = activeProvider !== null && settings?.provider === activeProvider.id;
  // 只读当前模型名：在激活 provider 目录内查 displayName（模型属于激活 provider 目录是不变式，查不到则回退裸 id）
  const currentModelLabel =
    activeProvider?.models.find((m) => m.id === settings?.model)?.displayName ?? settings?.model ?? "";

  return (
    <div className="flex flex-col gap-4">
      {settings === null ? (
        <p className="text-xs text-muted-foreground">模型配置读取失败，请刷新页面重试。</p>
      ) : (
        <div className="flex gap-4">
          {/* 三级导航（sub-nav，DESIGN.md §Components）：provider 列表 160px；
              选中面 = `menu-item-selected` 灰面——不新增设计语言。宽度由外层容器承载（antd 根元素不挂布局类） */}
          <div className="w-40 shrink-0">
            <Menu
              mode="inline"
              selectedKeys={activeProvider === null ? [] : [activeProvider.id]}
              onClick={({ key }) => setPickedProviderId(key)}
              items={providers.map((p) => ({
                key: p.id,
                // 窄栏（160px）超宽截断；title = 全文提示
                label: <span className="block truncate">{p.displayName}</span>,
                title: p.displayName,
              }))}
            />
          </div>

          {/* provider 面板（裸区块：标题行 + 模型只读行 + key） */}
          <div className="min-w-0 flex-1">
            {activeProvider !== null && (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <Typography.Title level={5}>{activeProvider.displayName}</Typography.Title>
                  {activeIsCurrent && <Tag>当前</Tag>}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">模型</span>
                  {activeIsCurrent ? (
                    <span className="text-sm">当前激活：{currentModelLabel}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      打开项目后，在聊天栏切换激活模型
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">
                    {activeProvider.apiKeySet
                      ? `key: 已配置（${activeProvider.apiKeyMasked ?? ""}）`
                      : "key: 未配置"}
                  </span>
                  {!activeProvider.apiKeySet && (
                    <span className="text-xs text-destructive">
                      未配 key：聊天下拉已禁用此组，聊天不可用
                    </span>
                  )}
                  <div className="flex gap-1.5">
                    <Input
                      size="small"
                      className="min-w-0 flex-1"
                      value={keyDrafts[activeProvider.id] ?? ""}
                      onChange={(e) =>
                        setKeyDrafts((d) => ({ ...d, [activeProvider.id]: e.target.value }))
                      }
                      placeholder="输入新 key（覆盖旧 key）"
                    />
                    <Button
                      size="small"
                      onClick={() => void handleSaveKey(activeProvider.id)}
                      disabled={saving}
                    >
                      保存
                    </Button>
                    {activeProvider.apiKeySet && (
                      <Button
                        size="small"
                        onClick={() => void handleClearKey(activeProvider.id)}
                        disabled={saving}
                      >
                        清除
                      </Button>
                    )}
                  </div>
                  {keyErrors[activeProvider.id] && (
                    <span className="text-xs text-destructive">
                      {keyErrors[activeProvider.id]}
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
