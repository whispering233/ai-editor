// 设置页「高级」tab 的内容壳：pi 配置目录 + 联网搜索 key + 本机配置文件编辑器
// （docs/design/tasks.md 卡 2/4/5；顺序见 docs/ui/DESIGN.md `tab-advanced`）
//
// 独立成一个组件而不是把几块直接写进 Settings.tsx：这些面板的挂载点只有这一处，
// 新增面板不必再改页面壳（页面壳只负责 tab 表）。
import { ConfigFileEditor } from "./config-file-editor";
import { PiDirPanel } from "./pi-dir-panel";
import { SearchKeyPanel } from "./search-key-panel";

export function PiConfigSection() {
  return (
    <div className="flex flex-col gap-3">
      <PiDirPanel />
      <SearchKeyPanel />
      <ConfigFileEditor />
    </div>
  );
}