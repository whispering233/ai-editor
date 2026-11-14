// 会话 store（`stores/writing-session.ts`）：换书归零、关闭后不自动弹、重开显示累计、
// 负增量不扣、项目变化立即归零（不等下一次增量）。契约 = DESIGN.md「当日码字悬浮面板」。
import { beforeEach, describe, expect, it } from "vitest";
import { useWritingSessionStore } from "./writing-session";

const store = useWritingSessionStore;

beforeEach(() => {
  store.setState({
    projectId: null,
    chars: 0,
    typingMs: 0,
    lastEditAt: null,
    visible: false,
    dismissed: false,
    hasAutoOpened: false,
  });
});

describe("recordDelta", () => {
  it("首次正增量自动打开（每个会话只自动弹一次）", () => {
    store.getState().recordDelta("book-a", 10, 1_000);
    expect(store.getState().visible).toBe(true);
    expect(store.getState().hasAutoOpened).toBe(true);
    expect(store.getState().chars).toBe(10);
  });

  it("负增量不扣字数、不自动打开，但仍推进最后变更时刻", () => {
    store.getState().syncProject("book-a");
    store.getState().recordDelta("book-a", -20, 1_000);
    const state = store.getState();
    expect(state.chars).toBe(0);
    expect(state.visible).toBe(false);
    expect(state.lastEditAt).toBe(1_000);
  });

  it("项目变化先归零（不显示旧书数字），且新书重新允许自动弹", () => {
    store.getState().recordDelta("book-a", 100, 1_000);
    store.getState().dismiss();
    store.getState().recordDelta("book-b", 5, 2_000);
    const state = store.getState();
    expect(state.projectId).toBe("book-b");
    expect(state.chars).toBe(5);
    expect(state.visible).toBe(true);
    expect(state.dismissed).toBe(false);
  });
});

describe("syncProject", () => {
  it("换书立即归零并隐藏（不等下一次增量）", () => {
    store.getState().recordDelta("book-a", 500, 1_000);
    store.getState().syncProject("book-b");
    const state = store.getState();
    expect(state.projectId).toBe("book-b");
    expect(state.chars).toBe(0);
    expect(state.typingMs).toBe(0);
    expect(state.lastEditAt).toBeNull();
    expect(state.visible).toBe(false);
    expect(state.hasAutoOpened).toBe(false);
  });

  it("相同项目不动（不闪面板、不清累计）", () => {
    store.getState().recordDelta("book-a", 500, 1_000);
    store.getState().syncProject("book-a");
    expect(store.getState().chars).toBe(500);
    expect(store.getState().visible).toBe(true);
  });

  it("关闭项目（null）归零", () => {
    store.getState().recordDelta("book-a", 500, 1_000);
    store.getState().syncProject(null);
    expect(store.getState().chars).toBe(0);
    expect(store.getState().visible).toBe(false);
  });
});

describe("关闭 / 重开", () => {
  it("点 X 后本次不再自动弹，追踪继续；重开显示累计", () => {
    store.getState().recordDelta("book-a", 100, 1_000);
    store.getState().dismiss();
    expect(store.getState().visible).toBe(false);
    expect(store.getState().dismissed).toBe(true);

    store.getState().recordDelta("book-a", 50, 2_000);
    expect(store.getState().visible).toBe(false); // 不自动弹
    expect(store.getState().chars).toBe(150); // 追踪继续

    store.getState().open();
    expect(store.getState().visible).toBe(true);
    expect(store.getState().chars).toBe(150);
  });

  it("用户主动重开不撤销 dismissed（下次关掉仍不自动弹）", () => {
    store.getState().recordDelta("book-a", 100, 1_000);
    store.getState().dismiss();
    store.getState().open();
    store.getState().recordDelta("book-a", 10, 2_000);
    expect(store.getState().visible).toBe(true);
    store.getState().dismiss();
    store.getState().recordDelta("book-a", 10, 3_000);
    expect(store.getState().visible).toBe(false);
  });
});