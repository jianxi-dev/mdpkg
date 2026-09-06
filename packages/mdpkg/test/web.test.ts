// web 模块测试：浏览器打开器与 CLI 同一管线（解包→校验→渲染），Node 下直接验证
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack } from '../src/container.ts';
import { buildManifest } from '../src/manifest.ts';
import { openMdpkg, readEntrySource, expand } from '../web/mdpkg-web.ts';
import { render, wrapDocument } from '../src/render.ts';
import { E } from '../src/errors.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

function makePkg(extra: Record<string, Uint8Array> = {}) {
  const files = new Map<string, Uint8Array>([
    ['document.md', enc.encode('# 标题 (tm)\n\n![图](assets/a.png)\n\n<<< includes/ch1.md\n')],
    ['includes/ch1.md', enc.encode('第一章 (c) --> 结束\n')],
    ['assets/a.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])],
    ...Object.entries(extra),
  ]);
  return pack(files, buildManifest(files)); // 与 CLI 一致：buildManifest 生成完整 manifest
}

test('openMdpkg: 解包 → 校验 → 渲染全链路（符号 + include + 图片内联）', async () => {
  const bytes = makePkg();
  const r = await openMdpkg(bytes);

  assert.equal(r.error, null);
  assert.equal(r.manifest?.entrypoint, 'document.md');
  assert.equal(r.validation.ok, true);
  assert.equal(r.files.size, 4);

  // 符号扩展：(tm)→™、(c)→©、-->→→（渲染层，不改源文）
  assert.ok(r.html!.includes('™'), '符号 (tm) 应扩展为 ™');
  assert.ok(r.html!.includes('©'), '符号 (c) 应扩展为 ©');
  assert.ok(r.html!.includes('→'), '符号 --> 应扩展为 →');
  // include 展开：被包含内容应出现在渲染结果
  assert.ok(r.html!.includes('第一章'), 'include 内容应展开');
  // 图片内联：data:image/png;base64
  assert.ok(r.html!.includes('data:image/png;base64,'), '图片应内联为 data URI');
  assert.ok(!r.html!.includes('assets/a.png'), '相对路径不应残留');
  // 源文不改：符号与 include 指令仍在原文
  const src = readEntrySource(r.files);
  assert.ok(src.includes('(tm)') && src.includes('<<<'), '源文应保持未转换');
});

test('openMdpkg: 与 CLI render 输出一致（同一管线）', async () => {
  const bytes = makePkg();
  const r = await openMdpkg(bytes);

  const files = r.files;
  const cliHtml = wrapDocument('document.md', render(files, { inline: true }).html);
  assert.equal(r.html, cliHtml, 'web 与 CLI 渲染输出应逐字节一致');
});

test('openMdpkg: 校验失败仍可预览（返回 validation.errors，不阻断渲染）', async () => {
  const bytes = makePkg();
  const { unpack } = await import('../src/zip-core.ts');
  const files = await unpack(bytes);
  const staleManifest = JSON.parse(dec.decode(files.get('manifest.json')!));
  files.set('assets/a.png', new Uint8Array([9, 9, 9]));
  const bad = pack(files, staleManifest);

  const r = await openMdpkg(bad);
  assert.equal(r.validation.ok, false);
  assert.ok(r.validation.errors.some((e) => e.includes(E.E403)), '应报 sha256 不符');
  assert.ok(r.html, '校验失败也应产出预览（内容仍在）');
});

test('openMdpkg: 无 entrypoint 时推断渲染（lenient-open）', async () => {
  const files = new Map<string, Uint8Array>([['other.md', enc.encode('# 无入口\n')]]);
  const bytes = pack(files, buildManifest(files));
  const r = await openMdpkg(bytes);
  // lenient-open：manifest 无 entrypoint 时推断 other.md 为入口，渲染成功
  assert.equal(r.error, null, '推断模式下不应报错');
  assert.ok(r.html?.includes('无入口'), '应渲染推断的 other.md');
  assert.equal(r.unverified, false, '有 manifest 时 unverified 为 false');
});

test('openMdpkg: 非 ZIP 字节直接抛 MdeError', async () => {
  await assert.rejects(() => openMdpkg(enc.encode('not a zip at all')), (e: Error) => {
    assert.ok(e.message.includes('MDPKG-E101') || e.message.includes('invalid'), `应报非 ZIP: ${e.message}`);
    return true;
  });
});

test('openMdpkg: manifest.json 缺失时校验失败', async () => {
  const { zipSync, strToU8 } = await import('fflate');
  const zipped = zipSync({ 'a.md': strToU8('# x') }, {});
  const r = await openMdpkg(zipped);
  assert.equal(r.validation.ok, false);
  assert.ok(r.validation.errors.some((e) => e.includes(E.E102)), '应报缺少 manifest.json');
});

test('expand: include 展开与 CLI 共用实现', async () => {
  const bytes = makePkg();
  const r = await openMdpkg(bytes);
  const { text, count } = expand(r.files, 'document.md');
  assert.ok(text.includes('第一章'), 'include 应展开');
  assert.equal(count, 1);
  assert.ok(dec.decode(r.files.get('document.md')!).includes('<<<'), '源文保持不变');
});