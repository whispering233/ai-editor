// 「设为阅读进度」唯一提交实现（卡片 1.1：详情页按钮 + 大纲行右键菜单共用）
//
// 语义：PUT /project/config { current_position }——store updateConfig 成功后自动重拉 config，
// 联动 InfoBar「阅读进度」/ 大纲行尾徽标 / 概览页 / compute 预览默认节点 / 伏笔健康指标基准。
// 服务端只接受**章节点**（卷/场景 → 400），调用方负责入口可见性（仅章行/章页提供入口）。
//
// 成功/失败 toast 收敛于此（两处入口文案一致，避免各写一份漂移）；
// 返回 boolean 供调用方决定后续（当前无用例分支，保留可判定结果）。
// **不做**防重入：调用方持有各自的提交态（详情页 settingCurrent / 右键菜单点后即关）。
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";
import type { OutlineNodeType } from "./api";

/**
 * 节点层级是否可承载「阅读进度」（卡片 1.1 章级收窄：仅章）——卷太粗、场景太碎，
 * 写作进度只落在章上。两个入口（详情页按钮 / 大纲行右键菜单）共用本判据，
 * 与服务端 `PUT /project/config` 校验同口径（UI 同向收窄，不留必定 400 的入口）。
 */
export function isCurrentPositionHost(nodeType: OutlineNodeType): boolean {
  return nodeType === "chapter";
}

/** 设为阅读进度；成功 → 「已设为阅读进度」，失败 → 泛化错误提示（节点已删/服务端拒绝/网络） */
export async function setCurrentPosition(nodeId: string): Promise<boolean> {
  try {
    await useProjectStore.getState().updateConfig({ current_position: nodeId });
    useUiStore.getState().showToast("已设为阅读进度");
    return true;
  } catch {
    useUiStore.getState().showToast("设置失败：该节点可能已删除，无法设为阅读进度", "error");
    return false;
  }
}
