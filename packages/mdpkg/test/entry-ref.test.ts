// 入口文档引用双重前缀 bug 回归（F1/F2）：
// 入口文档引用是「相对包根」语义（收集键与引用一致，精确查即可命中），expand 不重写入口非指令行；
// 仅被包含文件（include 展开内容）的引用按被包含文件目录重写。
// checkClosure 引用匹配先精确、未命中按入口文档目录 resolveRef 回退（与渲染 assetsPlugin 同一语义）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/render.ts';
import { checkClosure } from '../src/manifest.ts';
import { expand } from '../src/include.ts';
import { MdeError, E } from '../src/errors.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

test('入口引用已含顶层目录名：不双重前缀，render 内联 + checkClosure 通过', () => {
  const files = new Map<string, Uint8Array>([
    ['ima笔记使用指南/ima笔记使用指南.md', enc('![](ima笔记使用指南/attachment/1.gif)\n')],
    ['ima笔记使用指南/attachment/1.gif', PNG],
  ]);
  const html = render(files, { inline: true }).html;
  assert.ok(html.includes('src="data:image/gif;base64,'), '引用应精确命中并内联（不得双重前缀）');
  assert.doesNotThrow(() => checkClosure(files, 'ima笔记使用指南/ima笔记使用指南.md'), 'checkClosure 不应报 E401');
});

test('相对文档引用（mydoc/doc.md → assets/a.png）：resolveRef 回退内联 + checkClosure 通过', () => {
  const files = new Map<string, Uint8Array>([
    ['mydoc/doc.md', enc('![](assets/a.png)\n')],
    ['mydoc/assets/a.png', PNG],
  ]);
  const html = render(files, { inline: true }).html;
  assert.ok(html.includes('src="data:image/png;base64,'), '相对文档引用应经 resolveRef 回退内联');
  assert.doesNotThrow(() => checkClosure(files, 'mydoc/doc.md'), 'checkClosure 应经 resolveRef 回退通过');
});

test('include 内容重写保持：被包含文件引用仍按被包含文件目录重写', () => {
  const files = new Map<string, Uint8Array>([
    ['document.md', enc('# 主\n\n<<< includes/c.md\n')],
    ['includes/c.md', enc('![a](../assets/b.png)\n')],
    ['assets/b.png', PNG],
  ]);
  const html = render(files, { inline: true }).html;
  assert.ok(html.includes('src="data:image/png;base64,'), '被包含文件的 ../ 引用应重写后内联');
  assert.doesNotThrow(() => checkClosure(files, 'document.md'), 'checkClosure 应通过');
});

test('expand: 入口文档引用保持原样（相对包根语义），<<< 指令仍触发', () => {
  const files = new Map<string, Uint8Array>([
    ['ima笔记使用指南/ima笔记使用指南.md', enc('![](ima笔记使用指南/attachment/1.gif)\n\n<<< includes/c.md\n')],
    ['ima笔记使用指南/attachment/1.gif', PNG],
    ['includes/c.md', enc('![a](../assets/b.png)\n')],
  ]);
  const r = expand(files, 'ima笔记使用指南/ima笔记使用指南.md');
  assert.ok(r.text.includes('![](ima笔记使用指南/attachment/1.gif)'), '入口引用不应被重写');
  assert.ok(r.text.includes('![a](assets/b.png)'), '被包含文件引用按自身目录重写（../assets/b.png → assets/b.png）');
  assert.equal(r.count, 1, '入口文档的 <<< 指令仍应触发 include');
});

test('.. 引用缺失：checkClosure 报 E401 而非 E202（引用文本语义与条目路径校验分离）', () => {
  const files = new Map<string, Uint8Array>([
    ['docs/doc.md', enc('![a](../nope.png)\n')],
  ]);
  assert.throws(
    () => checkClosure(files, 'docs/doc.md'),
    (e: unknown) => e instanceof MdeError && e.code === E.E401,
    '缺失的 .. 引用应报 E401（引用文本可含 .. 段，不触发 E202）',
  );
});