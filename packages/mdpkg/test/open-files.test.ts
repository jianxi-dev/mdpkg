// openFiles（任意文件 Map 的 lenient 渲染统一入口）测试：Node 直调 web/mdpkg-web.ts
// 覆盖 spec「openFiles 统一入口」Requirement 场景：
//   lenient Map 渲染 / ../ 父级引用（resolveRef 联动）/ include 缺省展开与 include:false 透传 /
//   无 .md 错误分支 / 入口推断（最浅优先、隐藏路径排除）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openFiles } from '../web/mdpkg-web.ts';
import { E } from '../src/errors.ts';

const enc = (s: string) => new TextEncoder().encode(s);

// PNG 魔数（与 helpers.ts makeFiles 同款，触发 data:image/png 内联）
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

test('openFiles: lenient Map 渲染（docs/a.md + docs/assets/p.png）→ entry/unverified/内联图片/符号/title', async () => {
  const files = new Map<string, Uint8Array>([
    ['docs/a.md', enc('# 标题 (tm)\n\n![图](assets/p.png)\n')],
    ['docs/assets/p.png', PNG],
  ]);
  const r = await openFiles(files);
  assert.equal(r.error, null);
  assert.equal(r.entry, 'docs/a.md', '入口应推断为 docs/a.md');
  assert.equal(r.unverified, true, '无 manifest 应标记未校验');
  assert.equal(r.manifest, null, '无 manifest.json 应为 null');
  assert.ok(r.html!.includes('data:image/png;base64,'), '图片应内联为 data URI');
  assert.ok(r.html!.includes('™'), '符号 (tm) 应转换为 ™');
  assert.ok(r.html!.includes('<title>a.md</title>'), 'title 应为入口 basename');
});

test('openFiles: ../ 父级引用经 resolveRef 内联（docs/doc.md 引用 ../assets/a.png）', async () => {
  const files = new Map<string, Uint8Array>([
    ['docs/doc.md', enc('# 文档\n\n![a](../assets/a.png)\n')],
    ['assets/a.png', PNG],
  ]);
  const r = await openFiles(files);
  assert.equal(r.error, null, '引用文本经 resolveRef 解析，不应报 E202');
  assert.ok(r.html!.includes('data:image/png;base64,'), '父级引用应内联为 data URI');
});

test('openFiles: include 缺省展开（document.md <<< includes/c.md）→ 无 <<< 残留', async () => {
  const files = new Map<string, Uint8Array>([
    ['document.md', enc('# 主文档\n\n<<< includes/c.md\n')],
    ['includes/c.md', enc('第一章 (c) --> 结束\n')],
  ]);
  const r = await openFiles(files);
  assert.equal(r.error, null);
  assert.ok(r.html!.includes('第一章'), '应包含被包含文件内容');
  assert.ok(r.html!.includes('©'), '被包含文件符号 (c) 应转换');
  assert.ok(!r.html!.includes('<<<'), '不应有 <<< 残留');
  assert.ok(!r.html!.includes('&#x3C;&#x3C;&#x3C;'), '不应有降级实体');
});

test('openFiles: include: false 透传 → <<< 降级为可见文本', async () => {
  const files = new Map<string, Uint8Array>([
    ['document.md', enc('# 主文档\n\n<<< includes/c.md\n')],
    ['includes/c.md', enc('第一章\n')],
  ]);
  const r = await openFiles(files, { include: false });
  assert.equal(r.error, null, 'include 关闭时不应报 E508');
  assert.ok(r.html!.includes('&#x3C;&#x3C;&#x3C;'), 'include 指令应降级为可见文本');
});

test('openFiles: 无 .md → entry 空串、validation 结构、不抛异常', async () => {
  const files = new Map<string, Uint8Array>([
    ['assets/p.png', PNG],
  ]);
  const r = await openFiles(files); // 不抛异常即通过（OpenResult 返回，错误走 error/validation 承载）
  assert.equal(r.entry, '', '错误分支 entry 应为空串');
  assert.equal(r.html, null, '渲染失败应返回 html:null');
  assert.ok(r.error?.includes(E.E303), `error 应含 MDPKG-E303: ${r.error}`);
  assert.equal(typeof r.validation.ok, 'boolean', 'validation 应含 ok 字段');
  assert.ok(Array.isArray(r.validation.errors), 'validation 应含 errors 数组');
  assert.equal(r.unverified, true, '无 manifest 应标记 unverified');
});

test('openFiles: 入口推断最浅优先（sub/a.md vs docs/deep/b.md）', async () => {
  const files = new Map<string, Uint8Array>([
    ['sub/a.md', enc('# A\n')],
    ['docs/deep/b.md', enc('# B\n')],
  ]);
  const r = await openFiles(files);
  assert.equal(r.entry, 'sub/a.md', '应取最浅的 sub/a.md');
  assert.ok(r.html!.includes('A'), '应渲染 sub/a.md 内容');
});

test('openFiles: 隐藏路径排除（.hidden.md 不参与入口候选）', async () => {
  const files = new Map<string, Uint8Array>([
    ['.hidden.md', enc('# 隐藏\n')],
    ['visible.md', enc('# 可见\n')],
  ]);
  const r = await openFiles(files);
  assert.equal(r.entry, 'visible.md', '隐藏路径不应参与候选');
  assert.ok(r.html!.includes('可见'), '应渲染 visible.md');
});