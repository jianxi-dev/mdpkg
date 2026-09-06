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