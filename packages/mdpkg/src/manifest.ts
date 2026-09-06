// manifest 生成与校验（M2）
// 字段归属表（规范 §4.2）：resources/size/sha256/media_type 每次重算；
// entrypoint/extensions/extensions_required/encoding 有则保留；spec_version 由工具决定，不继承。
import { sha256 as sha256Hex } from 'js-sha256'; // 零依赖同步 SHA-256，浏览器/Node 共用（node:crypto 在浏览器不可用）
import Ajv2020 from 'ajv/dist/2020.js'; // ajv 8 默认只含 draft-07/2019-09；Schema 用 2020-12 必须走此入口（ESM 需带 .js）
import { MdeError, E } from './errors.ts';
import { normalizePath } from './zip-core.ts';
import { resolveRef } from './refpath.ts';
import schema from '../../../spec/schema/manifest-1.0.json' with { type: 'json' };
import { expand } from './include.ts';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';

export const SPEC_VERSION = '1.0';
export const DEFAULT_ENTRYPOINT = 'document.md';

/**
 * 推断入口（lenient-open spec「入口推断规则」）。
 * 无 manifest.json 时按确定性规则选 entrypoint：
 *   document.md > README.md > README.zh-CN.md > 其余 .md 最浅优先（同深度码位序）。
 * 候选排除含隐藏段（任一路径段以 . 开头）的路径；无 .md 抛 E303。
 */
export function inferEntrypoint(files: Map<string, Uint8Array>): string {
  const candidates = [...files.keys()].filter((p) => {
    if (!p.toLowerCase().endsWith('.md')) return false;
    if (p.split('/').some((seg) => seg.startsWith('.'))) return false; // 排除隐藏路径
    return true;
  });

  if (candidates.length === 0) {
    throw new MdeError(E.E303, 'entrypoint 不存在（推断失败）: 无 Markdown 文件');
  }

  const depth = (p: string) => p.split('/').length;
  const shallowest = (paths: string[]) =>
    [...paths].sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0));

  // 默认名全树查找（按文件名匹配，取最浅；同深度取码位先序）
  for (const name of ['document.md', 'README.md', 'README.zh-CN.md']) {
    const matches = candidates.filter((p) => p.split('/').pop() === name);
    if (matches.length > 0) return shallowest(matches)[0];
  }

  // 兜底：全部候选（任意深度）取最浅；同深度按码位字典序（与默认名查找同一语义）。
  // 候选非空即可推断（E303 仅在无任何 .md 时抛出），子目录任意名 md 同样可作入口。
  return shallowest(candidates)[0];
}

const MEDIA: Record<string, string> = {
  md: 'text/markdown', markdown: 'text/markdown', json: 'application/json',
  txt: 'text/plain', csv: 'text/csv',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
};

export function mediaType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MEDIA[ext] ?? 'application/octet-stream';
}

export function sha256(data: Uint8Array): string {
  return sha256Hex(data);
}

export interface Manifest {
  format: 'mdpkg';
  spec_version: string;
  entrypoint?: string;
  encoding?: 'utf-8';
  extensions?: { symbols?: 'off' | 'core' | 'extended'; include?: boolean };
  extensions_required?: string[];
  resources: { path: string; media_type: string; size: number; sha256: string; source_url?: string }[];
}

/** 生成 manifest：机器事实重算，作者意图继承 */
export function buildManifest(files: Map<string, Uint8Array>, prev?: Manifest): Manifest {
  const inheritedUrls = new Map((prev?.resources ?? []).filter((r) => r.source_url).map((r) => [r.path, r.source_url!]));
  const resources = [...files.keys()]
    .map((p) => normalizePath(p))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((path) => {
      const data = files.get(path)!;
      const r: Manifest['resources'][number] = {
        path,
        media_type: mediaType(path),
        size: data.length,
        sha256: sha256(data),
      };
      const src = inheritedUrls.get(path);
      if (src) r.source_url = src;
      return r;
    });

  return {
    format: 'mdpkg',
    spec_version: SPEC_VERSION, // 不继承
    entrypoint: prev?.entrypoint ?? (files.has(DEFAULT_ENTRYPOINT) ? DEFAULT_ENTRYPOINT : undefined),
    encoding: prev?.encoding ?? 'utf-8',
    extensions: prev?.extensions,
    extensions_required: prev?.extensions_required,
    resources,
  };
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
let validator: ReturnType<typeof ajv.compile> | null = null;
function getValidator() {
  if (!validator) validator = ajv.compile(schema as never);
  return validator;
}

/**
 * 收集文档内的资源引用。
 * 必须走 AST 而非正则：文档里常出现「示例代码块」内含 Markdown 语法示例
 * （如 README 的 ![图](assets/a.png)），正则会把示例当真实引用，导致 pack 误报 E401。
 * 用 remark 解析后，只有 image / link 节点的 url 才算引用，代码块与行内代码天然被排除——
 * 与符号扩展共用同一套「排除区」判断。
 */
export function collectReferences(md: string, baseDir = ''): { local: string[]; external: number; docLinks: number } {
  const local: string[] = [];
  let external = 0;
  let docLinks = 0;
  const tree = unified().use(remarkParse).parse(md);
  visit(tree as never, (node: { type: string; url?: string }) => {
    if (node.type !== 'image' && node.type !== 'link') return;
    const raw = node.url;
    if (typeof raw !== 'string' || !raw) return;
    if (/^(https?:)?\/\//i.test(raw) || /^(mailto|data|tel):/i.test(raw) || raw.startsWith('#') || raw.startsWith('<')) { external++; return; }
    const stripped = raw.split('#')[0].split('?')[0];
    let p: string;
    try { p = decodeURIComponent(stripped); }
    catch { p = stripped; } // 非法百分号转义（如 100%.pdf）退回字面值，引用按字面名匹配
    if (!p) return;
    // 到本地 Markdown 的链接是「文档间导航」而非附件，不强制打包——
    // 否则打包一篇 README 会连带要求整个仓库。图片与 pdf/zip 等嵌入附件才必须随包。
    if (node.type === 'link' && /\.md$/i.test(p)) { docLinks++; return; }
    try {
      local.push(normalizePath(baseDir ? `${baseDir}/${p}` : p));
    } catch {
      // 引用文本含 .. 段（D7：引用按文档目录语义解析，与条目路径校验分离）：
      // 保留原文，由 checkClosure 的 resolveRef 回退解析；越出包根时按缺失处理
      local.push(baseDir ? `${baseDir}/${p}` : p);
    }
  });
  return { local, external, docLinks };
}

export function assertMarkdownEntrypoint(entrypoint: string): void {
  if (!entrypoint.toLowerCase().endsWith('.md')) throw new MdeError(E.E303, `entrypoint 非 Markdown: ${entrypoint}`);
}

/** 引用闭包校验：先展开 include 再收集引用，否则会漏掉被包含文档里的图片（规范 §6.2 第 4 条） */
export function checkClosure(files: Map<string, Uint8Array>, entrypoint: string): { orphans: string[] } {
  assertMarkdownEntrypoint(entrypoint);
  if (!files.has(entrypoint)) throw new MdeError(E.E303, `entrypoint 不存在: ${entrypoint}`);
  // expand 同时会校验 include 自身的错误（循环/深度/包外/…）
  const { text, sources } = expand(files, entrypoint);
  const { local } = collectReferences(text);
  const present = new Set([...files.keys()].map((p) => normalizePath(p)));
  // 入口文档所在目录（D7 相对引用解析基准；'' = 包根）
  const i = entrypoint.lastIndexOf('/');
  const entryDir = i === -1 ? '' : entrypoint.slice(0, i);

  // 引用匹配：先精确（引用文本即包内路径，如入口引用已含顶层目录名），
  // 未命中按入口文档目录语义 resolveRef 回退（与渲染 assetsPlugin 同一 resolveRef）。
  // 引用文本可含 .. 段（normalizePath 拒绝），此时直接走回退。
  const resolveHit = (ref: string): string | null => {
    let norm: string | null = null;
    try { norm = normalizePath(ref); } catch { /* 含 .. 段：走 resolveRef 回退 */ }
    if (norm !== null && present.has(norm)) return norm;
    const resolved = resolveRef(entryDir, ref);
    if (resolved === null) return null;
    try { norm = normalizePath(resolved); } catch { return null; }
    return present.has(norm) ? norm : null;
  };

  for (const ref of new Set(local)) {
    if (resolveHit(ref) === null) throw new MdeError(E.E401, `引用的本地资源缺失: ${ref}（入口 ${entrypoint}）`);
  }
  const referenced = new Set<string>();
  for (const r of local) {
    const hit = resolveHit(r);
    if (hit !== null) referenced.add(hit);
  }
  referenced.add(normalizePath(entrypoint));
  for (const s of sources) referenced.add(normalizePath(s.file)); // 被包含文件不算孤儿
  return { orphans: [...present].filter((p) => !referenced.has(p) && p !== 'manifest.json') };
}

/** 版本协商（规范 §8.5）：主版本不同必须拒绝；必需扩展不支持必须报错，不得静默降级 */
export const SUPPORTED_REQUIRED = new Set(['include', 'symbols', 'symbols:core']);
export function assertSupported(manifest: Manifest): void {
  const major = String(manifest.spec_version).split('.')[0];
  if (major !== '1') throw new MdeError(E.E701, `spec_version 主版本不支持: ${manifest.spec_version}（本实现支持 1.x）`);
  for (const r of manifest.extensions_required ?? []) {
    if (!SUPPORTED_REQUIRED.has(r)) throw new MdeError(E.E702, `extensions_required 含不支持项: ${r}`);
  }
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  externalCount: number;
}

/** 完整校验：Schema + 覆盖性 + size/sha256 + 路径 + entrypoint */
export function validatePackage(files: Map<string, Uint8Array>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const raw = files.get('manifest.json');
  if (!raw) return { ok: false, errors: [`[${E.E102}] 缺少 manifest.json`], warnings, externalCount: 0 };

  let manifest: Manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(raw)); }
  catch (e) { return { ok: false, errors: [`[${E.E302}] manifest.json 不是合法 JSON: ${(e as Error).message}`], warnings, externalCount: 0 }; }
  try { assertSupported(manifest); }
  catch (e) { return { ok: false, errors: [e instanceof MdeError ? e.message : String(e)], warnings, externalCount: 0 }; }

  if (!getValidator()(manifest)) {
    for (const err of getValidator().errors ?? []) errors.push(`[${E.E302}] ${err.instancePath || '/'} ${err.message}`);
  }

  // 覆盖性：包内除 manifest.json 外全部文件都必须在 resources 中
  const actual = new Map([...files.keys()].filter((p) => p !== 'manifest.json').map((p) => [normalizePath(p), files.get(p)!]));
  const listed = new Map((manifest.resources ?? []).map((r) => [r.path, r]));
  for (const p of actual.keys()) if (!listed.has(p)) errors.push(`[${E.E304}] 包内文件未登记: ${p}`);
  for (const p of listed.keys()) if (!actual.has(p)) errors.push(`[${E.E304}] resources 登记了不存在的文件: ${p}`);

  for (const [p, data] of actual) {
    const r = listed.get(p);
    if (!r) continue;
    if (r.size !== data.length) errors.push(`[${E.E402}] size 不符: ${p}（manifest ${r.size} / 实际 ${data.length}）`);
    if (r.sha256 !== sha256(data)) errors.push(`[${E.E403}] sha256 不符: ${p}（完整性问题，非篡改证据）`);
  }

  const entry = manifest.entrypoint ?? DEFAULT_ENTRYPOINT;
  let externalCount = 0;
  try {
    assertMarkdownEntrypoint(entry);
    const body = actual.get(normalizePath(entry));
    if (!body) throw new MdeError(E.E303, `entrypoint 不存在: ${entry}`);
    const { external } = collectReferences(new TextDecoder().decode(body));
    externalCount = external;
    const { orphans } = checkClosure(actual, normalizePath(entry));
    for (const o of orphans) warnings.push(`[${E.E404}] 孤儿资源（未被引用）: ${o}`);
  } catch (e) {
    errors.push(e instanceof MdeError ? e.message : String(e));
  }

  return { ok: errors.length === 0, errors, warnings, externalCount };
}
