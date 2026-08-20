// 实体列表页（S3.5；替换 T7.1 占位壳；U8 增补第 5 个「关联」tab）
// 路由：#/entities/:type?（type ∈ character|setting|location|hook|…，缺省 character——main.tsx 归一化；
//   "relations" 由 main.tsx 先拦截传入本页，不参与归一化）；
//   四类 tab 切换即改 hash（useHashRoute 驱动），hash 变化 → main.tsx 传新 type → 本页重置查询状态
// 数据：GET /api/v1/entity/:type?q=&offset=&limit=&sort=&order=（EntitySummary 摘要列表）
// 契约：doc/ui/pages/entity-list.md——tab/搜索防抖 300ms/排序下拉/分页（limit 20、total 驱动）/
//   摘要列按类型（lib/entity-list.ts SUMMARY_COLUMNS）/空态两种文案区分/行点击跳详情（S3.6）；
//   「关联 Tab（U8 增补）」——type==="relations" 渲染 RelationsView（前端过滤全量关系），
//   「+ 新建」变「+ 建立关联」打开共用 CreateRelationDialog（列表模式，源可选）
// 决策 42（2026-08 批次十）：设定 tab（entityType==="setting"）改为**树形视图**（SettingTreeView，
//   与设定树 tab 合并——原「设定树」tab/路由已移除，main.tsx 重定向到设定 tab）；设定不走表格/分页，
//   搜索+标签筛选在树内进行（树形视图自带工具栏），上级设定筛选（决策 32）被树形导航吸收（下拉移除）；
//   character/location/hook 保持表格视图（决策 40：行级 AskAiButton 已移除——右键菜单替代）
// 「+ 新建」按钮（列表头/空态两个入口）→ 列表首行内联编辑行（UX4：name + 该类型首字段——
//   hook 的 status 下拉、其余文本；字段配置复用 lib/entity-list.ts CREATE_FIRST_FIELD；
//   提交成功留在列表（2026-08 用户反馈：不自动跳详情），失败内联错误不关行）
// 软删：服务端默认过滤（决策 12 修订）；回收站入口 #/trash 由 S4 卡实现，本卡不提供入口
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ENTITY_TYPES } from "@whispering233/ai-editor-shared";
import type { EntitySummary, EntityType } from "@whispering233/ai-editor-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { skeletonClass } from "@/lib/styles";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  createEntity,
  listEntities,
  type EntityListRes,
} from "../lib/api";
import {
  CREATE_FIRST_FIELD,
  PAGE_LIMIT,
  pageCount,
  SUMMARY_COLUMNS,
  summaryCellText,
} from "../lib/entity-list";
import { cn } from "../lib/utils";
import { navigate } from "../hooks/use-route";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useUiStore } from "../stores/ui";
import { CreateRelationDialog } from "../components/entity/create-relation-dialog";
import { RowContextMenu } from "../components/entity/row-context-menu";
import { RelationsView } from "../components/entity/relations-view";
import { SettingTreeView } from "../components/entity/setting-tree";
import { SuggestionDatalist, uniqueStrings } from "../components/ui/suggestion-datalist";

const TYPE_LABEL: Record<EntityType, string> = {
  character: "人物",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
  // C1 类型补全（决策 26 event 时间轴事件；时间轴专属 UI 由 C2 实现）
  event: "事件",
  // G2.3 类型补全（G2 时间标签点；tab 随 ENTITY_TYPES 自动出现，列表 = 泛型视图）
  timepoint: "时间点",
  // 决策 36（批次九）参考资料 reference
  reference: "参考资料",
};

/** 排序下拉选项（sort × order 组合；决策 39：移除 updated_at 项，默认创建时间倒序） */
const SORT_OPTIONS: Array<{
  value: string;
  label: string;
  sort: "name" | "created_at";
  order: "asc" | "desc";
}> = [
  { value: "name:asc", label: "名称（A→Z）", sort: "name", order: "asc" },
  { value: "name:desc", label: "名称（Z→A）", sort: "name", order: "desc" },
  { value: "created_at:desc", label: "创建时间（新→旧）", sort: "created_at", order: "desc" },
  { value: "created_at:asc", label: "创建时间（旧→新）", sort: "created_at", order: "asc" },
];

export default function EntityList({ type }: { type: string }) {
  /** 关联 tab（U8）：type==="relations" 时渲染关联总览视图，不参与四类实体逻辑 */
  const isRelations = type === "relations";
  // main.tsx 已把未知 type 归一化为 character；此处双保险
  const entityType = (ENTITY_TYPES as readonly string[]).includes(type)
    ? (type as EntityType)
    : "character";

  const [items, setItems] = useState<EntitySummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 搜索框即时值（防抖输入） */
  const [qInput, setQInput] = useState("");
  /** 防抖后的查询关键词（空 = 不过滤） */
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<"name" | "created_at">("created_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  /** 重试计数（错误后手动重新加载） */
  const [reloadTick, setReloadTick] = useState(0);
  // 数据变更信号（问题 1）：AI 提案确认写库 / InfoBar 刷新按钮 → 重拉列表
  // （关联 tab 的 RelationsView 以 reloadKey={reloadTick} 联动刷新；设定 tab 树形视图同 key；
  //   ref 守卫防首帧重复拉）
  useDataRefresh(() => setReloadTick((t) => t + 1));
  // 行内新建（UX4）打开态与表单状态
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [firstValue, setFirstValue] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  const col = SUMMARY_COLUMNS[entityType];
  const firstField = CREATE_FIRST_FIELD[entityType];
  const pages = pageCount(total, PAGE_LIMIT);
  const page = Math.floor(offset / PAGE_LIMIT) + 1;
  // 新建行 datalist 候选（批次五 J2，决策 31）：从当前列表聚合已有名称 / 首字段值
  // （浏览器原生自动完成——输入时弹出已有候选，如输入「势」弹出「势力」）
  const createNameSuggestions = uniqueStrings(items?.map((i) => i.name) ?? []);
  // 首字段候选：text 单值取 summary 字段值；tags 多值（K1：setting.rules）flatMap 聚合数组元素
  const createFirstSuggestions =
    firstField.key === ""
      ? []
      : firstField.input === "tags"
        ? uniqueStrings(
            (items ?? []).flatMap((i) =>
              Array.isArray(i.summary[firstField.key])
                ? (i.summary[firstField.key] as string[])
                : [],
            ),
          )
        : uniqueStrings(items?.map((i) => String(i.summary[firstField.key] ?? "")) ?? []);

  // tab 切换（type 变化，含进出关联 tab）：重置搜索/分页/排序（原型「MVP 切换时重置搜索与分页」）
  useEffect(() => {
    setQInput("");
    setQ("");
    setOffset(0);
    setSort("created_at");
    setOrder("desc");
    setItems(null);
    setError(null);
    setCreateOpen(false);
  }, [type]);

  // 搜索防抖 300ms；关键词变化时页码重置 0（同批 setState，只发一次请求）
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // 列表加载：type/q/offset/sort/order 变化驱动；卸载或参数变化时丢弃过期响应
  // 关联 tab / 设定 tab（树形视图自拉数据）：列表请求不发起，进出 tab 由对应分支触发兜底
  useEffect(() => {
    if (isRelations || entityType === "setting") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listEntities(entityType, {
      q: q || undefined,
      offset,
      limit: PAGE_LIMIT,
      sort,
      order,
    })
      .then((res: EntityListRes) => {
        if (!cancelled) {
          setItems(res.items);
          setTotal(res.total);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setItems(null);
          setError(err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, q, offset, sort, order, reloadTick, isRelations]);

  /** 排序切换：重置页码（原型交互） */
  function handleSortChange(value: string) {
    const opt = SORT_OPTIONS.find((o) => o.value === value);
    if (!opt) return;
    setSort(opt.sort);
    setOrder(opt.order);
    setOffset(0);
  }

  /** 打开行内新建（UX4）：重置表单防上次残留；实体 tab 用（关联 tab 走 CreateRelationDialog） */
  function openCreateRow() {
    setCreateName("");
    setFirstValue("");
    setCreateError(null);
    setCreateOpen(true);
  }

  /** 取消行内新建（Esc / 取消按钮共用） */
  function cancelCreateRow() {
    setCreateOpen(false);
    setCreateError(null);
  }

  /** 行内新建提交：POST → toast → 留在列表刷新（2026-08 用户反馈：不自动跳详情页）；失败内联错误不关行 */
  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    // name 必填（服务端 1-100 校验；前端先拦空值）
    const name = createName.trim();
    if (!name) {
      setCreateError("请输入名称");
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const first = CREATE_FIRST_FIELD[entityType];
      const data: Record<string, unknown> = {};
      // 空 key = 该类型无 data 首字段（timepoint：时间标签文本即 name，G2）——跳过不写 data
      if (first.key !== "" && firstValue.trim()) {
        if (first.input === "tags") {
          // K1（决策 31）：逗号分隔多值标签（中英文逗号均可）→ rules 数组
          data[first.key] = firstValue
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter((s) => s !== "");
        } else {
          data[first.key] = firstValue.trim();
        }
      }
      await createEntity(entityType, { name, data });
      useUiStore.getState().showToast(`已创建${TYPE_LABEL[entityType]}《${name}》`);
      // 创建后留在列表（2026-08 用户反馈：不自动跳详情页——打断性行为；关行 + 刷新列表
      // 让新项按排序出现在当前视图，需要进详情可点行进入）
      setCreateOpen(false);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "创建失败，请重试");
    } finally {
      setCreateSubmitting(false);
    }
  }

  /** 清空搜索（搜索空态操作） */
  function clearSearch() {
    setQInput("");
    setQ("");
    setOffset(0);
  }

  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold">实体</h1>

      {/* 顶部：实体类型 tab（含关联，U8）+ 搜索 + 新建/建立关联
          （设定 tab 为树形视图（决策 42），自带工具栏——搜索/新建在树内，顶部不重复渲染） */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
        <div className="flex gap-1">
          {/* 批次十二 T3：参考资料已有独立中栏 tab（#/references），实体二级 tab 排除——入口去重 */}
          {ENTITY_TYPES.filter((t) => t !== "reference").map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => navigate(`/entities/${t}`)}
              className={cn(
                "rounded-md border border-border px-3 py-1.5 text-sm",
                !isRelations && entityType === t
                  ? "bg-foreground font-medium text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
          {/* 关联 tab（token 样式；激活态反相对比 bg-foreground/text-background，同 Breadcrumb） */}
          <button
            type="button"
            onClick={() => navigate("/entities/relations")}
            className={cn(
              "rounded-md border border-border px-3 py-1.5 text-sm",
              isRelations
                ? "bg-foreground font-medium text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            关联
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!isRelations && entityType !== "setting" && (
            <Input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder={`搜索${TYPE_LABEL[entityType]}名称…`}
              className="w-52"
            />
          )}
          {!isRelations && entityType !== "setting" && (
            <Button type="button" onClick={openCreateRow}>
              + 新建
            </Button>
          )}
        </div>
      </div>

      {/* 关联 tab：关系总览视图（前端过滤全量）；设定 tab：树形视图（决策 42，与设定树合并——
          搜索+标签树内过滤、无分页、上级筛选被树形导航吸收）；其余类型 tab：原表格视图 */}
      {isRelations ? (
        <RelationsView reloadKey={reloadTick} onOpenCreate={() => setCreateOpen(true)} />
      ) : entityType === "setting" ? (
        <SettingTreeView reloadKey={reloadTick} />
      ) : (
        <>
          {/* 排序行 + 总数 */}
          <div className="mt-3 mb-2 flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              排序:
              <select
                value={`${sort}:${order}`}
                onChange={(e) => handleSortChange(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="ml-auto text-sm text-muted-foreground/70">共 {total} 个</span>
          </div>

          {/* 行内新建（UX4）：列表首行内联编辑——name + 该类型首字段（hook 的 status 下拉，其余文本；
          字段配置复用 lib/entity-list.ts CREATE_FIRST_FIELD）；回车/「创建」提交（成功留在列表刷新），
          Esc/「取消」关闭，失败内联错误不关行（可修正重试） */}
          {createOpen && (
            <form
              id="create-entity-row"
              onSubmit={handleCreate}
              className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2"
            >
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelCreateRow();
                }}
                placeholder={entityType === "character" ? "名称（如：张三）" : "名称"}
                maxLength={100}
                disabled={createSubmitting}
                autoFocus
                aria-label="名称"
                list={`entity-create-name-${entityType}`}
                className="w-48"
              />
              <SuggestionDatalist
                id={`entity-create-name-${entityType}`}
                options={createNameSuggestions}
              />
              {/* 首字段（空 key = 无 data 首字段——timepoint 仅 name，G2.3；行内新建退化为纯名称输入） */}
              {firstField.key !== "" &&
                (firstField.input === "select" ? (
                  <select
                    value={firstValue}
                    onChange={(e) => setFirstValue(e.target.value)}
                    disabled={createSubmitting}
                    aria-label={firstField.label}
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <option value="">{firstField.label}（选填）</option>
                    {firstField.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {summaryCellText(entityType, firstField.key, opt)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    value={firstValue}
                    onChange={(e) => setFirstValue(e.target.value)}
                    placeholder={
                      firstField.input === "tags"
                        ? `${firstField.label}（逗号分隔，如：势力,宗门）`
                        : `${firstField.label}（选填）`
                    }
                    disabled={createSubmitting}
                    aria-label={firstField.label}
                    list={`entity-create-first-${entityType}`}
                    className={firstField.input === "tags" ? "w-56" : "w-40"}
                  />
                ))}
              <SuggestionDatalist
                id={`entity-create-first-${entityType}`}
                options={createFirstSuggestions}
              />
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  type="button"
                  size="sm"
                  onClick={cancelCreateRow}
                  disabled={createSubmitting}
                >
                  取消
                </Button>
                <Button type="submit" size="sm" disabled={createSubmitting}>
                  {createSubmitting ? "创建中…" : "创建"}
                </Button>
              </div>
              {createError && <p className="w-full text-sm text-destructive">{createError}</p>}
            </form>
          )}

          {/* 错误横幅（列表请求失败） */}
          {error !== null && (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error === CLIENT_NETWORK_ERROR
                ? "无法连接服务，请确认 ai-editor 服务已启动。"
                : "列表加载失败，请重试。"}
              <Button
                variant="outline"
                className="ml-3"
                type="button"
                onClick={() => setReloadTick((t) => t + 1)}
              >
                重试
              </Button>
            </div>
          )}

          {/* 加载骨架（首次加载） */}
          {loading && items === null && error === null && (
            <div className="overflow-hidden rounded-md border border-border">
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-border/50 px-3 py-3 last:border-0"
                >
                  <div className={cn(skeletonClass, "h-4 w-1/4")} />
                  <div className={cn(skeletonClass, "h-4 w-1/6")} />
                  {col.key2 && <div className={cn(skeletonClass, "h-4 w-1/6")} />}
                  {col.key3 && <div className={cn(skeletonClass, "h-4 w-1/6")} />}
                  <div className={cn(skeletonClass, "ml-auto h-4 w-16")} />
                </div>
              ))}
            </div>
          )}

          {/* 空态（两种文案区分：无实体 vs 搜索无结果） */}
          {!loading && items !== null && items.length === 0 && (
            <EmptyState
              className="mt-3"
              action={
                q ? (
                  <Button variant="outline" type="button" onClick={clearSearch}>
                    清空搜索
                  </Button>
                ) : (
                  <Button type="button" onClick={openCreateRow}>
                    + 新建{TYPE_LABEL[entityType]}
                  </Button>
                )
              }
            >
              {q
                ? `没有匹配「${q}」的${TYPE_LABEL[entityType]}`
                : `还没有${TYPE_LABEL[entityType]}，新建一个`}
            </EmptyState>
          )}

          {/* 列表表格 */}
          {!loading && items !== null && items.length > 0 && (
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground/70">
                    <th className="px-3 py-2 font-normal">名称</th>
                    <th className="px-3 py-2 font-normal">{col.label1}</th>
                    {col.key2 && <th className="px-3 py-2 font-normal">{col.label2}</th>}
                    {col.key3 && <th className="px-3 py-2 font-normal">{col.label3}</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    // 行级右键菜单（决策 40）：注入会话上下文（focus_entity_type/id）+ 建立关联
                    // （源端点按行实体类型预填）；行点击跳详情保持（ContextMenuTrigger 内建
                    //   onContextMenu 处理右键，不干扰行 onClick）
                    <RowContextMenu
                      key={item.id}
                      focus={{ focus_entity_type: entityType, focus_entity_id: item.id }}
                      source={{ type: entityType, id: item.id, name: item.name }}
                      onCreated={() => setReloadTick((t) => t + 1)}
                      trigger={
                        <tr
                          className="cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-muted"
                          onClick={() => navigate(`/entities/${entityType}/${item.id}`)}
                          title={`打开《${item.name}》`}
                        />
                      }
                    >
                      <td className="max-w-64 truncate px-3 py-2 font-medium text-foreground">
                        {item.name}
                      </td>
                      <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">
                        {summaryCellText(entityType, col.key1, item.summary[col.key1])}
                      </td>
                      {col.key2 && (
                        <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">
                          {summaryCellText(entityType, col.key2, item.summary[col.key2])}
                        </td>
                      )}
                      {col.key3 && (
                        // 描述列（M2，仅 setting）：行内 truncate + hover title 查看完整摘要（服务端已截断 100 字符）
                        <td
                          className="max-w-40 truncate px-3 py-2 text-muted-foreground"
                          title={
                            typeof item.summary[col.key3] === "string"
                              ? (item.summary[col.key3] as string)
                              : undefined
                          }
                        >
                          {summaryCellText(entityType, col.key3, item.summary[col.key3])}
                        </td>
                      )}
                    </RowContextMenu>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 分页控件（total 驱动；MVP limit 固定 20） */}
          {!loading && items !== null && items.length > 0 && (
            <div className="mt-4 flex items-center justify-center gap-3 text-sm">
              <button
                type="button"
                disabled={page <= 1 || loading}
                className="rounded-md border border-border px-3 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                onClick={() => setOffset((page - 2) * PAGE_LIMIT)}
              >
                ‹ 上一页
              </button>
              <span className="text-muted-foreground">
                第 {page} / {pages} 页
              </span>
              <button
                type="button"
                disabled={page >= pages || loading}
                className="rounded-md border border-border px-3 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                onClick={() => setOffset(page * PAGE_LIMIT)}
              >
                下一页 ›
              </button>
            </div>
          )}
        </>
      )}

      {/* 关联 tab 建立关联对话框（列表模式：源实体可选，U8） */}
      {isRelations && createOpen && (
        <CreateRelationDialog
          source={null}
          onCreated={() => setReloadTick((t) => t + 1)}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </section>
  );
}
