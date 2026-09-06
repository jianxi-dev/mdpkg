#!/usr/bin/env node
// mdpkg CLI — M1: pack / unpack / list（M2 起补 validate / render / export / diff）
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pack, unpack, list, collectFiles, normalizePath } from './container.ts';
import { buildManifest, validatePackage, checkClosure, collectReferences, inferEntrypoint, DEFAULT_ENTRYPOINT } from './manifest.ts';
import { expand } from './include.ts';
import { render, wrapDocument, DEFAULT_MAX_INLINE_BYTES } from './render.ts';
import { toDocx } from './docx.ts';
import { buildZipExport } from './zip-export.ts';
import { toMarkdown } from './markdown-export.ts';
import { MdeError, EXIT, E } from './errors.ts';

function die(msg: string, code: number): never {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    o: { type: 'string' },
    inline: { type: 'boolean' },
    dir: { type: 'boolean' },
    format: { type: 'string' },
    'referenced-only': { type: 'boolean' },
    raw: { type: 'boolean' },
    expanded: { type: 'boolean' },
    zip: { type: 'boolean' },
    md: { type: 'boolean' },
  },
});
const [cmd, ...rest] = positionals;
const out = values.o;

function readPkg(p: string): Uint8Array {
  if (!existsSync(p)) die(`文件不存在: ${p}`, EXIT.USAGE);
  return new Uint8Array(readFileSync(p));
}

async function main() {
  if (cmd === 'pack') {
    const dir = rest[0];
    if (!dir || !out) die('用法: mdpkg pack <dir> -o <out.mdpkg>', EXIT.USAGE);
    if (!existsSync(dir) || !lstatSync(dir).isDirectory()) die(`不是目录: ${dir}`, EXIT.USAGE);
    const target = resolve(out);
    const files = collectFiles(resolve(dir));
    files.delete(require_relative(resolve(dir), target)); // 不把输出文件自身打进包
    // 已有的 manifest 只继承作者意图字段（entrypoint/extensions/…），resources 重算
    const prevRaw = files.get('manifest.json');
    files.delete('manifest.json');
    let prev;
    if (prevRaw) {
      try { prev = JSON.parse(new TextDecoder().decode(prevRaw)); }
      catch { process.stderr.write(`警告: 已存在的 manifest.json 无法解析，按默认重建\n`); }
    }
    // --referenced-only：只打引用闭包（入口 + include 链 + 被引用资源），而非目录全量
    if (values['referenced-only']) {
      const entryNow = prev?.entrypoint ?? (files.has(DEFAULT_ENTRYPOINT) ? DEFAULT_ENTRYPOINT : [...files.keys()][0]);
      const { text, sources } = expand(files, entryNow);
      const { local } = collectReferences(text);
      const keep = new Set([entryNow, ...sources.map((s) => s.file), ...local].map(normalizePath));
      for (const p of [...files.keys()]) if (!keep.has(normalizePath(p))) files.delete(p);
    }
    const manifest = buildManifest(files, prev);
    const entry = manifest.entrypoint ?? DEFAULT_ENTRYPOINT;
    const { orphans } = checkClosure(files, entry);
    for (const o of orphans) process.stderr.write(`[${E.E404}] 孤儿资源（未被引用）: ${o}\n`);
    const bytes = pack(files, manifest);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    process.stdout.write(`pack: ${files.size + 1} 个条目（入口 ${entry}）→ ${out} (${bytes.length} B)\n`);
    return;
  }

  if (cmd === 'unpack') {
    const pkg = rest[0];
    if (!pkg || !out) die('用法: mdpkg unpack <file.mdpkg> -o <dir>', EXIT.USAGE);
    const files = await unpack(readPkg(pkg));
    for (const [p, data] of files) {
      const dest = join(out, p);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, data);
    }
    process.stdout.write(`unpack: ${files.size} 个文件 → ${out}\n`);
    return;
  }

  if (cmd === 'export') {
    const pkg = rest[0];
    // --zip 与 --raw/--expanded 互斥（布尔选项用 in 判定，与 render 的 inline/dir 一致）
    if (values.zip && ('raw' in values || 'expanded' in values)) {
      die('用法: mdpkg export --zip 与 --raw/--expanded 互斥', EXIT.USAGE);
    }
    // --md 与 --raw/--expanded/--zip 互斥（存在性 in 判定，与 --zip 互斥同一模式）
    if (values.md && ('raw' in values || 'expanded' in values || 'zip' in values)) {
      die('用法: mdpkg export --md 与 --raw/--expanded/--zip 互斥', EXIT.USAGE);
    }
    const mode = values.raw ? 'raw' : values.expanded ? 'expanded' : values.zip ? 'zip' : values.md ? 'md' : null;
    if (!pkg || !mode) die('用法: mdpkg export (--raw | --expanded | --zip | --md) <file.mdpkg> [-o <dir|zip|md>]', EXIT.USAGE);
    if (mode !== 'zip' && mode !== 'md' && !out) die('用法: mdpkg export (--raw | --expanded) <file.mdpkg> -o <dir>', EXIT.USAGE);
    const files = await unpack(readPkg(pkg));
    if (mode === 'zip') {
      // zip 交付物：复用 buildZipExport（include 展开 + 路径重写 + README 已在核心完成，CLI 不重复展开）
      // -o 缺省按包名替换 .zip；无 .mdpkg 后缀时追加 .zip（避免输出名=输入路径覆盖原包）
      const target = resolve(out ?? defaultOutName(pkg, '.zip'));
      const bytes = buildZipExport(files);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      process.stdout.write(`export --zip: 展开后 Markdown + 资源 + README → ${target}\n`);
      return;
    }
    if (mode === 'md') {
      // md 单文件导出：复用 src 层 toMarkdown（入口解析 + include 展开 + 路径重写已在核心完成，
      // 符号保持源文本；CLI 不依赖 web 模块、不重复展开逻辑）
      // -o 缺省按包名替换 .md；无 .mdpkg 后缀时追加 .md（避免输出名=输入路径覆盖原包）
      const target = resolve(out ?? defaultOutName(pkg, '.md'));
      const text = toMarkdown(files);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, new TextEncoder().encode(text));
      process.stdout.write(`export --md: 展开后 Markdown → ${target}\n`);
      return;
    }
    const manifest = files.has('manifest.json') ? JSON.parse(new TextDecoder().decode(files.get('manifest.json')!)) : {};
    if (mode === 'expanded') {
      // expanded 需要真实入口（展开入口文档），无 md 时 E303 合理
      const entry = manifest.entrypoint ?? inferEntrypoint(files);
      if (!files.has('manifest.json')) {
        process.stderr.write(`提示: 未校验来源（缺少 manifest.json），按规则推断入口 ${entry}\n`);
      }
      for (const [p, data] of files) {
        if (p === 'manifest.json') continue;
        if (p === entry) continue; // 入口单独写展开后的版本
        const dest = join(out, p);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, data);
      }
      const { text } = expand(files, entry);
      const dest = join(out, entry);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, new TextEncoder().encode(text));
      process.stdout.write(`export --expanded: 入口已展开（include 已内联、相对路径已按包根重写）→ ${out}\n`);
    } else {
      // raw 只导出文件树，不需要入口；无 manifest 时保留提示但不含入口名
      if (!files.has('manifest.json')) {
        process.stderr.write(`提示: 未校验来源（缺少 manifest.json）\n`);
      }
      for (const [p, data] of files) {
        if (p === 'manifest.json') continue;
        const dest = join(out, p);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, data);
      }
      process.stdout.write(`export --raw: 结构保持、文本未改 → ${out}\n`);
    }
    return;
  }

  if (cmd === 'diff') {
    const [a, b] = rest;
    if (!a || !b) die('用法: mdpkg diff <a.mdpkg> <b.mdpkg>', EXIT.USAGE);
    const dirA = mkdtempSync(join(tmpdir(), 'mdpkg-diff-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'mdpkg-diff-b-'));
    for (const [src, dest] of [[a, dirA], [b, dirB]] as const) {
      for (const [p, data] of await unpack(readPkg(src))) {
        const target = join(dest, p);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
      }
    }
    const r = spawnSync('diff', ['-ruN', dirA, dirB], { encoding: 'utf8' });
    if (r.stdout) process.stdout.write(r.stdout.replaceAll(dirA, 'a').replaceAll(dirB, 'b'));
    if (r.stderr) process.stderr.write(r.stderr);
    process.exit(r.status === 0 ? EXIT.OK : EXIT.VALIDATION);
  }

  if (cmd === 'render') {
    const pkg = rest[0];
    if (!pkg) die('用法: mdpkg render <file.mdpkg> [-o out] [--format html|docx] [--inline | --dir]', EXIT.USAGE);
    const format = values.format ?? 'html';
    if (format !== 'html' && format !== 'docx') die(`用法: mdpkg render <file.mdpkg> [-o out] [--format html|docx]（收到: ${format}）`, EXIT.USAGE);
    // docx 是单文件容器，内联/目录二元模式不适用（规范：互斥报用法错误）
    if (format === 'docx' && ('inline' in values || 'dir' in values)) {
      die('用法: mdpkg render: --format docx 与 --inline/--dir 互斥', EXIT.USAGE);
    }
    const files = await unpack(readPkg(pkg));
    if (!files.has('manifest.json')) {
      process.stderr.write(`提示: 未校验来源（缺少 manifest.json），按规则推断入口 ${inferEntrypoint(files)}\n`);
    }
    if (format === 'docx') {
      // docx 输出：复用同一管线（解包 → 校验 → include 展开 → 解析 → 符号转换），仅输出目标不同
      const target = resolve(out ?? defaultOutName(pkg, '.docx'));
      const bytes = toDocx(files, {}, (w) => process.stderr.write(`警告: ${w}\n`));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      process.stdout.write(`render: ${target}（docx 格式）\n`);
      return;
    }
    const r = render(files, { inline: 'inline' in values, dir: 'dir' in values });
    const target = resolve(out ?? pkg.replace(/\.mdpkg$/i, '.html'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, wrapDocument(pkg.replace(/^.*\//, ''), r.html));
    if (r.degraded) {
      process.stderr.write(`提示: 资源 ${(r.totalBytes / 1048576).toFixed(1)}MB 超过 ${DEFAULT_MAX_INLINE_BYTES / 1048576}MB，已自动降级为 --dir\n`);
    }
    if (r.mode === 'dir') {
      const assetDir = target.replace(/\.html$/i, '_assets');
      for (const [p, data] of files) {
        if (p === 'manifest.json') continue;
        const dest = join(assetDir, p);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, data);
      }
      process.stdout.write(`render: ${target} + ${assetDir}（dir 模式）\n`);
      return;
    }
    process.stdout.write(`render: ${target}（inline 模式，自包含单文件）\n`);
    return;
  }

  if (cmd === 'validate') {
    const pkg = rest[0];
    if (!pkg) die('用法: mdpkg validate <file.mdpkg>', EXIT.USAGE);
    const r = validatePackage(await unpack(readPkg(pkg)));
    for (const w of r.warnings) process.stderr.write(w + '\n');
    for (const e of r.errors) process.stderr.write(e + '\n');
    if (r.externalCount > 0) {
      process.stderr.write(`提示: 本包含 ${r.externalCount} 个外部引用，不可完全离线（v1 不提供 --fetch 下载）\n`);
    }
    if (!r.ok) process.exit(EXIT.VALIDATION);
    process.stdout.write(`validate: OK（${r.warnings.length} 条告警）\n`);
    return;
  }

  if (cmd === 'list') {
    const pkg = rest[0];
    if (!pkg) die('用法: mdpkg list <file.mdpkg>', EXIT.USAGE);
    const items = await list(readPkg(pkg));
    for (const it of items) {
      process.stdout.write(`${String(it.size).padStart(10)}  ${String(it.compressed).padStart(8)}  ${it.path}\n`);
    }
    return;
  }

  die(`未知命令: ${cmd ?? '(空)'}；可用: pack / unpack / list / validate / render / export / diff`, EXIT.USAGE);
}

function require_relative(base: string, target: string): string {
  return target.startsWith(base + '/') ? target.slice(base.length + 1) : '';
}

/** 缺省输出名：包路径以 .mdpkg 结尾则替换扩展名，否则追加（避免无后缀时输出=输入覆盖原包） */
function defaultOutName(pkg: string, ext: string): string {
  return /\.mdpkg$/i.test(pkg) ? pkg.replace(/\.mdpkg$/i, ext) : pkg + ext;
}

main().catch((e: unknown) => {
  if (e instanceof MdeError) die(e.message, EXIT.VALIDATION);
  die(`内部错误: ${e instanceof Error ? e.message : String(e)}`, EXIT.INTERNAL);
});

export { E };
