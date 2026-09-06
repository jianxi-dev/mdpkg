// md 导出 CLI 级测试（export-formats 组 2/4.3）：export --md 命令形态 + 互斥 + 缺省输出名 + 展开语义
// 与核心级 toMarkdown 测试分离：本文件只测 CLI 接入，不重复展开语义（展开语义归 markdown-export.test.ts）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePkg } from './helpers.ts';

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

test('export --md：单文件产出展开后文本，符号保持源文本', () => {
  const { tmp, pkgPath } = setupTmp('.test-md-cli-basic');
  const outMd = join(tmp, 'out.md');
  const r = spawnSync('node', [CLI, 'export', '--md', pkgPath, '-o', outMd], { encoding: 'utf8' });
  assert.equal(r.status, 0, `退出码应为 0，实际 ${r.status}: ${r.stderr}`);
  assert.ok(r.stdout.includes('export --md'), `stdout 应含 export --md: ${r.stdout}`);
  assert.ok(existsSync(outMd), '应生成 out.md');

  const text = readFileSync(outMd, 'utf8');
  assert.ok(!text.includes('<<<'), '展开后不应残留 <<<');
  assert.ok(text.includes('第一章'), 'include 应已内联');
  assert.ok(text.includes('](includes/img/fig.png)'), '被包含文件的相对路径应按包根重写');
  assert.ok(text.includes('(tm)'), '符号应保持源文本（(tm) 不转 ™）');
  assert.ok(text.includes('assets/a.png'), '入口图片引用保留相对路径');
  rmSync(tmp, { recursive: true, force: true });
});

test('export --md 与 --raw/--expanded/--zip 互斥：退出码 2 + 用法消息 + 不产生输出', () => {
  const { tmp, pkgPath } = setupTmp('.test-md-cli-mutex');
  for (const flag of ['--raw', '--expanded', '--zip']) {
    const outMd = join(tmp, 'out.md');
    const r = spawnSync('node', [CLI, 'export', '--md', pkgPath, flag, '-o', outMd], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${flag} 冲突应退出码 2，实际 ${r.status}: ${r.stderr}`);
    assert.ok(r.stderr.includes('用法'), `stderr 应含用法消息: ${r.stderr}`);
    assert.ok(!existsSync(outMd), `${flag} 冲突不应产生输出文件`);
  }
  rmSync(tmp, { recursive: true, force: true });
});

test('export --md 缺省 -o：按包名替换 .md', () => {
  const { tmp, pkgPath } = setupTmp('.test-md-cli-default');
  const r = spawnSync('node', [CLI, 'export', '--md', pkgPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, `退出码应为 0，实际 ${r.status}: ${r.stderr}`);
  const defaultMd = join(tmp, 'demo.md');
  assert.ok(existsSync(defaultMd), `应生成 ${defaultMd}`);
  assert.ok(r.stdout.includes('demo.md'), `stdout 应含输出路径: ${r.stdout}`);
  rmSync(tmp, { recursive: true, force: true });
});

test('export --md 缺省 -o：无 .mdpkg 后缀时追加 .md，且不覆盖原文件', () => {
  const { tmp, pkgPath } = setupTmp('.test-md-cli-default-nosuffix');
  const noSuffix = join(tmp, 'demo');
  const original = makePkg();
  writeFileSync(noSuffix, original);
  const r = spawnSync('node', [CLI, 'export', '--md', noSuffix], { encoding: 'utf8' });
  assert.equal(r.status, 0, `退出码应为 0，实际 ${r.status}: ${r.stderr}`);
  const defaultMd = join(tmp, 'demo.md');
  assert.ok(existsSync(defaultMd), `应生成 ${defaultMd}（追加 .md 而非覆盖原文件）`);
  assert.ok(r.stdout.includes('demo.md'), `stdout 应含输出路径: ${r.stdout}`);
  // 原文件内容未被改动（字节仍等于 makePkg() 产物）
  assert.deepEqual(new Uint8Array(readFileSync(noSuffix)), original, '原文件字节不应被改动');
  rmSync(tmp, { recursive: true, force: true });
});
