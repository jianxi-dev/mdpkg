// ZIP 容器核心层（浏览器/Node 通用）：路径规范化 · 打包 · 流式解压 · 列表 · base64
// 无 node:fs / node:path / node:crypto / Buffer 依赖，可被浏览器 bundle 直接引用。
// CLI 侧 container.ts 在此之上补充目录收集与 Node 专用路径解析。
// 实测要点（M0 探针）：
//  - fflate 的 Unzip 回调里 size = 压缩后大小，originalSize 才是解压后大小（用错则炸弹防护失效）
//  - Unzip 的文件回调必须传给构造函数，register() 只注册编解码器
//  - 条目顺序由插入顺序决定，库不自动排序 → 必须自己排
import { Unzip, UnzipInflate, UnzipPassThrough, zipSync, strToU8 } from 'fflate';
import { MdeError, E } from './errors.ts';

export const MDE_EPOCH = new Date(Date.UTC(1980, 0, 1)); // ZIP 可表示的最早时间
export const MAX_PATH_BYTES = 1024;

export const LIMITS = {
  entries: 10_000,
  file: 200 * 1024 * 1024, // 单文件解压后
  total: 1024 * 1024 * 1024, // 总解压
  ratio: 1000, // 压缩比
};

// fflate Unzip 单次 push 递归解析在 ~2108 条目处静默截断（issue #1），取 1000 留余量
const ZIP_CHUNK_ENTRIES = 1000;

const ILLEGAL = /(^|[\\/])\.\.([\\/]|$)|\\|\0|^[A-Za-z]:|^[/\\]/u;

/** 路径规范化：NFC 归一化 + 拒绝非法路径。返回包内相对路径（分隔符 /） */
export function normalizePath(raw: string): string {
  if (new TextEncoder().encode(raw).length > MAX_PATH_BYTES) throw new MdeError(E.E204, `路径超长: ${raw.slice(0, 40)}…`);
  // macOS(APFS) 存 NFD，Linux 存 NFC；不归一化会导致跨平台 sha256 失配（M0/S4 实证）
  const p = raw.normalize('NFC').replace(/\\/g, '/');
  if (ILLEGAL.test(p)) throw new MdeError(E.E202, `非法路径: ${raw}`);
  const parts = p.split('/').filter((s) => s !== '' && s !== '.');
  if (parts.length === 0 || parts.some((s) => s === '..')) throw new MdeError(E.E202, `非法路径: ${raw}`);
  return parts.join('/');
}

/** Uint8Array → base64（浏览器无 Buffer；Node 侧亦统一此实现） */
export function toBase64(data: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000; // 16KB 分块，避免栈溢出（大图可达 MB 级）
  for (let i = 0; i < data.length; i += chunk) {
    bin += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// 已压缩/已压缩友好的媒体 → Store，不浪费 CPU
const STORE_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'mp4', 'mov', 'webm', 'mp3',
  'm4a', 'wav', 'pdf', 'zip', 'gz', 'tgz', 'br', 'zst', '7z', 'rar', 'woff2',
]);

function minimalManifest(files: Map<string, Uint8Array>) {
  return { format: 'mdpkg', spec_version: '1.0', entrypoint: 'document.md', entry_count: files.size };
}

/** 打包：固定顺序 + 固定 mtime + 逐条目压缩级别 → 同输入必产同字节 */
export function pack(files: Map<string, Uint8Array>, manifest?: object): Uint8Array {
  const all = new Map(files);
  const manifestBytes = strToU8(JSON.stringify(manifest ?? minimalManifest(all), null, 2) + '\n');
  all.set('manifest.json', manifestBytes);

  const seen = new Map<string, string>(); // 归一化路径 → 原始路径
  const zipped: Record<string, [Uint8Array, { level: number }]> = {};
  // manifest.json 最前，其余按路径码位升序（fflate 按插入顺序写条目，不自动排序）
  const order = [...all.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const sorted = ['manifest.json', ...order.filter((p) => p !== 'manifest.json')];

  for (const p of sorted) {
    const key = normalizePath(p);
    const lower = key.toLowerCase();
    const prev = seen.get(lower);
    if (prev !== undefined && prev !== key) throw new MdeError(E.E201, `路径冲突（仅大小写不同）: ${prev} vs ${key}`);
    seen.set(lower, key);
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    zipped[key] = [all.get(p)!, { level: STORE_EXT.has(ext) ? 0 : 9 }];
  }
  return zipSync(zipped, { mtime: MDE_EPOCH });
}

/**
 * 打包（不注入 manifest.json）：docx 等非 mdpkg 容器用。
 * 与 pack() 相同的确定性规则（固定顺序 + 固定 mtime + 逐条目压缩级别），
 * 但输出是纯用户文件集，不附加任何元数据条目。
 */
export function packRaw(files: Map<string, Uint8Array>): Uint8Array {
  const seen = new Map<string, string>(); // 归一化路径 → 原始路径
  const zipped: Record<string, [Uint8Array, { level: number }]> = {};
  // 按路径码位升序（fflate 按插入顺序写条目，不自动排序）
  const order = [...files.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const p of order) {
    const key = normalizePath(p);
    const lower = key.toLowerCase();
    const prev = seen.get(lower);
    if (prev !== undefined && prev !== key) throw new MdeError(E.E201, `路径冲突（仅大小写不同）: ${prev} vs ${key}`);
    seen.set(lower, key);
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    zipped[key] = [files.get(p)!, { level: STORE_EXT.has(ext) ? 0 : 9 }];
  }
  return zipSync(zipped, { mtime: MDE_EPOCH });
}

/**
 * 按 local file header 边界将 ZIP 切块，使每块条目数 ≤ maxEntries。
 * 目的：fflate Unzip 单次 push 递归解析在 ~2108 条目处静默截断（issue #1），
 *       分块后每块递归深度 ≤ 块内条目数，避免栈溢出丢内容。
 * 退化：任何解析异常（不完整 header、长度溢出）→ 返回 [data]（整块，保持既有行为）。
 */
function chunkZIP(data: Uint8Array, maxEntries: number): Uint8Array[] {
  if (maxEntries <= 0 || data.length < 30) return [data];
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const chunks: Uint8Array[] = [];
  let chunkStart = 0, count = 0, i = 0;

  while (i <= data.length - 4) {
    // 找 local file header 签名 PK\x03\x04
    if (data[i] !== 0x50 || data[i + 1] !== 0x4b || data[i + 2] !== 0x03 || data[i + 3] !== 0x04) { i++; continue; }
    // 不完整 header → 退化
    if (i + 30 > data.length) return [data];
    const nameLen = dv.getUint16(i + 26, true);
    const extraLen = dv.getUint16(i + 28, true);
    const compSize = dv.getUint32(i + 18, true);
    const entryEnd = i + 30 + nameLen + extraLen + compSize;
    // 长度溢出 → 退化（用真实字段跳过条目体，防内容中 PK\x03\x04 伪签名误导）
    if (entryEnd > data.length) return [data];
    count++;
    // 达到 maxEntries 且还有后续数据（central dir/EOCD）→ 在条目边界切一块
    if (count >= maxEntries && entryEnd < data.length) {
      chunks.push(data.subarray(chunkStart, entryEnd));
      chunkStart = entryEnd;
      count = 0;
    }
    i = entryEnd; // 跳到条目末尾继续扫描
  }

  // 最后一块包含 central directory + EOCD（必须包含全部剩余字节）
  if (chunkStart < data.length) chunks.push(data.subarray(chunkStart));
  return chunks.length > 0 ? chunks : [data];
}

/** 解包：流式读取，边读边计数，超限立即中断（不解压、不落盘） */
export function unpack(data: Uint8Array): Promise<Map<string, Uint8Array>> {
  return new Promise((res, rej) => {
    const out = new Map<string, Uint8Array>();
    let total = 0, pending = 0, settled = false;
    const finish = () => { if (pending === 0 && !settled) { settled = true; res(out); } };
    const uz = new Unzip((f) => {
      try {
        if (out.size + 1 > LIMITS.entries) throw new MdeError(E.E602, `资源总数超过 ${LIMITS.entries}`);
        const orig = f.originalSize; // 注意：f.size 是压缩后大小
        const comp = f.size;
        if (orig > LIMITS.file) throw new MdeError(E.E603, `单文件 ${(orig / 1048576).toFixed(0)}MB 超过上限 ${LIMITS.file / 1048576}MB`);
        if (orig / Math.max(1, comp) > LIMITS.ratio) throw new MdeError(E.E605, `压缩比 ${Math.round(orig / Math.max(1, comp))}:1 异常`);
        total += orig;
        if (total > LIMITS.total) throw new MdeError(E.E604, `总解压超过 ${LIMITS.total / 1048576}MB`);

        const path = normalizePath(f.name);
        const chunks: Uint8Array[] = [];
        pending++;
        // 注意：ondata 内不再调用 finish()——分块 push 下 pending 可能在块间归零，
        // 若此时 resolve 会跳过后续块的内容。finish() 仅在全部 push 结束后调用一次。
        f.ondata = (err, chunk, final) => {
          if (err) return rej(new MdeError(E.E101, String(err)));
          chunks.push(chunk);
          if (final) { out.set(path, concat(chunks)); pending--; }
        };
        f.start();
      } catch (e) { rej(e); }
    });
    uz.register(UnzipInflate);
    uz.register(UnzipPassThrough);
    const chunks = chunkZIP(data, ZIP_CHUNK_ENTRIES);
    for (let i = 0; i < chunks.length; i++) uz.push(chunks[i], i === chunks.length - 1);
    finish();
  });
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(n);
  let i = 0;
  for (const c of chunks) { out.set(c, i); i += c.length; }
  return out;
}

/** 列出包内条目（只读 header，不解压） */
export function list(data: Uint8Array): Promise<{ path: string; size: number; compressed: number }[]> {
  return new Promise((res, rej) => {
    const items: { path: string; size: number; compressed: number }[] = [];
    let pending = 0, settled = false;
    const finish = () => { if (pending === 0 && !settled) { settled = true; res(items); } };
    const uz = new Unzip((f) => {
      try {
        items.push({ path: normalizePath(f.name), size: f.originalSize, compressed: f.size });
        pending++;
        // 只读 header：消费流但不保留数据（finish 仅在全部 push 结束后调用）
        f.ondata = (_err, _chunk, final) => { if (final) { pending--; } };
        f.start();
      } catch (e) { rej(e); }
    });
    uz.register(UnzipInflate);
    uz.register(UnzipPassThrough);
    const chunks = chunkZIP(data, ZIP_CHUNK_ENTRIES);
    for (let i = 0; i < chunks.length; i++) uz.push(chunks[i], i === chunks.length - 1);
    finish();
  });
}