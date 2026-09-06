// 库层导出测试（export-formats 组 4.1/4.2）：toMarkdown（src/markdown-export.ts）+ toHtml（web/mdpkg-web.ts）
// 与 CLI 级测试（markdown-export-cli.test.ts）分离：本文件只测库 API，不重复 CLI 接入。
// 覆盖 spec「md 导出库 API」/「html 导出库 API」Requirement 场景：
//   展开语义（include 内联、无 <<< 残留、路径按包根重写）/ 符号保持源文本 /
//   无 .md E303 / manifest 非法 JSON E302 / lenient 推断入口 / include:false 透传 /
//   toHtml 与 openMdpkg().html 字节全等 / 自包含（doctype + data URI + title）/ 无 .md E303
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown } from '../src/markdown-export.ts';
import { toHtml, openMdpkg } from '../web/mdpkg-web.ts';
import { unpack } from '../src/zip-core.ts';
import { MdeError, E } from '../src/errors.ts';
import { makePkg } from './helpers.ts';

const enc = (s: string) => new TextEncoder().encode(s);

// PNG 魔数（与 helpers.ts makeFiles 同款，触发 data:image/png 内联）
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

// 含 include + 资源的包内文件 Map（与 helpers.ts makeFiles 同款）
function makeExportFiles(): Map<string, Uint8Array> {
  return new Map<string, Uint8Array>([
    ['document.md', enc('# 标题 (tm)\n\n![图](assets/a.png)\n\n<<< includes/c.md\n')],
    ['includes/c.md', enc('第一章 (c) --> 结束\n\n![图](img/fig.png)\n')],
  ]);
}

test('toMarkdown: 展开语义（include 内联、无 <<< 残留、被包含文件引用按包根重写）', () => {
  const text = toMarkdown(makeExportFiles());
  assert.ok(text.includes('第一章'), 'include 应已内联');
  assert.ok(!text.includes('<<<'), '展开后不应残留 <<<');
  assert.ok(text.includes('](includes/img/fig.png)'), '被包含文件的相对路径应按包根重写');
  assert.ok(text.includes('assets/a.png'), '入口文档自身引用保留相对路径');
});

test('toMarkdown: 符号保持源文本（(tm)/(c)/--> 不转 ™/©/→）', () => {
  const text = toMarkdown(makeExportFiles());
  assert.ok(text.includes('(tm)'), '(tm) 应保持源文本');
  assert.ok(text.includes('(c)'), '(c) 应保持源文本');
  assert.ok(text.includes('-->'), '--> 应保持源文本');
  assert.ok(!text.includes('™'), '不应转换为 ™');
  assert.ok(!text.includes('©'), '不应转换为 ©');
  assert.ok(!text.includes('→'), '不应转换为 →');
});

test('toMarkdown: 无 .md → 抛 E303（与 openMdpkg 错误语义一致）', () => {
  const files = new Map<string, Uint8Array>([['assets/a.png', PNG]]);
  assert.throws(
    () => toMarkdown(files),
    (e: unknown) => e instanceof MdeError && e.code === E.E303,
    '无 .md 应抛 MDPKG-E303',
  );
});

test('toMarkdown: manifest 非法 JSON → E302（与 render 同语义）', () => {
  const files = new Map<string, Uint8Array>([
    ['manifest.json', enc('{ 不是合法 JSON')],
    ['document.md', enc('# 标题\n')],
  ]);
  assert.throws(
    () => toMarkdown(files),
    (e: unknown) => e instanceof MdeError && e.code === E.E302,
    'manifest 非法 JSON 应抛 MDPKG-E302',
  );
});

test('toMarkdown: lenient 推断入口（无 manifest，docs/guide.md 可推断）', () => {
  const files = new Map<string, Uint8Array>([
    ['docs/guide.md', enc('# 指南\n\n正文内容\n')],
  ]);
  const text = toMarkdown(files);
  assert.ok(text.includes('指南'), '应推断 docs/guide.md 为入口并导出其内容');
  assert.ok(text.includes('正文内容'), '应包含入口文档正文');
});

test('toMarkdown: include: false 透传（<<< 保留为源文本，不展开）', () => {
  const files = new Map<string, Uint8Array>([
    ['document.md', enc('# 主文档\n\n<<< includes/c.md\n')],
    ['includes/c.md', enc('第一章\n')],
  ]);
  const text = toMarkdown(files, { include: false });
  assert.ok(text.includes('<<<'), 'include 关闭时 <<< 应保留为源文本');
  assert.ok(!text.includes('第一章'), 'include 关闭时不应展开被包含文件');
});

test('toMarkdown: manifest.entrypoint 优先于 lenient 推断', () => {
  const files = new Map<string, Uint8Array>([
    ['manifest.json', enc('{"entrypoint":"docs/guide.md"}')],
    ['document.md', enc('# 根文档\n')],
    ['docs/guide.md', enc('# 指南文档\n')],
  ]);
  const text = toMarkdown(files);
  assert.ok(text.includes('指南文档'), '应导出 manifest.entrypoint 指定的文档');
  assert.ok(!text.includes('根文档'), '不应导出推断候选 document.md');
});

test('toHtml: 与 openMdpkg().html 字节全等（同输入对比——同源管线证明）', async () => {
  const pkg = makePkg();
  const files = await unpack(pkg);
  const opened = await openMdpkg(pkg);
  assert.equal(opened.error, null, 'openMdpkg 不应有渲染错误');
  assert.equal(toHtml(files), opened.html, 'toHtml 应与 openMdpkg().html 逐字节一致');
});

test('toHtml: 自包含（<!doctype html> 开头、图片 data URI 内联、title=入口 basename）', () => {
  const files = new Map<string, Uint8Array>([
    ['document.md', enc('# 标题 (tm)\n\n![图](assets/a.png)\n')],
    ['assets/a.png', PNG],
  ]);
  const html = toHtml(files);
  assert.ok(html.startsWith('<!doctype html>'), '应以 <!doctype html> 开头');
  assert.ok(html.includes('data:image/png;base64,'), '图片应内联为 data URI');
  assert.ok(html.includes('<title>document.md</title>'), 'title 应为入口 basename');
  assert.ok(html.includes('™'), '渲染期符号转换应生效（(tm) → ™）');
});

test('toHtml: 无 .md → 抛 E303（纯导出函数直接抛，与 openMdpkg 错误语义一致）', () => {
  const files = new Map<string, Uint8Array>([['assets/a.png', PNG]]);
  assert.throws(
    () => toHtml(files),
    (e: unknown) => e instanceof MdeError && e.code === E.E303,
    '无 .md 应抛 MDPKG-E303',
  );
});