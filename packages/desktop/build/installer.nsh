; 卸载时的「清除使用数据」选项（electron-builder 的 customUnInstall 钩子）。
;
; 背景：NSIS 卸载器默认只删程序文件——书库（书籍 / 备份 / 对话历史）与 `%APPDATA%\AI Editor`
; （desktop.json、日志、Chromium 缓存）都会留在盘上。这里在卸载前问一次，**默认「否」**（保留），
; 用户明确点「是」才清。
;
; 为什么只扫默认候选目录而不读 desktop.json：书库路径由 `desktop.json` 记录、可能被用户改到任意位置，
; 而 NSIS 读 UTF-8 JSON 会有编码坑、用 PowerShell 回传中文路径同样不稳。取舍是——
; **默认位置（= 应用首次启动的候选链产物）全清**，自定义位置在提示里明确告知需手动删除
;（应用内「设置 → 通用 → 书库位置」随时可看到真实路径）。
; $DOCUMENTS 在 OneDrive「已知文件夹移动」下也会指向重定向后的目录，故它与显式的 OneDrive 项互为兜底。

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 \
    "是否同时清除 AI Editor 的使用数据？$\r$\n$\r$\n将删除（若存在）：$\r$\n  • 书籍、备份、对话历史：$DOCUMENTS\AI Editor$\r$\n  • 另一可能的书库位置：$PROFILE\AI Editor$\r$\n  • 设置、日志、缓存：$APPDATA\AI Editor$\r$\n$\r$\n注意：若你曾在「设置 → 通用 → 书库位置」把书库改到别处，那部分数据不会被自动删除。$\r$\n$\r$\n删除后无法恢复。选择「否」则全部保留（重新安装后可继续使用）。" \
    IDNO ai_editor_keep_data

  RMDir /r "$DOCUMENTS\AI Editor"
  RMDir /r "$PROFILE\OneDrive\Documents\AI Editor"
  RMDir /r "$PROFILE\AI Editor"
  RMDir /r "$APPDATA\AI Editor"

  ai_editor_keep_data:
!macroend
