// mdpkg-web 导出函数可用性（spec「浏览器端导出可用」场景的 Node 侧验证）：
// toDocx / toZip 与 CLI 共用同一跨端核心（docx.ts / zip-export.ts），
// 直接 import web/mdpkg-web.ts 调用，断言返回 Uint8Array 且可被 unpack 解出标准部件。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unpack } from '../src/container.ts';
import { toDocx, toZip, packMdpkg } from '../web/mdpkg-web.ts';
import { MdeError } from '../src/errors.ts';
import { enc, makeFiles, makePkg } from './helpers.ts';

test('mdpkg-web toDocx：返回 Uint8Array，解包含 word/document.xml 与 [Content_Types].xml', async () => {
  const bytes = toDocx(makeFiles());
  assert.ok(bytes instanceof Uint8Array, 'toDocx 应返回 Uint8Array');
  const out = await unpack(bytes);
  assert.ok(out.has('[Content_Types].xml'), '应含 [Content_Types].xml');
  assert.ok(out.has('word/document.xml'), '应含 word/document.xml');
  assert.ok(out.has('word/_rels/document.xml.rels'), '应含 document.xml.rels');
  // 位图资源应嵌入 word/media/
  assert.ok(out.has('word/media/img-1.png'), '位图应写入 word/media/img-1.png');
});

test('mdpkg-web toZip：返回 Uint8Array，解包含 README.md 且无 manifest.json', async () => {
  const bytes = toZip(await unpack(makePkg()));
  assert.ok(bytes instanceof Uint8Array, 'toZip 应返回 Uint8Array');
  const out = await unpack(bytes);
  assert.ok(out.has('README.md'), '应含 README.md');
  assert.ok(!out.has('manifest.json'), '不应含 manifest.json');
  assert.ok(out.has('document.md'), '应含入口文档');
});

// ── packMdpkg 入口推断回归（修复 manifest.entrypoint undefined 时回退 DEFAULT_ENTRYPOINT 导致 E303）──

test('packMdpkg lenient 包（docs/doc.md）→ 打包成功，entrypoint 推断为 docs/doc.md', async () => {
  const files = new Map<string, Uint8Array>([
    ['docs/doc.md', enc.encode('# 文档\n\n![图](../logo.png)\n')],
    ['logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])],
  ]);
  const pkg = packMdpkg(files); // 修复前抛 E303
  assert.ok(pkg instanceof Uint8Array, '应返回 Uint8Array');
  const out = await unpack(pkg);
  // buildManifest 只在 files.has('document.md') 时设 entrypoint；非默认名由 inferEntrypoint 推断但不写入 manifest
  const manifest = JSON.parse(new TextDecoder().decode(out.get('manifest.json')));
  assert.equal(manifest.entrypoint, undefined, '非默认名 entrypoint 不写入 manifest');
  assert.ok(out.has('docs/doc.md'), '解包应含 docs/doc.md');
  assert.ok(out.has('logo.png'), '解包应含资源 logo.png');
});

test('packMdpkg 单 md（rich.md）→ 打包成功，入口推断为 rich.md', async () => {
  const files = new Map<string, Uint8Array>([
    ['rich.md', enc.encode('# Rich\n\n内容\n')],
  ]);
  const pkg = packMdpkg(files);
  assert.ok(pkg instanceof Uint8Array, '应返回 Uint8Array');
  const out = await unpack(pkg);
  assert.ok(out.has('rich.md'), '解包应含 rich.md');
  // buildManifest 不设非默认名 entrypoint，但 packMdpkg 用 inferEntrypoint 推断入口并通过 checkClosure
  const manifest = JSON.parse(new TextDecoder().decode(out.get('manifest.json')));
  assert.equal(manifest.entrypoint, undefined, '非默认名 entrypoint 不写入 manifest（buildManifest 语义）');
});

test('packMdpkg 标准包（document.md）→ 行为不变，entrypoint 为 document.md', async () => {
  const pkg = makePkg();
  const out = await unpack(pkg);
  const manifest = JSON.parse(new TextDecoder().decode(out.get('manifest.json')));
  assert.equal(manifest.entrypoint, 'document.md', '标准包 entrypoint 应为 document.md');
});

test('packMdpkg 无 .md → 抛 E303（不崩溃）', () => {
  const files = new Map<string, Uint8Array>([
    ['data.json', enc.encode('{}')],
    ['style.css', enc.encode('body{}')],
  ]);
  assert.throws(() => packMdpkg(files), (err: unknown) => {
    assert.ok(err instanceof MdeError, '应为 MdeError');
    assert.ok(err.message.includes('E303'), '应含 E303 错误码');
    return true;
  }, '无 .md 文件应抛 E303');
});

test('packMdpkg lenient 子目录单 md（lib/guide.md + assets/）→ 打包成功，入口推断为 lib/guide.md', async () => {
  const files = new Map<string, Uint8Array>([
    ['lib/guide.md', enc.encode('# Guide\n\n![图](../assets/icon.png)\n')],
    ['assets/icon.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 8, 9])],
  ]);
  const pkg = packMdpkg(files);
  const out = await unpack(pkg);
  assert.ok(out.has('lib/guide.md'), '解包应含 lib/guide.md');
  assert.ok(out.has('assets/icon.png'), '解包应含资源 assets/icon.png');
});

// ── Wave 3.1 跨端错误契约：toDocx 非致命问题走 onWarning 不抛异常 ──

test('mdpkg-web toDocx：SVG 降级走 onWarning 不抛异常', () => {
  const files = new Map<string, Uint8Array>([
    ['document.md', enc.encode('# 标题\n\n![svg](assets/a.svg)\n')],
    ['assets/a.svg', enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')],
  ]);
  const warnings: string[] = [];
  const bytes = toDocx(files, {}, (w) => warnings.push(w));
  assert.ok(bytes instanceof Uint8Array, 'toDocx 应返回 Uint8Array');
  assert.ok(bytes.length > 0, '应产出非空 docx 字节');
  assert.ok(warnings.length > 0, 'SVG 应触发警告');
  assert.ok(warnings.some((w) => w.includes('SVG')), '警告应提及 SVG');
});

test('mdpkg-web toDocx：缺失资源不阻断，alt 占位不抛异常', () => {
  const files = new Map<string, Uint8Array>([
    ['document.md', enc.encode('# 标题\n\n![缺失](assets/missing.png)\n')],
  ]);
  const warnings: string[] = [];
  const bytes = toDocx(files, {}, (w) => warnings.push(w));
  assert.ok(bytes instanceof Uint8Array, 'toDocx 应返回 Uint8Array');
  // 缺失资源走 alt 占位（与 HTML 渲染路径一致，渲染路径不执行完整校验，不触发警告）
  assert.equal(warnings.length, 0, '缺失资源不触发警告（渲染路径语义）');
});

test('mdpkg-web toDocx：损坏图片头走 onWarning + 缺省尺寸不抛异常', () => {
  const badPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);
  const files = new Map<string, Uint8Array>([
    ['document.md', enc.encode('# 标题\n\n![坏图](assets/bad.png)\n')],
    ['assets/bad.png', badPng],
  ]);
  const warnings: string[] = [];
  const bytes = toDocx(files, {}, (w) => warnings.push(w));
  assert.ok(bytes instanceof Uint8Array, 'toDocx 应返回 Uint8Array');
  assert.ok(warnings.length > 0, '损坏图片头应触发警告');
  assert.ok(warnings.some((w) => w.includes('固有尺寸')), '警告应提及固有尺寸');
});

test('mdpkg-web toDocx：正常导出（位图嵌入）不触发警告', () => {
  // 最小合法 PNG（8 字节签名 + IHDR 宽高各 10px）
  const png = new Uint8Array(8 + 4 + 4 + 13 + 4);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png[8] = 0; png[9] = 0; png[10] = 0; png[11] = 13;
  png[12] = 0x49; png[13] = 0x48; png[14] = 0x44; png[15] = 0x52;
  png[16] = 0; png[17] = 0; png[18] = 0; png[19] = 10;
  png[20] = 0; png[21] = 0; png[22] = 0; png[23] = 10;
  png[24] = 8; png[25] = 2; png[26] = 0; png[27] = 0; png[28] = 0;
  const files = new Map<string, Uint8Array>([
    ['document.md', enc.encode('# 标题\n\n![图](assets/a.png)\n')],
    ['assets/a.png', png],
  ]);
  const warnings: string[] = [];
  const bytes = toDocx(files, {}, (w) => warnings.push(w));
  assert.ok(bytes instanceof Uint8Array, 'toDocx 应返回 Uint8Array');
  assert.equal(warnings.length, 0, '正常位图不应触发警告');
});