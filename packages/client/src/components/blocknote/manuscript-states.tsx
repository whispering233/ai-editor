// 章正文页的两个整页状态（卡 12.5）：页容器按错误码分流后渲染——
// ① 404 态（章不存在 / 已软删，写法同 OutlineDetail）；② 加载失败态（错误文案 + 重试）。
// 拆成 presenter（纯 props、无请求）以便 SSR 走查：仓内无 jsdom，页面容器渲染依赖 effect 后的状态。
import { Button } from "antd";
import { EmptyState } from "@/components/ui/empty-state";
import { navigate } from "@/hooks/use-route";

/** 章不存在或已被软删（GET/PUT 404 OUTLINE_NODE_NOT_FOUND） */
export function ManuscriptMissing() {
  return (
    <section>
      <EmptyState
        padding="lg"
        action={
          <div className="flex justify-center gap-2">
            <a
              href="#/trash"
              className="rounded-md border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            >
              去回收站
            </a>
            <Button onClick={() => navigate("/outline")}>返回大纲</Button>
          </div>
        }
      >
        该章不存在或已被删除
      </EmptyState>
    </section>
  );
}

/** 正文加载失败（网络层 / 非章节点等：展示服务端文案 + 重试） */
export function ManuscriptLoadFailure({
  message,
  onRetry,
}: {
 /** 失败文案（ApiError.message；网络层失败为兜底中文） */
  message: string;
  onRetry: () => void;
}) {
  return (
    <section>
      <EmptyState
        padding="lg"
        action={<Button onClick={onRetry}>重试</Button>}
      >
        正文加载失败
        <span className="mt-1 block text-xs text-muted-foreground/70">{message}</span>
      </EmptyState>
    </section>
  );
}
