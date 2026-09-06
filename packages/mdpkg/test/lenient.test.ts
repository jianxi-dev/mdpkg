// lenient-open 测试：入口推断 + render 无 manifest + unverified 字段 + CLI 提示
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { inferEntrypoint } from '../src/manifest.ts';
import { render } from '../src/render.ts';
import { openMdpkg } from '../web/mdpkg-web.ts';
import { MdeError, E } from '../src/errors.ts';
import { zipSync, strToU8 } from 'fflate';

const enc = (s: string) => new TextEncoder().encode(s);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli.ts');

// 构造无 manifest 的裸 zip（fflate zipSync）
function bareZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files, { mtime: new Date(Date.UTC(1980, 0, 1)) });
}

// --- 1.2 inferEntrypoint 单测 ---

test('inferEntrypoint: document.md 优先于 README', () => {
  const files = new Map([
    ['README.md', enc('# README')],
    ['document.md', enc('# 文档')],
    ['other.md', enc('# 其他')],
  ]);
  assert.equal(inferEntrypoint(files), 'document.md');
});

test('inferEntrypoint: 无 document.md 时 README 兜底', () => {
  const files = new Map([
    ['README.md', enc('# README')],
    ['other.md', enc('# 其他')],
  ]);
  assert.equal(inferEntrypoint(files), 'README.md');
});

test('inferEntrypoint: README.zh-CN.md 变体', () => {
  const files = new Map([
    ['README.zh-CN.md', enc('# 中文')],
    ['chapter1.md', enc('# 第一章')],
  ]);
  assert.equal(inferEntrypoint(files), 'README.zh-CN.md');
});

test('inferEntrypoint: README.md 优先于 README.zh-CN.md（同树共存）', () => {
  const files = new Map([
    ['README.md', enc('# README')],
    ['README.zh-CN.md', enc('# 中文')],
  ]);
  // 锁死默认名循环顺序：README.md 先于 README.zh-CN.md，防优先级反转不被察觉
  assert.equal(inferEntrypoint(files), 'README.md');
});

test('inferEntrypoint: 子目录 document.md 优先于根 README（全树最浅）', () => {
  const files = new Map([
    ['README.md', enc('# README')],
    ['docs/document.md', enc('# 子目录文档')],
  ]);
  // document.md 深度 1 < README 深度 0？不对：README 深度 0 更浅
  // 但规则是 document.md 优先于 README，不论深度
  assert.equal(inferEntrypoint(files), 'docs/document.md');
});

test('inferEntrypoint: 无默认名时最浅优先（根目录同深码位序首）', () => {
  const files = new Map([
    ['chapter2.md', enc('# 二')],
    ['chapter1.md', enc('# 一')],
    ['docs/notes.md', enc('# 笔记')],
  ]);
  // 根目录文件深度 1 < docs/notes.md 深度 2，先取根目录；同深按码位序 chapter1.md 在前
  assert.equal(inferEntrypoint(files), 'chapter1.md');
});

test('inferEntrypoint: 子目录任意名 md 可推断（docs/guide.md）', () => {
  const files = new Map([
    ['docs/guide.md', enc('# 指南')],
  ]);
  // 修复前仅查根目录 → E303；现在任意深度候选均可推断
  assert.equal(inferEntrypoint(files), 'docs/guide.md');
});

test('inferEntrypoint: 子目录多文件取最浅（深度优先）', () => {
  const files = new Map([
    ['sub/a.md', enc('# A')],
    ['docs/deep/b.md', enc('# B')],
  ]);
  // sub/a.md 深度 2 < docs/deep/b.md 深度 3 → 取浅者
  assert.equal(inferEntrypoint(files), 'sub/a.md');
});

test('inferEntrypoint: 同深度按码位序（a.md < b.md）', () => {
  const files = new Map([
    ['sub/b.md', enc('# B')],
    ['sub/a.md', enc('# A')],
  ]);
  assert.equal(inferEntrypoint(files), 'sub/a.md');
});

test('inferEntrypoint: 隐藏路径不参与候选（含子目录隐藏段）', () => {
  const files = new Map([
    ['.hidden.md', enc('# 隐藏')],
    ['dir/.x.md', enc('# 子目录隐藏')],
    ['visible.md', enc('# 可见')],
  ]);
  assert.equal(inferEntrypoint(files), 'visible.md');
});

test('inferEntrypoint: 无 md 文件抛 E303（消息含「推断」）', () => {
  const files = new Map([['image.png', new Uint8Array([1, 2, 3])]]);
  try {
    inferEntrypoint(files);
    assert.fail('应抛 E303');
  } catch (e) {
    assert.ok(e instanceof MdeError && e.code === E.E303, '应抛 E303');
    assert.ok((e as Error).message.includes('推断'), '消息应含「推断」字样');
  }
});

// --- 2.2 render 无 manifest ---

test('render 无 manifest: 含 chapter1/chapter2 时入口为 chapter1.md', () => {
  const files = new Map([
    ['chapter1.md', enc('# 第一章标题\n')],
    ['chapter2.md', enc('# 第二章标题\n')],
  ]);
  const r = render(files, {});
  assert.ok(r.html.includes('第一章标题'), '应渲染 chapter1.md 的标题');
});

test('render 无 manifest: 仅子目录 document.md 时入口为子目录路径', () => {
  const files = new Map([
    ['docs/document.md', enc('# 子目录文档标题\n')],
  ]);
  const r = render(files, {});
  assert.ok(r.html.includes('子目录文档标题'), '应渲染子目录 document.md');
});

test('render 有 manifest 且有 entrypoint 时不推断（走 manifest.entrypoint）', () => {
  const files = new Map([
    ['document.md', enc('# 默认文档\n')],
    ['custom.md', enc('# 自定义入口\n')],
    ['manifest.json', enc(JSON.stringify({ format: 'mdpkg', spec_version: '1.0', entrypoint: 'custom.md', resources: [] }))],
  ]);
  const r = render(files, {});
  assert.ok(r.html.includes('自定义入口'), '应渲染 manifest 指定的 custom.md');
});

// --- 3.3 openMdpkg unverified 字段 ---

test('openMdpkg 裸 zip 返回 unverified: true', async () => {
  const bytes = bareZip({ 'a.md': strToU8('# 标题 A\n') });
  const r = await openMdpkg(bytes);
  assert.equal(r.unverified, true);
  assert.ok(r.html?.includes('标题 A'), '应渲染 a.md');
});

test('openMdpkg 带 manifest 包返回 unverified: false', async () => {
  const { pack } = await import('../src/container.ts');
  const { buildManifest } = await import('../src/manifest.ts');
  const files = new Map([
    ['document.md', enc('# 有 manifest\n')],
  ]);
  const bytes = pack(files, buildManifest(files));
  const r = await openMdpkg(bytes);
  assert.equal(r.unverified, false);
});

test('openMdpkg 裸 zip 无 md: 返回 error 分支且 unverified:true', async () => {
  const bytes = bareZip({ 'image.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) });
  const r = await openMdpkg(bytes);
  assert.equal(r.unverified, true, '无 manifest 应标记 unverified');
  assert.equal(r.html, null, '渲染失败应返回 html:null（error 分支）');
  assert.ok(r.error?.includes('MDPKG-E303'), `error 应含 MDPKG-E303: ${r.error}`);
});

test('openMdpkg 裸 zip: entry 为推断入口 + title 用推断名', async () => {
  const bytes = bareZip({ 'chapter1.md': strToU8('# 第一章\n') });
  const r = await openMdpkg(bytes);
  assert.equal(r.entry, 'chapter1.md', 'entry 应为推断入口 chapter1.md');
  assert.ok(r.html?.includes('<title>chapter1.md</title>'), `title 应为 chapter1.md，实际 html 前段: ${r.html?.slice(0, 300)}`);
  assert.ok(!r.html?.includes('document.md'), '不应出现 document.md');
});

test('openMdpkg 带 manifest: entry 为 manifest.entrypoint', async () => {
  const { pack } = await import('../src/container.ts');
  const { buildManifest } = await import('../src/manifest.ts');
  const files = new Map([
    ['document.md', enc('# 默认文档\n')],
    ['custom.md', enc('# 自定义入口\n')],
  ]);
  const bytes = pack(files, buildManifest(files, { entrypoint: 'custom.md' }));
  const r = await openMdpkg(bytes);
  assert.equal(r.entry, 'custom.md', 'entry 应为 manifest 指定的 custom.md');
  assert.ok(r.html?.includes('<title>custom.md</title>'), `title 应为 custom.md，实际 html 前段: ${r.html?.slice(0, 300)}`);
});

test('openMdpkg 裸 zip 无 md: entry 为空串（错误分支）', async () => {
  const bytes = bareZip({ 'image.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) });
  const r = await openMdpkg(bytes);
  assert.equal(r.entry, '', '错误分支 entry 应为空串');
});

// --- 3.3 CLI stderr 提示 ---

test('CLI render 裸 zip 成功且 stderr 含「未校验来源」', () => {
  const tmp = join(__dirname, '.test-lenient-cli');
  mkdirSync(tmp, { recursive: true });
  const zipPath = join(tmp, 'bare.zip');
  writeFileSync(zipPath, bareZip({
    'chapter1.md': strToU8('# CLI 第一章\n'),
    'chapter2.md': strToU8('# CLI 第二章\n'),
  }));
  const htmlPath = join(tmp, 'out.html');
  const r = spawnSync('node', [CLI, 'render', zipPath, '-o', htmlPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, `退出码应为 0，实际 ${r.status}: ${r.stderr}`);
  assert.ok(r.stderr.includes('未校验来源'), `stderr 应含「未校验来源」: ${r.stderr}`);
  assert.ok(r.stderr.includes('chapter1.md'), `stderr 应含推断入口名: ${r.stderr}`);
  rmSync(tmp, { recursive: true, force: true });
});

test('CLI export --expanded 裸 zip stderr 含「未校验来源」+ 入口名', () => {
  const tmp = join(__dirname, '.test-lenient-cli-exp');
  mkdirSync(tmp, { recursive: true });
  const zipPath = join(tmp, 'bare.zip');
  writeFileSync(zipPath, bareZip({
    'README.md': strToU8('# 导出测试\n'),
  }));
  const outDir = join(tmp, 'out');
  const r = spawnSync('node', [CLI, 'export', '--expanded', zipPath, '-o', outDir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `退出码应为 0，实际 ${r.status}: ${r.stderr}`);
  assert.ok(r.stderr.includes('未校验来源'), `stderr 应含「未校验来源」: ${r.stderr}`);
  assert.ok(r.stderr.includes('README.md'), `stderr 应含推断入口名: ${r.stderr}`);
  rmSync(tmp, { recursive: true, force: true });
});

test('CLI export --raw 无 md 裸 zip 成功（不推断入口）', () => {
  const tmp = join(__dirname, '.test-lenient-cli-raw-nomd');
  mkdirSync(tmp, { recursive: true });
  const zipPath = join(tmp, 'bare.zip');
  writeFileSync(zipPath, bareZip({
    'image.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  }));
  const outDir = join(tmp, 'out');
  const r = spawnSync('node', [CLI, 'export', '--raw', zipPath, '-o', outDir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `退出码应为 0，实际 ${r.status}: ${r.stderr}`);
  assert.ok(r.stderr.includes('未校验来源'), `stderr 应含「未校验来源」: ${r.stderr}`);
  assert.ok(!r.stderr.includes('推断入口'), `raw 模式提示不应含入口名: ${r.stderr}`);
  rmSync(tmp, { recursive: true, force: true });
});
