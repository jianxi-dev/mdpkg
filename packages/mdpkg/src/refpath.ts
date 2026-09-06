// 相对引用解析（OpenSpec folder-drop-open D7）：引用文本 ≠ 条目路径
// 原则：Markdown 引用（图片/链接 src）按「文档所在目录」语义解析，
// 与 zip-core 的 normalizePath（条目路径校验，拒绝 .. 段——ZIP 遍历防护）完全分离。
// 本模块为纯字符串段级压平：不触文件系统、不调 normalizePath、不 import Node API（浏览器/Node 跨端）。
// 越出包根（baseDir 之上）返回 null——调用方保留原文/占位，绝不抛错。

/**
 * 把引用文本按文档所在目录解析为包内相对路径。
 * @param baseDir - 文档所在目录（'' 表示包根，如入口 docs/doc.md → 'docs'）
 * @param ref     - 引用文本（如 '../assets/a.png' 或 './x.md'）
 * @returns 解析后的包内相对路径（'.' 段原样压平）；空引用或越出包根返回 null
 */
export function resolveRef(baseDir: string, ref: string): string | null {
  if (!ref) return null; // 空引用不可解析
  const out: string[] = [];
  for (const seg of [...baseDir.split('/'), ...ref.split('/')]) {
    if (seg === '' || seg === '.') continue; // 空段与 . 段压平（a/b/../c → a/c）
    if (seg === '..') {
      if (out.length === 0) return null; // .. 越出包根（baseDir 之上）
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length === 0 ? null : out.join('/');
}