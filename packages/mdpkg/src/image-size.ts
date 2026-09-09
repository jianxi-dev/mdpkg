// 位图固有尺寸读取：纯字节头解析，零 Node 专属 API（仅 Uint8Array 视图）
// 支持 PNG / JPEG / GIF / WebP；无法解析时返回 null（调用方回退缺省尺寸）
// 设计约束：跨端核心层（浏览器/Node 通用），不引入任何运行时依赖

export interface ImageSize {
  width: number;
  height: number;
}

/** 从位图字节读取固有宽高；未知格式 / 截断 / 损坏 → null */
export function readImageSize(data: Uint8Array): ImageSize | null {
  if (pngSize(data) != null) return pngSize(data)!;
  if (jpegSize(data) != null) return jpegSize(data)!;
  if (gifSize(data) != null) return gifSize(data)!;
  if (webpSize(data) != null) return webpSize(data)!;
  return null;
}

// --- PNG：IHDR 块 @ offset 16（8 字节签名 + 4 长度 + 4 "IHDR" + 4W + 4H）---

function pngSize(data: Uint8Array): ImageSize | null {
  if (data.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (data[i] !== sig[i]) return null;
  }
  // IHDR：宽度 byte 16-19，高度 byte 20-23（大端）
  return {
    width: readU32BE(data, 16),
    height: readU32BE(data, 20),
  };
}

// --- JPEG：扫描 SOF0/1/2 标记段（0xFFC0 / 0xFFC1 / 0xFFC2）---

function jpegSize(data: Uint8Array): ImageSize | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 <= data.length) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = data[offset + 1];
    // SOF0/1/2 含尺寸信息
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      // 段结构：FF Cn [2 字节长度] [1 字节精度] [2 高度] [2 宽度]
      const height = readU16BE(data, offset + 5);
      const width = readU16BE(data, offset + 7);
      return { width, height };
    }
    // 跳过当前标记段（长度含自身 2 字节）
    if (offset + 3 >= data.length) break;
    const segLen = readU16BE(data, offset + 2);
    offset += 2 + segLen;
  }
  return null;
}

// --- GIF：逻辑屏幕描述符（byte 6-9 宽 + 10-13 高，小端）---

function gifSize(data: Uint8Array): ImageSize | null {
  if (data.length < 10) return null;
  const sig = [0x47, 0x49, 0x46, 0x38]; // "GIF8"
  for (let i = 0; i < 4; i++) {
    if (data[i] !== sig[i]) return null;
  }
  return {
    width: readU16LE(data, 6),
    height: readU16LE(data, 8),
  };
}

// --- WebP：VP8X / VP8L / VP8 三种编码格式 ---

function webpSize(data: Uint8Array): ImageSize | null {
  if (data.length < 16) return null;
  // RIFF....WEBP
  if (data[0] !== 0x52 || data[1] !== 0x49 || data[2] !== 0x46 || data[3] !== 0x46) return null;
  if (data[8] !== 0x57 || data[9] !== 0x45 || data[10] !== 0x42 || data[11] !== 0x50) return null;
  // VP8X（扩展格式）
  if (data.length >= 30 && data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38 && data[15] === 0x58) {
    // 宽高 @ byte 24-29（24 位小端，实际尺寸 = 值 + 1）
    const width = (data[24] | (data[25] << 8) | (data[26] << 16)) + 1;
    const height = (data[27] | (data[28] << 8) | (data[29] << 16)) + 1;
    return { width, height };
  }
  // VP8（有损）
  if (data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38 && data[15] === 0x20) {
    // 帧标签后 4 字节：2 位标志 + 14 位版本 + 16 位宽度... 简化：从 byte 26-27 读（常见布局）
    if (data.length < 30) return null;
    const width = readU16LE(data, 26) & 0x3fff;
    const height = readU16LE(data, 28) & 0x3fff;
    return { width, height };
  }
  // VP8L（无损）
  if (data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38 && data[15] === 0x4c) {
    if (data.length < 25) return null;
    // byte 21-24：14 位宽 + 14 位高（小端位打包）
    const b0 = data[21];
    const b1 = data[22];
    const b2 = data[23];
    const b3 = data[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + ((b3 << 6) | ((b2 & 0xf0) >> 4) | ((b1 & 0xc0) >> 2));
    return { width, height };
  }
  return null;
}

// --- 大端 / 小端读取 ---

function readU32BE(data: Uint8Array, offset: number): number {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function readU16BE(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

function readU16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}
