// zip 导出核心（跨端纯逻辑，P2）：.mdpkg 包 → 标准 zip 交付物（spec: zip-export）
// 语义（对照 export --expanded）：include 已展开、相对路径已按包根重写、不含 manifest.json
// 等 mdpkg 特定条目；另附加 README.md 说明文件。文本除展开与路径重写外一字不改。
// 跨端约束：不 import Buffer/fs/path，Node CLI 与浏览器（mdpkg-web）共用同一源码。
// 打包说明：zip-core 的 pack() 强制写入 manifest.json（容器格式要求），与导出产物
// 「不含 mdpkg 特定条目」冲突，故复用 packRaw()（不注入 manifest 的纯打包，同确定性
// 规则：mtime 固定 MDE_EPOCH、条目按路径码位升序、已压缩媒体 Store level 0）。
import { MdeError, E } from './errors.ts';
import { packRaw } from './zip-core.ts';
import { expand } from './include.ts';
import { inferEntrypoint } from './manifest.ts';

export interface ZipExportOptions {
  /** 自定义 README 内容；缺省用内置中文模板 */
  readme?: string;
}

/** 内置中文 README 模板：注明包来源（入口/构成/打开方式）；不写时间戳（可重复构建） */
function defaultReadme(entry: string, count: number): string {
  return `# 文档包说明

本目录由 mdpkg 导出（zip 交付形态），内容与源包一致：include 已展开、相对路径已按包根重写，Markdown 文本未作其它改动。

- 入口文档：${entry}
- 内容构成：${count} 个文件（Markdown 文档与图片等资源）
- 打开方式：用任意 Markdown 阅读器或编辑器打开入口文档即可；图片等资源已随目录携带，无需联网。

如需重新打包为 .mdpkg 单文件，可安装 mdpkg 后执行：mdpkg pack . -o out.mdpkg
`;
}

/**
 * 构建 zip 导出交付物。
 * @param pkg 原始包条目（含 manifest.json；lenient 场景可无 manifest，入口按规则推断）
 * @param opts 可选：自定义 README
 * @returns 标准 zip 字节（可重复构建：mtime 固定、条目按路径排序）
 */
export function buildZipExport(pkg: Map<string, Uint8Array>, opts?: ZipExportOptions): Uint8Array {
  // 1. 解析 manifest（有则取 entrypoint；非法 JSON 报 E302，与 render 路径一致）
  const manifestRaw = pkg.get('manifest.json');
  let entry: string;
  if (manifestRaw !== undefined) {
    let manifest: { entrypoint?: string };
    try { manifest = JSON.parse(new TextDecoder().decode(manifestRaw)); }
    catch (e) { throw new MdeError(E.E302, `manifest.json 不是合法 JSON: ${(e as Error).message}`); }
    entry = manifest.entrypoint ?? inferEntrypoint(pkg);
  } else {
    entry = inferEntrypoint(pkg); // lenient：无 manifest 时按规则推断（无 md 抛 E303）
  }
  if (!pkg.has(entry)) throw new MdeError(E.E303, `entrypoint 不存在: ${entry}`);

  // 2. 组装产物集（等价 export --expanded）：manifest.json 剔除；入口替换为展开文本；
  //    其余文件原样保留（文本一字不改）。expand 同时完成 include 展开与相对路径按包根重写。
  const out = new Map<string, Uint8Array>();
  for (const [p, data] of pkg) {
    if (p === 'manifest.json' || p === entry) continue;
    out.set(p, data);
  }
  const { text } = expand(pkg, entry);
  out.set(entry, new TextEncoder().encode(text));

  // 3. 附加 README.md：包内已有根级 README.md 时不覆盖（常见于入口即 README.md，
  //    覆盖会丢失用户内容），跳过生成——包自带 README 已承担说明职责。
  if (!out.has('README.md')) {
    out.set('README.md', new TextEncoder().encode(opts?.readme ?? defaultReadme(entry, out.size)));
  }

  // 4. 打包：packRaw 与 pack() 同确定性规则（mtime 固定、路径升序、媒体 Store），
  //    且不注入 manifest.json（导出产物不含 mdpkg 特定条目）
  return packRaw(out);
}