// 书名校验纯函数（UX2 抽取）：新建项目 / 导入备份共用同一规则
// 规则来源：Sidebar L3（oracle U3 审核）——buildBookPath 直接拼目录名，书名含路径分隔符（/ \）、
//   纯点段（. / ..）或控制字符可逃出 books/ 目录；空名无意义。客户端快速反馈，服务端同款校验兜底。
// 返回 null = 合法；否则返回错误文案（直接用于内联提示）。
export function validateBookName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "请输入书名";
  if (/[\\/]|^\.+$|[\u0000-\u001f]/.test(trimmed)) return "书名不能包含 /、\\ 或为 . / ..";
  return null;
}
