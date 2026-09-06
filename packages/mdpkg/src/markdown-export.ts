// Markdown 导出（export-formats D1）：展开后单文件，符号保持源文本
// 语义与 CLI `export --expanded` 同源：include 内联 + 相对路径按包根重写（复用 expand 中间产物）。
// 符号不转换——导出的是 Markdown 源（`(tm)` 保持 `(tm)`），符号转换是渲染期行为（render.ts）。
// 跨端：无 Node API（TextDecoder 为 Web 标准，浏览器/Node 均可用）。
import { expand } from './include.ts';
import { assertMarkdownEntrypoint, inferEntrypoint } from './manifest.ts';
import { MdeError, E } from './errors.ts';

export interface MarkdownExportOptions {
  /** include 展开开关：缺省跟随 manifest.extensions.include（无 manifest 时默认展开）；显式 false 不展开（<<< 降级为可见文本） */
  include?: boolean;
}

/**
 * 导出入口文档的展开后 Markdown 文本（与 CLI `export --md` 同源语义）。
 * 入口解析与 render.ts 完全一致：manifest.entrypoint 优先，否则 lenient 推断（inferEntrypoint）；
 * 无 .md 抛 E303（与 openMdpkg 错误语义一致）。
 * @param files - 包内文件 Map（路径 → 字节）
 * @param opts - 可选：include 展开开关
 */
export function toMarkdown(files: Map<string, Uint8Array>, opts: MarkdownExportOptions = {}): string {
  // 入口解析（与 render.ts :70 同规则）：有 manifest 且含 entrypoint 时走 manifest；否则推断（lenient-open）
  const manifestRaw = files.get('manifest.json');
  let manifest: { entrypoint?: string; extensions?: { include?: boolean }; [k: string]: unknown };
  try { manifest = manifestRaw ? JSON.parse(new TextDecoder().decode(manifestRaw)) : {}; }
  catch (e) { throw new MdeError(E.E302, `manifest.json 不是合法 JSON: ${(e as Error).message}`); }
  const hasManifest = manifestRaw !== undefined;
  const entry: string = hasManifest && manifest.entrypoint ? manifest.entrypoint : inferEntrypoint(files);
  assertMarkdownEntrypoint(entry); // 非 Markdown 入口在此拒绝（E303），与 render.ts 对齐
  const body = files.get(entry);
  if (!body) throw new MdeError(E.E303, `entrypoint 不存在: ${entry}`);
  // include 开关：显式 opts.include 优先；缺省跟随 manifest.extensions.include（无 manifest 时默认展开）
  const includeEnabled = opts.include ?? !(manifest.extensions?.include === false);
  // 展开后文本（include 内联 + 相对路径按包根重写）；符号保持源文本（不转换——导出的是 Markdown 源）
  return includeEnabled ? expand(files, entry).text : new TextDecoder().decode(body);
}