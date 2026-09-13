// M3 渲染管线测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, wrapDocument, DEFAULT_MAX_INLINE_BYTES } from '../src/render.ts';
import { buildManifest } from '../src/manifest.ts';
import { MdeError, E } from '../src/errors.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Uint8Array(500).fill(7)]);

function pkg(body: string, extra: Record<string, Uint8Array> = {}) {
  const files = new Map<string, Uint8Array>([['document.md', enc(body)], ...Object.entries(extra)]);
  return { files, withManifest: () => new Map([...files, ['manifest.json', enc(JSON.stringify(buildManifest(files)))]]) };
}

test('符号转换: 普通文本转换，代码与行内代码不转换', () => {
  const html = render(pkg('# 标题 (tm) 与 -->\n\n行内 `(tm)` 不转\n\n```\n代码块 (tm) 不转\n```\n').withManifest()).html;
  assert.ok(html.includes('™'), '普通文本应转换');
  assert.ok(html.includes('→'), '箭头应转换');
  assert.ok(html.includes('<code>(tm)</code>'), '行内代码不应转换');
  assert.ok(/<pre><code>[\s\S]*\(tm\)/.test(html), '代码块不应转换');
});

test('哨兵法转义: \\(tm) 保留字面，普通 (tm) 正常转换', () => {
  const html = render(pkg('字面 \\(tm) 与 转换 (tm)\n').withManifest()).html;
  assert.ok(html.includes('(tm)'), '转义应保留字面 (tm)');
  assert.ok(html.includes('™'), '未转义的应转换');
});

test('词边界: a<=b 与 v1.2-->v2 与路径不误伤', () => {
  // 断言「未出现转换后的符号」而非匹配原文：rehype-stringify 用数字实体（< → &#x3C;）
  // 且文本中的 > 不转义，按字面匹配会与序列化细节耦合
  const html = render(pkg('a<=b 与 v1.2-->v2 与 路径/a/b 与 结尾 (tm)\n').withManifest()).html;
  assert.ok(!html.includes('a≤b'), 'a<=b 不应转换为 a≤b');
  assert.ok(!html.includes('v1.2→v2'), '版本号中的箭头不应转换');
  assert.ok(html.includes('™'), '行尾的 (tm) 仍应正常转换');
});

test('消毒: script 与 on* 事件属性被清除', () => {
  const html = render(pkg('<script>alert(1)</script>\n\n<img src="x.png" onerror="alert(1)">\n\n[链接](javascript:alert(1))\n').withManifest()).html;
  assert.ok(!html.includes('<script'), 'script 应被清除');
  assert.ok(!html.includes('onerror'), 'on* 属性应被清除');
  assert.ok(!html.includes('javascript:'), 'javascript: URL 应被清除');
});

test('inline 模式: 包内图片转 data URI，外链补 referrerpolicy', () => {
  const files = pkg('![a](assets/a.png)\n\n![外](https://example.com/x.png)\n', { 'assets/a.png': PNG }).withManifest();
  const html = render(files, { inline: true }).html;
  assert.ok(html.includes('src="data:image/png;base64,'), '包内图片应内联为 data URI');
  assert.ok(html.includes('referrerpolicy="no-referrer"'), '外链图片应补 referrerpolicy');
  // 外链保留原 URL 是正确的（只是补 referrerpolicy），要断言的是它没被 base64 化
  assert.ok(!/src="data:[^"]*example\.com/.test(html), '外链不应被内联为 data URI');
  assert.ok(html.includes('src="https://example.com/x.png"'), '外链 URL 应原样保留');
});

test('dir 模式: 图片保留相对路径', () => {
  const files = pkg('![a](assets/a.png)\n', { 'assets/a.png': PNG }).withManifest();
  const html = render(files, { dir: true }).html;
  assert.ok(html.includes('src="assets/a.png"'), 'dir 模式应保留相对路径');
  assert.equal(render(files, { dir: true }).mode, 'dir');
});

test('阈值降级: 资源总量超限时自动降为 dir 并标记 degraded', () => {
  const files = pkg('![a](assets/a.png)\n', { 'assets/a.png': PNG }).withManifest();
  const r = render(files, { maxInlineBytes: 10 }); // 10 字节阈值，包必然超限
  assert.equal(r.mode, 'dir');
  assert.equal(r.degraded, true);
  assert.equal(r.html.includes('data:image/png;base64,'), false, '降级后不应内联');
  assert.ok(r.totalBytes > 10);
  // 显式 --inline 时忽略阈值
  assert.equal(render(files, { inline: true, maxInlineBytes: 10 }).mode, 'inline');
  assert.equal(DEFAULT_MAX_INLINE_BYTES, 50 * 1024 * 1024);
});

test('extensions.symbols 为 off 时不转换', () => {
  const files = pkg('标题 (tm)\n').withManifest();
  const m = new Map(files);
  const man = JSON.parse(new TextDecoder().decode(m.get('manifest.json')!));
  man.extensions = { symbols: 'off' };
  m.set('manifest.json', enc(JSON.stringify(man)));
  assert.ok(!render(m).html.includes('™'), 'symbols=off 应完全不转换');
});

test('wrapDocument: 输出 HTML 壳并转义标题', () => {
  const doc = wrapDocument('<script>x</script>', '<p>正文</p>');
  assert.ok(doc.startsWith('<!doctype html>'));
  assert.ok(doc.includes('<p>正文</p>'));
  assert.ok(!doc.includes('<script>x</script>'), '标题应被转义');
});

test('include 开关: 显式 include:false 时 <<< 降级为可见文本，不抛 E508', () => {
  const files = new Map<string, Uint8Array>([['document.md', enc('# 标题\n\n<<< missing.md\n')]]);
  const html = render(files, { include: false }).html;
  // rehype-stringify 对文本中的 < 用数字实体（&#x3C;），浏览器渲染即可见的 <<<
  assert.ok(html.includes('&#x3C;&#x3C;&#x3C;'), '未展开的 include 指令应降级为可见文本');
});

test('include 开关: 缺省与显式 include:true 均展开，缺失目标抛 E508（既有行为锁定）', () => {
  const files = new Map<string, Uint8Array>([['document.md', enc('# 标题\n\n<<< missing.md\n')]]);
  assert.throws(() => render(files), (e: unknown) => e instanceof MdeError && e.code === E.E508, '缺省应展开并抛 E508');
  assert.throws(() => render(files, { include: true }), (e: unknown) => e instanceof MdeError && e.code === E.E508, '显式 true 应展开并抛 E508');
});

test('include 开关: 显式 include:false 覆盖 manifest.extensions.include 缺省展开', () => {
  const files = pkg('# 标题\n\n<<< missing.md\n').withManifest();
  const html = render(files, { include: false }).html;
  assert.ok(html.includes('&#x3C;&#x3C;&#x3C;'), '显式 false 应优先于 manifest 缺省');
});

// ============ 相对引用解析（folder-drop-open 组 0，任务 0.5） ============

test('相对引用: docs/doc.md 引用 ../assets/a.png 内联（zip2 场景，不再 E202）', () => {
  const files = new Map<string, Uint8Array>([
    ['docs/doc.md', enc('![a](../assets/a.png)\n')],
    ['assets/a.png', PNG],
  ]);
  const html = render(files, { inline: true }).html;
  assert.ok(html.includes('src="data:image/png;base64,'), '父级引用应解析为 assets/a.png 并内联');
});

test('相对引用: 越根 ../../x.png 不抛错不内联', () => {
  const files = new Map<string, Uint8Array>([
    ['docs/doc.md', enc('![a](../../x.png)\n')],
  ]);
  const html = render(files, { inline: true }).html;
  assert.ok(!html.includes('data:image/png'), '越根引用不应内联');
  assert.ok(html.includes('../../x.png'), '越根引用应保留原文');
});

test('相对引用: ./ 同级引用内联', () => {
  const files = new Map<string, Uint8Array>([
    ['docs/doc.md', enc('![a](./assets/a.png)\n')],
    ['docs/assets/a.png', PNG],
  ]);
  const html = render(files, { inline: true }).html;
  assert.ok(html.includes('src="data:image/png;base64,'), '同级引用应解析为 docs/assets/a.png 并内联');
});

test('相对引用: include 内 ../ 引用重写后内联', () => {
  const files = new Map<string, Uint8Array>([
    ['document.md', enc('# 标题\n\n<<< includes/c.md\n')],
    ['includes/c.md', enc('![a](../assets/b.png)\n')],
    ['assets/b.png', PNG],
  ]);
  const html = render(files, { inline: true }).html;
  assert.ok(html.includes('src="data:image/png;base64,'), '被包含文件的父级引用应重写为 assets/b.png 并内联');
});

// ============ PR-A: frontmatter 剥离 + CJK 间距（反哺 md-bundle） ============

test('frontmatter: 文档头部 YAML 剥离，不渲染为 hr 与正文', () => {
  const md = '---\ntitle: 示例文档\ntags: [a, b]\n---\n\n# 标题\n';
  const html = render(pkg(md).withManifest()).html;
  assert.ok(!html.includes('title:'), 'frontmatter 内容应被剥离');
  assert.ok(!html.includes('tags:'), 'frontmatter 内容应被剥离');
  assert.ok(html.includes('<h1>标题</h1>'), 'frontmatter 后正文应正常渲染');
});

test('frontmatter: 容忍 BOM 与 EOF 无尾换行', () => {
  const html = render(pkg('\uFEFF---\ntitle: x\n---\n正文\n').withManifest()).html;
  assert.ok(!html.includes('title:'), '带 BOM 的 frontmatter 也应剥离');
  assert.ok(html.includes('正文'), '剥离后正文保留');
});

test('frontmatter: 文档中部 --- 保留为分隔线（仅头部剥离）', () => {
  const md = '# 标题\n\n---\n\n正文\n';
  const html = render(pkg(md).withManifest()).html;
  assert.ok(html.includes('<hr'), '文档中部 --- 应保留为分隔线');
});

test('frontmatter: include 展开后形成的文档头部仍剥离，中部 include 的 --- 不动', () => {
  const files = new Map<string, Uint8Array>([
    ['document.md', enc('<<< meta.md\n\n# 标题\n')],
    ['meta.md', enc('---\nsummary: s\n---\n')],
  ]);
  const html = render(files).html;
  assert.ok(!html.includes('summary:'), 'include 展开后位于头部的 frontmatter 应剥离');
  const mid = render(new Map<string, Uint8Array>([
    ['document.md', enc('# 标题\n\n<<< meta2.md\n')],
    ['meta2.md', enc('---\nsummary: s\n---\n')],
  ])).html;
  assert.ok(mid.includes('summary:'), 'include 内容位于中部时不应剥离（保留可见文本）');
});

test('CJK 间距: 中英/中文数字间插零宽，代码块与行内代码不插', () => {
  const md = '中文English与数字123混排\n\n```\n中文code\n```\n\n行内 `中文inline` 不插\n';
  const html = render(pkg(md).withManifest()).html;
  assert.ok(html.includes('中文\u200BEnglish'), '中→英应插零宽');
  assert.ok(html.includes('English\u200B与'), '英→中应插零宽');
  assert.ok(html.includes('数字\u200B123'), '中→数字应插零宽');
  assert.ok(html.includes('123\u200B混排'), '数字→中应插零宽');
  assert.ok(!html.includes('中文\u200Bcode'), '代码块内不应插零宽');
  assert.ok(html.includes('<code>中文inline</code>'), '行内代码不应插零宽');
});

test('CJK 间距: cjkSpacing:false 关闭插距', () => {
  const html = render(pkg('中文English\n').withManifest(), { cjkSpacing: false }).html;
  assert.ok(!html.includes('中文\u200BEnglish'), '关闭后不应插零宽');
});

test('CJK 守卫: 累计 text 超 20 万字符后不再插零宽', () => {
  const body = '中a'.repeat(100_000) + '\n\n' + '中b';
  const html = render(pkg(body + '\n').withManifest()).html;
  assert.ok(html.includes('中\u200Ba'), '预算内应插零宽');
  assert.ok(!html.includes('中\u200Bb'), '预算耗尽后的文本节点不应插零宽');
});

test('外链: 协议相对 // 与 http 均保留并补 referrerpolicy（不内联）', () => {
  const files = pkg('![a](//example.com/x.png)\n\n![b](https://example.com/y.png)\n').withManifest();
  const html = render(files, { inline: true }).html;
  assert.ok(html.includes('src="//example.com/x.png"'), '协议相对 URL 应原样保留');
  assert.ok(html.includes('src="https://example.com/y.png"'), 'https URL 应原样保留');
  assert.ok(html.includes('referrerpolicy="no-referrer"'), '外链应补 referrerpolicy');
  assert.ok(!/src="data:[^"]*example\.com/.test(html), '外链不应被内联为 data URI');
});
