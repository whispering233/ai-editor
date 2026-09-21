// 参考资料列表页（卡 12.8）
// - 点击标题 = 行内编辑（Enter 提交 / Esc 取消 / 失焦保存）；双击行 = 进详情页（编辑态即编辑器）
// - 行信息 = [标题、分类、标签、来源]（来源列**只认 `url`**——kind / file_name / source 是文件机制遗留字段，不读）
// - 新建入口收敛为**一个**（#/references/new）：名称 + 可选 URL + 分类 + 标签 + 正文块编辑器；
//   旧草稿双路由 #/references/new/md、#/references/new/link 由 main.tsx 重定向到新入口
// - 「导入 md 新建」= 文件机制退役后的替代路径（选 md → 解析 → 建条目 → 跳详情），
//   frontmatter title 作条目名、其余为正文，有损必须先确认（lib/reference + lib/document-io）
// - 文件扫描（「扫描」按钮 / 「未同步本地文档」提示条）已随文件机制退役删除
// 数据：listEntities("reference", { limit: MAX_ENTITY_LIST_LIMIT }) 一次全量拉取（参考资料量小），
// 分类/标签/关键词过滤在前端（列表摘要 summary.type/tags/url/content 由 db toSummary 提供）
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { MAX_ENTITY_LIST_LIMIT } from "@whispering233/ai-editor-shared";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { Alert, Button, Input, Select, Skeleton } from "antd";
import { PageHeader } from "@/components/ui/page-header";
import { TagChip, TypeChip } from "@/components/ui/tag-chip";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DeleteOutlined,
  ExportOutlined,
  FileTextOutlined,
  ImportOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { createEntity, deleteEntity, listEntities, updateEntity } from "../lib/api";
import { ApiError } from "../lib/api";
import { markdownImportConfirmMessage, readTextFile } from "../lib/document-io";
import { planReferenceImport, referenceSource, referenceTypeLabel } from "../lib/reference";
import { navigate } from "../hooks/use-route";
import { useSaveShortcut } from "../lib/save-shortcut";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";
import { RowContextMenu } from "../components/entity/row-context-menu";
import { DocumentEditor, type DocumentEditorApi } from "../components/blocknote/document-editor";

/** 新建条目的缺省分类（REST 不兜底，写入侧给缺省——见 docs/api/30-api-entity.md「reference 特例」） */
const DEFAULT_TYPE = "material";

export default function ReferenceList() {
  const config = useProjectStore((s) => s.config);
  const [items, setItems] = useState<EntitySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  useDataRefresh(() => setReloadTick((t) => t + 1));

  // 筛选状态
  const [keyword, setKeyword] = useState("");
  const [activeType, setActiveType] = useState<string | "all">("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // 「导入 md 新建」：隐藏文件框 + 隐藏块编辑器实例（md → 块的解析要真实例，能力出口 = DocumentEditorApi）
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importArmed, setImportArmed] = useState(false);
  const [editorApi, setEditorApi] = useState<DocumentEditorApi | null>(null);

  /** 「导入 md 新建」：读文本 → frontmatter 取名 + md → 块（有损必须先确认）→ POST 建条目 → 跳详情 */
  async function importMarkdown(file: File): Promise<void> {
    if (editorApi === null) {
      useUiStore.getState().showToast("编辑器未就绪，请重试", "error");
      return;
    }
    let text: string;
    try {
      text = await readTextFile(file);
    } catch {
      useUiStore.getState().showToast("导入失败：文件读取异常", "error");
      return;
    }
    const plan = planReferenceImport(file.name, text, (markdown) =>
      editorApi.parseMarkdown(markdown),
    );
    switch (plan.action) {
      case "error":
        useUiStore.getState().showToast(plan.message, "error");
        return;
      case "confirm-lossy": {
        const ok = await useUiStore.getState().confirm({
          title: "导入 markdown（有损）",
          description: `${markdownImportConfirmMessage(
            plan.unsupportedCount,
          )}；继续将用文件内容新建参考资料。需要无损请改用块 JSON 导入。`,
        });
        if (!ok) return;
        break;
      }
      case "apply":
        break;
    }
    try {
      const created = await createEntity("reference", {
        name: plan.name,
        data: { type: DEFAULT_TYPE, content: plan.content },
      });
      useUiStore.getState().showToast(`已从《${file.name}》新建参考资料《${plan.name}》`);
      useUiStore.getState().notifyDataChanged();
      navigate(`#/references/${created.id}`);
    } catch (e) {
      useUiStore
        .getState()
        .showToast(e instanceof ApiError ? e.message : "创建失败，请重试", "error");
    }
  }

  // 数据加载
  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    listEntities("reference", { limit: MAX_ENTITY_LIST_LIMIT })
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "加载失败，请重试");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  // 聚合标签池（列表摘要 tags 前 3 个 —— 为覆盖全量已用上限 limit 拉取）
  const tagPool = useMemo(() => {
    const set = new Set<string>();
    for (const it of items ?? []) {
      const tags = it.summary?.tags;
      if (Array.isArray(tags))
        for (const t of tags) if (typeof t === "string" && t !== "") set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  // 聚合分类池（筛选下拉选项 = 项目内已用分类，无预置枚举）
  const typePool = useMemo(() => {
    const set = new Set<string>();
    for (const it of items ?? []) {
      const t = it.summary?.type;
      if (typeof t === "string" && t !== "") set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  // 过滤后可见列表：分类 + 标签 + 关键词（前端过滤，列表量小）
  const visible = useMemo(() => {
    if (items === null) return null;
    const kw = keyword.trim().toLowerCase();
    return items
      .filter((it) => {
        if (activeType !== "all" && it.summary?.type !== activeType) return false;
        if (activeTag !== null && !Array.isArray(it.summary?.tags)) return false;
        if (activeTag !== null && !(it.summary?.tags as string[]).includes(activeTag)) return false;
        if (kw !== "") {
          const name = it.name.toLowerCase();
          const content =
            typeof it.summary?.content === "string"
              ? (it.summary.content as string).toLowerCase()
              : "";
          if (!name.includes(kw) && !content.includes(kw)) return false;
        }
        return true;
      })
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }, [items, keyword, activeType, activeTag]);

  /** 行内编辑标题提交（点击标题行内编辑，PUT name；失败 toast 后 rethrow——组件保持编辑态 + 保留输入值，对齐时间轴 editFailureRecovery） */
  async function handleRename(id: string, name: string) {
    try {
      await updateEntity("reference", id, { name });
      useUiStore.getState().notifyDataChanged();
      setReloadTick((t) => t + 1);
    } catch (e) {
      useUiStore
        .getState()
        .showToast(e instanceof ApiError ? e.message : "保存失败，请重试", "error");
      throw e;
    }
  }

  async function handleDelete(item: EntitySummary) {
    try {
      await deleteEntity("reference", item.id);
      // 删除要**推送**才传播（DESIGN.md §550）：本地删除不会被拉取复活，但另一台的删除要等这次推送
      useUiStore
        .getState()
        .showToast(`已移入回收站：《${item.name}》，可随时还原；推送到云端后，另一台也会同步删除`);
      setReloadTick((t) => t + 1);
    } catch (e) {
      useUiStore
        .getState()
        .showToast(e instanceof ApiError ? e.message : "删除失败，请重试", "error");
    }
  }

  const disabled = config === null;

  /** 页头控件行（左=搜索/分类/标签；右=导入 md 新建 / 新建） */
  const headerControls = (
    <>
      <div className="w-48">
        <Input
          prefix={<SearchOutlined />}
          allowClear
          placeholder="搜索标题 / 内容摘要…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>
      <Select
        className="w-32"
        // 浮层按内容宽展开：跟随触发器宽度（128px）会把长分类名/长标签截成省略号
        popupMatchSelectWidth={false}
        value={activeType}
        onChange={(value) => setActiveType(value === "all" ? "all" : String(value))}
        options={[
          { value: "all", label: "全部分类" },
          ...typePool.map((t) => ({ value: t, label: referenceTypeLabel(t) })),
        ]}
      />
      <Select
        className="w-32"
        // 同上：标签是用户自定义文本，跟随触发器宽度必然截断
        popupMatchSelectWidth={false}
        value={activeTag ?? ""}
        onChange={(value) => setActiveTag(value === "" ? null : String(value))}
        options={[
          { value: "", label: "全部标签" },
          ...tagPool.map((t) => ({ value: t, label: t })),
        ]}
      />
      <span
        className="ml-auto flex items-center gap-2"
        title={disabled ? "请先打开项目" : undefined}
      >
        {/* 导入入口：隐藏文件框（浏览器与桌面同一套；选完清空 value 以便重复选同一文件） */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,text/markdown"
          className="hidden"
          aria-label="选择要导入的 md 文件（新建参考资料）"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file !== undefined) void importMarkdown(file);
          }}
        />
        <Button
          disabled={disabled}
          icon={<ImportOutlined />}
          title="把一个 markdown 文件新建为参考资料（frontmatter title 作名称）"
          onClick={() => {
            // 先挂隐藏编辑器（md → 块的解析要真实例）：文件对话框打开期间完成挂载
            setImportArmed(true);
            fileInputRef.current?.click();
          }}
        >
          导入 md 新建
        </Button>
        <Button
          type="primary"
          disabled={disabled}
          onClick={() => navigate("#/references/new")}
          icon={<FileTextOutlined />}
        >
          新建
        </Button>
      </span>
    </>
  );

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* 页头（统一壳）：标题 + 控件行（左=搜索/分类/标签；右=导入 md 新建 / 新建）+ 分割线 */}
      <PageHeader title="参考资料" controls={headerControls} />

      {/* 隐藏块编辑器实例：**只**作「导入 md 新建」的 md → 块能力出口（DocumentEditorApi 要真实例）；
          点过导入后才挂载——列表页空转的编辑器不存在，SSR/单测也不渲染它 */}
      {importArmed && (
        <div className="hidden" aria-hidden="true">
          <DocumentEditor initialContent="" onChange={() => {}} onReady={setEditorApi} />
        </div>
      )}

      {/* 错误条（单区块失败不阻塞其他） */}
      {error !== null && (
        <Alert
          className="mb-2"
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={() => setReloadTick((t) => t + 1)}>
              重试
            </Button>
          }
        />
      )}

      {/* 滚动区：列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items === null ? (
          <div className="space-y-2">
            <Skeleton active title={false} paragraph={{ rows: 3 }} />
          </div>
        ) : visible === null || visible.length === 0 ? (
          /* 空态（R2）：无条目分支去重——纯文字提示，不显示书籍图标与新建按钮
             （顶部标题行已有新建入口）；筛选/搜索无匹配分支保留「清空筛选」操作 */
          <EmptyState
            padding="sm"
            action={
              keyword !== "" || activeType !== "all" || activeTag !== null ? (
                <Button
                  onClick={() => {
                    setKeyword("");
                    setActiveType("all");
                    setActiveTag(null);
                  }}
                >
                  清空筛选
                </Button>
              ) : undefined
            }
          >
            {keyword !== "" || activeType !== "all" || activeTag !== null
              ? "未找到匹配的参考资料——换个关键词或清空筛选条件试试"
              : "还没有参考资料，先新建一条——把书籍摘抄、灵感记录、写作理论保存到这里，AI 创作顾问会参考它们给出建议"}
          </EmptyState>
        ) : (
          /* 表格平铺（R3）：thead 四列 + 单行 tr，行高从两行收为一行；
             对齐 EntityList 表格样式（border + thead bg-muted/50） */
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground/70">
                  <th className="px-3 py-2 font-normal">标题</th>
                  <th className="px-3 py-2 font-normal">分类</th>
                  <th className="px-3 py-2 font-normal">标签</th>
                  <th className="px-3 py-2 font-normal">来源</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map((it) => (
                  <RefRow
                    key={it.id}
                    item={it}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    onGoto={() => navigate(`#/references/${it.id}`)}
                    onRelationCreated={() => setReloadTick((t) => t + 1)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

interface RefRowProps {
  item: EntitySummary;
  /** 行内编辑标题提交（页面 PUT name + 刷新；失败 rethrow——组件保持编辑态） */
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (item: EntitySummary) => void;
  /** 双击行进详情页 */
  onGoto: () => void;
  /** 建立关联成功后的数据刷新（页面 reloadTick+1） */
  onRelationCreated: () => void;
}

/** 列表行（卡 11.1 + R3 表格平铺）：单行 tr，四列 [标题（点击行内编辑）、分类、标签、来源] + 删除；
 * 来源列只认 `url`（有 url → 可点击链接，否则不显示来源）；双击行 = 进详情页；
 * 右键菜单 [注入会话上下文、建立关联] 复用 */
function RefRow({ item, onRename, onDelete, onGoto, onRelationCreated }: RefRowProps) {
  const type = (item.summary?.type as string | undefined) ?? "material";
  const tags = Array.isArray(item.summary?.tags)
    ? (item.summary?.tags as string[]).filter((t): t is string => typeof t === "string" && t !== "")
    : [];
  // 来源列：只认 url（文件机制遗留的 kind / file_name / source 不再读）
  const source = referenceSource(item.summary);

  // 标题行内编辑（点击标题进入，Enter 提交 / Esc 取消 / 失焦保存；对齐时间轴 TimelineEvent 模式）
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Ctrl/Cmd+S（B2）：行内编辑进行中 → 提交当前编辑（Enter 同语义）；未编辑时不参与
  useSaveShortcut(() => commitEdit(), editing);

  /** 点击标题进入行内编辑（预填当前名） */
  function startEdit() {
    setNameValue(item.name);
    setEditing(true);
  }

  /** Enter/失焦提交：trim 后空/未变 → 退出编辑不发请求；saving 守卫防 Enter+blur 双提交；
   * 失败保持编辑态 + 保留输入值（页面已 toast，此处 catch 吞掉防 unhandled rejection） */
  async function commitEdit() {
    if (saving) return;
    const name = nameValue.trim();
    if (name === "" || name === item.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onRename(item.id, name);
      setEditing(false);
    } catch {
      // 失败保持编辑态（setEditing(false) 未执行）+ 输入值保留，可修正后重试
      return false; // 保存失败：Ctrl+S 据此不生成备份
    } finally {
      setSaving(false);
    }
  }

  /** 行双击：双击 = 详情；冲突防护：双击标题 = 编辑（第一击已把 span 换成输入框，
   * dblclick target 是输入框被 closest 拦截；极端时序由 editing 守卫拦截）；双击按钮区不跳详情 */
  function handleRowDoubleClick(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button, input, a")) return;
    if (editing) return;
    onGoto();
  }

  return (
    <RowContextMenu
      focus={{ focus_entity_type: "reference", focus_entity_id: item.id }}
      source={{ type: "reference", id: item.id, name: item.name }}
      onCreated={onRelationCreated}
      trigger={
        <tr
          className="group cursor-default border-b border-border/50 transition-colors last:border-0 hover:bg-muted"
          onDoubleClick={handleRowDoubleClick}
          title="双击查看详情"
        />
      }
    >
      {/* 标题列：点击 = 行内编辑（Enter 提交 / Esc 取消 / 失焦保存） */}
      <td className="max-w-56 px-3 py-2">
        {editing ? (
          <Input
            autoComplete="off"
            autoFocus
            size="small"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitEdit();
              } else if (e.key === "Escape") {
                setEditing(false);
              }
            }}
            onBlur={() => void commitEdit()}
            disabled={saving}
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="block w-full truncate text-left text-sm font-medium text-foreground hover:text-primary"
            title="点击编辑标题"
          >
            {item.name}
          </button>
        )}
      </td>
      {/* 分类列（2026-09 卡 18.1）：分类 = 类型徽标 → `TypeChip`（描边式，与标签列的 tint 实底两套形态语言；
          此前是裸文字——分类既不像标签也不像类型，两页还各手抄一份中文名映射） */}
      <td className="max-w-28 px-3 py-2">
        {referenceTypeLabel(type) !== "" && (
          <TypeChip className="max-w-full truncate">{referenceTypeLabel(type)}</TypeChip>
        )}
      </td>
      {/* 标签列：tags 前 3 个徽标 */}
      <td className="px-3 py-2">
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {tags.map((t) => (
              <TagChip key={t}>{t}</TagChip>
            ))}
          </div>
        )}
      </td>
      {/* 来源列：有 url 显示链接（http(s) 可点击），否则不显示来源 */}
      <td className="max-w-44 px-3 py-2">
        {source !== "" &&
          (/^https?:\/\//.test(source) ? (
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline"
              title={source}
            >
              <span className="truncate">{source}</span>
              <ExportOutlined className="shrink-0" />
            </a>
          ) : (
            <span className="block truncate text-xs text-muted-foreground" title={source}>
              {source}
            </span>
          ))}
      </td>
      {/* 操作列：删除（H3 直接平铺不收 ⋯） */}
      <td className="w-10 px-2 py-2 text-right">
        {/* 移入回收站 = 软删（可还原）→ 常规色，**不用**危险色（DESIGN §icon-button：危险色只给不可撤销） */}
        <Button
          color="default"
          variant="text"
          onClick={() => onDelete(item)}
          aria-label="删除"
          title="移入回收站"
          icon={<DeleteOutlined />}
        />
      </td>
    </RowContextMenu>
  );
}
