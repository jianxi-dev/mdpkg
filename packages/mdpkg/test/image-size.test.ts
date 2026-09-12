// image-size.ts 单元测试：纯字节头解析（PNG/JPEG/GIF/WebP + 截断/空/未知 → null）
// 风格：node:test + assert/strict，真实头样本（最小有效头）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readImageSize } from '../src/image-size.ts';

// --- 工具 ---

/** 构造 PNG 头（8 字节签名 + IHDR 长度 + "IHDR" + 4W@16 + 4H@20） */
function pngHeader(width: number, height: number): Uint8Array {
  const data = new Uint8Array(24);
  // PNG 签名
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR 长度 = 13（大端 4 字节 @ offset 8）
  data[8] = 0; data[9] = 0; data[10] = 0; data[11] = 13;
  // "IHDR" @ offset 12
  data[12] = 0x49; data[13] = 0x48; data[14] = 0x44; data[15] = 0x52;
  // 宽度（大端 4 字节 @ offset 16）
  data[16] = (width >> 24) & 0xff; data[17] = (width >> 16) & 0xff;
  data[18] = (width >> 8) & 0xff; data[19] = width & 0xff;
  // 高度（大端 4 字节 @ offset 20）
  data[20] = (height >> 24) & 0xff; data[21] = (height >> 16) & 0xff;
  data[22] = (height >> 8) & 0xff; data[23] = height & 0xff;
  return data;
}

/** 构造 JPEG 头（SOF0 标记段含宽高） */
function jpegHeader(width: number, height: number): Uint8Array {
  // FF D8 FF C0 [2 字节长度] [1 字节精度] [2 高度] [2 宽度]
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xc0, // SOF0
    0x00, 0x0b, // 长度 = 11
    0x08, // 精度 8 位
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
  ]);
}

/** 构造 GIF 头（逻辑屏幕描述符小端宽高） */
function gifHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
    width & 0xff, (width >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
    0x00, 0x00, 0x00,
  ]);
}

/** 构造 WebP VP8X 头 */
function webpHeader(width: number, height: number): Uint8Array {
  const data = new Uint8Array(30);
  // RIFF
  data[0] = 0x52; data[1] = 0x49; data[2] = 0x46; data[3] = 0x46;
  // 文件大小（占位）
  data[4] = 0x00; data[5] = 0x00; data[6] = 0x00; data[7] = 0x00;
  // WEBP
  data[8] = 0x57; data[9] = 0x45; data[10] = 0x42; data[11] = 0x50;
  // VP8X
  data[12] = 0x56; data[13] = 0x50; data[14] = 0x38; data[15] = 0x58;
  // VP8X 标志（10 字节）
  data[16] = 0x00; data[17] = 0x00; data[18] = 0x00; data[19] = 0x00;
  data[20] = 0x00; data[21] = 0x00; data[22] = 0x00; data[23] = 0x00;
  // 宽高（24 位小端，实际 = 值 + 1）
  const w = width - 1;
  const h = height - 1;
  data[24] = w & 0xff; data[25] = (w >> 8) & 0xff; data[26] = (w >> 16) & 0xff;
  data[27] = h & 0xff; data[28] = (h >> 8) & 0xff; data[29] = (h >> 16) & 0xff;
  return data;
}

// ============ PNG ============

test('PNG：标准 IHDR 头解析 1920×1080', () => {
  const size = readImageSize(pngHeader(1920, 1080));
  assert.deepEqual(size, { width: 1920, height: 1080 });
});

test('PNG：1×1 最小尺寸', () => {
  const size = readImageSize(pngHeader(1, 1));
  assert.deepEqual(size, { width: 1, height: 1 });
});

test('PNG：截断头（< 24 字节）→ null', () => {
  assert.equal(readImageSize(new Uint8Array(10)), null);
});

// ============ JPEG ============

test('JPEG：SOF0 头解析 800×600', () => {
  const size = readImageSize(jpegHeader(800, 600));
  assert.deepEqual(size, { width: 800, height: 600 });
});

test('JPEG：SOF2 头解析 640×480', () => {
  const data = new Uint8Array([
    0xff, 0xd8, 0xff, 0xc2, 0x00, 0x0b, 0x08,
    0x01, 0xe0, // 480
    0x02, 0x80, // 640
  ]);
  const size = readImageSize(data);
  assert.deepEqual(size, { width: 640, height: 480 });
});

test('JPEG：SOF0 段前带 FF FF 填充字节 → 正确解析 800×600', () => {
  // FF D8 FF FF FF C0 [len] [precision] [height] [width]
  const data = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xff, 0xff, // 填充字节
    0xff, 0xc0, // SOF0
    0x00, 0x0b, // 长度 = 11
    0x08, // 精度
    0x02, 0x58, // 600
    0x03, 0x20, // 800
  ]);
  const size = readImageSize(data);
  assert.deepEqual(size, { width: 800, height: 600 });
});

test('JPEG：SOF0 段后紧跟 FF FF 填充 → 正确解析 640×480', () => {
  // FF D8 FF C0 [len] [precision] [H] [W] FF FF（SOF 后填充不影响解析）
  const data = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xc0, // SOF0
    0x00, 0x0b, // 长度 = 11
    0x08, // 精度
    0x01, 0xe0, // 480
    0x02, 0x80, // 640
    0xff, 0xff, // 尾部填充
  ]);
  const size = readImageSize(data);
  assert.deepEqual(size, { width: 640, height: 480 });
});

test('JPEG：非 SOF 标记段（无尺寸）→ null', () => {
  // APP0 标记（FFE0）不含尺寸
  const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  assert.equal(readImageSize(data), null);
});

// ============ GIF ============

test('GIF：逻辑屏幕描述符解析 320×240', () => {
  const size = readImageSize(gifHeader(320, 240));
  assert.deepEqual(size, { width: 320, height: 240 });
});

test('GIF：截断头（< 10 字节）→ null', () => {
  assert.equal(readImageSize(new Uint8Array([0x47, 0x49, 0x46])), null);
});

// ============ WebP ============

test('WebP：VP8X 头解析 1920×1080', () => {
  const size = readImageSize(webpHeader(1920, 1080));
  assert.deepEqual(size, { width: 1920, height: 1080 });
});

test('WebP：VP8X 1×1 最小尺寸', () => {
  const size = readImageSize(webpHeader(1, 1));
  assert.deepEqual(size, { width: 1, height: 1 });
});

/** 构造 WebP VP8L（无损）头：bytes 12-15 = "VP8L", bytes 21-24 = 14-bit 宽高 */
function webpVp8LHeader(width: number, height: number): Uint8Array {
  const data = new Uint8Array(25);
  // RIFF
  data[0] = 0x52; data[1] = 0x49; data[2] = 0x46; data[3] = 0x46;
  data[4] = 0x00; data[5] = 0x00; data[6] = 0x00; data[7] = 0x00;
  // WEBP
  data[8] = 0x57; data[9] = 0x45; data[10] = 0x42; data[11] = 0x50;
  // VP8L
  data[12] = 0x56; data[13] = 0x50; data[14] = 0x38; data[15] = 0x4c;
  // VP8L 14-bit 小端位打包：低 14 位 = width-1, 高 14 位 = height-1
  const w = width - 1;
  const h = height - 1;
  // byte21 = w[7:0], byte22 = w[13:8] | h[1:0]<<6, byte23 = h[9:2], byte24 = h[13:10]
  data[21] = w & 0xff;
  data[22] = ((w >> 8) & 0x3f) | ((h & 0x03) << 6);
  data[23] = (h >> 2) & 0xff;
  data[24] = (h >> 10) & 0x0f;
  return data;
}

test('WebP：VP8L 无损头解析 800×600', () => {
  const size = readImageSize(webpVp8LHeader(800, 600));
  assert.deepEqual(size, { width: 800, height: 600 });
});

test('WebP：VP8L 1×1 最小尺寸', () => {
  const size = readImageSize(webpVp8LHeader(1, 1));
  assert.deepEqual(size, { width: 1, height: 1 });
});

test('WebP：VP8L 大尺寸 4096×2048', () => {
  const size = readImageSize(webpVp8LHeader(4096, 2048));
  assert.deepEqual(size, { width: 4096, height: 2048 });
});

// ============ 边界 ============

test('空字节 → null', () => {
  assert.equal(readImageSize(new Uint8Array(0)), null);
});

test('未知格式（随机字节）→ null', () => {
  assert.equal(readImageSize(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])), null);
});

test('不完整 PNG 签名 → null', () => {
  const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(readImageSize(data), null);
});
