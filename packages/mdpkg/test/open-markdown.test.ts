// openMarkdown（.md 单文件直开）测试：Node 直调 web/mdpkg-web.ts
// 与 openMdpkg 的 OpenResult 同构：manifest=null、unverified=true、validation 含 E102（lenient 语义）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMarkdown } from '../web/mdpkg-web.ts';
import { E } from '../src/errors.ts';

const enc = (s: string) => new TextEncoder().encode(s);

test('openMarkdown: 标题渲染 + 符号转换 + GFM 表格，entry 保留原文件名', async () => {
  const r = await openMarkdown('guide.md', enc('# 指南 (tm)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'));
  assert.equal(r.error, null);
  assert.equal(r.entry, 'guide.md', 'entry 应保留原文件名');
  assert.equal(r.manifest, null, '单文件无 manifest');
  assert.equal(r.unverified, true, '来源未校验语义与 lenient 一致');
  assert.equal(r.degraded, false);
  assert.ok(r.html!.includes('<h1'), '标题应渲染');
  assert.ok(r.html!.includes('™'), '符号 (tm) 应转换为 ™');
  assert.ok(r.html!.includes('<table>'), 'GFM 表格应渲染');
});

test('openMarkdown: <<< 降级为可见文本且无 E508', async () => {
  const r = await openMarkdown('guide.md', enc('# 标题\n\n<<< missing.md\n'));
  assert.equal(r.error, null, 'include 关闭时不应报 E508');
  // rehype-stringify 对文本中的 < 用数字实体（&#x3C;），浏览器渲染即可见的 <<<
  assert.ok(r.html!.includes('&#x3C;&#x3C;&#x3C;'), 'include 指令应降级为可见文本');
});

test('openMarkdown: validation.errors 含 E102（缺少 manifest）', async () => {
  const r = await openMarkdown('guide.md', enc('# 标题\n'));
  assert.equal(r.validation.ok, false);
  assert.ok(r.validation.errors.some((e) => e.includes(E.E102)), '应报缺少 manifest.json');
});

test('openMarkdown: 非 .md 名回退 document.md 作为入口', async () => {
  const r = await openMarkdown('notes.txt', enc('# 标题\n'));
  assert.equal(r.entry, 'document.md', '非 .md 名应回退 document.md');
  assert.equal(r.error, null);
  assert.ok(r.html!.includes('<h1'), '仍应正常渲染');
});