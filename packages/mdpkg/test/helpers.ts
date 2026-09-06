// 测试共享构造（zip-export.test.ts / zip-export-cli.test.ts / docx.test.ts 共用）
// 不带 .test 后缀：node --test test/*.test.ts 显式 glob 不会执行本文件。
import { pack } from '../src/container.ts';
import { buildManifest } from '../src/manifest.ts';

export const enc = new TextEncoder();
export const dec = new TextDecoder();

// 构造含 include + 资源的包（与 repack.test.ts 同款模式）
export function makeFiles(): Map<string, Uint8Array> {
  return new Map<string, Uint8Array>([
    ['document.md', enc.encode('# 标题 (tm)\n\n![图](assets/a.png)\n\n<<< includes/ch1.md\n')],
    ['includes/ch1.md', enc.encode('第一章 (c) --> 结束\n\n![图](img/fig.png)\n')],
    ['assets/a.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])],
    ['includes/img/fig.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 5, 6])],
  ]);
}

export function makePkg(files = makeFiles()): Uint8Array {
  return pack(files, buildManifest(files));
}