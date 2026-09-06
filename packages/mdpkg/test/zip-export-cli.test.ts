// zip 导出 CLI 级测试（P2）：export --zip 命令形态 + 互斥 + 缺省输出名 + unzip 互操作
// 与 zip-export.test.ts（核心级）分离：本文件只测 CLI 接入，不重复核心展开语义。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpack } from '../src/container.ts';
import { enc, dec, makeFiles, makePkg } from './helpers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli.ts');

// 临时目录 + 包文件（demo.mdpkg）
function setupTmp(name: string): { tmp: string; pkgPath: string } {
  const tmp = join(__dirname, name);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const pkgPath = join(tmp, 'demo.mdpkg');
  writeFileSync(pkgPath, makePkg());
  return { tmp, pkgPath };
}

test('export --zip：产物无 manifest、README 存在、include 已展开、资源字节一致', async () => {
  const { tmp, pkgPath } = setupTmp('.test-zip-cli-basic');
  const outZip = join(tmp, 'out.zip');
  const r = spawnSync('node', [CLI, 'export', '--zip', pkgPath, '-o', outZip], { encoding: 'utf8' });
  assert.equal(r.status, 0, `退出码应为 0，实际 ${r.status}: ${r.stderr}`);
  assert.ok(r.stdout.includes('export --zip'), `stdout 应含 export --zip: ${r.stdout}`);
  assert.ok(existsSync(outZip), '应生成 out.zip');

  const out = await unpack(new Uint8Array(readFileSync(outZip)));
  // 无 manifest.json 等 mdpkg 特定条目
  assert.ok(!out.has('manifest.json'), '导出产物不应含 manifest.json');
  // README.md 存在
  assert.ok(out.has('README.md'), '应附加 README.md');
  // 目录结构与包内一致（manifest 剔除 + README 附加）
  const expected = [...makeFiles().keys(), 'README.md'].sort();
  assert.deepEqual([...out.keys()].sort(), expected, '目录结构应保持包内相对路径');

  // 展开后的 Markdown 无 <<< 残留、include 已内联、相对路径按包根重写
  const entryText = dec.decode(out.get('document.md')!);
  assert.ok(!entryText.includes('<<<'), '展开后不应残留 <<<');
  assert.ok(entryText.includes('第一章'), 'include 应已内联');
  assert.ok(entryText.includes('](includes/img/fig.png)'), '被包含文件的相对路径应按包根重写');
  // 非入口文件文本一字不改
  assert.equal(dec.decode(out.get('includes/ch1.md')!), dec.decode(makeFiles().get('includes/ch1.md')!));

  // 资源字节一致
  assert.deepEqual(out.get('assets/a.png'), makeFiles().get('assets/a.png'));
  assert.deepEqual(out.get('includes/img/fig.png'), makeFiles().get('includes/img/fig.png'));
  rmSync(tmp, { recursive: true, force: true });
});

test('export --zip 产物 unzip -l 可列、无 manifest 条目', () => {
  const { tmp, pkgPath } = setupTmp('.test-zip-cli-unzip');
  const outZip = join(tmp, 'out.zip');
  const r = spawnSync('node', [CLI, 'export', '--zip', pkgPath, '-o', outZip], { encoding: 'utf8' });
  assert.equal(r.status, 0, `退出码应为 0，实际 ${r.status}: ${r.stderr}`);

  const l = spawnSync('unzip', ['-l', outZip], { encoding: 'utf8' });
  assert.equal(l.status, 0, `unzip -l 应成功: ${l.stderr}`);
  assert.ok(l.stdout.includes('README.md'), '应列出 README.md');
  assert.ok(l.stdout.includes('document.md'), '应列出 document.md');
  assert.ok(l.stdout.includes('assets/a.png'), '应列出资源');
  assert.ok(!l.stdout.includes('manifest.json'), '不应列出 manifest.json');
  rmSync(tmp, { recursive: true, force: true });
});

test('export --zip 与 --raw/--expanded 互斥：退出码 2 + 用法消息 + 不产生输出', () => {
  const { tmp, pkgPath } = setupTmp('.test-zip-cli-mutex');
  for (const flag of ['--raw', '--expanded']) {
    const outZip = join(tmp, 'out.zip');
    const r = spawnSync('node', [CLI, 'export', '--zip', pkgPath, flag, '-o', outZip], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${flag} 冲突应退出码 2，实际 ${r.status}: ${r.stderr}`);
    assert.ok(r.stderr.includes('用法'), `stderr 应含用法消息: ${r.stderr}`);
    assert.ok(!existsSync(outZip), `${flag} 冲突不应产生输出文件`);
  }
  rmSync(tmp, { recursive: true, force: true });
});

test('export --zip 缺省 -o：按包名替换 .zip', () => {
  const { tmp, pkgPath } = setupTmp('.test-zip-cli-default');
  const r = spawnSync('node', [CLI, 'export', '--zip', pkgPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, `退出码应为 0，实际 ${r.status}: ${r.stderr}`);
  const defaultZip = join(tmp, 'demo.zip');
  assert.ok(existsSync(defaultZip), `应生成 ${defaultZip}`);
  assert.ok(r.stdout.includes('demo.zip'), `stdout 应含输出路径: ${r.stdout}`);
  rmSync(tmp, { recursive: true, force: true });
});

test('export --zip 缺省 -o：无 .mdpkg 后缀时追加 .zip，且不覆盖原文件', () => {
  const { tmp, pkgPath } = setupTmp('.test-zip-cli-default-nosuffix');
  const noSuffix = join(tmp, 'demo');
  const original = makePkg();
  writeFileSync(noSuffix, original);
  const r = spawnSync('node', [CLI, 'export', '--zip', noSuffix], { encoding: 'utf8' });
  assert.equal(r.status, 0, `退出码应为 0，实际 ${r.status}: ${r.stderr}`);
  const defaultZip = join(tmp, 'demo.zip');
  assert.ok(existsSync(defaultZip), `应生成 ${defaultZip}（追加 .zip 而非覆盖原文件）`);
  assert.ok(r.stdout.includes('demo.zip'), `stdout 应含输出路径: ${r.stdout}`);
  // 原文件内容未被改动（字节仍等于 makePkg() 产物）
  assert.deepEqual(new Uint8Array(readFileSync(noSuffix)), original, '原文件字节不应被改动');
  rmSync(tmp, { recursive: true, force: true });
});