// 设置页「项目规则」分区（自 Settings.tsx 下沉；二级 tab 的一个 pane）
// 数据：GET/PUT /project/agents——项目目录 AGENTS.md 是项目规则唯一事实源；
// 注入 AI 上下文「## 项目设定」段（每轮有效）；空 = 整段跳过
// 载入优先读 project store 已缓存 agents；保存后 toast + dataVersion +1（中栏数据页刷新）；
// 外部修改检测：GET 返回 mtime，与上次读取比对不一致提示「文件已被外部修改，请刷新/重新加载」；无项目打开灰显禁用
import { useEffect, useState } from "react";
import { Button, Input, Typography } from "antd";
import { ApiError, CLIENT_NETWORK_ERROR } from "../../lib/api";
import { useProjectStore } from "../../stores/project";
import { useUiStore } from "../../stores/ui";

/** 从任意错误提取错误码（ApiError → 服务端码；未知 → 网络错误） */
function errorCodeOf(err: unknown): string {
  return err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR;
}

export function ProjectRulesSection() {
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

  const [agentsContent, setAgentsContent] = useState("");
  /** 已加载的项目 id（null = 尚未/无项目）：id 变化（切换项目）→ 重新加载；
   * 同项目内 store 重拉（loadAgents）→ 不覆盖用户草稿 */
  const [agentsLoadedFor, setAgentsLoadedFor] = useState<string | null>(null);
  const [agentsSaving, setAgentsSaving] = useState(false);
  /** 规则区表单内联错误 */
  const [agentsErrorLocal, setAgentsErrorLocal] = useState<string | null>(null);
  /** 外部修改提示：store 检测到 mtime 变化 → 展示「文件已被外部修改，请刷新/重新加载」 */
  const [externalModified, setExternalModified] = useState(false);

  // 载入：进入本分区优先用 project store 已缓存 config（AppShell 挂载时已拉取）；
  // 无缓存（store 尚未拉取）补拉一次——仅本挂载触发一次（store 内部有并发防抖），
  // 避免「无项目/失败后 config 恒为 null」时本 effect 反复重拉
  useEffect(() => {
    const state = useProjectStore.getState();
    if (state.config === null && !state.configLoading) {
      void state.loadConfig();
    }
  }, []);

  // config 就绪后按项目身份加载：关闭项目（null）→ 重置；切换项目（id 变化）→
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

  return (
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
      {agentsErrorLocal && <p className="mt-1 text-sm text-destructive">{agentsErrorLocal}</p>}
      {agentsError !== null && agentsError !== "NO_PROJECT_OPEN" && (
        <p className="mt-1 text-sm text-destructive">规则文件加载失败，请重试</p>
      )}
    </div>
  );
}
