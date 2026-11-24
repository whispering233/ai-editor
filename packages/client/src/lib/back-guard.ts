// 后退守卫（C2）：详情表单 dirty 时按浏览器后退，不再静默丢弃修改。
// 机制 = **哨兵历史条目**：dirty 期间 pushState 一条**同 URL** 条目，用户后退先落到它（URL 不变、
// 路由不动）；在这里问一句——取消 → 再 push 一条哨兵复位，确认 → 真正 `history.back()`。
// 实测次序（Chromium 实测，见任务卡汇报）：pushState(同 URL) 不触发任何事件；退到同 URL 条目只有
// popstate（**无 hashchange** ⇒ `useHashRoute` 不会被误判）；退到不同 hash 时 popstate 先于 hashchange。
// 状态只有两个：
// - armed = 哨兵是不是还挂在当前位置（是 ⇒ 下一次 popstate 就是我们拦的那次后退）
// - suppressed = 自己那次 `back()` 的回声 popstate 还没到（到了就吞掉，不重复问 / 不重复退）
// 纯逻辑 + 注入历史操作 ⇒ 真值表可单测（`back-guard.test.ts`）；接线见 hooks/use-back-guard。

/** 守卫需要的历史操作（`window.history` 的窄化，测试注入假实现） */
export interface BackGuardHistory {
  /** 同 URL pushState 一条哨兵（带状态戳，供 `onSentinel` 识别） */
  pushSentinel(): void;
  /** 当前条目是否就是哨兵——「退一条」只在确认是它时才安全（URL 不变） */
  onSentinel(): boolean;
  /** 真正后退一条 */
  back(): void;
}

export interface BackGuard {
  /** dirty 变化：变脏挂哨兵（已挂不重复）；变干净撤哨兵（哨兵没有理由继续拦后退） */
  setDirty(dirty: boolean): void;
  /** popstate 到达（同一函数实例直接当事件监听用） */
  handlePopState(): void;
  /** 卸载：撤哨兵并丢弃状态，在途确认落地后也不再动历史 */
  reset(): void;
}

export function createBackGuard(
  history: BackGuardHistory,
  confirmDiscard: () => Promise<boolean>,
): BackGuard {
  let armed = false;
  let suppressed = false;
  let disposed = false;

  /** 挂哨兵；重新挂时清抑制标志（上一条哨兵没等到回声时它会残留） */
  function arm(): void {
    if (disposed || armed) return;
    armed = true;
    suppressed = false;
    history.pushSentinel();
  }

  /** 撤哨兵：只有「当前条目就是哨兵」时退一条才安全（落点 URL 不变）；
   * 已经不在哨兵上（期间有新导航压栈）就留着，让下一次后退自然消费掉 */
  function disarm(): void {
    if (!armed) return;
    armed = false;
    if (!history.onSentinel()) return;
    suppressed = true; // 这次 back() 的回声不当作后退处理
    history.back();
  }

  return {
    setDirty(dirty) {
      if (!dirty) {
        disarm();
        return;
      }
      arm();
    },
    handlePopState() {
      if (disposed) return;
      if (suppressed) {
        suppressed = false;
        return;
      }
      if (!armed) return; // 没有哨兵：不是我们拦的那次后退（前进 / 守卫未覆盖的历史操作）
      armed = false; // 哨兵被这次后退消费掉了；在途期间的第二次 popstate 因 armed=false 被忽略
      void confirmDiscard().then((ok) => {
        if (disposed) return;
        if (!ok) {
          arm(); // 取消：重新 push 哨兵复位（URL 全程未变）
          return;
        }
        suppressed = true; // 自己那次 back() 不得再弹框
        history.back();
      });
    },
    reset() {
      disarm(); // 监听已由调用方移除 ⇒ 这次 popstate 没人接，URL 不变
      disposed = true;
    },
  };
}