// 参考资料文件服务（决策 43，批次十一）
//
// 单一事实来源：doc/design/decisions.md 决策 43、doc/ui/pages/references.md。
// 职责：references/ 目录（项目文件夹内自包含）的读写/原子写/移动（软删 .trash/）/物理删，
//   + 扫描重建索引（文件 = 真相源，DB 索引 = 派生镜像，mtime 快照比对）。
// 同步方案（决策 43，与用户确认）：
//   - 应用内编辑：先原子写文件再更新 DB（文件写失败 → 操作报错 DB 不动；DB 失败 → 文件已写，
//     scan 以文件为准自愈——文件可重建 DB 而 DB 不可重建文件）
//   - 外部编辑/新增/删除：scan 幂等全量比对——「已索引跳过」= 索引存在 且 文件 mtime === 索引
//     file_mtime；mtime 不一致 → 以文件为准重新解析 frontmatter + 正文更新索引
//   - 软删：文件移 references/.trash/ + 索引 deleted_at；restore 移回；purge 物理删
// 依赖方向：本模块只依赖 shared 纯函数与 db 包实体查询（getEntity/updateEntity/softDeleteEntity/
//   restoreEntity——scan 用），不依赖 route/middleware（避免循环依赖）。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, openSync, fsyncSync, closeSync } from "node:fs";
import { join } from "node:path";
import {
  parseReferenceFrontmatter,
  serializeReferenceFile,
} from "@whispering233/ai-editor-shared";
import {
  createEntity,
  getEntity,
  nowIso,
  restoreEntity,
  softDeleteEntity,
  updateEntity,
  type Db,
} from "@whispering233/ai-editor-db";
import type { EntityRow, ReferenceTypeValue } from "@whispering233/ai-editor-shared";

/** 参考资料目录（项目根下，决策 43：书籍项目文件夹自包含参考资料） */
export const REFERENCE_DIR = "references";

/** 软删回收目录（references/.trash/，决策 43：软删文件移入，restore 移回、purge 物理删） */
export const REFERENCE_TRASH_DIR = ".trash";

/** 文件 mtime 比对容差（毫秒）：**仅防御 ISO 毫秒截断 roundtrip**（mtimeMs 浮点 → toISOString
 * 毫秒截断 → getTime 可能差亚毫秒）。与备份体系 1s 容差语义相反——备份容差防「mtime 未刷新
 * 误判有变更」，scan 容差过大会**漏检真实外部修改**（1s 内的改动检测不到），故取最小值。
 * 应用内写入：writeFileAtomic 后 stat 与 scan 读取的 mtime 必然一致（同一文件），严格相等即可。 */
export const REFERENCE_MTIME_TOLERANCE_MS = 2;

/** 原子写（决策 11 同款：临时文件 + fsync + rename；参考资料 md 文件同样禁止直接覆盖） */
export function writeFileAtomic(filePath: string, data: string): void {
  const tmp = `${filePath}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, data, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, filePath);
}

/** 确保 references/ 与 references/.trash/ 存在（幂等） */
export function ensureReferenceDirs(root: string): void {
  mkdirSync(join(root, REFERENCE_DIR), { recursive: true });
  mkdirSync(join(root, REFERENCE_DIR, REFERENCE_TRASH_DIR), { recursive: true });
}

/** 生成不冲突文件名：`<base>.md` 已存在 → `<base> (N).md`（N 最小正整数，沿用「书名 (N)」先例） */
export function uniqueFileNameIn(dir: string, base: string): string {
  let name = `${base}.md`;
  let n = 2;
  while (existsSync(join(dir, name))) {
    name = `${base} (${n}).md`;
    n += 1;
  }
  return name;
}

/** 写参考文件（frontmatter + 正文，原子写）；返回 { fileName（调用方已唯一化）, mtime（ISO） } */
export function writeReferenceFile(
  root: string,
  fileName: string,
  meta: { title: string; category: ReferenceTypeValue; tags: string[]; extraLines?: readonly string[] },
  body: string,
): { fileName: string; mtime: string } {
  ensureReferenceDirs(root);
  writeFileAtomic(join(root, REFERENCE_DIR, fileName), serializeReferenceFile({ ...meta, body }));
  return { fileName, mtime: new Date(statSync(join(root, REFERENCE_DIR, fileName)).mtimeMs).toISOString() };
}

/** 解析后的参考文件（meta + body + mtime） */
export interface ParsedReferenceFile {
  title: string | undefined;
  category: ReferenceTypeValue | undefined;
  tags: string[];
  body: string;
  /** 未知 frontmatter 行（外部编辑器自定义字段，序列化时原样保留） */
  extraLines: string[];
  /** 文件 mtime（ISO，毫秒精度） */
  mtime: string;
  /** mtime 毫秒数值（scan 容差比对用） */
  mtimeMs: number;
}

/** 读参考文件并解析 frontmatter；文件缺失 → null */
export function readReferenceFile(root: string, fileName: string): ParsedReferenceFile | null {
  const full = join(root, REFERENCE_DIR, fileName);
  if (!existsSync(full)) return null;
  const text = readFileSync(full, "utf8");
  const parsed = parseReferenceFrontmatter(text);
  const st = statSync(full);
  return {
    title: parsed.title,
    category: parsed.category as ReferenceTypeValue | undefined,
    tags: parsed.tags,
    body: parsed.body,
    extraLines: parsed.extraLines,
    mtime: new Date(st.mtimeMs).toISOString(),
    mtimeMs: st.mtimeMs,
  };
}

/** 软删移动：references/<fileName> → references/.trash/<唯一名>；返回实际文件名（冲突递增） */
export function moveReferenceToTrash(root: string, fileName: string): string {
  ensureReferenceDirs(root);
  const trashDir = join(root, REFERENCE_DIR, REFERENCE_TRASH_DIR);
  const base = fileName.replace(/\.md$/, "");
  const target = uniqueFileNameIn(trashDir, base);
  renameSync(join(root, REFERENCE_DIR, fileName), join(trashDir, target));
  return target;
}

/** 还原移动：references/.trash/<fileName> → references/<唯一名>；返回实际文件名（冲突递增）；
 * .trash/ 下文件缺失 → 返回 null（外部已清理——仅还原索引，详情读取时 409 REFERENCE_FILE_MISSING） */
export function restoreReferenceFromTrash(root: string, fileName: string): string | null {
  ensureReferenceDirs(root);
  const trashFile = join(root, REFERENCE_DIR, REFERENCE_TRASH_DIR, fileName);
  if (!existsSync(trashFile)) return null;
  const base = fileName.replace(/\.md$/, "");
  const target = uniqueFileNameIn(join(root, REFERENCE_DIR), base);
  renameSync(trashFile, join(root, REFERENCE_DIR, target));
  return target;
}

/** 物理删参考文件（references/ 与 references/.trash/ 都尝试；缺失忽略——幂等） */
export function removeReferenceFile(root: string, fileName: string): void {
  for (const dir of [REFERENCE_DIR, join(REFERENCE_DIR, REFERENCE_TRASH_DIR)]) {
    const full = join(root, dir, fileName);
    if (existsSync(full)) rmSync(full);
  }
}

/** references/ 顶层 md 文件列表（排除 .trash/；不含子目录——YAGNI） */
export function listReferenceFiles(root: string): string[] {
  const dir = join(root, REFERENCE_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
}

/** 实体行 → reference data 解析（data 坏 JSON 防御由 rowToEntityRow 兜底） */
function referenceDataOf(row: EntityRow): Record<string, unknown> {
  return (row.data ?? {}) as Record<string, unknown>;
}

/** 扫描结果统计（决策 43：幂等全量比对） */
export interface ScanReferenceResult {
  added: number;
  updated: number;
  restored: number;
  removed: number;
  skipped: number;
  errors: string[];
}

/**
 * 扫描重建参考资料索引（POST /api/v1/reference/scan，endpoints.md）。
 * 规则（决策 43 + 2026-08 修订：软删文件归 .trash/，references/ 下缺失即视为外部删除）：
 *   1. 遍历 references/ 顶层 *.md（排除 .trash/）：
 *      - 非软删索引匹配（kind='file' 且 file_name === 文件名）→ mtime 一致（容差内）跳过；
 *        不一致 → 以文件为准更新（title/category/tags/content/file_mtime/updated_at）
 *      - 软删索引匹配 → 还原（deleted_at=NULL，文件留 references/ 原地）+ 更新数据
 *      - 无匹配 → 新建（title=frontmatter title ?? 文件名去扩展名、category ?? material）
 *   2. 反向：非软删 file 类索引，references/ 下对应文件缺失 → 索引同步软删（进回收站可还原）
 * 幂等：重复执行无副作用；只处理顶层文件。
 */
export function scanReferences(root: string, db: Db): ScanReferenceResult {
  const result: ScanReferenceResult = { added: 0, updated: 0, restored: 0, removed: 0, skipped: 0, errors: [] };
  ensureReferenceDirs(root);

  // 现有 file 类索引（含软删——还原判定用）：原始 SQL 读取（listEntities 无 data 完整字段）
  const rows = db
    .prepare("SELECT id, name, data, deleted_at FROM entities WHERE type = 'reference'")
    .all() as Array<{ id: string; name: string; data: string; deleted_at: string | null }>;
  const liveIndex = new Map<string, { id: string; name: string; data: Record<string, unknown> }>(); // file_name → 非软删
  const softDeletedIndex = new Map<string, { id: string; name: string; data: Record<string, unknown> }>(); // file_name → 软删
  for (const r of rows) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(r.data) as Record<string, unknown>;
    } catch {
      continue; // 坏行防御（rowToEntityRow 同款语义，scan 跳过不阻塞）
    }
    if (data.kind !== "file" || typeof data.file_name !== "string") continue;
    if (r.deleted_at === null) liveIndex.set(data.file_name, { id: r.id, name: r.name, data });
    else softDeletedIndex.set(data.file_name, { id: r.id, name: r.name, data });
  }

  // 1. 正向：文件 → 索引
  for (const fileName of listReferenceFiles(root)) {
    const file = readReferenceFile(root, fileName);
    if (file === null) continue; // 竞态（读取间被删）→ 下一轮 scan 处理
    const live = liveIndex.get(fileName);
    if (live !== undefined) {
      // mtime 容差比对：一致跳过
      const stored = typeof live.data.file_mtime === "string" ? new Date(live.data.file_mtime).getTime() : NaN;
      if (!Number.isNaN(stored) && Math.abs(file.mtimeMs - stored) <= REFERENCE_MTIME_TOLERANCE_MS) {
        result.skipped += 1;
        continue;
      }
      applyFileToIndex(db, live.id, file, fileName);
      result.updated += 1;
      continue;
    }
    const soft = softDeletedIndex.get(fileName);
    if (soft !== undefined) {
      // 软删索引 + 文件回归 references/ → 还原 + 更新
      restoreEntity(db, "reference", soft.id);
      applyFileToIndex(db, soft.id, file, fileName);
      result.restored += 1;
      continue;
    }
    // 无匹配 → 新建（title/category 兜底）
    const title = file.title ?? fileName.replace(/\.md$/, "");
    const category = file.category ?? "material";
    const data = {
      kind: "file",
      file_name: fileName,
      file_mtime: file.mtime,
      type: category,
      content: file.body,
      ...(file.tags.length > 0 ? { tags: file.tags } : {}),
    };
    createEntity(db, { type: "reference", name: title, data });
    result.added += 1;
  }

  // 2. 反向：非软删 file 类索引，references/ 下文件缺失 → 软删
  const files = new Set(listReferenceFiles(root));
  for (const [fileName, live] of liveIndex) {
    if (!files.has(fileName)) {
      softDeleteEntity(db, live.id, nowIso());
      result.removed += 1;
    }
  }

  return result;
}

/** 以文件为准更新索引（name + data 浅合并：title/category/tags/content/file_mtime） */
function applyFileToIndex(
  db: Db,
  id: string,
  file: ParsedReferenceFile,
  fileName: string,
): void {
  updateEntity(db, id, {
    name: file.title ?? fileName.replace(/\.md$/, ""),
    data: {
      type: file.category ?? "material",
      content: file.body,
      file_mtime: file.mtime,
      ...(file.tags.length > 0 ? { tags: file.tags } : {}),
    },
  });
}

/** 读取实体的 reference data（不存在 → null；**含软删**——trash restore/purge 分支用，
 * getEntity 过滤 deleted_at 读不到软删实体）；用于 route 层 kind 分支判定 */
export function getReferenceRowAny(db: Db, id: string): { row: EntityRow; data: Record<string, unknown> } | null {
  const raw = db.prepare("SELECT * FROM entities WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (raw === undefined) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(typeof raw.data === "string" ? raw.data : "{}") as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { row: raw as unknown as EntityRow, data };
}

/** 读取实体的 reference data（不存在/已软删 → null；用于 route 层 kind 分支判定） */
export function getReferenceRow(db: Db, id: string): { row: EntityRow; data: Record<string, unknown> } | null {
  const row = getEntity(db, id);
  if (row === null) return null;
  return { row, data: referenceDataOf(row) };
}
