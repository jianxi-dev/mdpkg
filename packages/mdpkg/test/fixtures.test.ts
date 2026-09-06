// Conformance fixtures 驱动（M5）
// 用例数据与实现无关地放在 spec/fixtures/<id>/case.json，本文件只负责执行与比对。
// 这是「两个独立实现能对齐」的真正机制：任何语言的实现只要能跑通同一批 case.json 即视为合规。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFiles, pack, unpack, normalizePath } from '../src/container.ts';
import { buildManifest, validatePackage, checkClosure, DEFAULT_ENTRYPOINT } from '../src/manifest.ts';
import { render } from '../src/render.ts';
import { expand } from '../src/include.ts';
import { MdeError } from '../src/errors.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES = join(ROOT, 'spec/fixtures');

interface Case {
  id: string;
  title: string;
  kind: 'pack' | 'validate' | 'render' | 'expand' | 'export' | 'unpack' | 'path';
  input?: string; // 输入目录，默认 input/
  entry?: string;
  args?: Record<string, unknown>;
  lenient?: boolean; // 宽容打开：直接对无 manifest.json 的文件集操作（lenient-open）
  tamper?: { resource?: number; sha256?: string; size?: number }; // 篡改 manifest 以测完整性校验
  expect: {
    errorCode?: string | null;
    tree?: string[];
    manifest?: Record<string, unknown>;
    htmlContains?: string[];
    htmlNotContains?: string[];
    textContains?: string[];
    pathInput?: string;
  };
}

const dirs = existsSync(FIXTURES)
  ? readdirSync(FIXTURES).filter((d) => existsSync(join(FIXTURES, d, 'case.json')))
  : [];

async function runCase(c: Case, base: string): Promise<void> {
  const inputDir = join(base, c.input ?? 'input');
  const entry = c.entry ?? DEFAULT_ENTRYPOINT;

  if (c.kind === 'path') {
    const raw = String(c.expect.pathInput ?? '');
    if (c.expect.errorCode) {
      assert.throws(() => normalizePath(raw), (e: unknown) => e instanceof MdeError && e.code === c.expect.errorCode, `${c.id}: 期望 ${c.expect.errorCode}`);
    } else {
      assert.equal(normalizePath(raw), c.expect.textContains?.[0], c.id);
    }
    return;
  }

  // 路径/链接类错误在收集阶段就抛出，需在此捕获（如符号链接 E601）
  let files: Map<string, Uint8Array>;
  try {
    files = collectFiles(inputDir);
  } catch (e) {
    if (c.expect.errorCode && e instanceof MdeError) {
      assert.equal(e.code, c.expect.errorCode, `${c.id}: 期望 ${c.expect.errorCode}`);
      return;
    }
    throw e;
  }
  // 若 input 目录自带 manifest.json，按字段归属表作为 prev 继承（作者意图保留、机器事实重算）
  const prevRaw = files.get('manifest.json');
  let prev: Record<string, unknown> | undefined;
  if (prevRaw) {
    try { prev = JSON.parse(new TextDecoder().decode(prevRaw)); }
    catch { prev = undefined; }
  }
  files.delete('manifest.json');
  const manifest = buildManifest(files, prev as never);
  const manifestJson = () => new TextEncoder().encode(JSON.stringify(buildManifest(files, prev as never)));
  const withManifest = () => new Map<string, Uint8Array>([...files, ['manifest.json', manifestJson()]]);

  if (c.kind === 'export') {
    // export --raw：产物必须与输入逐字节相同（结构保持、文本一字不改）
    const data = files.get(entry)!;
    const original = new Uint8Array(readFileSync(join(inputDir, entry)));
    assert.deepEqual(new Uint8Array(data), original, `${c.id}: raw 模式文本必须一字不改`);
    if (c.expect.textContains) {
      const r = expand(files, entry);
      for (const s of c.expect.textContains) assert.ok(r.text.includes(s), `${c.id}: 展开结果应包含 ${JSON.stringify(s)}`);
    }
    return;
  }

  if (c.kind === 'expand') {
    if (c.expect.errorCode) {
      assert.throws(() => expand(files, entry), (e: unknown) => e instanceof MdeError && e.code === c.expect.errorCode, `${c.id}: 期望 ${c.expect.errorCode}`);
      return;
    }
    const r = expand(files, entry);
    for (const s of c.expect.textContains ?? []) assert.ok(r.text.includes(s), `${c.id}: 展开结果应包含 ${JSON.stringify(s)}`);
    return;
  }

  if (c.kind === 'validate') {
    // lenient：直接对无 manifest 的文件集校验（严格性保持，应报 E102）；否则注入 manifest
    const pkg = c.lenient ? files : withManifest();
    if (c.tamper) {
      // lenient+tamper 互斥：tamper 需要 manifest.json，缺失时下方 pkg.get()! 会 TypeError（潜伏）
      if (!pkg.has('manifest.json')) throw new Error('fixture 错误: lenient+tamper 互斥（tamper 需要 manifest）');
      const idx = c.tamper.resource ?? 0;
      const m = JSON.parse(new TextDecoder().decode(pkg.get('manifest.json')!));
      if (c.tamper.sha256) m.resources[idx].sha256 = c.tamper.sha256;
      if (c.tamper.size !== undefined) m.resources[idx].size = c.tamper.size;
      pkg.set('manifest.json', new TextEncoder().encode(JSON.stringify(m)));
    }
    if (c.expect.errorCode) {
      const r = validatePackage(pkg);
      assert.ok(r.errors.some((e) => e.includes(c.expect.errorCode!)), `${c.id}: 期望错误 ${c.expect.errorCode}，实际 ${JSON.stringify(r.errors)}`);
      return;
    }
    const r = validatePackage(pkg);
    assert.deepEqual(r.errors, [], `${c.id}: 应无错误，实际 ${JSON.stringify(r.errors)}`);
    return;
  }

  if (c.kind === 'render') {
    // lenient：直接对无 manifest 的文件集渲染（入口推断）；推断失败（如 E303）在此捕获
    const input = c.lenient ? files : withManifest();
    let html: string;
    try {
      html = render(input, c.args ?? {}).html;
    } catch (e) {
      if (c.expect.errorCode && e instanceof MdeError) {
        assert.equal(e.code, c.expect.errorCode, `${c.id}: 期望 ${c.expect.errorCode}`);
        return;
      }
      throw e;
    }
    for (const s of c.expect.htmlContains ?? []) assert.ok(html.includes(s), `${c.id}: HTML 应包含 ${JSON.stringify(s)}`);
    for (const s of c.expect.htmlNotContains ?? []) assert.ok(!html.includes(s), `${c.id}: HTML 不应包含 ${JSON.stringify(s)}`);
    return;
  }

  if (c.kind === 'unpack') {
    // pack → unpack 往返：除 manifest.json（由工具生成）外，每个文件必须逐字节相同
    const bytes = pack(files, manifest);
    const restored = await unpack(bytes);
    for (const [p, data] of files) {
      const got = restored.get(normalizePath(p));
      assert.ok(got, `${c.id}: 解包后缺少 ${p}`);
      assert.deepEqual(new Uint8Array(got!), new Uint8Array(data), `${c.id}: ${p} 往返后内容不一致`);
    }
    return;
  }

  // kind === 'pack'
  if (c.expect.errorCode) {
    assert.throws(() => { checkClosure(files, entry); pack(files, manifest); }, (e: unknown) => e instanceof MdeError && e.code === c.expect.errorCode, `${c.id}: 期望 ${c.expect.errorCode}`);
    return;
  }
  checkClosure(files, entry);
  const bytes = pack(files, manifest);
  if (c.expect.tree) {
    const { list } = await import('../src/container.ts');
    const items = await list(bytes);
    // manifest.json 由工具生成且含 sha256，逐字节手算不现实 → 比对时跳过该行
    const actual = items.filter((i) => i.path !== 'manifest.json').map((i) => `${i.path} ${i.size}`);
    const expected = c.expect.tree.filter((t) => !t.startsWith('manifest.json'));
    assert.deepEqual(actual, expected, `${c.id}: 条目树不符`);
  }
  if (c.expect.manifest) {
    for (const [k, v] of Object.entries(c.expect.manifest)) {
      assert.deepEqual((manifest as Record<string, unknown>)[k], v, `${c.id}: manifest.${k} 不符`);
    }
  }
  // 可重复构建：同输入两次打包必须字节相同
  const again = pack(files, buildManifest(files));
  assert.equal(Buffer.from(bytes).toString('hex'), Buffer.from(again).toString('hex'), `${c.id}: 两次打包字节应相同`);
}

for (const d of dirs) {
  const base = join(FIXTURES, d);
  const c: Case = JSON.parse(readFileSync(join(base, 'case.json'), 'utf8'));
  test(`[${c.kind}] ${c.id} — ${c.title}`, async () => { await runCase(c, base); });
}
