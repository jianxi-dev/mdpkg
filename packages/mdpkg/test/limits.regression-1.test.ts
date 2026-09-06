// Regression: ship 覆盖审计缺口（E602/E603/E604 限额、空包、toBase64 分块）
// Found by /ship coverage audit on 2026-09-05
// E602/E604 因 fflate Unzip 限制暂 skip（详见各测试注释），产品 bug 已登记 issue
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { unpack, toBase64 } from '../src/container.ts';
import { openMdpkg } from '../web/mdpkg-web.ts';
import { MdeError } from '../src/errors.ts';

// 手写最小 ZIP 构造器（store 模式，method 0）
// 用于伪造 header 中的 uncompSize 而不需要真实大数据——unpack 限额检查读的是 header 字段
function forgeZip(entries: { name: string; data: Uint8Array; origSize?: number }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const compSize = entry.data.length;
    const uncompSize = entry.origSize ?? entry.data.length;

    // Local file header (30 B + name)
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // 签名
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // method = store
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0x0021, true); // mod date (1980-01-01)
    lv.setUint32(14, 0, true); // crc32 (unpack 不校验)
    lv.setUint32(18, compSize, true); // compressed size
    lv.setUint32(22, uncompSize, true); // uncompressed size (可伪造)
    lv.setUint16(26, name.length, true); // name length
    lv.setUint16(28, 0, true); // extra length
    local.set(name, 30);
    parts.push(local, entry.data);

    // Central directory header (46 B + name)
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // 签名
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, 0, true); // method
    cv.setUint16(12, 0, true); // mod time
    cv.setUint16(14, 0x0021, true); // mod date
    cv.setUint32(16, 0, true); // crc32
    cv.setUint32(20, compSize, true); // compressed size
    cv.setUint32(24, uncompSize, true); // uncompressed size
    cv.setUint16(28, name.length, true); // name length
    cv.setUint16(30, 0, true); // extra length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk start
    cv.setUint16(36, 0, true); // internal attr
    cv.setUint32(38, 0, true); // external attr
    cv.setUint32(42, offset, true); // local offset
    central.set(name, 46);
    centrals.push(central);

    offset += local.length + entry.data.length;
  }

  // 拼接 central directory
  const centralTotal = centrals.reduce((a, c) => a + c.length, 0);
  const centralBuf = new Uint8Array(centralTotal);
  let pos = 0;
  for (const c of centrals) { centralBuf.set(c, pos); pos += c.length; }
  parts.push(centralBuf);

  // EOCD (22 B)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // 签名
  ev.setUint16(4, 0, true); // disk no
  ev.setUint16(6, 0, true); // disk start
  ev.setUint16(8, entries.length, true); // entries this disk
  ev.setUint16(10, entries.length, true); // total entries
  ev.setUint32(12, centralTotal, true); // central size
  ev.setUint32(16, offset, true); // central offset
  ev.setUint16(20, 0, true); // comment length
  parts.push(eocd);

  // 拼接全部
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// 2026-09-05 修复：unpack 改为分块 push（chunkZIP，每块 ≤1000 条目），fflate 递归深度不再超限。
// 10_001 条目全部被解析后，第 10_001 个触发 LIMITS.entries=10_000 → E602。
test('E602: 条目总数超过 10_000 上限被拒绝', async () => {
  // 真实 10_001 个 1 字节条目（zipSync 直接生成，可靠）
  const map: Record<string, Uint8Array> = {};
  for (let i = 0; i < 10_001; i++) map[`f${i}.md`] = new Uint8Array([120]);
  const data = zipSync(map, {});

  await assert.rejects(() => unpack(data), (e: unknown) => e instanceof MdeError && e.message.includes('MDPKG-E602'));
});

test('E603: 单文件解压后超过 200MB 上限被拒绝', async () => {
  // 伪造 origSize = 201MB，实际数据仅 1 字节（store 模式）
  const forged = forgeZip([
    { name: 'document.md', data: strToU8('small'), origSize: 201 * 1024 * 1024 },
  ]);

  await assert.rejects(() => unpack(forged), (e: unknown) => e instanceof MdeError && e.message.includes('MDPKG-E603'));
});

// 2026-09-05 修复：分块 push 后，7 个伪造条目全部被解析，total = 7×150MB = 1050MB > 1GB → E604 触发。
// 实测：2 条目伪造包（每 100MB）解出 2 条完整内容，无截断。
test('E604: 总解压量超过 1GB 上限被拒绝', async () => {
  // 7 个条目各 150MB（每个 < 200MB 单文件上限），总和 1050MB > 1GB
  // compSize = 200KB 使压缩比 ≈ 750:1 < 1000:1（避开 E605 先触发）
  const entries = Array.from({ length: 7 }, (_, i) => ({
    name: `f${i}.data`,
    data: new Uint8Array(200 * 1024), // 200KB 真实数据
    origSize: 150 * 1024 * 1024, // 伪造 150MB
  }));
  const forged = forgeZip(entries);

  await assert.rejects(() => unpack(forged), (e: unknown) => e instanceof MdeError && e.message.includes('MDPKG-E604'));
});

test('openMdpkg: 空 ZIP 包（0 条目）报 E101', async () => {
  const empty = zipSync({}, {}); // 22 字节空 zip
  await assert.rejects(() => openMdpkg(empty), (e: unknown) => e instanceof MdeError && e.message.includes('MDPKG-E101'));
});

test('toBase64: 跨 0x8000 分块边界与 Buffer 基准一致', () => {
  // 100_000 字节 > 3×32768，覆盖多块 + 末尾不完整块
  const data = new Uint8Array(100_000).map((_, i) => i % 251);
  const actual = toBase64(data);
  const expected = Buffer.from(data).toString('base64');
  assert.equal(actual, expected, 'toBase64 分块实现应与 Buffer 基准逐字符一致');
});
