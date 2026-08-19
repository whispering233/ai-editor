// 回收站页（S4.4；替换 T7.1 占位壳）
// 路由：#/trash（跨实体/大纲的全局入口，layout.md §2.2）
// 数据：GET /api/v1/trash → { entities, nodes }；还原 POST /trash/entity|outline/:id/restore、
//   彻底删除 DELETE /trash/...（决策 12 软删 + 回收站；契约 trash.md + endpoints.md L660-736）
// 关键交互（trash.md）：
// - 分栏：实体 (N) / 大纲节点 (M)，每行类型徽标 + 名称 + 相对时间（formatRelativeTime）+ [还原] [彻底删除]
// - 还原实体：toast 连带恢复计数（lib/trash restoreEntityToast，计数 0 省略）；404 残留 → 刷新 + toast「该对象已不存在」
// - 还原节点：409 OUTLINE_ANCESTOR_DELETED → 行内「上级节点也在回收站」+ 祖先名 + [还原上级] 快捷按钮——
//   祖先 id 从 409 message 解析（lib/trash parseAncestorId），名字从当前列表 nodes 匹配（软删祖先必在列表）；
//   还原祖先成功自动重试当前节点，更上级仍软删会再次 409 更新提示（服务端路径自顶向下首遇即抛——报
//   **最顶层**软删祖先，级联还原一次解整条链，重试必收敛）；解析失败降级为纯提示无按钮
// - purge：ConfirmDialog danger + 「确认彻底删除」文案（trash.md 44-49 行 MVP 语义：单次确认 + 明确文案）
//   → 行移除 + toast「已彻底删除」；404 残留同还原（刷新 + toast）；其他错误冒泡 ConfirmDialog 内联显示
import { useEffect, useState } from "react";
import type { EntityType } from "@whispering233/ai-editor-shared";
import { formatRelativeTime } from "@whispering233/ai-editor-shared";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { errorBannerClass } from "@/lib/styles";
import { cn } from "../lib/utils";
import { ConfirmDialog } from "../components/outline/dialogs";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  getTrashList,
  purgeOutlineNode,
  purgeTrashEntity,
  restoreOutlineNode,
  restoreTrashEntity,
  type OutlineNodeType,
  type TrashEntity,
  type TrashListRes,
  type TrashOutlineNode,
} from "../lib/api";
import { parseAncestorId, restoreEntityToast, restoreNodeToast } from "../lib/trash";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  character: "人物",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
  // C1 类型补全（决策 26 event 时间轴事件；时间轴专属 UI 由 C2 实现）
  event: "事件",
  // G2.3 类型补全（G2 时间标签点；软删/还原走 /trash/entity/:type/:id 泛型路径）
  timepoint: "时间点",
  // 决策 36（批次九）参考资料 reference
  reference: "参考资料",
};

const NODE_TYPE_LABEL: Record<OutlineNodeType, string> = {
  volume: "卷",
  chapter: "章",
  scene: "场",
};

/** 类型徽标（token 类；实体四类 / 大纲三类共用） */
function TypeBadge({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
  );
}

/** purge 确认目标（实体 / 节点） */
type PurgeTarget = { kind: "entity"; item: TrashEntity } | { kind: "node"; item: TrashOutlineNode };

export default function Trash() {
  const [data, setData] = useState<TrashListRes | null>(null);
  const [loading, setLoading] = useState(false);
  /** 列表请求失败（错误码；null = 正常） */
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // 数据变更信号（问题 1）：AI 提案确认写库 / InfoBar 刷新按钮 → 重拉回收站列表
  // （AI 软删实体/节点会级联入回收站；ref 守卫防首帧重复拉）
  useDataRefresh(() => setReloadTick((t) => t + 1));
  const [purgeTarget, setPurgeTarget] = useState<PurgeTarget | null>(null);
  /** 节点还原 409 祖先冲突（行内展示：最近一个软删祖先 + 还原快捷按钮） */
  const [ancestorConflict, setAncestorConflict] = useState<{
    node: TrashOutlineNode;
    ancestorId: string;
    ancestorName: string;
  } | null>(null);

  // 列表加载（reloadTick 驱动重试/刷新；卸载或重载丢弃过期响应）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTrashList()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  async function reload() {
    setReloadTick((t) => t + 1);
  }

  /** 404 残留（目标已被 purge 的残留请求；实体/节点两侧同码判定） */
  function isGone(err: unknown): boolean {
    return (
      err instanceof ApiError &&
      (err.code === "ENTITY_NOT_FOUND" || err.code === "OUTLINE_NODE_NOT_FOUND")
    );
  }

  /** 非 404 的还原失败 → 全局错误横幅（FeedbackHost 渲染，token 红色） */
  function reportRestoreError(err: unknown) {
    useUiStore
      .getState()
      .showError(
        err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR,
        err instanceof ApiError ? err.message : "操作失败，请重试",
      );
  }

  /** 还原实体：成功 → toast（连带恢复计数）→ 刷新；404 残留 → 刷新 + toast */
  async function handleRestoreEntity(item: TrashEntity) {
    try {
      const res = await restoreTrashEntity(item.type, item.id);
      useUiStore
        .getState()
        .showToast(restoreEntityToast(res.restoredRelations, res.restoredDeltas));
      await reload();
    } catch (err) {
      if (isGone(err)) {
        useUiStore.getState().showToast("该对象已不存在", "error");
        await reload();
        return;
      }
      reportRestoreError(err);
    }
  }

  /** 还原节点：成功 → toast（含子节点计数）→ 刷新；409 → 行内祖先提示；404 → 刷新 + toast */
  async function handleRestoreNode(node: TrashOutlineNode) {
    setAncestorConflict(null);
    try {
      const res = await restoreOutlineNode(node.id);
      useUiStore.getState().showToast(restoreNodeToast(res.restoredChildren));
      await reload();
      // 大纲 tab 联动：outline 树是 project store 全局快照，还原后重拉（Outline 页订阅自动刷新）
      useProjectStore.getState().loadOutline();
    } catch (err) {
      if (err instanceof ApiError && err.code === "OUTLINE_ANCESTOR_DELETED") {
        const ancestorId = parseAncestorId(err.message);
        if (ancestorId === null) {
          // message 格式变化（解析失败）：降级为纯提示，无快捷按钮
          useUiStore
            .getState()
            .showError("OUTLINE_ANCESTOR_DELETED", "上级节点也在回收站，请先还原上级");
          return;
        }
        setAncestorConflict({
          node,
          ancestorId,
          ancestorName: data?.nodes.find((n) => n.id === ancestorId)?.title ?? ancestorId,
        });
        return;
      }
      if (isGone(err)) {
        useUiStore.getState().showToast("该对象已不存在", "error");
        await reload();
        return;
      }
      reportRestoreError(err);
    }
  }

  /** 还原祖先快捷按钮：祖先还原成功 → 自动重试当前节点（更上级仍软删会再次 409 更新提示） */
  async function handleRestoreAncestor() {
    const conflict = ancestorConflict;
    if (!conflict) return;
    try {
      await restoreOutlineNode(conflict.ancestorId);
      // 祖先恢复立即可见（即使重试当前节点再次 409 报更上级，树也已变化）
      useProjectStore.getState().loadOutline();
      await handleRestoreNode(conflict.node);
    } catch (err) {
      if (isGone(err)) {
        useUiStore.getState().showToast("该对象已不存在", "error");
        setAncestorConflict(null);
        await reload();
        return;
      }
      reportRestoreError(err);
    }
  }

  /** purge 确认执行：成功 → toast + 刷新；404 残留 → 刷新 + toast（不抛，对话框关闭）；
   *  其他错误抛给 ConfirmDialog 内联显示（保持打开） */
  async function handlePurgeConfirm() {
    if (!purgeTarget) return;
    try {
      if (purgeTarget.kind === "entity") {
        await purgeTrashEntity(purgeTarget.item.type, purgeTarget.item.id);
      } else {
        await purgeOutlineNode(purgeTarget.item.id);
        // 大纲 tab 联动：purge 后节点从全局树移除
        useProjectStore.getState().loadOutline();
      }
      useUiStore.getState().showToast("已彻底删除");
      await reload();
    } catch (err) {
      if (isGone(err)) {
        useUiStore.getState().showToast("该对象已不存在", "error");
        await reload();
        return;
      }
      throw err;
    }
  }

  const isEmpty = data !== null && data.entities.length === 0 && data.nodes.length === 0;

  return (
    <section>
      {/* header：标题 + 说明 + 刷新 */}
      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-xl font-semibold">回收站</h1>
        <Button
          variant="outline"
          type="button"
          className="ml-auto"
          onClick={() => void reload()}
          disabled={loading}
        >
          刷新
        </Button>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        软删对象会保留一段时间，可在此还原，或彻底删除（不可恢复）。
      </p>

      {/* 列表请求失败：横幅 + 重试 */}
      {error !== null && (
        <div className={cn(errorBannerClass, "mb-3")}>
          {error === CLIENT_NETWORK_ERROR
            ? "无法连接服务，请确认 ai-editor 服务已启动。"
            : "回收站加载失败，请重试。"}
          <Button variant="outline" className="ml-3" type="button" onClick={() => void reload()}>
            重试
          </Button>
        </div>
      )}

      {/* 加载骨架（首次加载，两栏分栏） */}
      {loading && data === null && error === null && (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((col) => (
            <div key={col} className="overflow-hidden rounded-md border border-border">
              <div className="h-9 animate-pulse bg-muted/60" />
              {Array.from({ length: 3 }, (_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5 last:border-0"
                >
                  <div className="h-4 w-10 animate-pulse rounded bg-muted" />
                  <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 空态 */}
      {!loading && isEmpty && <EmptyState>回收站是空的</EmptyState>}

      {/* 分栏：实体 / 大纲节点（md 双列，窄屏堆叠） */}
      {data !== null && !isEmpty && (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {/* 实体栏 */}
          <div className="overflow-hidden rounded-md border border-border">
            <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">
              实体 ({data.entities.length})
            </div>
            {data.entities.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">暂无实体</p>
            ) : (
              <ul className="divide-y divide-border/70">
                {data.entities.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                    <TypeBadge label={ENTITY_TYPE_LABEL[item.type]} />
                    <span
                      className="min-w-0 flex-1 truncate text-sm text-foreground"
                      title={item.name}
                    >
                      {item.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(item.deletedAt)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="xs"
                        type="button"
                        onClick={() => void handleRestoreEntity(item)}
                      >
                        还原
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        type="button"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => setPurgeTarget({ kind: "entity", item })}
                      >
                        彻底删除
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 节点栏 */}
          <div className="overflow-hidden rounded-md border border-border">
            <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">
              大纲节点 ({data.nodes.length})
            </div>
            {data.nodes.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">暂无节点</p>
            ) : (
              <ul className="divide-y divide-border/70">
                {data.nodes.map((node) => (
                  <li key={node.id} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <TypeBadge label={NODE_TYPE_LABEL[node.type]} />
                      <span
                        className="min-w-0 flex-1 truncate text-sm text-foreground"
                        title={node.title}
                      >
                        {node.title}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelativeTime(node.deletedAt)}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="xs"
                          type="button"
                          onClick={() => void handleRestoreNode(node)}
                        >
                          还原
                        </Button>
                        <Button
                          variant="outline"
                          size="xs"
                          type="button"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => setPurgeTarget({ kind: "node", item: node })}
                        >
                          彻底删除
                        </Button>
                      </div>
                    </div>
                    {/* 409 祖先冲突：行内提示 + 还原祖先快捷按钮（还原成功自动重试当前节点） */}
                    {ancestorConflict?.node.id === node.id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
                        <span className="text-destructive">
                          上级节点《{ancestorConflict.ancestorName}》也在回收站，请先还原上级
                        </span>
                        <Button
                          variant="outline"
                          size="xs"
                          type="button"
                          className="border-destructive/40 text-destructive hover:bg-destructive/10"
                          onClick={() => void handleRestoreAncestor()}
                        >
                          还原上级《{ancestorConflict.ancestorName}》
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* purge 二次确认（danger + 「确认彻底删除」文案；影响范围说明，trash.md 44-49 行 MVP 语义） */}
      {purgeTarget && (
        <ConfirmDialog
          title="彻底删除"
          description={
            purgeTarget.kind === "entity"
              ? `将彻底删除《${purgeTarget.item.name}》（${ENTITY_TYPE_LABEL[purgeTarget.item.type]}）及其关联关系、变更记录，不可恢复。`
              : `将彻底删除《${purgeTarget.item.title}》及整棵子树、关联关系、变更记录，不可恢复。`
          }
          confirmLabel="确认彻底删除"
          danger
          onConfirm={handlePurgeConfirm}
          onClose={() => setPurgeTarget(null)}
        />
      )}
    </section>
  );
}
