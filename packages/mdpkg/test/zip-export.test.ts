// zip-export 核心单测（P2）：展开语义 + README + 可重复构建 + unzip 互操作 + 错误码
// 与后续 CLI 测试分离：本文件只测 buildZipExport 核心，不测 export --zip 命令形态。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpack, collectFiles } from '../src/container.ts';
import { expand } from '../src/include.ts';
import { buildZipExport } from '../src/zip-export.ts';
import { MdeError, E } from '../src/errors.ts';
import { enc, dec, makeFiles, makePkg } from './helpers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../..');

test('基本导出：无 manifest 条目、README 存在、include 已展开、资源字节一致', async () => {
  const zip = buildZipExport(await unpack(makePkg()));
  const out = await unpack(zip);

  // 无 manifest.json 等 mdpkg 特定条目
  assert.ok(!out.has('manifest.json'), '导出产物不应含 manifest.json');
  // README.md 存在
  assert.ok(out.has('README.md'), '应附加 README.md');
  // 结构与包内一致（manifest 剔除 + README 附加）
  const expected = [...makeFiles().keys(), 'README.md'].sort();
  assert.deepEqual([...out.keys()].sort(), expected, '目录结构应保持包内相对路径');

  // 展开后的 Markdown 无 <<< 残留，且与 expand() 结果逐字一致（仅展开与路径重写）
  const entryText = dec.decode(out.get('document.md')!);
  assert.ok(!entryText.includes('<<<'), '展开后不应残留 <<<');
  const { text } = expand(makeFiles(), 'document.md');
  assert.equal(entryText, text, '入口文本应与 expand 结果一致');
  // 相对路径已按包根重写（被包含文件里的 img/fig.png → includes/img/fig.png）
  assert.ok(entryText.includes('](includes/img/fig.png)'), '被包含文件的相对路径应按包根重写');

  // 资源字节一致
  assert.deepEqual(out.get('assets/a.png'), makeFiles().get('assets/a.png'));
  assert.deepEqual(out.get('includes/img/fig.png'), makeFiles().get('includes/img/fig.png'));
  // 非入口文件文本一字不改（ch1.md 原样保留，路径不重写）
  assert.equal(dec.decode(out.get('includes/ch1.md')!), dec.decode(makeFiles().get('includes/ch1.md')!));
});

test('可重复构建：同输入两次导出字节相同', async () => {
  const files = await unpack(makePkg());
  const a = buildZipExport(files);
  const b = buildZipExport(files);
  assert.equal(Buffer.from(a).toString('hex'), Buffer.from(b).toString('hex'));
});

test('unzip -l 互操作：标准 zip 可列可提、无 manifest 条目', async () => {
  const tmp = join(__dirname, '.test-zip-export-unzip');
  mkdirSync(tmp, { recursive: true });
  const zipPath = join(tmp, 'out.zip');
  writeFileSync(zipPath, buildZipExport(await unpack(makePkg())));

  const l = spawnSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
  assert.equal(l.status, 0, `unzip -l 应成功: ${l.stderr}`);
  assert.ok(l.stdout.includes('README.md'), '应列出 README.md');
  assert.ok(l.stdout.includes('document.md'), '应列出 document.md');
  assert.ok(l.stdout.includes('assets/a.png'), '应列出资源');
  assert.ok(!l.stdout.includes('manifest.json'), '不应列出 manifest.json');

  const p = spawnSync('unzip', ['-p', zipPath, 'README.md'], { encoding: 'utf8' });
  assert.equal(p.status, 0, `unzip -p README.md 应成功: ${p.stderr}`);
  assert.ok(p.stdout.includes('入口文档'), 'README 应可提取且注明入口');
  rmSync(tmp, { recursive: true, force: true });
});

test('lenient 场景（无 manifest）：入口按规则推断并展开', async () => {
  const files = new Map<string, Uint8Array>([
    ['README.md', enc.encode('# 说明\n')],
    ['document.md', enc.encode('# 文档\n\n<<< includes/ch1.md\n')],
    ['includes/ch1.md', enc.encode('第一章内容\n')],
  ]);
  const zip = buildZipExport(files); // 无 manifest.json → 推断 document.md
  const out = await unpack(zip);
  const text = dec.decode(out.get('document.md')!);
  assert.ok(text.includes('# 文档') && text.includes('第一章内容'), '入口应已展开');
  assert.ok(!text.includes('<<<'), '不应残留 <<<');
  assert.ok(out.has('README.md'), 'lenient 场景也应附加 README.md');
});

test('包内已有根级 README.md 时不覆盖（入口即 README.md 场景）', async () => {
  const files = new Map<string, Uint8Array>([
    ['README.md', enc.encode('# 包自带说明\n\n<<< includes/ch1.md\n')],
    ['includes/ch1.md', enc.encode('第一章内容\n')],
  ]);
  const zip = buildZipExport(files); // 推断入口 = README.md
  const out = await unpack(zip);
  // 展开文本写入 README.md，生成模板不得覆盖用户内容
  const readme = dec.decode(out.get('README.md')!);
  assert.ok(readme.includes('# 包自带说明') && readme.includes('第一章内容'), '应为展开后的包自带说明');
  assert.ok(!readme.includes('mdpkg 导出'), '不应是生成模板');
});

test('自定义 readme 生效', async () => {
  const zip = buildZipExport(makeFiles(), { readme: '# 自定义说明\n' });
  const out = await unpack(zip);
  assert.equal(dec.decode(out.get('README.md')!), '# 自定义说明\n');
});

test('README 模板：注明入口与构成、不含时间戳', async () => {
  const zip = buildZipExport(makeFiles());
  const out = await unpack(zip);
  const readme = dec.decode(out.get('README.md')!);
  assert.ok(readme.includes('document.md'), '应注明入口文档');
  assert.ok(readme.includes('打开方式'), '应说明打开方式');
  assert.ok(!/20\d\d/.test(readme), '不应含时间戳（可重复构建）');
});

test('错误语义：manifest 非法 JSON → E302', () => {
  const files = new Map<string, Uint8Array>([
    ['document.md', enc.encode('# 文档\n')],
    ['manifest.json', enc.encode('{ 不是 JSON')],
  ]);
  assert.throws(() => buildZipExport(files), (e: unknown) => e instanceof MdeError && e.code === E.E302);
});

test('错误语义：entrypoint 不存在 → E303', () => {
  const files = new Map<string, Uint8Array>([
    ['document.md', enc.encode('# 文档\n')],
    ['manifest.json', enc.encode(JSON.stringify({ format: 'mdpkg', spec_version: '1.0', entrypoint: 'missing.md', resources: [] }))],
  ]);
  assert.throws(() => buildZipExport(files), (e: unknown) => e instanceof MdeError && e.code === E.E303);
});

test('错误语义：无 md 文件 → E303（推断失败）', () => {
  const files = new Map<string, Uint8Array>([
    ['image.png', new Uint8Array([1, 2, 3])],
  ]);
  assert.throws(() => buildZipExport(files), (e: unknown) => e instanceof MdeError && e.code === E.E303);
});

test('错误语义：include 目标不存在 → E508', () => {
  const files = new Map<string, Uint8Array>([
    ['document.md', enc.encode('<<< missing.md\n')],
  ]);
  assert.throws(() => buildZipExport(files), (e: unknown) => e instanceof MdeError && e.code === E.E508);
});

// --- spec/fixtures 驱动（lenient：fixture 输入目录无 manifest.json） ---

test('fixture export-expanded：include 已内联、相对路径按包根重写', async () => {
  const files = collectFiles(join(ROOT, 'spec/fixtures/export-expanded/input'));
  const zip = buildZipExport(files);
  const out = await unpack(zip);
  const text = dec.decode(out.get('document.md')!);
  assert.ok(text.includes('第一章内容'), 'include 应已内联');
  assert.ok(text.includes('](includes/img/fig.png)'), '相对路径应按包根重写');
  assert.ok(!text.includes('<<<'), '不应残留 <<<');
});

test('fixture include-multi-level：多层嵌套展开', async () => {
  const files = collectFiles(join(ROOT, 'spec/fixtures/include-multi-level/input'));
  const zip = buildZipExport(files);
  const out = await unpack(zip);
  const text = dec.decode(out.get('document.md')!);
  for (const s of ['L1', 'L2', 'L3']) assert.ok(text.includes(s), `应包含 ${s}`);
  assert.ok(!text.includes('<<<'), '不应残留 <<<');
});