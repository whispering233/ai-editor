// 数据版本订阅 hook（交互批次，问题 1）：中栏数据页面统一订阅 ui store 的 dataVersion，
// AI 提案确认写库 / InfoBar 刷新按钮触发后调用 onChange 重拉各自数据。
// 首帧守卫：ref 记录「已消费的版本」并在挂载时同步为当前值（dataVersion 初始 0），
// 之后仅真实变化（+1）触发——避免页面挂载时的重复拉取（页面自身的挂载加载已承担首拉）。
// 注意：onChange 为调用方闭包（页面重载函数，每次渲染重建），effect 仅依赖 dataVersion——
// 本仓库无 react-hooks/exhaustive-deps 规则，且按「版本变化才触发」语义依赖即正确
import { useEffect, useRef } from "react";
import { useUiStore } from "../stores/ui";

export function useDataRefresh(onChange: () => void): void {
  const dataVersion = useUiStore((s) => s.dataVersion);
  const lastVersion = useRef(dataVersion);

  useEffect(() => {
    if (dataVersion === lastVersion.current) return;
    lastVersion.current = dataVersion;
    onChange();
  }, [dataVersion]);
}
