// docx 导出（OOXML 最小写入器，浏览器/Node 通用）
// 管线与 render.ts 一致（规范 §8.1）：解包 → 校验 → include 展开 → 解析 → 符号转换 → 序列化
// 输出部件：[Content_Types].xml / _rels/.rels / word/document.xml / word/_rels/document.xml.rels /
//          word/styles.xml / word/numbering.xml / word/media/*（位图资源）
// 约束：零 Node 专属 API（无 Buffer/fs/path），仅用 TextEncoder/TextDecoder 与 fflate（经 zip-core）。
// 保真决策：
//  - 列表用真实 OOXML 编号（numbering.xml + numPr），嵌套列表按 ilvl 递增
//  - 符号转换在 mdast 文本层复用 symbols.ts（与 HTML 路径同一转换函数与哨兵语义）
//  - raw HTML 降级为字面量文本（script/style 整体丢弃，与 rehype-sanitize 删除语义一致）
//  - 位图（png/jpg/jpeg/gif/webp）嵌入 word/media/；SVG 与其它非位图以 alt 文本占位 + 警告
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { replaceSymbols, unguard, guardEscapes } from './symbols.ts';
import { expand } from './include.ts';
import { resolveRef } from './refpath.ts';
import { assertSupported, assertMarkdownEntrypoint, inferEntrypoint } from './manifest.ts';
import { packRaw } from './zip-core.ts';
import { MdeError, E } from './errors.ts';

// OOXML 命名空间：document.xml 根元素一次性声明，正文引用各前缀
const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
};

const EMU_PER_INCH = 914400; // 1 英寸 = 914400 EMU
const DEFAULT_IMAGE_WIDTH_EMU = 6 * EMU_PER_INCH; // 默认宽 6 英寸
const DEFAULT_IMAGE_HEIGHT_EMU = Math.round(DEFAULT_IMAGE_WIDTH_EMU * 0.75); // 高按 4:3

// 可嵌入 docx 的位图扩展名（SVG 与其它类型降级为 alt 文本）
const BITMAP_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

export interface DocxOptions {
  /** 符号扩展开关（默认 true，跟随 manifest.extensions.symbols，与 HTML 路径一致） */
  symbols?: boolean;
  /** 图片默认宽度（EMU，1 英寸 = 914400），默认 6 英寸 */
  imageWidthEmu?: number;
  /** 图片默认高度（EMU），默认按 4:3（宽 × 0.75） */
  imageHeightEmu?: number;
}

// 序列化上下文：收集媒体、关系、警告
interface Ctx {
  files: Map<string, Uint8Array>;
  entryDir: string; // 入口文档所在目录（D7 相对引用解析基准；'' = 包根）
  symbols: boolean;
  imageWidthEmu: number;
  imageHeightEmu: number;
  media: { path: string; data: Uint8Array }[]; // 待写入 word/media/ 的位图
  rels: { id: string; type: string; target: string; external?: boolean }[]; // document.xml.rels
  warnings: string[];
  nextRid: number; // 关系编号（rId1=styles、rId2=numbering 已占用）
  docPrId: number; // 图片 docPr 自增 id
}

/** XML 文本转义（& < > " '） */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** raw HTML 降级：script/style 元素整体丢弃，其余输出字面量文本（无执行面） */
function degradeHtml(raw: string): string {
  return raw.replace(/<\s*(script|style)\b[\s\S]*?<\s*\/\s*(script|style)\s*>/gi, '');
}

const isExternal = (src: string) =>
  /^(https?:)?\/\//i.test(src) || /^(mailto|data|tel):/i.test(src) || src.startsWith('#') || src.startsWith('<');

// 行内格式累积器：strong/em/delete/code/link 逐层叠加
interface RunFmt {
  b?: boolean;
  i?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string; // 超链接 rId（外链）
}

/** run 属性：粗体/斜体/删除线/等宽代码/超链接样式 */
function rPrXml(fmt: RunFmt): string {
  let rPr = '';
  if (fmt.b) rPr += '<w:b/>';
  if (fmt.i) rPr += '<w:i/>';
  if (fmt.strike) rPr += '<w:strike/>';
  if (fmt.code) {
    rPr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>';
    rPr += '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>';
  }
  if (fmt.link) rPr += '<w:rStyle w:val="Hyperlink"/>';
  return rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
}

/** 单个文本 run（外链时包 hyperlink 元素） */
function plainRun(text: string, fmt: RunFmt): string {
  const run = `<w:r>${rPrXml(fmt)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  return fmt.link ? `<w:hyperlink r:id="${fmt.link}" w:history="1">${run}</w:hyperlink>` : run;
}

/** 文本 → run 序列（\n 软换行转 w:br，保留行结构） */
function textToRuns(text: string, fmt: RunFmt): string {
  const parts = text.split('\n');
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) out += `<w:r>${rPrXml(fmt)}<w:br/></w:r>`;
    if (parts[i]) out += plainRun(parts[i], fmt);
  }
  return out;
}

/** 行内代码：等宽字体 + 浅灰底纹 */
function codeRun(text: string, fmt: RunFmt): string {
  return plainRun(text, { ...fmt, code: true });
}

/** 行内子节点序列化（段落/标题内容），fmt 逐层传递（strong/em/link 等嵌套格式） */
function inlineChildren(children: unknown[], ctx: Ctx, fmt: RunFmt = {}): string {
  return children.map((c) => inlineToXml(c as never, ctx, fmt)).join('');
}

/** 行内节点 → OOXML run 序列（text 节点做符号转换，与 HTML 路径同一函数） */
function inlineToXml(node: { type: string; [k: string]: unknown }, ctx: Ctx, fmt: RunFmt): string {
  switch (node.type) {
    case 'text': {
      let text = String(node.value ?? '');
      if (ctx.symbols) text = unguard(replaceSymbols(text)); // 哨兵还原 + 符号转换
      return textToRuns(text, fmt);
    }
    case 'strong': return inlineChildren(node.children as never[], ctx, { ...fmt, b: true });
    case 'emphasis': return inlineChildren(node.children as never[], ctx, { ...fmt, i: true });
    case 'delete': return inlineChildren(node.children as never[], ctx, { ...fmt, strike: true });
    case 'inlineCode': return codeRun(String(node.value ?? ''), fmt);
    case 'link': {
      const url = String(node.url ?? '');
      if (isExternal(url)) {
        const rId = `rId${ctx.nextRid++}`;
        ctx.rels.push({ id: rId, type: 'hyperlink', target: url, external: true });
        return inlineChildren(node.children as never[], ctx, { ...fmt, link: rId });
      }
      // 内部锚点/相对链接：无关系可建，按普通文本输出（保留字面目标）
      return inlineChildren(node.children as never[], ctx, fmt);
    }
    case 'image': return imageToXml(node as never, ctx, fmt);
    case 'break': return `<w:r>${rPrXml(fmt)}<w:br/></w:r>`;
    case 'html': return textToRuns(degradeHtml(String(node.value ?? '')), fmt);
    case 'footnoteReference': return textToRuns(`[^${String(node.identifier ?? '')}]`, fmt);
    default: {
      // 未知行内节点：尽力输出其文本内容，避免内容丢失
      const v = (node as { value?: unknown }).value;
      return typeof v === 'string' ? textToRuns(v, fmt) : '';
    }
  }
}

/** 图片降级：以 alt（或 src）文本占位；warning 非空时记入 ctx.warnings */
function imageFallbackText(src: string, alt: string, ctx: Ctx, fmt: RunFmt, warning?: string): string {
  if (warning) ctx.warnings.push(warning);
  return textToRuns(alt || src, fmt);
}

/** 图片节点：位图嵌入 word/media/ + relationship + w:drawing；SVG/外链/缺失 → alt 文本占位 */
function imageToXml(node: { url?: unknown; alt?: unknown }, ctx: Ctx, fmt: RunFmt): string {
  const src = String(node.url ?? '');
  const alt = String(node.alt ?? '');
  if (isExternal(src)) return imageFallbackText(src, alt, ctx, fmt); // 外链无法嵌入：alt 占位
  let data = ctx.files.get(src);
  if (!data && ctx.entryDir) {
    // 精确查未命中：按入口文档目录语义解析引用文本（D7，如 docs/doc.md 的 ../assets/a.png → assets/a.png）
    const resolved = resolveRef(ctx.entryDir, src);
    if (resolved !== null) data = ctx.files.get(resolved);
  }
  if (!data) return imageFallbackText(src, alt, ctx, fmt); // 缺失资源：不阻断渲染，以 alt 占位（`validate` 命令负责报错，与 HTML 路径一致）
  const ext = src.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'svg') {
    return imageFallbackText(src, alt, ctx, fmt, `SVG 图片不嵌入 docx（v1 限制），已用 alt 文本占位: ${src}`);
  }
  if (!BITMAP_EXT.has(ext)) {
    return imageFallbackText(src, alt, ctx, fmt, `资源类型不支持嵌入 docx: ${src}，已用 alt 文本占位`);
  }
  const id = ctx.media.length + 1;
  const mediaPath = `word/media/img-${id}.${ext}`;
  ctx.media.push({ path: mediaPath, data });
  const rId = `rId${ctx.nextRid++}`;
  ctx.rels.push({ id: rId, type: 'image', target: mediaPath });
  const w = ctx.imageWidthEmu;
  const h = ctx.imageHeightEmu;
  const docPrId = ctx.docPrId++;
  const name = mediaPath.split('/').pop()!;
  return `<w:r>${rPrXml(fmt)}<w:drawing>
  <wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="${w}" cy="${h}"/>
    <wp:docPr id="${docPrId}" name="${esc(name)}" descr="${esc(alt)}"/>
    <a:graphic>
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic>
          <pic:nvPicPr>
            <pic:cNvPr id="${docPrId}" name="${esc(name)}" descr="${esc(alt)}"/>
            <pic:cNvPicPr/>
          </pic:nvPicPr>
          <pic:blipFill>
            <a:blip r:embed="${rId}"/>
            <a:stretch><a:fillRect/></a:stretch>
          </pic:blipFill>
          <pic:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing></w:r>`;
}

/** 列表：numbering.xml 编号（ul=numId 1 项目符号，ol=numId 2 十进制），嵌套按 ilvl 递增 */
function serializeList(node: { ordered?: unknown; start?: unknown; children?: unknown[] }, ctx: Ctx, ilvl: number): string {
  const numId = node.ordered ? 2 : 1;
  const start = Number(node.start) || 1;
  let out = '';
  (node.children ?? []).forEach((item, idx) => {
    const it = item as { type?: string; checked?: unknown; children?: unknown[] };
    if (it.type !== 'listItem') return;
    // 任务列表（GFM）：勾选框以文本前缀呈现
    const checked = typeof it.checked === 'boolean' ? (it.checked ? '[x] ' : '[ ] ') : '';
    // 有序列表自定义起始号：仅首项带 startOverride
    const startOverride = idx === 0 && numId === 2 && start !== 1 ? `<w:startOverride w:val="${start}"/>` : '';
    const numPr = `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/>${startOverride}</w:numPr>`;
    let first = true;
    for (const child of it.children ?? []) {
      if ((child as { type?: string }).type === 'list') {
        out += serializeList(child as never, ctx, ilvl + 1);
        continue;
      }
      out += blockToXml(child as never, ctx, { numPr, prefix: first ? checked : undefined });
      first = false;
    }
  });
  return out;
}

/** 块级节点 → OOXML 段落/表格 XML */
function blockToXml(node: { type: string; [k: string]: unknown }, ctx: Ctx, extra?: { numPr?: string; prefix?: string; style?: string }): string {
  switch (node.type) {
    case 'heading': {
      const depth = Math.min(6, Math.max(1, Number(node.depth) || 1));
      return `<w:p><w:pPr><w:pStyle w:val="Heading${depth}"/></w:pPr>${inlineChildren(node.children as never[], ctx)}</w:p>`;
    }
    case 'paragraph': {
      const pStyle = extra?.style ?? (extra?.numPr ? 'ListParagraph' : '');
      const pPr = `${pStyle ? `<w:pStyle w:val="${pStyle}"/>` : ''}${extra?.numPr ?? ''}`;
      const prefix = extra?.prefix ? plainRun(extra.prefix, {}) : '';
      return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${prefix}${inlineChildren(node.children as never[], ctx)}</w:p>`;
    }
    case 'code': {
      // 块级代码：每行一段（CodeBlock 样式），保留空白
      const lines = String(node.value ?? '').split('\n');
      return lines
        .map((line) => `<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`)
        .join('');
    }
    case 'list': return serializeList(node as never, ctx, 0);
    case 'blockquote': {
      // 引用：子块套 Quote 样式（左缩进 + 斜体）
      return (node.children as never[]).map((c) => blockToXml(c as never, ctx, { style: 'Quote' })).join('');
    }
    case 'thematicBreak': {
      // 水平线：段落底部边框
      return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>';
    }
    case 'table': return tableToXml(node as never, ctx);
    case 'html': return textToRuns(degradeHtml(String(node.value ?? '')), {});
    case 'footnoteDefinition': return ''; // 脚注定义不输出（引用已降级为 [^label] 文本）
    default: {
      // 未知块节点：尽力输出其文本内容，避免内容丢失
      const v = (node as { value?: unknown }).value;
      return typeof v === 'string' && v ? `<w:p>${textToRuns(v, {})}</w:p>` : '';
    }
  }
}

/** 表格（remark-gfm）：tblBorders + 表头底纹，单元格内块递归序列化 */
function tableToXml(node: { children?: unknown[] }, ctx: Ctx): string {
  const rows = (node.children ?? []).filter((r) => (r as { type?: string }).type === 'tableRow');
  const colCount = Math.max(1, ...rows.map((r) => (r as { children?: unknown[] }).children?.length ?? 0));
  const colW = Math.floor(9000 / colCount); // 页宽约 9000 twips，均分
  let out = '<w:tbl><w:tblPr><w:tblStyle w:val="Table"/><w:tblW w:w="0" w:type="auto"/>';
  out += '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`).join('') + '</w:tblBorders>';
  out += '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>';
  out += `<w:tblGrid>${'<w:gridCol w:w="' + colW + '"/>'.repeat(colCount)}</w:tblGrid>`;
  rows.forEach((row, ri) => {
    out += '<w:tr>';
    (row as { children?: unknown[] }).children?.forEach((cell) => {
      const isHeader = ri === 0;
      out += '<w:tc><w:tcPr>';
      out += `<w:tcW w:w="${colW}" w:type="dxa"/>`;
      if (isHeader) out += '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>';
      out += '</w:tcPr>';
      const blocks = (cell as { children?: unknown[] }).children ?? [];
      out += blocks.length === 0 ? '<w:p/>' : blocks.map((b) => blockToXml(b as never, ctx, { style: 'Table' })).join('');
      out += '</w:tc>';
    });
    out += '</w:tr>';
  });
  return out + '</w:tbl>';
}

// 扩展名 → ContentType（[Content_Types].xml 的 Default 声明；未知扩展名回退 octet-stream）
const EXT_CONTENT_TYPE = new Map<string, string>([
  ['rels', 'application/vnd.openxmlformats-package.relationships+xml'],
  ['xml', 'application/xml'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
]);

/** [Content_Types].xml：声明全部部件类型（含实际用到的图片扩展名） */
function contentTypesXml(ctx: Ctx): string {
  const usedExt = new Set(ctx.media.map((m) => m.path.split('.').pop()!.toLowerCase()));
  const defaults = ['rels', 'xml', ...usedExt].map((ext) => {
    const ct = EXT_CONTENT_TYPE.get(ext) ?? 'application/octet-stream';
    return `<Default Extension="${ext}" ContentType="${ct}"/>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
${defaults}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;
}

function documentXml(bodyXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}">
<w:body>
${bodyXml}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body>
</w:document>`;
}

// 关系类型 → OOXML 关系 URI（document.xml.rels；未知类型回退 hyperlink）
const REL_TYPE_URI = new Map<string, string>([
  ['styles', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles'],
  ['numbering', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering'],
  ['image', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'],
]);

function documentRelsXml(ctx: Ctx): string {
  const rels = [
    { id: 'rId1', type: 'styles', target: 'styles.xml' },
    { id: 'rId2', type: 'numbering', target: 'numbering.xml' },
    ...ctx.rels,
  ];
  const items = rels.map((r) => {
    const type = REL_TYPE_URI.get(r.type) ?? 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
    const mode = r.external ? ' TargetMode="External"' : '';
    return `<Relationship Id="${r.id}" Type="${type}" Target="${esc(r.target)}"${mode}/>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${items}
</Relationships>`;
}

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

// 基础样式表（D7 最小集）：Normal / Heading 1-6 / ListParagraph / Quote / Table / CodeBlock / Hyperlink
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${NS.w}">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="4"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="5"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720" w:right="360"/><w:spacing w:before="120" w:after="120"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Table"><w:name w:val="Table"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="360"/><w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;

// 编号定义：abstractNum 0 = 项目符号（ul），abstractNum 1 = 十进制（ol），各 8 级嵌套
const NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${NS.w}">
<w:abstractNum w:abstractNumId="0">
<w:multiLevelType w:val="hybridMultilevel"/>
${[0, 1, 2, 3, 4, 5, 6, 7].map((lvl) => {
    const bullet = ['•', '◦', '▪', '•', '◦', '▪', '•', '◦'][lvl];
    const left = 720 + lvl * 720;
    return `<w:lvl w:ilvl="${lvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${bullet}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`;
  }).join('')}
</w:abstractNum>
<w:abstractNum w:abstractNumId="1">
<w:multiLevelType w:val="hybridMultilevel"/>
${[0, 1, 2, 3, 4, 5, 6, 7].map((lvl) => {
    const lvlText = Array.from({ length: lvl + 1 }, (_, i) => `%${i + 1}`).join('.') + '.';
    const left = 720 + lvl * 720;
    return `<w:lvl w:ilvl="${lvl}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="${lvlText}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`;
  }).join('')}
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

/**
 * 将 .mdpkg 包内容渲染为 .docx（OOXML 文档）字节。
 * 管线与 render.ts 一致：入口解析 → include 展开 → <<< 降级 → 哨兵保护 → 解析 → 符号转换 → 序列化。
 * 纯逻辑跨端：无 Node 专属 API，浏览器（mdpkg-web）与 CLI 共用。
 * @param files - 解包后的包内容（含 manifest.json 时做版本协商与入口解析，否则 lenient 推断）
 * @param opts - 符号开关与图片默认尺寸
 * @param onWarning - SVG 降级等提示回调（CLI 打 stderr；浏览器端可忽略）
 */
export function toDocx(files: Map<string, Uint8Array>, opts: DocxOptions = {}, onWarning?: (msg: string) => void): Uint8Array {
  // 入口解析与 render.ts 完全一致（manifest.entrypoint 优先，否则 lenient 推断）
  const manifestRaw = files.get('manifest.json');
  let manifest: { entrypoint?: string; extensions?: { include?: boolean; symbols?: 'off' | 'core' | 'extended' }; [k: string]: unknown };
  try { manifest = manifestRaw ? JSON.parse(new TextDecoder().decode(manifestRaw)) : {}; }
  catch (e) { throw new MdeError(E.E302, `manifest.json 不是合法 JSON: ${(e as Error).message}`); }
  const hasManifest = manifestRaw !== undefined;
  const entry: string = hasManifest && manifest.entrypoint ? manifest.entrypoint : inferEntrypoint(files);
  assertMarkdownEntrypoint(entry); // 非 Markdown 入口在此拒绝（E303），与 render.ts 对齐
  if (hasManifest) assertSupported(manifest as never); // 有 manifest 才做版本协商（E701/E702）

  const body = files.get(entry);
  if (!body) throw new MdeError(E.E303, `entrypoint 不存在: ${entry}`);
  // 入口文档所在目录（D7 相对引用解析基准；'' = 包根）
  const i = entry.lastIndexOf('/');
  const entryDir = i === -1 ? '' : entry.slice(0, i);

  // 管线顺序与 render.ts 一致：include 展开（解析前）→ <<< 降级 → 哨兵保护 → 解析
  const raw = new TextDecoder().decode(body);
  let expanded = manifest.extensions?.include === false ? raw : expand(files, entry).text;
  // 未被展开的指令（缩进的、或 include 关闭时）必须作为可见文本降级（与 render.ts 相同处理）
  expanded = expanded.replace(/^(\s*)<<</gm, '$1&lt;&lt;&lt;');

  const tree = unified().use(remarkParse).use(remarkGfm).parse(guardEscapes(expanded));

  const ctx: Ctx = {
    files,
    entryDir,
    symbols: opts.symbols !== false && manifest.extensions?.symbols !== 'off',
    imageWidthEmu: opts.imageWidthEmu ?? DEFAULT_IMAGE_WIDTH_EMU,
    imageHeightEmu: opts.imageHeightEmu ?? DEFAULT_IMAGE_HEIGHT_EMU,
    media: [],
    rels: [],
    warnings: [],
    nextRid: 3, // rId1=styles、rId2=numbering 已占用
    docPrId: 1,
  };
  const bodyXml = (tree as { children?: unknown[] }).children?.map((c) => blockToXml(c as never, ctx)).join('') ?? '';

  // 组装 OOXML 部件并打包（packRaw：不注入 manifest.json，docx 是标准 OOXML 容器）
  const enc = (s: string) => new TextEncoder().encode(s);
  const out = new Map<string, Uint8Array>();
  out.set('[Content_Types].xml', enc(contentTypesXml(ctx)));
  out.set('_rels/.rels', enc(ROOT_RELS_XML));
  out.set('word/document.xml', enc(documentXml(bodyXml)));
  out.set('word/_rels/document.xml.rels', enc(documentRelsXml(ctx)));
  out.set('word/styles.xml', enc(STYLES_XML));
  out.set('word/numbering.xml', enc(NUMBERING_XML));
  for (const m of ctx.media) out.set(m.path, m.data);

  const bytes = packRaw(out);
  if (onWarning) for (const w of ctx.warnings) onWarning(w);
  return bytes;
}