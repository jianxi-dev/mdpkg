// Regression: 分块 push 修复验证（issue #1）
// 覆盖：防截断、伪签名免疫、空包/单条目退化路径
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { unpack, list } from '../src/container.ts';

test('防截断: 2500 条目（>2108 栈限）完整解包', async () => {
  const map: Record<string, Uint8Array> = {};
  for (let i = 0; i < 2500; i++) map[`f${i}.md`] = new Uint8Array([i % 256]);
  const data = zipSync(map, {});
  const out = await unpack(data);
  assert.equal(out.size, 2500, '应完整解出 2500 条，无静默截断');
  // 抽样验证内容
  assert.deepEqual(out.get('f0.md'), new Uint8Array([0]));
  assert.deepEqual(out.get('f2499.md'), new Uint8Array([2499 % 256]));
});

test('防截断: list 对 2500 条目完整列出', async () => {
  const map: Record<string, Uint8Array> = {};
  for (let i = 0; i < 2500; i++) map[`f${i}.md`] = new Uint8Array([120]);
  const data = zipSync(map, {});
  const items = await list(data);
  assert.equal(items.length, 2500, 'list 应返回全部 2500 条目');
});

test('伪签名免疫（真实字节）: store 条目含 PK\\x03\\x04 不误切', async () => {
  // store 模式（level: 0）下条目内容原字节落盘，伪签名真实存在于归档中
  // （此前默认 deflate 压缩会改写字节，字面签名已不存在 → 测试空转）
  const tricky = 'x'.repeat(40) + String.fromCharCode(0x50, 0x4b, 0x03, 0x04) + 'y'.repeat(40);
  const trickyBytes = strToU8(tricky);
  const map: Record<string, Uint8Array> = { 'tricky.bin': trickyBytes };
  for (let i = 0; i < 2001; i++) map[`f${i}.md`] = new Uint8Array([i % 256]);
  const data = zipSync(map, { level: 0 });
  const out = await unpack(data);
  assert.equal(out.size, 2002, '应解出 2002 条（不在伪签名处误切）');
  assert.deepEqual(out.get('tricky.bin'), trickyBytes, '含伪签名的内容应逐字节一致');
});

test('退化路径: 空包（0 条目）不切分', async () => {
  const data = zipSync({}, {});
  // 空包应正常解出 0 条目（不抛错）
  const out = await unpack(data);
  assert.equal(out.size, 0);
});

test('退化路径: 单条目包不切分', async () => {
  const data = zipSync({ 'only.md': strToU8('solo') }, {});
  const out = await unpack(data);
  assert.equal(out.size, 1);
  assert.deepEqual(out.get('only.md'), strToU8('solo'));
});

test('大条目边界: 2001 条目（跨两块阈值，3 块）完整解包', async () => {
  const map: Record<string, Uint8Array> = {};
  for (let i = 0; i < 2001; i++) map[`f${i}.md`] = new Uint8Array([i % 256]);
  const data = zipSync(map, {});
  const out = await unpack(data);
  assert.equal(out.size, 2001, '2001 条目应完整解出（验证分块边界）');
});

// 分块边界整数倍：恰 1000（满一块阈值，切点恰在最后条目边界）与恰 2000（两块满额，末块纯 CD+EOCD）
for (const n of [1000, 2000]) {
  test(`分块边界: 恰 ${n} 条目（阈值整数倍）完整解包`, async () => {
    const map: Record<string, Uint8Array> = {};
    for (let i = 0; i < n; i++) map[`f${i}.md`] = new Uint8Array([i % 256]);
    const data = zipSync(map, {});
    const out = await unpack(data);
    assert.equal(out.size, n, `${n} 条目应完整解出（阈值整数倍不丢条目）`);
    assert.deepEqual(out.get('f0.md'), new Uint8Array([0]), '首条目内容应一致');
    assert.deepEqual(out.get(`f${n - 1}.md`), new Uint8Array([(n - 1) % 256]), '末条目内容应一致');
  });
}

// --- Issue #3 回归测试：zip64 / data descriptor 兼容性 ---

// 构造含 data descriptor（bit 3）的 ZIP：local header compSize=0，真实尺寸在 data descriptor 中
function forgeDataDescriptorZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const compSize = entry.data.length;

    // Local file header with bit 3 set (data descriptor), compSize=0
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0008, true); // bit 3 = data descriptor
    lv.setUint16(8, 0, true); // method = store
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x0021, true);
    lv.setUint32(14, 0, true); // crc32 = 0 (unknown)
    lv.setUint32(18, 0, true); // compSize = 0 (unknown, in data descriptor)
    lv.setUint32(22, 0, true); // uncompSize = 0
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, entry.data);

    // Data descriptor (16 bytes with signature)
    const dd = new Uint8Array(16);
    const dv2 = new DataView(dd.buffer);
    dv2.setUint32(0, 0x08074b50, true); // PK\x07\x08
    dv2.setUint32(4, 0, true); // crc32
    dv2.setUint32(8, compSize, true); // compressed size
    dv2.setUint32(12, compSize, true); // uncompressed size
    parts.push(dd);

    // Central directory header (with real values)
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0008, true); // bit 3
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x0021, true);
    cv.setUint32(16, 0, true); // crc32
    cv.setUint32(20, compSize, true); // real compressed size in CD
    cv.setUint32(24, compSize, true); // real uncomp size in CD
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true); // local header offset
    central.set(name, 46);
    centrals.push(central);

    offset += local.length + entry.data.length + dd.length;
  }

  const centralTotal = centrals.reduce((a, c) => a + c.length, 0);
  const centralBuf = new Uint8Array(centralTotal);
  let pos = 0;
  for (const c of centrals) { centralBuf.set(c, pos); pos += c.length; }
  parts.push(centralBuf);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralTotal, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  parts.push(eocd);

  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

test('Issue#3: data descriptor (bit-3) 包完整解包', async () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({
    name: `f${i}.md`,
    data: new TextEncoder().encode(`content-${i}`.repeat(100)),
  }));
  const data = forgeDataDescriptorZip(entries);
  const out = await unpack(data);
  assert.equal(out.size, 10, 'data descriptor 包应完整解出 10 条');
  for (let i = 0; i < 10; i++) {
    const expected = new TextEncoder().encode(`content-${i}`.repeat(100));
    assert.deepEqual(out.get(`f${i}.md`), expected, `f${i}.md 内容应一致`);
  }
});

test('Issue#3: data descriptor 大条目（>1000 条目触发分块）完整解包', async () => {
  const entries = Array.from({ length: 1500 }, (_, i) => ({
    name: `f${i}.md`,
    data: new Uint8Array([i % 256]),
  }));
  const data = forgeDataDescriptorZip(entries);
  const out = await unpack(data);
  assert.equal(out.size, 1500, 'data descriptor 1500 条目应完整解包');
  assert.deepEqual(out.get('f0.md'), new Uint8Array([0]));
  assert.deepEqual(out.get('f1499.md'), new Uint8Array([1499 % 256]));
});
