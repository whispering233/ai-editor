// 应用级错误边界（交互批次，问题 3）：防止渲染异常导致整页白屏
// 背景：用户实测「点击新会话后整个页面变空白」——无 ErrorBoundary 时 React 渲染异常会
// 卸载整棵组件树（#root 清空 = 白屏）。代码走查 ChatPanel 新会话路径（setCurrentSession(null)
// → 清空 messages/proposals/streamTools → 空态渲染）未发现静态可见的崩溃点（各渲染分支均有
// 空值守卫、zustand selector 均为字段级引用），但渲染异常可能来自版本/环境相关的组件内部
// （Base UI 菜单等），本地工具应用加轻量 ErrorBoundary 兜底是低成本高价值的：异常时展示
// 可恢复的错误卡（错误信息 + 重新加载 / 回到首页），而不是无提示白屏。
// 实现约束：错误边界必须是 class 组件（React 对函数组件无 componentDidCatch）；
// 样式用 token 类（layout.md §3，oracle 红线：禁止硬编码色类）
import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  /** 渲染异常信息（null = 无异常） */
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 异常上抛给全局（浏览器控制台可见原始堆栈，便于排查），UI 侧由本组件承接
    console.error("[ErrorBoundary] 渲染异常:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-8">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-8 py-6 text-center">
          <CircleAlert className="size-8 text-destructive" />
          <p className="font-serif text-base font-medium text-foreground">界面出现异常</p>
          <p className="max-w-md text-sm text-muted-foreground">
            数据不会丢失，请重新加载页面继续写作。
          </p>
          <p className="max-w-md break-all font-mono text-xs text-destructive/80">
            {error.message || String(error)}
          </p>
          <div className="mt-2 flex gap-2">
            <Button type="button" onClick={() => window.location.reload()}>
              <RotateCcw className="size-4" />
              重新加载
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                // 回到首页：重置 hash 后 reload 完整恢复（仅重置 hash 可能仍落在异常路由上）
                window.location.hash = "#/";
                window.location.reload();
              }}
            >
              回到首页
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
