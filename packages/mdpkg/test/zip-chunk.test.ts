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
