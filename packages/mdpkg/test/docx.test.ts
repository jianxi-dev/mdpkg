// docx 导出测试（OpenSpec add-docx-export 分组 4，任务 4.1-4.6）
// 覆盖：单元级序列化断言（4.1）/ fixtures 往返保真（4.2）/ HTML 与 docx 内容一致性（4.3）/
//       互操作（4.4）/ CLI 负例（4.5）
// 风格参照 zip-export.test.ts：node:test + assert/strict、spawnSync 互操作、fixtures 驱动、中文用例名
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toDocx } from '../src/docx.ts';
import { render } from '../src/render.ts';
import { pack, unpack, collectFiles } from '../src/container.ts';
import { buildManifest } from '../src/manifest.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = new TextDecoder();
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../..'); // 仓库根（spec/fixtures 所在）
const CLI = join(__dirname, '../src/cli.ts');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

// --- 工具 ---

/** 解 docx 产物为 OOXML 部件（docx 是标准 ZIP 容器，unpack 可直接读） */
function unpackDocx(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  return unpack(bytes);
}

/** 从 document.xml 提取纯文本：按段落切分，段内拼接 w:t（w:br 软换行并入段内） */
function docxText(docXml: string): string {
  return docXml
    .split('<w:p>')
    .map((p) => [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(''))
    .join('\n');
}

/**
 * HTML 去标签提取纯文本：先删 script/style，再剥标签，再解常见实体。
 * 注意：docx 与 HTML 路径对 raw HTML 的呈现策略差异是**有意的**（design D4）——
 * HTML 路径经 rehype-sanitize 整块删除 script/style，docx 路径只丢 script/style 元素、
 * 其余输出字面量文本；4.3 一致性仅覆盖双路径共有语义（符号/展开/文本），不掩盖此差异。
 */
function htmlText(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x3C;/g, '<')
    .replace(/&#x3E;/g, '>');
}

/** 空白归一化（比较语义文本用，忽略结构差异） */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 构造含 manifest 的包（与 render.test.ts 同款模式） */
function pkg(body: string, extra: Record<string, Uint8Array> = {}): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>([['document.md', enc(body)], ...Object.entries(extra)]);
  return new Map([...files, ['manifest.json', enc(JSON.stringify(buildManifest(files)))]]);
}

// ============ 4.1 单元级序列化断言（直接调 toDocx，解包读 word/document.xml） ============

test('4.1 标题 1-6：pStyle 与文本保真', async () => {
  const body = ['# 标题一', '## 标题二', '### 标题三', '#### 标题四', '##### 标题五', '###### 标题六'].join('\n');
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  for (let i = 1; i <= 6; i++) {
    assert.ok(doc.includes(`<w:pStyle w:val="Heading${i}"/>`), `应含 Heading${i} 样式`);
  }
  const text = docxText(doc);
  for (const t of ['标题一', '标题二', '标题三', '标题四', '标题五', '标题六']) {
    assert.ok(text.includes(t), `标题文本应保真: ${t}`);
  }
});

test('4.1 段落与行内格式：strong/em/delete/inlineCode 的 run 属性', async () => {
  const body = '普通段落 **粗体** *斜体* ~~删除~~ `行内代码`\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('<w:b/>'), 'strong 应输出粗体 run');
  assert.ok(doc.includes('<w:i/>'), 'em 应输出斜体 run');
  assert.ok(doc.includes('<w:strike/>'), 'delete 应输出删除线 run');
  assert.ok(doc.includes('Consolas'), '行内代码应使用等宽字体');
  const text = docxText(doc);
  for (const t of ['普通段落', '粗体', '斜体', '删除', '行内代码']) {
    assert.ok(text.includes(t), `行内文本应保真: ${t}`);
  }
});

test('4.1 引用与代码块：Quote/CodeBlock 样式', async () => {
  const body = '> 引用段落\n\n```js\nconst a = 1;\n```\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('<w:pStyle w:val="Quote"/>'), '引用应使用 Quote 样式');
  assert.ok(doc.includes('<w:pStyle w:val="CodeBlock"/>'), '代码块应使用 CodeBlock 样式');
  const text = docxText(doc);
  assert.ok(text.includes('引用段落'), '引用文本应保真');
  assert.ok(text.includes('const a = 1;'), '代码块文本应保真');
});

test('4.1 列表：ul/ol 编号、嵌套 ilvl、任务列表前缀', async () => {
  const body = [
    '- 项目一',
    '- 项目二',
    '  - 嵌套一',
    '    - 嵌套二',
    '',
    '1. 第一',
    '2. 第二',
    '',
    '- [x] 已完成',
    '- [ ] 未完成',
  ].join('\n');
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('<w:numId w:val="1"/>'), 'ul 应使用 numId 1（项目符号）');
  assert.ok(doc.includes('<w:numId w:val="2"/>'), 'ol 应使用 numId 2（十进制）');
  assert.ok(doc.includes('<w:ilvl w:val="1"/>'), '嵌套列表应 ilvl=1');
  assert.ok(doc.includes('<w:ilvl w:val="2"/>'), '二级嵌套应 ilvl=2');
  const text = docxText(doc);
  assert.ok(text.includes('[x] 已完成'), '任务列表已完成项应带 [x] 前缀');
  assert.ok(text.includes('[ ] 未完成'), '任务列表未完成项应带 [ ] 前缀');
  for (const t of ['项目一', '嵌套一', '嵌套二', '第一', '第二']) {
    assert.ok(text.includes(t), `列表文本应保真: ${t}`);
  }
});

test('4.1 表格与水平线：tbl 单元格文本与 pBdr', async () => {
  const body = '| 列A | 列B |\n| --- | --- |\n| 甲 | 乙 |\n\n---\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('<w:tbl>'), '表格应输出 w:tbl');
  assert.ok(doc.includes('<w:pBdr>'), '水平线应输出段落边框');
  const text = docxText(doc);
  for (const t of ['列A', '列B', '甲', '乙']) {
    assert.ok(text.includes(t), `单元格文本应保真: ${t}`);
  }
});

test('4.1 外链：hyperlink rId 与 rels TargetMode=External', async () => {
  const body = '[外链](https://example.com)\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const rels = dec.decode(out.get('word/_rels/document.xml.rels')!);
  assert.ok(doc.includes('<w:hyperlink r:id="rId3"'), '外链应输出 hyperlink（rId1/2 为 styles/numbering）');
  assert.ok(rels.includes('TargetMode="External"'), '外链关系应标记 External');
  assert.ok(rels.includes('Target="https://example.com"'), '外链目标应写入 rels');
  assert.ok(docxText(doc).includes('外链'), '链接文本应保真');
});

test('4.1 图片：drawing 与 word/media 字节一致', async () => {
  const body = '![图](assets/a.png)\n';
  const out = await unpackDocx(toDocx(pkg(body, { 'assets/a.png': PNG })));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('<w:drawing>'), '图片应输出 w:drawing');
  assert.ok(doc.includes('r:embed="rId3"'), '图片应引用 rId3 关系');
  assert.ok(out.has('word/media/img-1.png'), '位图应写入 word/media/img-1.png');
  assert.deepEqual(out.get('word/media/img-1.png'), PNG, '媒体字节应与源一致');
});

test('4.1 相对引用：docs/doc.md 的 ../assets/a.png 嵌入 word/media', async () => {
  const files = new Map<string, Uint8Array>([
    ['docs/doc.md', enc('![图](../assets/a.png)\n')],
    ['assets/a.png', PNG],
  ]);
  const out = await unpackDocx(toDocx(files));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('<w:drawing>'), '父级引用图片应嵌入 w:drawing');
  assert.ok(out.has('word/media/img-1.png'), '位图应写入 word/media/img-1.png');
  assert.deepEqual(out.get('word/media/img-1.png'), PNG, '媒体字节应与源一致');
});

test('4.1 相对引用：越根 ../../x.png 不抛错，alt 占位', async () => {
  const files = new Map<string, Uint8Array>([
    ['docs/doc.md', enc('![图](../../x.png)\n')],
  ]);
  const out = await unpackDocx(toDocx(files));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(!doc.includes('<w:drawing>'), '越根引用不应嵌入');
  assert.ok(docxText(doc).includes('图'), '应以 alt 文本占位');
});

// ============ 4.2 往返与保真（spec/fixtures 驱动） ============

test('4.2 fixture render-symbols：符号已转换', async () => {
  const files = collectFiles(join(ROOT, 'spec/fixtures/render-symbols/input'));
  const out = await unpackDocx(toDocx(files));
  const text = docxText(dec.decode(out.get('word/document.xml')!));
  for (const s of ['™', '©', '®', '→', '←', '↔', '±', '≠', '≤', '≥']) {
    assert.ok(text.includes(s), `符号应已转换: ${s}`);
  }
});

test('4.2 fixture render-include-nested：include 展开 + 图片嵌入', async () => {
  const files = collectFiles(join(ROOT, 'spec/fixtures/render-include-nested/input'));
  const out = await unpackDocx(toDocx(files));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  assert.ok(text.includes('主'), '入口标题应保真');
  assert.ok(text.includes('第一章'), 'include 内容应已展开');
  assert.ok(text.includes('™') && text.includes('©'), '符号应已转换');
  assert.ok(!text.includes('<<<'), '不应残留 <<< 指令');
  assert.ok(doc.includes('<w:drawing>'), '被包含文件的图片应嵌入');
  assert.ok(out.has('word/media/img-1.png'), '图片应写入 word/media');
});

test('4.2 fixture include-multi-level：多层 include 展开无残留', async () => {
  const files = collectFiles(join(ROOT, 'spec/fixtures/include-multi-level/input'));
  const out = await unpackDocx(toDocx(files));
  const text = docxText(dec.decode(out.get('word/document.xml')!));
  for (const s of ['L1', 'L2', 'L3']) {
    assert.ok(text.includes(s), `应包含 ${s}`);
  }
  assert.ok(!text.includes('<<<'), '不应残留 <<<');
});

test('4.2 fixture sec-html-injection：raw HTML 不产生内容', async () => {
  const files = collectFiles(join(ROOT, 'spec/fixtures/sec-html-injection/input'));
  const out = await unpackDocx(toDocx(files));
  const text = docxText(dec.decode(out.get('word/document.xml')!));
  assert.ok(!text.includes('<script'), 'script 标签不应出现（内容已丢弃）');
  assert.ok(text.includes('&lt;img src='), 'img 应降级为字面量文本（XML 转义，无执行面）');
  assert.ok(text.includes('链接'), '链接文本应保真');
  assert.ok(!text.includes('javascript:'), 'javascript: URL 不应出现');
});

// ============ 4.3 内容一致性（HTML 路径 vs docx 路径） ============

test('4.3 HTML 与 docx 路径语义一致：符号与 include 展开', async () => {
  const files = new Map<string, Uint8Array>([
    ['document.md', enc('# 标题 (tm)\n\n第一章 (c) --> 结束\n\n- 项目一\n- 项目二\n\n<<< includes/ch1.md\n')],
    ['includes/ch1.md', enc('包含内容 (r) <-- 返回\n')],
  ]);
  const html = render(files).html;
  const out = await unpackDocx(toDocx(files));
  const docx = docxText(dec.decode(out.get('word/document.xml')!));
  assert.equal(norm(htmlText(html)), norm(docx), '两侧归一化纯文本应一致（符号与展开语义相同）');
});

// ============ 4.4 互操作 ============

test('4.4 unzip -l：标准 OOXML 条目可列', async () => {
  const tmp = join(__dirname, '.test-docx-unzip');
  mkdirSync(tmp, { recursive: true });
  const docxPath = join(tmp, 'out.docx');
  writeFileSync(docxPath, toDocx(pkg('# 标题\n')));
  const r = spawnSync('unzip', ['-l', docxPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, `unzip -l 应成功: ${r.stderr}`);
  for (const entry of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels']) {
    assert.ok(r.stdout.includes(entry), `应列出标准条目: ${entry}`);
  }
  rmSync(tmp, { recursive: true, force: true });
});

test('4.4 可打开性：soffice/textutil 转换成功且文本非空', async (t) => {
  const hasSoffice = spawnSync('which', ['soffice'], { encoding: 'utf8' }).status === 0;
  const hasTextutil = spawnSync('which', ['textutil'], { encoding: 'utf8' }).status === 0;
  if (!hasSoffice && !hasTextutil) {
    t.skip('本机无 soffice 与 textutil，跳过可打开性验证');
    return;
  }
  const tmp = join(__dirname, '.test-docx-open');
  mkdirSync(tmp, { recursive: true });
  const docxPath = join(tmp, 'out.docx');
  writeFileSync(docxPath, toDocx(pkg('# 标题 (tm)\n\n正文段落\n')));
  const txtPath = join(tmp, 'out.txt');
  let r;
  if (hasSoffice) {
    r = spawnSync('soffice', ['--headless', '--convert-to', 'txt', '--outdir', tmp, docxPath], { encoding: 'utf8' });
  } else {
    r = spawnSync('textutil', ['-convert', 'txt', docxPath, '-output', txtPath], { encoding: 'utf8' });
  }
  assert.equal(r.status, 0, `转换应成功: ${r.stderr}`);
  const txt = readFileSync(txtPath, 'utf8');
  assert.ok(txt.trim().length > 0, '转换输出文本不应为空');
  assert.ok(txt.includes('标题'), '转换文本应含标题');
  rmSync(tmp, { recursive: true, force: true });
});

// ============ 4.5 CLI 负例（spawnSync node src/cli.ts） ============

/** 构造真实 .mdpkg 文件供 CLI 使用 */
function makeCliPkg(dir: string, files: Map<string, Uint8Array>): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'demo.mdpkg');
  writeFileSync(p, pack(files, buildManifest(files)));
  return p;
}

test('4.5 CLI：--format docx 与 --inline 互斥 → 退出码 2', () => {
  const tmp = join(__dirname, '.test-docx-cli-inline');
  const pkgPath = makeCliPkg(tmp, new Map([['document.md', enc('# 标题\n')]]));
  const r = spawnSync(process.execPath, [CLI, 'render', pkgPath, '--format', 'docx', '--inline'], { encoding: 'utf8' });
  assert.equal(r.status, 2, '应退出码 2（用法错误）');
  assert.ok(r.stderr.includes('互斥'), 'stderr 应含用法消息');
  rmSync(tmp, { recursive: true, force: true });
});

test('4.5 CLI：--format docx 与 --dir 互斥 → 退出码 2', () => {
  const tmp = join(__dirname, '.test-docx-cli-dir');
  const pkgPath = makeCliPkg(tmp, new Map([['document.md', enc('# 标题\n')]]));
  const r = spawnSync(process.execPath, [CLI, 'render', pkgPath, '--format', 'docx', '--dir'], { encoding: 'utf8' });
  assert.equal(r.status, 2, '应退出码 2（用法错误）');
  assert.ok(r.stderr.includes('互斥'), 'stderr 应含用法消息');
  rmSync(tmp, { recursive: true, force: true });
});

test('4.5 CLI：非法 --format → 退出码 2', () => {
  const tmp = join(__dirname, '.test-docx-cli-badfmt');
  const pkgPath = makeCliPkg(tmp, new Map([['document.md', enc('# 标题\n')]]));
  const r = spawnSync(process.execPath, [CLI, 'render', pkgPath, '--format', 'bad'], { encoding: 'utf8' });
  assert.equal(r.status, 2, '非法格式应退出码 2');
  assert.ok(r.stderr.includes('html|docx'), 'stderr 应含支持格式说明');
  rmSync(tmp, { recursive: true, force: true });
});

test('4.5 CLI：SVG 图片 → 退出码 0 + stderr 含 SVG 警告', () => {
  const tmp = join(__dirname, '.test-docx-cli-svg');
  const pkgPath = makeCliPkg(tmp, new Map([
    ['document.md', enc('# 标题\n\n![svg](assets/a.svg)\n')],
    ['assets/a.svg', enc('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')],
  ]));
  const outPath = join(tmp, 'out.docx');
  const r = spawnSync(process.execPath, [CLI, 'render', pkgPath, '--format', 'docx', '-o', outPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'SVG 降级不应失败（退出码 0）');
  assert.ok(r.stderr.includes('SVG'), 'stderr 应含 SVG 警告');
  assert.ok(r.stderr.includes('警告'), 'stderr 应含警告前缀');
  assert.ok(existsSync(outPath), '应产出 docx 文件');
  rmSync(tmp, { recursive: true, force: true });
});

test('4.5 CLI：缺省 -o 按包名替换 .docx（demo.mdpkg → demo.docx）', () => {
  const tmp = join(__dirname, '.test-docx-cli-default');
  const pkgPath = makeCliPkg(tmp, new Map([['document.md', enc('# 标题\n')]]));
  const r = spawnSync(process.execPath, [CLI, 'render', pkgPath, '--format', 'docx'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `退出码应为 0，实际 ${r.status}: ${r.stderr}`);
  const defaultDocx = join(tmp, 'demo.docx');
  assert.ok(existsSync(defaultDocx), `应生成 ${defaultDocx}`);
  assert.ok(r.stdout.includes('demo.docx'), `stdout 应含输出路径: ${r.stdout}`);
  rmSync(tmp, { recursive: true, force: true });
});