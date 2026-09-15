; 卸载时的「清除使用数据」选项（electron-builder 的 customUnInstall 钩子）。
;
; 背景：NSIS 卸载器默认只删程序文件——书库（书籍 / 备份 / 对话历史）与 `%APPDATA%\AI Editor`
; （desktop.json、日志、Chromium 缓存）都会留在盘上。这里在卸载前问一次，**默认「否」**（保留），
; 用户明确点「是」才清。
;
; ⚠ 核心安全约束：**只删「带本应用签名文件」的目录**。
; 书库目录叫 `AI Editor`，用户完全可能早就自己建过同名目录放别的东西——无差别 `RMDir /r`
; 就是不可恢复的误删。签名 = `<书库>\.ai-editor\library.json`（应用每次启动幂等写入，见
; `packages/desktop/src/config.ts` 的 `writeLibraryMarker`）：有这个文件才是本应用用的目录。
;
; 为什么只扫默认候选位置、不解析 desktop.json：书库路径可能被用户改到任意位置，而 NSIS 读
; UTF-8 JSON 有编码坑、用 PowerShell 回传中文路径同样不稳。取舍是——默认位置（= 应用首次
; 启动候选链的产物）能精确判断并清理；自定义位置在提示里明确告知需手动删除（应用内
; 「设置 → 通用 → 书库位置」随时能看到真实路径）。

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 \
    "是否同时清除 AI Editor 的使用数据？$\r$\n$\r$\n将删除（仅限确认属于本应用的目录）：$\r$\n  • 书库：$DOCUMENTS\AI Editor 或 $PROFILE\AI Editor（书籍、备份、对话历史）$\r$\n  • 应用数据：$APPDATA\AI Editor（设置、日志、缓存）$\r$\n$\r$\n判断依据：书库目录下存在本应用的签名文件 .ai-editor\library.json——同名但非本应用创建的目录不会被删除。$\r$\n若你曾在「设置 → 通用 → 书库位置」把书库改到别处，那部分数据也不会被自动删除。$\r$\n$\r$\n删除后无法恢复。选择「否」则全部保留（重新安装后可继续使用）。" \
    IDNO ai_editor_keep_data

  ; —— 书库候选位置：先验签名文件，有才删 ——
  IfFileExists "$DOCUMENTS\AI Editor\.ai-editor\library.json" 0 ai_editor_skip_docs
    RMDir /r "$DOCUMENTS\AI Editor"
  ai_editor_skip_docs:

  IfFileExists "$PROFILE\OneDrive\Documents\AI Editor\.ai-editor\library.json" 0 ai_editor_skip_onedrive
    RMDir /r "$PROFILE\OneDrive\Documents\AI Editor"
  ai_editor_skip_onedrive:

  IfFileExists "$PROFILE\AI Editor\.ai-editor\library.json" 0 ai_editor_skip_profile
    RMDir /r "$PROFILE\AI Editor"
  ai_editor_skip_profile:

  ; —— 应用数据（userData = %APPDATA%\AI Editor）：desktop.json 是本应用写的，作为存在性检查 ——
  IfFileExists "$APPDATA\AI Editor\desktop.json" 0 ai_editor_skip_userdata
    RMDir /r "$APPDATA\AI Editor"
  ai_editor_skip_userdata:

  ai_editor_keep_data:
!macroend
