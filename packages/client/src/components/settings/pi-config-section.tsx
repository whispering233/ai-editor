// 设置页「高级」tab 的内容壳：pi 配置目录 + 本机配置文件编辑器（docs/design/tasks.md 卡 4/5）
//
// 独立成一个组件而不是把两块直接写进 Settings.tsx：编辑器的挂载点只有这一处，
// 新增面板不必再改页面壳（页面壳只负责 tab 表）。
import { ConfigFileEditor } from "./config-file-editor";
import { PiDirPanel } from "./pi-dir-panel";

export function PiConfigSection() {
  return (
    <div className="flex flex-col gap-3">
      <PiDirPanel />
      <ConfigFileEditor />
    </div>
  );
}