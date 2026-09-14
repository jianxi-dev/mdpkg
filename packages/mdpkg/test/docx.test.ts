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
  const body = ['- 项目一', '- 项目二', '  - 嵌套一', '    - 嵌套二', '', '1. 第一', '2. 第二', '', '- [x] 已完成', '- [ ] 未完成'].join(
    '\n'
  );
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('<w:numId w:val="1"/>'), 'ul 应使用 numId 1（项目符号）');
  assert.ok(doc.includes('<w:numId w:val="2"/>'), 'ol 应使用 numId 2（十进制）');
  assert.ok(doc.includes('<w:ilvl w:val="1"/>'), '嵌套列表应 ilvl=1');
  assert.ok(doc.includes('<w:ilvl w:val="2"/>'), '二级嵌套应 ilvl=2');
  const text = docxText(doc);
  assert.ok(text.includes('☑ 已完成'), '任务列表已完成项应带 ☑ 字形');
  assert.ok(text.includes('☐ 未完成'), '任务列表未完成项应带 ☐ 字形');
  assert.ok(!text.includes('[x]'), '不应残留 [x] 文本');
  assert.ok(!text.includes('[ ]'), '不应残留 [ ] 文本');
  for (const t of ['项目一', '嵌套一', '嵌套二', '第一', '第二']) {
    assert.ok(text.includes(t), `列表文本应保真: ${t}`);
  }
});

test('4.1 表格与水平线：tbl 单元格文本保真 + --- 无输出', async () => {
  const body = '| 列A | 列B |\n| --- | --- |\n| 甲 | 乙 |\n\n---\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('<w:tbl>'), '表格应输出 w:tbl');
  assert.ok(!doc.includes('<w:pBdr><w:bottom'), '--- 不应输出段落边框（v1 不输出水平线）');
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
  const files = new Map<string, Uint8Array>([['docs/doc.md', enc('![图](../../x.png)\n')]]);
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
  for (const entry of [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/document.xml',
    'word/styles.xml',
    'word/numbering.xml',
    'word/_rels/document.xml.rels',
  ]) {
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
  const pkgPath = makeCliPkg(
    tmp,
    new Map([
      ['document.md', enc('# 标题\n\n![svg](assets/a.svg)\n')],
      ['assets/a.svg', enc('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')],
    ])
  );
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

// ============ Wave 1.1 数学 AST 前处理 pass ============

test('Wave 1.1 行内数学：$a^2 + b^2$ 去除 $ 定界符', async () => {
  const body = '公式 $a^2 + b^2$ 结束\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const text = docxText(dec.decode(out.get('word/document.xml')!));
  assert.ok(text.includes('a^2 + b^2'), '行内数学内容应保真');
  assert.ok(!text.includes('$'), '不应残留 $ 定界符');
});

test('Wave 1.1 块级数学：$$...$$ 独立段落无 $', async () => {
  const body = '前文\n\n$$E = mc^2$$\n\n后文\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  assert.ok(text.includes('E = mc^2'), '块级数学内容应保真');
  assert.ok(!text.includes('$'), '不应残留 $ 定界符');
  assert.ok(doc.includes('</w:p><w:p>'), '块级数学应独立成段');
});

test('Wave 1.1 相邻数学：行内与块级共存', async () => {
  const body = '行内 $a$ 与块级\n\n$$b^2$$\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const text = docxText(dec.decode(out.get('word/document.xml')!));
  assert.ok(text.includes('行内'), '行内文本应保真');
  assert.ok(text.includes('a'), '行内数学内容应保真');
  assert.ok(text.includes('b^2'), '块级数学内容应保真');
  assert.ok(!text.includes('$'), '不应残留 $');
});

test('Wave 1.1 代码块内不提取数学', async () => {
  const body = '```\n$x + y$\n```\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const text = docxText(dec.decode(out.get('word/document.xml')!));
  assert.ok(text.includes('$x + y$'), '代码块内 $ 应保持原样');
});

test('Wave 1.1 表格内不提取数学', async () => {
  const body = '| 列 |\n| --- |\n| $a$ |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const text = docxText(dec.decode(out.get('word/document.xml')!));
  assert.ok(text.includes('$a$'), '表格单元格内 $ 应保持原样');
});

test('Wave 1.1 未闭合 $ 不崩溃且保持原样', async () => {
  const body = '未闭合 $a + b 文本\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const text = docxText(dec.decode(out.get('word/document.xml')!));
  assert.ok(text.includes('$a + b'), '未闭合 $ 应保持原样');
  assert.ok(text.includes('未闭合'), '上下文文本应保真');
});

// ============ Wave 1.2 Callout 识别 ============

test('Wave 1.2 已知键 callout：> [!TIP] 去标识输出带底纹与左边框的 callout 块', async () => {
  const body = '> [!TIP]\n> 提示内容\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  assert.ok(!text.includes('TIP'), '不应残留 TIP 标识文本');
  assert.ok(!text.includes('[!'), '不应残留 [! 标识');
  assert.ok(text.includes('提示内容'), 'callout 内容应保真');
  assert.ok(doc.includes('<w:pBdr><w:left w:val="single" w:sz="18"'), 'callout 应有加粗左边框');
  assert.ok(doc.includes('w:fill="ECF7EC"'), 'TIP 应使用类型背景色');
});

test('Wave 1.2 未知键降级：> [!FOO] 保持 blockquote', async () => {
  const body = '> [!FOO]\n> 未知内容\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  assert.ok(text.includes('FOO'), '未知键标签文本应保留');
  assert.ok(text.includes('未知内容'), '内容应保真');
  assert.ok(doc.includes('<w:pStyle w:val="Quote"/>'), '未知键应使用 Quote 样式');
});

test('Wave 1.2 非首行标签：> [!TIP] 不在首行则不转换', async () => {
  const body = '> 首行文本\n> [!TIP]\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('<w:pStyle w:val="Quote"/>'), '非首行标签应保持 Quote');
});

// ============ Wave 1.3 任务列表复选框字形 ============

test('Wave 1.3 勾选任务：- [x] 输出 ☑ 字形', async () => {
  const body = '- [x] 已完成\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const text = docxText(dec.decode(out.get('word/document.xml')!));
  assert.ok(text.includes('☑'), '应含 ☑ 字形');
  assert.ok(!text.includes('[x]'), '不应残留 [x] 文本');
  assert.ok(text.includes('已完成'), '任务文本应保真');
});

test('Wave 1.3 未勾选任务：- [ ] 输出 ☐ 字形', async () => {
  const body = '- [ ] 未完成\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const text = docxText(dec.decode(out.get('word/document.xml')!));
  assert.ok(text.includes('☐'), '应含 ☐ 字形');
  assert.ok(!text.includes('[ ]'), '不应残留 [ ] 文本');
  assert.ok(text.includes('未完成'), '任务文本应保真');
});

test('Wave 1.3 常规列表项（无 checked 字段）不插字形', async () => {
  const body = '- 普通项\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const text = docxText(dec.decode(out.get('word/document.xml')!));
  assert.ok(!text.includes('☑'), '不应含 ☑');
  assert.ok(!text.includes('☐'), '不应含 ☐');
  assert.ok(text.includes('普通项'), '列表文本应保真');
});

test('Wave 1.3 嵌套任务列表：子项也使用字形', async () => {
  const body = '- [x] 父项\n  - [ ] 子项\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const text = docxText(dec.decode(out.get('word/document.xml')!));
  assert.ok(text.includes('☑'), '父项应含 ☑');
  assert.ok(text.includes('☐'), '子项应含 ☐');
  assert.ok(text.includes('父项') && text.includes('子项'), '嵌套文本应保真');
});

// ============ Wave 2.1 代码块语言标注 ============

test('Wave 2.1 有 lang：```ts 不输出 [ts] 语言标注文本', async () => {
  const body = '```ts\nconst a = 1;\n```\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  assert.ok(!text.includes('[ts]'), '不应输出 [ts] 语言标注');
  assert.ok(doc.includes('<w:pStyle w:val="CodeBlock"/>'), '应使用 CodeBlock 样式（含背景色）');
  assert.ok(text.includes('const a = 1;'), '代码内容应保真');
});

test('Wave 2.1 无 lang：纯代码块无标注', async () => {
  const body = '```\nconst y = 2;\n```\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  assert.ok(text.includes('const y = 2;'), '代码内容应保真');
  assert.ok(!doc.includes('<w:color w:val="808080"/>'), '无 lang 不应有灰色标注');
});

test('Wave 2.1 mermaid：不插语言标注', async () => {
  const body = '```mermaid\ngraph TD;\n```\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  assert.ok(text.includes('graph TD;'), 'mermaid 内容应保真');
  assert.ok(!text.includes('[mermaid]'), 'mermaid 不应有语言标注');
});

test('Wave 2.1 代码块 shading 保留：F6F8FA 底纹', async () => {
  const body = '```py\nprint("hi")\n```\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const styles = dec.decode(out.get('word/styles.xml')!);
  assert.ok(styles.includes('F6F8FA'), 'CodeBlock 样式应保留 F6F8FA 底纹');
});

// ============ Wave 2.2 固有图片尺寸 ============

test('Wave 2.2 宽图：保持宽高比缩放（1920×1080 → 宽优先）', async () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png[11] = 13;
  png[12] = 0x49;
  png[13] = 0x48;
  png[14] = 0x44;
  png[15] = 0x52;
  png[16] = 0x00;
  png[17] = 0x00;
  png[18] = 0x07;
  png[19] = 0x80;
  png[20] = 0x00;
  png[21] = 0x00;
  png[22] = 0x04;
  png[23] = 0x38;
  const body = '![宽图](assets/wide.png)\n';
  const out = await unpackDocx(toDocx(pkg(body, { 'assets/wide.png': png })));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('cx="5486400"'), '宽图宽应缩放到 6 英寸');
  assert.ok(doc.includes('cy="3086100"'), '宽图高应按 16:9 比例缩放');
});

test('Wave 2.2 高图：保持宽高比缩放（窄高图）', async () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png[11] = 13;
  png[12] = 0x49;
  png[13] = 0x48;
  png[14] = 0x44;
  png[15] = 0x52;
  png[16] = 0x00;
  png[17] = 0x00;
  png[18] = 0x02;
  png[19] = 0x58;
  png[20] = 0x00;
  png[21] = 0x00;
  png[22] = 0x04;
  png[23] = 0xb0;
  const body = '![高图](assets/tall.png)\n';
  const out = await unpackDocx(toDocx(pkg(body, { 'assets/tall.png': png })));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('cx="5486400"'), '高图宽也应缩放到 6 英寸上限');
  assert.ok(doc.includes('cy="10972800"'), '高图高应按 1:2 比例缩放');
});

test('Wave 2.2 无法读取固有尺寸：回退缺省 + 警告', async () => {
  const badPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);
  const body = '![坏图](assets/bad.png)\n';
  const warnings: string[] = [];
  const out = await unpackDocx(toDocx(pkg(body, { 'assets/bad.png': badPng }), {}, (w) => warnings.push(w)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('cx="5486400"'), '应回退到缺省 6 英寸宽');
  assert.ok(doc.includes('cy="4114800"'), '应回退到缺省 4.5 英寸高');
  assert.ok(warnings.length > 0, '应产生警告');
  assert.ok(warnings[0].includes('固有尺寸'), '警告应提及固有尺寸');
});

test('Wave 2.2 零宽图片：回退缺省尺寸 + 不产生 NaN', async () => {
  // PNG IHDR 宽度=0, 高度=100（畸形头）
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png[11] = 13;
  png[12] = 0x49;
  png[13] = 0x48;
  png[14] = 0x44;
  png[15] = 0x52;
  png[16] = 0x00;
  png[17] = 0x00;
  png[18] = 0x00;
  png[19] = 0x00; // width=0
  png[20] = 0x00;
  png[21] = 0x00;
  png[22] = 0x00;
  png[23] = 0x64; // height=100
  const body = '![零宽](assets/zero.png)\n';
  const warnings: string[] = [];
  const out = await unpackDocx(toDocx(pkg(body, { 'assets/zero.png': png }), {}, (w) => warnings.push(w)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('cx="5486400"'), '应回退到缺省 6 英寸宽');
  assert.ok(doc.includes('cy="4114800"'), '应回退到缺省 4.5 英寸高');
  assert.ok(!doc.includes('NaN'), '不应含 NaN');
  assert.ok(!doc.includes('Infinity'), '不应含 Infinity');
  assert.ok(warnings.length > 0, '应产生警告');
  assert.ok(warnings[0].includes('无效'), '警告应提及无效尺寸');
});

// ============ Wave 2.3 表头加粗 + 内容宽度列 ============

test('Wave 2.3 表头单元格：显式 <w:b/> 加粗', async () => {
  const body = '| 列A | 列B |\n| --- | --- |\n| 甲 | 乙 |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const firstRowMatch = doc.match(/<w:tr>([\s\S]*?)<\/w:tr>/);
  assert.ok(firstRowMatch, '应有表头行');
  const firstRow = firstRowMatch![1];
  assert.ok(firstRow.includes('<w:b/>'), '表头单元格应含 <w:b/>');
  assert.ok(firstRow.includes('F2F2F2'), '表头应保留 F2F2F2 底纹');
});

test('Wave 2.3 内容宽度：宽列分配更多宽度', async () => {
  const body = '| A | BBBBBBBBBBBBBBBBBBBB |\n| --- | --- |\n| x | y |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const gridMatch = doc.match(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/);
  assert.ok(gridMatch, '应有 tblGrid');
  const cols = [...gridMatch![1].matchAll(/w:w="(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(cols.length === 2, '应有 2 列');
  assert.ok(cols[1] > cols[0], '宽列应分配更多宽度');
});

test('Wave 2.3 全空列：等分兜底', async () => {
  const body = '|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const gridMatch = doc.match(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/);
  assert.ok(gridMatch, '应有 tblGrid');
  const cols = [...gridMatch![1].matchAll(/w:w="(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(cols.length === 3, '应有 3 列');
  assert.ok(
    cols.every((w) => w === cols[0]),
    '全空列应等分'
  );
});

test('Wave 2.3 表头加粗不影响数据行', async () => {
  const body = '| 列A | 列B |\n| --- | --- |\n| 数据1 | 数据2 |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const rows = doc.match(/<w:tr>[\s\S]*?<\/w:tr>/g);
  assert.ok(rows && rows.length >= 2, '应有表头行和数据行');
  const dataRow = rows![1];
  assert.ok(!dataRow.includes('<w:b/>'), '数据行不应含 <w:b/>');
});

test('Wave 2.3 表头嵌套格式保留：**bold** + `code` 保持结构且加粗', async () => {
  const body = '| **粗体** `代码` | 普通 |\n| --- | --- |\n| x | y |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const firstRow = doc.match(/<w:tr>([\s\S]*?)<\/w:tr>/);
  assert.ok(firstRow, '应有表头行');
  const headerCell = firstRow![1];
  // 加粗 run 存在
  assert.ok(headerCell.includes('<w:b/>'), '表头应含 <w:b/>');
  // 行内代码结构保留（Consolas 字体 + F2F2F2 底纹）
  assert.ok(headerCell.includes('Consolas'), '行内代码应保留 Consolas');
  assert.ok(headerCell.includes('F2F2F2'), '行内代码应保留 F2F2F2 底纹');
  // 文本内容保真
  const text = docxText(doc);
  assert.ok(text.includes('粗体'), '粗体文本应保真');
  assert.ok(text.includes('代码'), '代码文本应保真');
});

// ============ Wave 3.2 spec 场景对齐（补充 Wave 1/2 未覆盖的场景） ============

test('Wave 3.2 空文档回归：仅标题无正文仍输出合法 docx', async () => {
  const body = '# 仅标题\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('<w:p>'), '应含段落');
  assert.ok(doc.includes('仅标题'), '标题文本应保真');
  assert.ok(out.has('[Content_Types].xml'), '应含 [Content_Types].xml');
  assert.ok(out.has('word/styles.xml'), '应含 styles.xml');
});

test('Wave 3.2 缺失资源：alt 占位 + 不阻断 + 退出码 0', async () => {
  const body = '![缺失的图片](assets/gone.png)\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(!doc.includes('<w:drawing>'), '缺失资源不应嵌入 drawing');
  assert.ok(docxText(doc).includes('缺失的图片'), '应以 alt 文本占位');
});

test('Wave 3.2 mermaid 降级：按代码块输出（不渲染图、不插语言标注）', async () => {
  const body = '```mermaid\ngraph TD;\nA to B\n```\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  assert.ok(text.includes('graph TD;'), 'mermaid 内容应保真');
  assert.ok(text.includes('A to B'), 'mermaid 内容应保真');
  assert.ok(doc.includes('<w:pStyle w:val="CodeBlock"/>'), '应使用 CodeBlock 样式');
  assert.ok(!text.includes('[mermaid]'), 'mermaid 不应插语言标注');
});

test('Wave 3.2 raw HTML 字面量：非 script/style 节点以文本呈现', async () => {
  // docx 路径将非 script/style 的 raw HTML 节点以字面量文本呈现（XML 转义，无执行面）
  const body = '正文 <em>强调</em> 后文\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const text = docxText(dec.decode(out.get('word/document.xml')!));
  assert.ok(text.includes('&lt;em&gt;强调&lt;/em&gt;'), '非 script/style HTML 应以字面量文本呈现（XML 转义）');
  assert.ok(text.includes('正文'), '上下文应保真');
  assert.ok(text.includes('后文'), '上下文应保真');
});

test('Wave 3.2 表头加粗 + 数据行不嵌套：完整表格保真', async () => {
  const body = '| 名称 | 数值 |\n| --- | --- |\n| 甲 | 1 |\n| 乙 | 2 |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const rows = doc.match(/<w:tr>[\s\S]*?<\/w:tr>/g);
  assert.ok(rows && rows.length === 3, '应有 3 行（表头 + 2 数据行）');
  assert.ok(rows![0].includes('<w:b/>'), '表头行应加粗');
  assert.ok(!rows![1].includes('<w:b/>'), '数据行 1 不应加粗');
  assert.ok(!rows![2].includes('<w:b/>'), '数据行 2 不应加粗');
  const text = docxText(doc);
  for (const t of ['名称', '数值', '甲', '乙']) {
    assert.ok(text.includes(t), `单元格文本应保真: ${t}`);
  }
});

// ============ Review 修复：heading 块级 math 不被静默丢弃 ============

test('Review 修复 heading 含块级 math：$$...$$ 不被丢弃且保持 Heading 样式', async () => {
  const body = '# 标题\n\n## 含公式标题\n\n$$E = mc^2$$\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  // 块级 math 内容应出现在输出中（不被静默丢弃）
  assert.ok(text.includes('E = mc^2'), '块级数学内容应保真');
  assert.ok(!text.includes('$'), '不应残留 $ 定界符');
  // 应含 Heading2 样式（含公式标题的深度为 2）
  assert.ok(doc.includes('<w:pStyle w:val="Heading2"/>'), '应保留 Heading2 样式');
});

test('Review 修复 heading 内含前后文 + 块级 math：拆段且样式一致', async () => {
  const body = '## 前文 $$x^2$$ 后文\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  assert.ok(text.includes('前文'), '前文应保真');
  assert.ok(text.includes('x^2'), '块级数学内容应保真');
  assert.ok(text.includes('后文'), '后文应保真');
  // 拆分后的各段均应使用 Heading2 样式
  const headingMatches = doc.match(/<w:pStyle w:val="Heading2"\/>/g);
  assert.ok(headingMatches && headingMatches.length >= 2, '拆分后的多段均应含 Heading2 样式');
});

// ============ Review 修复：显式 imageHeightEmu 哨兵比较 ============

test('Review 修复 显式 imageHeightEmu 等于默认值时优先使用显式值', async () => {
  // 构造 100×100 的 PNG（固有尺寸可被读取）
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png[11] = 13;
  png[12] = 0x49;
  png[13] = 0x48;
  png[14] = 0x44;
  png[15] = 0x52;
  png[16] = 0x00;
  png[17] = 0x00;
  png[18] = 0x00;
  png[19] = 0x64; // width=100
  png[20] = 0x00;
  png[21] = 0x00;
  png[22] = 0x00;
  png[23] = 0x64; // height=100
  const body = '![图](assets/square.png)\n';
  // 显式传入 imageHeightEmu = 4114800（= 默认 4.5 英寸），此时应直接使用该值而非按宽高比计算
  const DEFAULT_IMAGE_HEIGHT_EMU = Math.round(6 * 914400 * 0.75); // 4114800
  const out = await unpackDocx(
    toDocx(pkg(body, { 'assets/square.png': png }), {
      imageHeightEmu: DEFAULT_IMAGE_HEIGHT_EMU,
    })
  );
  const doc = dec.decode(out.get('word/document.xml')!);
  // 100px * 9525 = 952500 EMU（< 6 英寸上限），所以宽 = 952500
  // 若按宽高比计算：h = 952500 * (100/100) = 952500
  // 若使用显式值：h = 4114800
  // 只有 explicitImageHeight 标志正确时才会用 4114800
  assert.ok(doc.includes('cy="4114800"'), '显式 imageHeightEmu 等于默认值时仍应优先使用显式值');
});

// ============ 缺陷修复回归（issue #9）：docx 导出 8 项 ============

test('回归#9-1 图片：rels Target 相对 word/（media/img-1.png），非 word/media/…', async () => {
  const body = '![图](assets/a.png)\n';
  const out = await unpackDocx(toDocx(pkg(body, { 'assets/a.png': PNG })));
  const rels = dec.decode(out.get('word/_rels/document.xml.rels')!);
  assert.ok(rels.includes('Target="media/img-1.png"'), 'image 关系 Target 应相对 word/');
  assert.ok(!rels.includes('Target="word/media/'), '不应出现 word/media/ 绝对形式');
});

test('回归#9-2 列表：多个有序列表各自独立 numId 实例', async () => {
  const body = '1. 甲\n2. 乙\n\n分隔段\n\n1. 丙\n2. 丁\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const numbering = dec.decode(out.get('word/numbering.xml')!);
  assert.ok(doc.includes('<w:numId w:val="2"/>'), '第一个 ol 应使用 numId 2');
  assert.ok(doc.includes('<w:numId w:val="3"/>'), '第二个 ol 应使用 numId 3');
  assert.ok(numbering.includes('<w:num w:numId="2">'), 'numbering.xml 应声明 numId 2 实例');
  assert.ok(numbering.includes('<w:num w:numId="3">'), 'numbering.xml 应声明 numId 3 实例');
  assert.ok(!doc.includes('<w:startOverride'), '段落 numPr 内不应有 startOverride（无效元素）');
});

test('回归#9-2b 列表：自定义起始号经 numbering.xml lvlOverride 表达', async () => {
  const body = '3. 丙\n4. 丁\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const numbering = dec.decode(out.get('word/numbering.xml')!);
  assert.ok(numbering.includes('<w:startOverride w:val="3"/>'), '起始号应写入 numbering.xml lvlOverride');
});

test('回归#9-3 行距：docDefaults 单倍（line=240）', async () => {
  const out = await unpackDocx(toDocx(pkg('正文\n')));
  const styles = dec.decode(out.get('word/styles.xml')!);
  assert.ok(styles.includes('<w:spacing w:after="160" w:line="240" w:lineRule="auto"/>'), 'docDefaults 应为 line=240');
  assert.ok(!styles.includes('w:line="360"'), '不应再出现 1.5 倍行距');
});

test('回归#9-4 软换行：\\n 并入空格而非 w:br（与 HTML 语义一致）', async () => {
  const body = '第一行\n第二行\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  assert.ok(!doc.includes('<w:br/>'), '软换行不应输出 w:br');
  assert.ok(text.includes('第一行 第二行'), '软换行应合并为空格');
});

test('回归#9-4b 硬换行（行尾两空格）仍输出 w:br', async () => {
  const body = '第一行  \n第二行\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('<w:br/>'), '硬换行应保留 w:br');
});

test('回归#9-5 表格：tblW 满宽 dxa + fixed 布局', async () => {
  const body = '| 列A | 列B |\n| --- | --- |\n| 甲 | 乙 |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('<w:tblW w:w="9026" w:type="dxa"/>'), '表格应满页宽（9026 dxa）');
  assert.ok(doc.includes('<w:tblLayout w:type="fixed"/>'), '表格应固定布局');
});

test('回归#9-6 表格：单元格垂直居中 + 内边距', async () => {
  const body = '| 列A | 列B |\n| --- | --- |\n| 甲 | 乙 |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('<w:vAlign w:val="center"/>'), '单元格应垂直居中');
  assert.ok(
    doc.includes(
      '<w:tblCellMar><w:top w:w="57" w:type="dxa"/><w:start w:w="108" w:type="dxa"/><w:bottom w:w="57" w:type="dxa"/><w:end w:w="108" w:type="dxa"/></w:tblCellMar>'
    ),
    '应声明单元格内边距'
  );
});

test('回归#9-7 callout 同行标题：> [!tip] 实用提示 → 去标识、标题加粗、类型背景色', async () => {
  const body = '> [!tip] 实用提示\n> Markdown 是最通用的文档格式。\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  assert.ok(!text.includes('[!tip]'), '不应残留 [!. ] 标识');
  assert.ok(!text.includes('TIP'), '不应输出 TIP 标签文本');
  assert.ok(text.includes('实用提示'), '标题文本应保真');
  assert.ok(text.includes('Markdown 是最通用的文档格式'), '正文应保真');
  assert.ok(doc.includes('w:fill="ECF7EC"'), 'TIP 应使用类型背景色');
  const titleRun = doc.match(/<w:r><w:rPr><w:b\/><\/w:rPr><w:t[^>]*>实用提示<\/w:t><\/w:r>/);
  assert.ok(titleRun, '标题 run 应加粗');
  const bodyBold = doc.match(/<w:r><w:rPr><w:b\/><\/w:rPr><w:t[^>]*>Markdown<\/w:t>/);
  assert.ok(!bodyBold, '同行正文 run 不应加粗（仅标题加粗）');
});

test('回归#9-7b callout 类型色：warning 黄 / note 蓝 / quote 灰', async () => {
  const body = '> [!warning] 注意\n> 内容\n\n> [!note] 说明\n> 内容\n\n> [!quote] 引文\n> 内容\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('w:fill="FCF8E8"'), 'warning 应使用黄色背景');
  assert.ok(doc.includes('w:fill="F0F7FA"'), 'note 应使用蓝色背景');
  assert.ok(doc.includes('w:fill="F5F5F5"'), 'quote 应使用灰色背景');
});

// ============ 回归#13：短内容表格列宽不满宽 ============

function gridColSum(doc: string): number {
  const re = /<w:gridCol w:w="(\d+)"/g;
  let sum = 0;
  let m;
  while ((m = re.exec(doc)) !== null) sum += Number(m[1]);
  return sum;
}

/** 提取第一个 tblGrid 中所有 gridCol w:w 值数组 */
function gridColValues(doc: string): number[] {
  const tblRe = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/;
  const tbl = tblRe.exec(doc);
  if (!tbl) return [];
  const re = /w:w="(\d+)"/g;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(tbl[1])) !== null) out.push(Number(m[1]));
  return out;
}

test('回归#13-1 2列短内容表格：gridCol 总和 === 9026', async () => {
  const body = '| 列A | 列B |\n| --- | --- |\n| 甲 | 乙 |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const sum = gridColSum(doc);
  assert.equal(sum, 9026, `2列短内容表格 gridCol 总和应为 9026，实际 ${sum}`);
});

test('回归#13-2 4列短内容表格：gridCol 总和 === 9026', async () => {
  const body = '| A | B | C | D |\n| --- | --- | --- | --- |\n| 甲 | 乙 | 丙 | 丁 |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const sum = gridColSum(doc);
  assert.equal(sum, 9026, `4列短内容表格 gridCol 总和应为 9026，实际 ${sum}`);
});

test('回归#13-3 长内容压缩：3列各60全角字符 gridCol 总和 === 9026', async () => {
  const long = '国'.repeat(60);
  const body = `| ${long} | ${long} | ${long} |\n| --- | --- | --- |\n| ${long} | ${long} | ${long} |\n`;
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const sum = gridColSum(doc);
  assert.equal(sum, 9026, `长内容压缩表格 gridCol 总和应为 9026，实际 ${sum}`);
});

test('回归#13-4 混合文档：短表格+长表格各一，每个 gridCol 总和 === 9026', async () => {
  const long = '字'.repeat(60);
  const body = [
    '| 短A | 短B |',
    '| --- | --- |',
    '| 甲 | 乙 |',
    '',
    `| ${long} | ${long} |`,
    '| --- | --- |',
    `| ${long} | ${long} |`,
  ].join('\n');
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const re = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(doc)) !== null) {
    const colRe = /gridCol w:w="(\d+)"/g;
    let s = 0;
    let c: RegExpExecArray | null;
    while ((c = colRe.exec(m[1])) !== null) s += Number(c[1]);
    assert.equal(s, 9026, `表格${idx + 1} gridCol 总和应为 9026，实际 ${s}`);
    idx++;
  }
  assert.equal(idx, 2, `应有 2 个表格，实际 ${idx}`);
});

// 回归#13-5 触底保护：12 列极短内容表格，总和精确等于 9026（12*800>9026，min 约束无法全部满足）
test('回归#13-5 触底保护：12 列极短内容表格，总和精确等于 9026', async () => {
  const body =
    '| A | B | C | D | E | F | G | H | I | J | K | L |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    '| 甲 | 乙 | 丙 | 丁 | 戊 | 己 | 庚 | 辛 | 壬 | 癸 | 子 | 丑 |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const cols = gridColValues(doc);
  assert.equal(cols.length, 12, `应有 12 列，实际 ${cols.length}`);
  const sum = cols.reduce((a, b) => a + b, 0);
  assert.equal(sum, 9026, `总和应精确等于 9026，实际 ${sum}`);
});

// ============ 回归#16：docx 导出第二轮 8 项质量修复 ============

test('回归#16-a 表格数据单元格：**P0** 加粗且仅一个段落', async () => {
  const body = '| 优先级 | 说明 |\n| --- | --- |\n| **P0** | 最高 |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const rows = doc.match(/<w:tr>[\s\S]*?<\/w:tr>/g);
  assert.ok(rows && rows.length === 2, '应有 2 行');
  // 提取第一个数据单元格
  const cells = rows![1].match(/<w:tc>[\s\S]*?<\/w:tc>/g);
  assert.ok(cells && cells.length === 2, '数据行应有 2 个单元格');
  const p0Cell = cells![0];
  // 数据单元格应含 <w:b/>（来自 strong）
  assert.ok(p0Cell.includes('<w:b/>'), '数据单元格 **P0** 应含粗体');
  // 文本 P0 保真
  assert.ok(p0Cell.includes('P0'), '数据单元格应含文本 P0');
  // 仅一个 <w:p>
  const pCount = (p0Cell.match(/<w:p>/g) || []).length;
  assert.equal(pCount, 1, '数据单元格应仅一个段落');
});

test('回归#16-b 表格数据单元格：**50%** 内容不丢失', async () => {
  const body = '| 列 | 值 |\n| --- | --- |\n| a | **50%** |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const rows = doc.match(/<w:tr>[\s\S]*?<\/w:tr>/g);
  const dataRow = rows![1];
  assert.ok(dataRow.includes('50%'), '数据单元格应含 50%（不应为空）');
});

test('回归#16-c 表格数据单元格：text+inlineCode+text 仅一个段落', async () => {
  const body = '| 列 | 值 |\n| --- | --- |\n| x | text `code` text |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const rows = doc.match(/<w:tr>[\s\S]*?<\/w:tr>/g);
  const cells = rows![1].match(/<w:tc>[\s\S]*?<\/w:tc>/g);
  const secondCell = cells![1];
  const pCount = (secondCell.match(/<w:p>/g) || []).length;
  assert.equal(pCount, 1, 'text+inlineCode+text 应仅一个段落（不应拆成 3 段）');
  assert.ok(secondCell.includes('text'), '应含 text');
  assert.ok(secondCell.includes('code'), '应含 code');
});

test('回归#16-d 列宽：文件名列 ≥2500 且总和 === 9026', async () => {
  const body = '| 编号 | `04_智能合同2.0优势价值销售策略.txt` | 主题 |\n' + '| --- | --- | --- |\n' + '| 1 | 策略文档 | 销售 |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const cols = gridColValues(doc);
  assert.equal(cols.length, 3, '应有 3 列');
  assert.ok(cols[1] >= 2500, `文件名列应 ≥2500，实际 ${cols[1]}`);
  const sum = cols.reduce((a, b) => a + b, 0);
  assert.equal(sum, 9026, `总和应精确等于 9026，实际 ${sum}`);
});

test('回归#16-e 编号：两个有序列表各自独立 abstractNum', async () => {
  const body = '1. 甲\n2. 乙\n\n分隔\n\n1. 丙\n2. 丁\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const numbering = dec.decode(out.get('word/numbering.xml')!);
  // 每个 ol 应有独立的 abstractNum（id == numId）
  assert.ok(numbering.includes('<w:abstractNum w:abstractNumId="2">'), '第一个 ol 应有独立 abstractNum 2');
  assert.ok(numbering.includes('<w:abstractNum w:abstractNumId="3">'), '第二个 ol 应有独立 abstractNum 3');
  assert.ok(numbering.includes('<w:num w:numId="2"><w:abstractNumId w:val="2"/>'), 'numId 2 应绑定 abstractNum 2');
  assert.ok(numbering.includes('<w:num w:numId="3"><w:abstractNumId w:val="3"/>'), 'numId 3 应绑定 abstractNum 3');
  // 项目符号仍为 abstractNum 0
  assert.ok(numbering.includes('<w:num w:numId="1"><w:abstractNumId w:val="0"/>'), '项目符号应绑定 abstractNum 0');
});

test('回归#16-eb 编号：自定义起始号仍发 startOverride', async () => {
  const body = '3. 丙\n4. 丁\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const numbering = dec.decode(out.get('word/numbering.xml')!);
  assert.ok(numbering.includes('<w:startOverride w:val="3"/>'), '起始号 3 应写入 startOverride');
});

test('回归#16-f emoji：astral emoji 清除，BMP 符号保留', async () => {
  const body = '🛑 标题 🔢\n\n⚠️ 注意 ❌ 错误\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  // astral emoji 应被清除
  assert.ok(!doc.includes('🛑'), '🛑 应被清除');
  assert.ok(!doc.includes('🔢'), '🔢 应被清除');
  // BMP 符号保留
  assert.ok(doc.includes('⚠'), '⚠ 应保留');
  assert.ok(doc.includes('❌'), '❌ 应保留');
  // FE0F 应被清除（⚠️ → ⚠）
  assert.ok(!doc.includes('️'), 'FE0F 变体选择符应被清除');
});

test('回归#16-g 单元格间距 + tcPr 顺序', async () => {
  const body = '| 列A | 列B |\n| --- | --- |\n| 甲 | 乙 |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  // 数据单元格 pPr 含 before=0/after=0
  const rows = doc.match(/<w:tr>[\s\S]*?<\/w:tr>/g);
  const dataRow = rows![1];
  assert.ok(dataRow.includes('w:before="0" w:after="0"'), '数据单元格段落应有 before=0/after=0');
  // 表头 tcPr 顺序：tcW → shd → vAlign
  const headerRow = rows![0];
  const tcPrMatch = headerRow.match(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/);
  assert.ok(tcPrMatch, '表头单元格应有 tcPr');
  const tcPr = tcPrMatch![1];
  const tcWIdx = tcPr.indexOf('<w:tcW');
  const shdIdx = tcPr.indexOf('<w:shd');
  const vAlignIdx = tcPr.indexOf('<w:vAlign');
  assert.ok(tcWIdx < shdIdx && shdIdx < vAlignIdx, '表头 tcPr 顺序应为 tcW → shd → vAlign');
});

test('回归#16-h 水平线：--- 无输出', async () => {
  const body = '上文\n\n---\n\n下文\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(!doc.includes('<w:pBdr><w:bottom'), '--- 不应输出段落边框');
  const text = docxText(doc);
  assert.ok(text.includes('上文'), '上文应保真');
  assert.ok(text.includes('下文'), '下文应保真');
});

test('回归#16-i callout：标题/正文分段落', async () => {
  const body = '> [!tip] 实用提示\n> Markdown 是最通用的文档格式。\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  assert.ok(text.includes('实用提示'), '标题应保真');
  assert.ok(text.includes('Markdown 是最通用的文档格式'), '正文应保真');
  // 标题加粗
  assert.ok(
    doc.includes('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">实用提示</w:t></w:r>') ||
      doc.includes('<w:b/><w:t xml:space="preserve">实用提示</w:t>'),
    '标题 run 应加粗'
  );
  // 正文不应加粗：找到 Markdown 所在的 run，确认不在 <w:b/> 后
  const markdownRun = doc.match(/<w:t[^>]*>Markdown/);
  assert.ok(markdownRun, '正文应含 Markdown');
  // 确认 Markdown run 不在 bold run 内
  const markdownIdx = doc.indexOf('Markdown');
  // 往前找最近的 <w:rPr><w:b/> 或 </w:r>
  const prevRPrBold = doc.lastIndexOf('<w:b/>', markdownIdx);
  const prevRClose = doc.lastIndexOf('</w:r>', markdownIdx);
  assert.ok(prevRClose > prevRPrBold || prevRPrBold === -1, '正文 run 不应在 bold 格式内');
  // 标题段 pPr schema 顺序：w:spacing 在 w:ind 之前
  const headPP = doc.match(/<w:pPr><w:pBdr>[\s\S]*?<\/w:pPr>/);
  assert.ok(headPP, '应有标题段 pPr');
  const headPPContent = headPP![0];
  assert.ok(headPPContent.indexOf('<w:spacing') < headPPContent.indexOf('<w:ind'), '标题段 pPr 中 w:spacing 应在 w:ind 之前');
});

test('回归#16-ib callout：无标题时正文不加粗', async () => {
  const body = '> [!warning]\n> 打包为单文件\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  assert.ok(text.includes('打包为单文件'), '正文应保真');
  // 正文不应加粗
  const contentIdx = doc.indexOf('打包为单文件');
  const prevRPrBold = doc.lastIndexOf('<w:b/>', contentIdx);
  const prevRClose = doc.lastIndexOf('</w:r>', contentIdx);
  assert.ok(prevRClose > prevRPrBold || prevRPrBold === -1, '无标题 callout 正文不应加粗');
});

test('回归#16-j frontmatter：剥离 frontmatter 文本', async () => {
  const body = '---\nname: x\n---\n# H\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const text = docxText(doc);
  assert.ok(!text.includes('name: x'), '不应含 frontmatter 文本');
  assert.ok(text.includes('H'), '标题 H 应保真');
  assert.ok(!doc.includes('<w:pBdr><w:bottom'), '不应有 frontmatter 尾部的 hr');
});

test('回归#16-k stripEmoji：无 emoji 文本保留边缘空格', async () => {
  const body = '`A9_exam_key.json` 或 `V11_exam_key.json`\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  assert.ok(doc.includes('xml:space="preserve"> 或 </w:t>'), '或 两侧空格应保留');
});

test('回归#16-l 12列含长内容：总和 9026 且每列 ≥400', async () => {
  const body =
    '| x | x | x | x | x | x | x | x | x | x | x | 智能合同2.0优势价值销售策略一表 |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n';
  const out = await unpackDocx(toDocx(pkg(body)));
  const doc = dec.decode(out.get('word/document.xml')!);
  const cols = gridColValues(doc);
  assert.equal(cols.length, 12, `应有 12 列，实际 ${cols.length}`);
  const sum = cols.reduce((a, b) => a + b, 0);
  assert.equal(sum, 9026, `总和应精确等于 9026，实际 ${sum}`);
  for (const w of cols) {
    assert.ok(w >= 400, `每列应 ≥400，实际 ${w}`);
  }
});
