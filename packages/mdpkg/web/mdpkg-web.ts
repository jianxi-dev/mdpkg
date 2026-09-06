// mdpkg 浏览器端打开器（嵌入 md-bundle 网页工具用）
// 零 Node 依赖：unpack/validate/expand/render/pack 全链路在浏览器可跑（fflate + unified 生态均为纯 JS）。
// 管线与 CLI 一致（规范 §8.1）：解包 → 校验 → include 展开 → 解析 → 符号转换 → 渲染（消毒）→ 内联。
// 支持三种输入形态：
//   .mdpkg / .zip → openMdpkg(bytes)（解包容器；无 manifest 时 lenient 推断入口）
//   .md（单文件直开）→ openMarkdown(name, bytes)（无需打包，include 关闭、<<< 降级为可见文本）
//   任意文件 Map（目录/多条目拖入）→ openFiles(files)（lenient 渲染统一入口，include 缺省展开）
// 编辑闭环：
//   const r = await openMdpkg(bytes);
//   // 修改 r.files 中对应 Uint8Array（不要直接改 manifest.json 文本）
//   const out = packMdpkg(r.files, r.manifest ?? undefined);
//   // out 即为新的 .mdpkg 字节流，可交给浏览器下载
import { unpack, toBase64, pack } from '../src/zip-core.ts';
import { validatePackage, buildManifest, checkClosure, inferEntrypoint, type Manifest, type ValidationResult, DEFAULT_ENTRYPOINT } from '../src/manifest.ts';
import { render as renderMarkup, wrapDocument } from '../src/render.ts';
import { toMarkdown } from '../src/markdown-export.ts';
import { toDocx } from '../src/docx.ts';
import { buildZipExport, type ZipExportOptions } from '../src/zip-export.ts';
import { expand } from '../src/include.ts';
import { MdeError, E } from '../src/errors.ts';

export interface OpenOptions {
  /** 符号扩展开关（默认 true，跟随 manifest.extensions.symbols） */
  symbols?: boolean;
}

export interface OpenResult {
  files: Map<string, Uint8Array>;
  manifest: Manifest | null;
  validation: ValidationResult;
  /** 完整自包含 HTML 文档（含 <!doctype> 与内联样式） */
  html: string | null;
  /** 渲染是否发生降级（包过大时 auto 降级 dir，浏览器端无文件系统，仅作提示） */
  degraded: boolean;
  /** 渲染阶段错误（校验错误见 validation.errors） */
  error: string | null;
  /** 来源未校验（缺少 manifest.json、按规则推断入口）——与 degraded 维度不同：degraded=体积降级，unverified=来源未校验 */
  unverified: boolean;
  /** 实际采用的入口路径：有 manifest 且含 entrypoint 时取其值，否则为 inferEntrypoint 推断结果；错误分支（inferEntrypoint 抛 E303）时为空串 '' */
  entry: string;
}

/** 共享渲染核心：renderMarkup(inline:true) 的薄封装——openMdpkg / openMarkdown / openFiles 三入口共用 */
function renderMap(files: Map<string, Uint8Array>, opts: { symbols?: boolean; include?: boolean }): { html: string; degraded: boolean } {
  const r = renderMarkup(files, { inline: true, symbols: opts.symbols, include: opts.include });
  return { html: r.html, degraded: r.degraded };
}

/**
 * Map → OpenResult 的完整组装（openMdpkg 的「解包之后」段，三入口共用）：
 * manifest 读取 → unverified 判定 → validatePackage → 入口解析（manifest.entrypoint 优先，否则 inferEntrypoint，try/catch → ''）
 * → renderMap 渲染 → wrapDocument(title=入口 basename)；渲染错误走 error 字段不抛。
 */
function renderPackage(files: Map<string, Uint8Array>, opts: { symbols?: boolean; include?: boolean }): OpenResult {
  let manifest: Manifest | null = null;
  const manifestRaw = files.get('manifest.json');
  if (manifestRaw) {
    try { manifest = JSON.parse(new TextDecoder().decode(manifestRaw)); } catch { manifest = null; }
  }
  const unverified = manifestRaw === undefined;

  const validation = validatePackage(files);

  // 与 render.ts :62 同规则：manifest.entrypoint 优先，否则 inferEntrypoint 推断
  const hasManifest = manifestRaw !== undefined;
  const resolvedEntry: string = hasManifest && manifest?.entrypoint ? manifest.entrypoint : (() => {
    try { return inferEntrypoint(files); } catch { return ''; }
  })();

  try {
    const r = renderMap(files, { symbols: opts.symbols, include: opts.include });
    const title = resolvedEntry.split('/').pop() ?? resolvedEntry;
    return {
      files, manifest, validation,
      html: wrapDocument(title, r.html),
      degraded: r.degraded,
      error: null,
      unverified,
      entry: resolvedEntry,
    };
  } catch (e) {
    return {
      files, manifest, validation,
      html: null,
      degraded: false,
      error: e instanceof MdeError ? e.message : String(e),
      unverified,
      entry: resolvedEntry,
    };
  }
}

/** 打开 .mdpkg：解包 → 校验 → 渲染。任何一步硬错误（非 ZIP 等）直接 throw MdeError */
export async function openMdpkg(bytes: Uint8Array, opts: OpenOptions = {}): Promise<OpenResult> {
  const files = await unpack(bytes);
  if (files.size === 0) throw new MdeError(E.E101, '不是有效的 ZIP 包（0 个条目）');
  return renderPackage(files, opts);
}

export interface OpenFilesOptions extends OpenOptions {
  /** include 展开开关：缺省 undefined 跟随 render 默认（无 manifest 时展开）；显式 false 不展开（<<< 降级为可见文本） */
  include?: boolean;
}

/**
 * 任意文件 Map 的 lenient 渲染统一入口（目录/多条目拖入、上传目录等场景）：
 * 入口推断（manifest.entrypoint 优先，否则 inferEntrypoint，失败 → ''）→ 校验 → 渲染（图片 data URI 内联）→ 包装。
 * 返回结构与 openMdpkg / openMarkdown 完全同构；unverified = Map 无 manifest.json。
 */
export async function openFiles(files: Map<string, Uint8Array>, opts?: OpenFilesOptions): Promise<OpenResult> {
  return renderPackage(files, opts ?? {});
}

/**
 * 直接打开单个 Markdown 文件（.md 直开，无需打包）：构造单文件 Map → 委托 openFiles。
 * 与 openMdpkg 的 OpenResult 完全同构：manifest=null、unverified=true（单文件无 manifest，来源未校验语义与 lenient 一致）。
 * include 关闭（include: false）：单文件无法解析相对 include，命中 <<< 时降级为可见文本而非 E508。
 * @param name - 文件名；非 .md 后缀（如无扩展名文本）回退 document.md 作为入口
 */
export async function openMarkdown(name: string, bytes: Uint8Array, opts: OpenOptions = {}): Promise<OpenResult> {
  const entry = /\.md$/i.test(name) ? name : 'document.md';
  const files = new Map<string, Uint8Array>([[entry, bytes]]);
  return openFiles(files, { ...opts, include: false });
}

/**
 * 导出自包含单文件 HTML（与 openMdpkg().html 完全同源：renderMap + wrapDocument 同一管线）。
 * 入口推断同 openFiles（manifest.entrypoint 优先，否则 inferEntrypoint）；无 .md 抛 E303。
 * 纯导出函数：渲染错误直接抛 MdeError 由调用方处理（与 openMdpkg 的 error 字段承载不同——导出无 OpenResult 结构）。
 * @param files - 包内文件 Map（路径 → 字节）
 * @param opts - 符号扩展开关（默认 true，跟随 manifest.extensions.symbols）
 */
export function toHtml(files: Map<string, Uint8Array>, opts?: OpenOptions): string {
  // 入口解析（与 renderPackage 同规则）：manifest.entrypoint 优先，否则 lenient 推断；无 .md 抛 E303
  const manifestRaw = files.get('manifest.json');
  let manifest: { entrypoint?: string } | null = null;
  if (manifestRaw) {
    try { manifest = JSON.parse(new TextDecoder().decode(manifestRaw)); } catch { manifest = null; }
  }
  const hasManifest = manifestRaw !== undefined;
  const entry: string = hasManifest && manifest?.entrypoint ? manifest.entrypoint : inferEntrypoint(files);
  // 与 openMdpkg().html 同源：renderMap（renderMarkup inline:true 封装）+ wrapDocument(title=入口 basename)
  const r = renderMap(files, { symbols: opts?.symbols });
  const title = entry.split('/').pop() ?? entry;
  return wrapDocument(title, r.html);
}

/**
 * 读取入口 Markdown 原文（include 未展开）。预览源码用。
 * @param entry - 默认值 DEFAULT_ENTRYPOINT（'document.md'）仅适用于标准包；
 *   lenient（无 manifest）包的调用方应传入 openMdpkg 返回的 `entry` 字段以匹配实际入口。
 */
export function readEntrySource(files: Map<string, Uint8Array>, entry = DEFAULT_ENTRYPOINT): string {
  const body = files.get(entry);
  if (!body) throw new MdeError(E.E303, `entrypoint 不存在: ${entry}`);
  return new TextDecoder().decode(body);
}

function readManifest(files: Map<string, Uint8Array>): Manifest | undefined {
  const raw = files.get('manifest.json');
  if (!raw) return undefined;
  try { return JSON.parse(new TextDecoder().decode(raw)); }
  catch { return undefined; }
}

/** 编辑后重新打包。files 中可包含旧的 manifest.json；本函数会将其删除并按规范 §4.2 重建。 */
export function packMdpkg(files: Map<string, Uint8Array>, prevManifest?: Manifest): Uint8Array {
  const work = new Map(files);
  const prev = prevManifest ?? readManifest(work);
  work.delete('manifest.json');
  const manifest = buildManifest(work, prev);
  // 回退不能用 DEFAULT_ENTRYPOINT（'document.md'）——lenient 包可能无 document.md；
  // inferEntrypoint 已覆盖默认名优先 + 任意深度 + 无 .md 抛 E303 语义。
  const entry = manifest.entrypoint ?? inferEntrypoint(work);
  checkClosure(work, entry); // 与 CLI pack 对齐：非 Markdown/缺失入口与残缺引用闭包在此拒绝
  return pack(work, manifest);
}

export { toBase64, expand, MdeError, buildManifest, toDocx, buildZipExport as toZip, toMarkdown };
export type { Manifest, ValidationResult, DocxOptions, ZipExportOptions, MarkdownExportOptions };