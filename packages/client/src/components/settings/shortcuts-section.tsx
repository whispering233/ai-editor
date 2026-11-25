// 设置页「快捷键」tab（纯说明页：无可交互控件、不拉数据）
// 契约 = DESIGN.md §设置页「快捷键」区：SectionCard + section-title + caption-text + data-row 行语言，
// 组合键走中性徽标 TypeChip（不新增视觉语言）；键位与说明来自 lib/shortcuts.ts 的清单。
// 平台化：Apple = ⌘ / 其余 = Ctrl；SSR（无 navigator）按非 Apple 渲染。
// 桌面专属条目（界面缩放）按 `desktopBridge()` 非空过滤——浏览器形态不展示，与「通用」tab 同口径。
import { SectionCard } from "../ui/section-card";
import { TypeChip } from "../ui/tag-chip";
import { desktopBridge } from "../../lib/desktop";
import { formatShortcutKey, isApplePlatform, SHORTCUTS } from "../../lib/shortcuts";

export function ShortcutsSection() {
  const apple = isApplePlatform(typeof navigator === "undefined" ? "" : navigator.userAgent);
  const isDesktop = desktopBridge() !== null;
  const items = SHORTCUTS.filter((item) => !item.desktopOnly || isDesktop);
  return (
    <SectionCard title="快捷键">
      <p className="mb-2 text-xs text-muted-foreground">以下快捷键在应用内任意页面生效</p>
      <ul>
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 border-b border-border/50 py-2 last:border-b-0"
          >
            <TypeChip className="shrink-0">{formatShortcutKey(item.key, apple, item.shift)}</TypeChip>
            <span className="text-sm">{item.description}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
