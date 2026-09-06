# md-bundle 集成指南：解包 → 编辑 → 重打包

> 本指南面向 md-bundle 等网页工具，说明如何调用 `mdpkg` 的浏览器端 API 完成 `.mdpkg` 的打开、编辑、保存闭环。

下表是 md-bundle 可复用的全部能力速查：

| API | 场景 | 示例位置 |
|---|---|---|
| `openMdpkg(bytes)` | 打开 .mdpkg / .zip 包 | [最小闭环示例](#最小闭环示例) |
| `openMarkdown(name, bytes)` | 直接渲染单个 .md 文件 | [核心 API](#核心-api) |
| `openFiles(files)` | 目录/多条目收集后统一打开 | [目录场景：收集目录树 → openFiles](#目录场景收集目录树--openfiles) |
| `packMdpkg(files, prevManifest?)` | 编辑后重打包 | [最小闭环示例](#最小闭环示例) |
| `readEntrySource(files, entry)` | 读取入口源码 | [核心 API](#核心-api) |
| `toMarkdown(files)` | 导出展开后 Markdown | [toMarkdown：导出展开后 Markdown](#tomarkdown导出展开后-markdown) |
| `toHtml(files)` | 导出自包含 HTML | [toHtml：导出自包含 HTML](#tohtml导出自包含-html) |
| `toDocx(files, opts?, onWarning?)` | 导出 OOXML 文档 | [toDocx：导出 OOXML 文档](#todocx导出-ooxml-文档) |
| `toZip(files, opts?)` | 导出标准 zip 交付物 | [toZip：导出标准 zip 交付物](#tozip导出标准-zip-交付物) |
| `expand` / `buildManifest` / `toBase64` / `MdeError` | 工具函数 | [核心 API](#核心-api) |

## 核心 API

```ts
import { openMdpkg, openFiles, openMarkdown, packMdpkg, type Manifest } from 'mdpkg/web/mdpkg-web.ts';
```

- `openMdpkg(bytes: Uint8Array)`：解包 `.mdpkg`，返回文件表、`manifest`、校验结果、渲染好的 HTML。
- `openFiles(files: Map<string, Uint8Array>, opts?: { symbols?: boolean; include?: boolean })`：任意文件 Map 的 lenient 渲染。无 manifest 时推断入口、标注 `unverified: true`；返回结构与 `openMdpkg` 完全同构（files / manifest / validation / html / degraded / error / unverified / entry）。`include` 缺省 `true`（跟随 render 默认语义：无 manifest 时展开）。供「上传/选择目录」场景使用——收集目录树为 Map 后调用。
- `openMarkdown(name: bytes, opts?)`：单 .md 直开（内部委托 `openFiles`，`include: false`，`<<<` 降级可见文本）。
- `packMdpkg(files: Map<string, Uint8Array>, prevManifest?: Manifest)`：把编辑后的文件表重新打包成 `.mdpkg` 字节流。

## 最小闭环示例

```ts
import { openMdpkg, packMdpkg } from 'mdpkg/web/mdpkg-web.ts';

// 1. 打开用户上传的 .mdpkg
const file = await fetch('/demo.mdpkg').then((r) => r.arrayBuffer());
const result = await openMdpkg(new Uint8Array(file));

if (result.validation.ok === false) {
  // 校验失败仍可继续编辑，但应提示用户
  console.warn('校验未通过', result.validation.errors);
}

// 2. 编辑：直接替换 files Map 中的 Uint8Array
const entry = result.manifest?.entrypoint ?? 'document.md';
const oldText = new TextDecoder().decode(result.files.get(entry)!);
const newText = oldText.replace('(tm)', '(tm) — 已编辑');
result.files.set(entry, new TextEncoder().encode(newText));

// 3. 重打包
const outBytes = packMdpkg(result.files, result.manifest ?? undefined);

// 4. 触发浏览器下载
const blob = new Blob([outBytes], { type: 'application/octet-stream' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'edited.mdpkg';
a.click();
URL.revokeObjectURL(a.href);
```

## 目录场景：收集目录树 → openFiles

当用户选择文件夹（或同时拖入 md + 附件多选）时，递归收集目录树构造 Map，再交给 `openFiles` 渲染。Map 键为文件夹内相对路径（含顶层文件夹名），入口按 lenient 规则推断。

```ts
import { openFiles } from 'mdpkg/web/mdpkg-web.ts';

// 1. 递归读取目录树，构造 Map（伪代码：使用 webkitGetAsEntry / getAsEntry）
async function collectDir(entry: FileSystemEntry, prefix = '', map = new Map<string, Uint8Array>()) {
  if (entry.isFile) {
    const file = await new Promise<File>((res) => (entry as FileSystemFileEntry).file(res));
    const buf = new Uint8Array(await file.arrayBuffer());
    map.set(prefix + file.name, buf);
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const entries = await new Promise<FileSystemEntry[]>((res) => reader.readEntries(res));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue; // 跳过隐藏路径段
      await collectDir(e, prefix + entry.name + '/', map);
    }
  }
  return map;
}

// 2. 调用 openFiles（无 manifest → lenient 推断入口 + unverified 标注）
const files = await collectDir(dirEntry);
const result = await openFiles(files, { symbols: true });

// 3. 渲染预览（result.html 已含图片 data URI 内联）
preview.srcdoc = result.html ?? `<pre>${result.error}</pre>`;

// 4. 可选：导出 docx / zip
// const docx = toDocx(result.files, { symbols: true }, (w) => console.warn(w));
// const zip = toZip(result.files);
```

### 相对引用语义

`openFiles` 渲染时按**文档所在目录**解析相对路径引用：

- `assets/a.png`（同级引用）→ 匹配 Map 中键 `assets/a.png`
- `../assets/a.png`（父级引用）→ 若文档在 `docs/doc.md`，解析为 `assets/a.png` 后匹配
- `./assets/a.png`（显式同级）→ 等价于 `assets/a.png`

越出包根的引用（如 `../../x.png`）不内联、不阻断渲染，按原文或外链处理。

## 推荐保存流程

1. **始终保留 `result.files` 这个 Map**，它是单文件包的内存真源。
2. **用户修改文本时**，把字符串用 `new TextEncoder().encode(text)` 转成 `Uint8Array` 写回 Map。
3. **用户替换图片/附件时**，把二进制内容作为 `Uint8Array` 写回 Map，并确保路径仍被 Markdown 引用。
4. **调用 `packMdpkg(files, result.manifest)`**：第二个参数传入原 `manifest`，用于保留 `entrypoint`、`extensions`、`extensions_required`、`encoding` 等作者意图字段。
5. **（可选）二次校验**：再次调用 `openMdpkg(outBytes)` 或 `validatePackage`，确认没有过期哈希或缺失资源。
6. **写回存储或触发下载**。

## 必须遵守的规则

### 不要直接修改 `manifest.json` 文本

`packMdpkg` 会主动删除 `files` 中的 `manifest.json`，并调用 `buildManifest` 重新生成：

- `resources[]`、`size`、`sha256`、`media_type`：每次重算。
- `entrypoint`、`extensions`、`extensions_required`、`encoding`：从 `prevManifest` 继承。
- `spec_version`：由工具决定，不继承。

如果你手动改了 `manifest.json` 的哈希但没有重算，保存后的包会在 `validate` 阶段报 `MDPKG-E402/E403`。

### `source_url` 按路径继承

`resources[].source_url` 表示「该资源曾经从哪个外链下载」。重打包时：

- **路径不变、内容改变**：`source_url` 会保留在同一路径上。
- **重命名文件**：原 `source_url` 会丢失。
- **新增文件**：没有 `source_url`。

### `files` Map 中必须全是 `Uint8Array`

不要放入字符串、Buffer 或其他类型。浏览器端没有 Node 的 `Buffer`，统一使用 `Uint8Array`。

### 孤儿资源只是告警

包内存在但未被引用的资源会在 `pack` 阶段报 `MDPKG-E404` 警告，不会中断保存。若希望精简体积，可在调用 `packMdpkg` 前自行从 Map 中删除这些文件。

### 相对路径引用保持原样

mdpkg v1 不使用 `mdpkg://` 协议。包内 Markdown 仍使用标准相对路径：

```markdown
![产品截图](assets/images/product.png)
```

编辑时若移动了资源文件，记得同步修改 Markdown 中的引用路径。

## 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 重打包后 `validate` 报 `MDPKG-E304` | `manifest.json` 被手动修改，`resources` 与实际文件对不上 | 不要手动改 manifest，让 `packMdpkg` 重建 |
| 报 `MDPKG-E401` | Markdown 引用了 Map 中不存在的资源 | 确保引用路径与 Map 键一致 |
| 报 `MDPKG-E402/E403` | 文件内容改了但 manifest 哈希没更新 | 使用 `packMdpkg`，它会重算哈希 |
| 下载的文件无法被 `openMdpkg` 识别 | 写入的不是 `Uint8Array` 或 MIME 类型不对 | 用 `Blob([uint8Array], { type: 'application/octet-stream' })` |

## 导出：md、html、docx 与 zip

除了解包 → 编辑 → 重打包的闭环，`mdpkg-web` 还提供一组导出函数，供 md-bundle 的「导出」菜单使用。它们与 `openMdpkg` / `packMdpkg` 共用同一跨端核心（`zip-core`），只是方向不同：把包内文件表交付为通用办公/文档格式。

```ts
import { toMarkdown, toHtml, toDocx, toZip } from 'mdpkg/web/mdpkg-web.ts';
```

导出矩阵：

| 格式 | 浏览器端 | CLI | 说明 |
|---|---|---|---|
| md | `toMarkdown(files, opts?)` | `export --md` | 展开后 Markdown 单文件（符号保持源文本） |
| mdpkg | `packMdpkg(files, prevManifest?)` | `pack` | 标准 .mdpkg 容器 |
| html | `toHtml(files, opts?)` | `render` | 自包含单文件 HTML（资源 data URI 内联） |
| zip | `toZip(files, opts?)` | `export --zip` | 标准 zip 交付物（无 manifest.json） |
| docx | `toDocx(files, opts?, onWarning?)` | `render --format docx` | OOXML 文档（资源嵌入） |
| pdf | `window.print()` | — | 浏览器打印兜底，不做导出能力 |

### toMarkdown：导出展开后 Markdown

```ts
// files 来自 openMdpkg 返回的 result.files
const mdText = toMarkdown(result.files);

// 浏览器端触发下载
const blob = new Blob([mdText], { type: 'text/markdown' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'document.md';
a.click();
URL.revokeObjectURL(a.href);
```

语义：

- 返回展开后的入口文档 Markdown 字符串：include 已内联、相对路径已按包根重写，与 CLI `export --md` 同源语义。
- **符号保持源文本**（不转换）——导出的是 Markdown 源，符号转换是渲染期行为。
- 入口自动解析：优先用 `manifest.entrypoint`，lenient 模式下按推断规则（document.md > README.md > 首个 .md）确定。
- 签名：`toMarkdown(files: Map<string, Uint8Array>, opts?: { symbols?: boolean }): string`。

### toHtml：导出自包含 HTML

```ts
// 与 openMdpkg().html 同源（同一 render + wrapDocument 管线）
const htmlText = toHtml(result.files);

const blob = new Blob([htmlText], { type: 'text/html' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'document.html';
a.click();
URL.revokeObjectURL(a.href);
```

语义：

- 返回完整 HTML 文档字符串（`<!doctype html>` + 内联样式 + 资源 data URI 内联），与 `openMdpkg().html` 同源。
- 图片以 `data:image/...;base64,` 内联，可直接保存为 `.html` 离线打开。
- 签名：`toHtml(files: Map<string, Uint8Array>, opts?: { symbols?: boolean }): string`。

### toDocx：导出 OOXML 文档

```ts
// files 来自 openMdpkg 返回的 result.files
// 入口由 manifest 或 lenient 推断自动解析，无需手动传入
const docxBytes = toDocx(
  result.files,
  { symbols: true }, // 是否应用 core 符号转换（默认 true）
  (msg) => console.warn(msg), // SVG 与非位图降级提示（可选）
);

// 浏览器端触发下载
const blob = new Blob([docxBytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'document.docx';
a.click();
URL.revokeObjectURL(a.href);
```

语义：

- 产出标准 `.docx`（ZIP 容器 + `[Content_Types].xml` + `word/document.xml`），可被 Microsoft Word / LibreOffice / WPS / Pages 直接打开。
- 复用与 `render --format docx` 同一渲染管线输入侧：include 已展开、符号已转换、原始 HTML 不生效。
- 位图资源（png / jpg / gif / webp）嵌入 `word/media/`，SVG 与非位图经 `onWarning` 回调提示。
- 入口自动解析：优先用 `manifest.entrypoint`，lenient 模式下按推断规则（document.md > README.md > 首个 .md）确定。
- 签名：`toDocx(files: Map<string, Uint8Array>, opts?: { symbols?: boolean; imageWidthEmu?: number; imageHeightEmu?: number }, onWarning?: (msg: string) => void): Uint8Array`。

### toZip：导出标准 zip 交付物

```ts
// 不传 opts 时，内置中文 README 模板会自动附加
const zipBytes = toZip(result.files);

// 也可传入自定义 README 内容（传入时不再使用内置模板）
// const zipBytes = toZip(result.files, { readme: '# 自定义说明\n' });

const blob = new Blob([zipBytes], { type: 'application/zip' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'document.zip';
a.click();
URL.revokeObjectURL(a.href);
```

语义：

- 产出标准 ZIP 容器，**不含 `manifest.json`** 等 mdpkg 特定条目，是交付给普通用户的最终形态。
- 内容等价于 CLI `export --expanded` 的产物集：include 已展开的 Markdown + 全部资源 + 相对路径已按包根重写。
- 缺省附加内置中文 `README.md` 说明包来源、打开方式与内容构成；若包内已有根级 `README.md` 则不生成模板。也可通过 `readme` 传入自定义字符串覆盖模板。
- 签名：`toZip(files: Map<string, Uint8Array>, opts?: { readme?: string }): Uint8Array`。

## 与 CLI 的关系

浏览器端 `packMdpkg` 与 Node CLI 的 `mdpkg pack` 共用同一套 ZIP 打包逻辑：

- 同样的条目排序（`manifest.json` 最前，其余按路径码位升序）。
- 同样的压缩策略（文本 DEFLATE，已压缩媒体 Store）。
- 同样的固定时间戳 `1980-01-01`，保证同输入同字节。

因此，在 md-bundle 中编辑保存的包，可以被 CLI 正常 `unpack / validate / render`。

导出侧的 `toMarkdown` / `toHtml` / `toDocx` / `toZip` 与 CLI 的 `export --md` / `render` / `render --format docx` / `export --zip` 同源：共享同一跨端核心，Node 端产出文件落盘，浏览器端产出字符串或 `Uint8Array` 供 Blob 下载。
