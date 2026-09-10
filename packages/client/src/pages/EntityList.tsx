// 实体列表页（S3.5；替换 T7.1 占位壳；U8 增补「关联」段）
// 路由（批次十七 1-1 一级化）：#/characters | #/setting（树形视图）| #/locations | #/relations——
// 各类型独立一级段，main.tsx 按段路由传入 type；hook/event/timepoint 泛型入口已去重（富页/宿主段承接），
// 旧 #/entities/:type[/:id] 在 main.tsx 全量重定向到新段；
// 批次十八 A1（用户反馈）：页首残留的「实体」标题与类型切换 Segmented 已移除——
// 类型切换 = 左栏 NavRail（一级导航），列表页只保留搜索/排序/新建等内容级控件；
// type 变化（直接改 hash / 切导航）仍触发本页查询状态重置
// 数据：GET /api/v1/entity/:type?q=&offset=&limit=&sort=&order=（EntitySummary 摘要列表）
// ——搜索防抖 300ms/排序下拉/分页（limit 20、total 驱动）/
// 摘要列按类型（lib/entity-list.ts SUMMARY_COLUMNS）/空态两种文案区分/行点击跳详情（S3.6）；
// 「关联（U8）」——type==="relations" 渲染 RelationsView（前端过滤全量关系），
// 「+ 新建」变「+ 建立关联」打开共用 CreateRelationDialog（列表模式，源可选）
// （2026-08 批次十）：设定 tab（entityType==="setting"）改为**树形视图**（SettingTreeView，
// 与设定树 tab 合并）；设定不走表格/分页，
// 搜索+标签筛选在树内进行（树形视图自带工具栏），上级设定筛选被树形导航吸收（下拉移除）；
// character/location 保持表格视图（行级 AskAiButton 已移除——右键菜单替代）
// 「+ 新建」按钮（列表头/空态两个入口）→ 列表首行内联编辑行（UX4：name + 该类型首字段——
// hook 的 status 下拉、其余文本；字段配置复用 lib/entity-list.ts CREATE_FIRST_FIELD；
// 提交成功留在列表（2026-08 用户反馈：不自动跳详情），失败内联错误不关行）
// 软删：服务端默认过滤；回收站入口 #/trash 由 S4 卡实现，本卡不提供入口
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ENTITY_TYPES } from "@whispering233/ai-editor-shared";
import type { EntitySummary, EntityType } from "@whispering233/ai-editor-shared";
import { Alert, Button, Input, Pagination, Select, Skeleton, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { TagChip } from "@/components/ui/tag-chip";
import { PageTitle } from "@/components/ui/page-title";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  createEntity,
  listEntities,
  type EntityListRes,
} from "../lib/api";
import {
  characterRowInfo,
  CREATE_FIRST_FIELD,
  ListableEntityType,
  PAGE_LIMIT,
  SUMMARY_COLUMNS,
  summaryCellText,
} from "../lib/entity-list";
import { entityDetailPath } from "../lib/entity-paths";
import { focusNewItem } from "../lib/new-item-focus";
import { cn } from "../lib/utils";
import { navigate } from "../hooks/use-route";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useUiStore } from "../stores/ui";
import { CreateRelationDialog } from "../components/entity/create-relation-dialog";
import { RowContextMenu } from "../components/entity/row-context-menu";
import { RelationsView } from "../components/entity/relations-view";
import { SettingTreeView } from "../components/entity/setting-tree";
import { SuggestionDatalist, uniqueStrings } from "../components/ui/suggestion-datalist";
import { EmptyState } from "../components/ui/empty-state";

const TYPE_LABEL: Record<ListableEntityType, string> = {
  character: "人物",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
  // C1 类型补全（ event 时间轴事件；时间轴专属 UI 由 C2 实现）
  event: "事件",
  // G2.3 类型补全（G2 时间标签点；tab 随 ENTITY_TYPES 自动出现，列表 = 泛型视图）
  timepoint: "时间点",
};
// 注：TYPE_LABEL.reference 已随批次十二 T3 移除——实体二级 tab 不再渲染参考资料
//（独立中栏 tab #/references，旧路由重定向）。
// 批次十七 1-1 泛型入口收敛：导航仅保留列表宿主类型（hook/event/timepoint 已由富页/宿主段承接，
// 旧 #/entities/{hook,event,timepoint} 路由在 main.tsx 重定向）

/** 排序下拉选项（sort × order 组合；移除 updated_at 项，默认创建时间倒序） */
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
    ? (type as ListableEntityType)
    : ("character" as ListableEntityType);

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
  // ref 守卫防首帧重复拉）
  useDataRefresh(() => setReloadTick((t) => t + 1));
  // 行内新建（UX4）打开态与表单状态
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [firstValue, setFirstValue] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  /** 新建成功后的聚焦目标 id（A2：新行滚动到位 + 高亮 + 键盘焦点落行；3s 后清除） */
  const [newItemId, setNewItemId] = useState<string | null>(null);
  /** 已聚焦过的新建行 id（一次性守卫：数据重拉不重复聚焦抢焦点） */
  const focusedNewItemRef = useRef<string | null>(null);

  // 新建行聚焦（A2）：新行已进入当前页数据（items 含 id）时滚动 + 聚焦；
  // 排序/分页导致新行不在当前视图 → focusNewItem 返回 false，静默忽略（不强行跳页）。
  // 一次性守卫（focusedNewItemRef）：3s 高亮窗口内列表重拉（搜索/刷新）不重复抢焦点
  useEffect(() => {
    if (newItemId === null || focusedNewItemRef.current === newItemId) return;
    const t = setTimeout(() => {
      if (focusNewItem(`[data-entity-id="${newItemId}"]`)) focusedNewItemRef.current = newItemId;
    }, 0);
    return () => clearTimeout(t);
  }, [newItemId, items]);

  // 新建行高亮自动消失（3s）
  useEffect(() => {
    if (newItemId === null) return;
    const t = setTimeout(() => setNewItemId(null), 3000);
    return () => clearTimeout(t);
  }, [newItemId]);

  const col = SUMMARY_COLUMNS[entityType];
  const firstField = CREATE_FIRST_FIELD[entityType];
  const page = Math.floor(offset / PAGE_LIMIT) + 1;
  // 新建行 datalist 候选（批次五 J2）：从当前列表聚合已有名称 / 首字段值
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
          // K1：逗号分隔多值标签（中英文逗号均可）→ rules 数组
          data[first.key] = firstValue
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter((s) => s !== "");
        } else {
          data[first.key] = firstValue.trim();
        }
      }
      const res = await createEntity(entityType, { name, data });
      useUiStore.getState().showToast(`已创建${TYPE_LABEL[entityType]}《${name}》`);
      // 创建后留在列表（2026-08 用户反馈：不自动跳详情页——打断性行为；关行 + 刷新列表
      // 让新项按排序出现在当前视图，需要进详情可点行进入）；A2：新行滚动到位 + 高亮 + 聚焦
      setCreateOpen(false);
      setNewItemId(res.id);
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
      {/* 第一行：页面标题（layout.md §3 页面头部统一结构；批次十八误删「实体」标题后补回各类型标题） */}
      <PageTitle className="mb-4">{isRelations ? "关联" : TYPE_LABEL[entityType]}</PageTitle>

      {/* 第二行：控件行（左：搜索/排序/总数；右：操作按钮）。设定（树）与关联（关系总览）
          的控件行在各自视图内渲染（工具栏位置随视图结构） */}
      {!isRelations && entityType !== "setting" && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="w-48">
            <Input
              prefix={<SearchOutlined />}
              allowClear
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder={`搜索${TYPE_LABEL[entityType]}名称…`}
            />
          </div>
          <span className="flex items-center gap-2">
            <Typography.Text type="secondary">排序:</Typography.Text>
            <Select
              value={`${sort}:${order}`}
              onChange={(value) => handleSortChange(String(value))}
              options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              style={{ minWidth: 150 }}
            />
          </span>
          <span className="text-sm text-muted-foreground">共 {total} 个</span>
          <Button type="primary" className="ml-auto" onClick={openCreateRow}>
            + 新建
          </Button>
        </div>
      )}

      {/* 关联 tab：关系总览视图（前端过滤全量）；设定 tab：树形视图（与设定树合并——
          搜索+标签树内过滤、无分页、上级筛选被树形导航吸收）；其余类型 tab：原表格视图 */}
      {isRelations ? (
        <RelationsView reloadKey={reloadTick} onOpenCreate={() => setCreateOpen(true)} />
      ) : entityType === "setting" ? (
        <SettingTreeView reloadKey={reloadTick} />
      ) : (
        <>

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
                style={{ width: 192 }}
              />
              <SuggestionDatalist
                id={`entity-create-name-${entityType}`}
                options={createNameSuggestions}
              />
              {/* 首字段（空 key = 无 data 首字段——timepoint 仅 name，G2.3；行内新建退化为纯名称输入） */}
              {firstField.key !== "" &&
                (firstField.input === "select" ? (
                  <Select
                    size="medium"
                    value={firstValue === "" ? undefined : firstValue}
                    onChange={(value) => setFirstValue(value === undefined ? "" : String(value))}
                    disabled={createSubmitting}
                    aria-label={firstField.label}
                    placeholder={`${firstField.label}（选填）`}
                    allowClear
                    style={{ minWidth: 150 }}
                    options={firstField.options?.map((opt) => ({
                      value: opt,
                      label: summaryCellText(entityType, firstField.key, opt),
                    }))}
                  />
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
                    style={{ width: firstField.input === "tags" ? 224 : 160 }}
                  />
                ))}
              <SuggestionDatalist
                id={`entity-create-first-${entityType}`}
                options={createFirstSuggestions}
              />
              <div className="ml-auto flex items-center gap-2">
                <Button htmlType="button" onClick={cancelCreateRow} disabled={createSubmitting}>
                  取消
                </Button>
                <Button htmlType="submit" type="primary" loading={createSubmitting}>
                  创建
                </Button>
              </div>
              {createError && <p className="w-full text-sm text-destructive">{createError}</p>}
            </form>
          )}

          {/* 错误横幅（列表请求失败） */}
          {error !== null && (
            <Alert
              className="mb-3"
              type="error"
              showIcon
              message={
                error === CLIENT_NETWORK_ERROR
                  ? "无法连接服务，请确认 ai-editor 服务已启动。"
                  : "列表加载失败，请重试。"
              }
              action={
                <Button size="small" onClick={() => setReloadTick((t) => t + 1)}>
                  重试
                </Button>
              }
            />
          )}

          {/* 加载骨架（首次加载） */}
          {loading && items === null && error === null && (
            <div className="rounded-md border border-border p-3">
              <Skeleton active title={false} paragraph={{ rows: 6 }} />
            </div>
          )}

          {/* 空态（两种文案区分：无实体 vs 搜索无结果；均走 EmptyState 虚线卡） */}
          {!loading && items !== null && items.length === 0 && (
            <EmptyState
              padding="sm"
              className="mt-3"
              action={
                q ? (
                  <Button onClick={clearSearch}>清空搜索</Button>
                ) : (
                  <Button type="primary" onClick={openCreateRow}>
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
                    // 行级右键菜单：注入会话上下文（focus_entity_type/id）+ 建立关联
                    // （源端点按行实体类型预填）；行点击跳详情保持（ContextMenuTrigger 内建
                    // onContextMenu 处理右键，不干扰行 onClick）
                    <RowContextMenu
                      key={item.id}
                      focus={{ focus_entity_type: entityType, focus_entity_id: item.id }}
                      source={{ type: entityType, id: item.id, name: item.name }}
                      onCreated={() => setReloadTick((t) => t + 1)}
                      trigger={
                        <tr
                          data-entity-id={item.id}
                          tabIndex={-1}
                          className={cn(
                            "cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-muted",
                            item.id === newItemId && "bg-primary/10 ring-1 ring-primary/30 ring-inset", // 新建成功临时高亮（3s，A2）
                          )}
                          onClick={() =>
                            navigate(entityDetailPath(entityType as EntityType, item.id))
                          }
                          title={`打开《${item.name}》`}
                        />
                      }
                    >
                      {/* （用户复核修订）：character 四列（名称+动机第二行 / 角色 / 性格 /
                          能力）由 CharacterRow 自渲染；其余类型保持原表格列 */}
                      {entityType === "character" ? (
                        <CharacterRow item={item} />
                      ) : (
                        <>
                          <td className="max-w-64 truncate px-3 py-2 font-medium text-foreground">
                            {item.name}
                          </td>
                          <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">
                            {summaryCellText(entityType, col.key1, item.summary[col.key1])}
                          </td>
                        </>
                      )}
                      {/* character 四列（名称+动机第二行 / 角色 / 性格 / 能力）由
                          CharacterRow 自渲染，通用 key2/key3 单元格跳过（防表头/表体错位） */}
                      {entityType !== "character" && col.key2 && (
                        <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">
                          {summaryCellText(entityType, col.key2, item.summary[col.key2])}
                        </td>
                      )}
                      {entityType !== "character" && col.key3 && (
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
            <div className="mt-4 flex justify-center">
              <Pagination
                simple
                current={page}
                total={total}
                pageSize={PAGE_LIMIT}
                disabled={loading}
                onChange={(p) => setOffset((p - 1) * PAGE_LIMIT)}
              />
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

/** 人物行四列布局（ + 用户修订，2026-08 批次十三）：名称列（第一行名称 + 第二行动机
 * 摘要，hover title 查看完整）+ 角色列（summary.role，T2 标签徽标样式）+ 性格列 + 能力列
 * （各前 2 个 chips，T2 徽标样式；空数组显示「—」占位与其余类型缺失语义一致）。
 * 角色/性格/能力独立成列——列头即区分，修复首版合并 chips 无法分辨的反馈。 */
function CharacterRow({ item }: { item: EntitySummary }) {
  const { role, motivation, personality, abilities } = characterRowInfo(item.summary);
  const badge = (text: string) => <TagChip key={text}>{text}</TagChip>;
  return (
    <>
      {/* 名称列：名称 + 动机第二行（弱化样式，空动机不渲染） */}
      <td className="px-3 py-2">
        <div className="min-w-0">
          <span className="block max-w-64 truncate font-medium text-foreground" title={item.name}>
            {item.name}
          </span>
          {motivation !== "" && (
            <span
              className="mt-0.5 block max-w-72 truncate text-xs text-muted-foreground"
              title={motivation}
            >
              {motivation}
            </span>
          )}
        </div>
      </td>
      {/* 角色列 */}
      <td className="px-3 py-2">
        {role !== "" ? <TagChip>{role}</TagChip> : <span className="text-muted-foreground">—</span>}
      </td>
      {/* 性格列（前 2 chips）：td 保持 table-cell（禁止直接加 flex——浏览器表格布局会把
          非 cell 盒塞进同一列槽，能力列与性格列重叠，实测踩坑），flex 只作用内层容器 */}
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {personality.length > 0 ? (
            personality.map(badge)
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      </td>
      {/* 能力列（前 2 chips）：同上 */}
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {abilities.length > 0 ? (
            abilities.map(badge)
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      </td>
    </>
  );
}
