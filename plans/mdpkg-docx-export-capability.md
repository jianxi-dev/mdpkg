# mdpkg docx 导出能力说明（对接 md-bundle 网页端）

> 面向 md-bundle（`/Users/mason/ToHighs/md-bundle`）网页端 docx 导出优化对接的能力说明。
> 来源：`jianxi-dev/mdpkg` `packages/mdpkg/src/docx.ts` + 未合并 PR #6（v0.3.0.0 wave 2/3）。
> 本文档描述**目标能力形态**（wave 1 + wave 2/3），并明确标注哪些已合并、哪些待合并。

## Context

| 侧 | 现状 | 备注 |
|---|---|---|
| mdpkg `toDocx`（wave 1 基线） | 已合并（`59e15c8`，含 4.1–4.5 测试） | OOXML 最小写入器，481 行，浏览器/Node 通用 |
| mdpkg PR #6 wave 2/3 | **已合并（2026-09-12，v0.3.0.0）** | 表格样式 / 图片固有尺寸 / 代码语言 / GFM alert / 数学降级 / 任务列表复选框修复；测试 225 → 281 |
| md-bundle `exportDocx.ts` | **已替换为上游 `toDocx` 薄封装（86 行）** | 自研 592 行已删除；保留 YAML frontmatter 剥离补上游缺项 |
| md-bundle vendor `mdpkg-web.js` | **已更新**（d.ts 含 `toDocx`/`toZip` 声明） | 遵循 AGENTS.md：never edit vendor，仅替换 + 补类型 |

**对接状态：已完成（2026-09-13）**。md-bundle 网页端 docx 导出 = vendored `toDocx`（wave 1 + wave 2/3 完整能力），调用点外包 `{ ok } | { ok, error }` 确定性结果契约、`onWarning` 透传降级提示。详情见 §五。

---

## 一、API 与跨端约束

```ts
// packages/mdpkg/src/docx.ts（浏览器与 Node 共用同一函数）
export function toDocx(
  files: Map<string, Uint8Array>,   // 包内容（含 manifest.json 时做版本协商 + 入口解析；否则 lenient 推断）
  opts?: DocxOptions,
  onWarning?: (msg: string) => void // 非致命降级回调（SVG、头解析失败等；浏览器端可忽略或上屏）
): Uint8Array                       // 标准 OOXML docx 字节（PK\x03\x04 开头）

interface DocxOptions {
  symbols?: boolean;          // 符号扩展（默认 true，跟随 manifest.extensions.symbols，与 HTML 路径一致）
  imageWidthEmu?: number;     // 图片最大宽度（默认 6 英寸 = 5486400 EMU）
  imageHeightEmu?: number;    // 显式高度（wave 2/3：提供则按显式值；缺省按固有宽高比换算）
}
```

- **零 Node 专属 API**：仅 `TextEncoder/TextDecoder` + fflate（经 `zip-core` 的 `packRaw`）；`mdpkg-web.ts` 已 re-export `toDocx`（`export { ..., toDocx, ... }`）。
- **错误模型**：结构/清单错误抛 `MdeError`（跨端一致）；非致命问题（SVG 降级、图片头解析失败、未知节点）走 `onWarning`，不阻断导出；**缺失资源走 alt 占位、不触发警告**（渲染路径语义，与 HTML 路径一致，完整性由 `validate` 负责）。
- **管线与 `render.ts` 完全一致**（规范 §8.1）：入口解析 → include 展开 → `<<<` 未展开降级 → 哨兵保护 → remark 解析（GFM）→ 符号转换 → 序列化。符号与 include 复用 `symbols.ts` / `include.ts` 同一函数——**HTML 与 docx 双路径语义天然一致**。

---

## 二、能力矩阵（Markdown 语法 → OOXML，wave 1 + wave 2/3）

| Markdown 语法 | OOXML 输出 | 说明 |
|---|---|---|
| 标题 1–6 | `Heading1–6` 段落样式 | 样式表内置（keepNext + 递减字号） |
| 段落 | `w:p` | 行内格式逐层叠加（嵌套 strong/em/link） |
| **粗体 / *斜体* / ~~删除~~** | run 属性 `w:b` / `w:i` / `w:strike` | 嵌套累积 |
| 行内代码 | Consolas 等宽 + 浅灰底纹 `w:shd F2F2F2` | — |
| 外链 `[x](https://…)` | `w:hyperlink` + rels `TargetMode="External"` | 内部锚点/相对链接按普通文本输出 |
| 图片（png/jpg/jpeg/gif/webp） | `w:drawing` + `word/media/img-N.ext` | wave 2/3：`image-size.ts` 读字节头（PNG IHDR / JPEG SOF / GIF 头 / WebP 头）取**固有宽高**，EMU 等比保留宽高比；头解析失败回退 6"×4.5" + 警告 |
| 图片（SVG / 其它 / 缺失 / 外链） | **alt 文本占位** | SVG/非位图/外链 → 警告；缺失 → 不警告（渲染路径语义）；绝不阻断导出 |
| 代码块 | `CodeBlock` 样式，逐行成段（保留空白） | wave 2/3：fenced **language 写入 OOXML**（代码语言标注）；20 号字 + F6F8FA 底纹 |
| 无序/有序列表 | 真实 `numbering.xml`（numId 1 项目符号 / 2 十进制），`ilvl` 0–7 级嵌套 | 有序自定义起始号 `w:startOverride`；8 级 bullet 轮换 `•◦▪` |
| 任务列表 `- [x]` | 前缀 `[x]` / `[ ]` | wave 2/3：**改 Wingdings 字符复选框**（替换文本前缀，正式勾选框） |
| 引用块 | `Quote` 样式（左缩进 + 斜体 + 灰字） | — |
| 表格（GFM） | `w:tbl` + `tblBorders`（BFBFBF）+ **表头底纹 F2F2F2** | wave 2/3：表头加粗强调 + 内容自适应列宽（9000 twips 均分/自适应）；表头不破坏单元格结构 |
| 水平线 `---` | 段落底部边框 `pBdr` | — |
| raw HTML | **降级为字面量文本**；`script/style` 整体丢弃 | 与 rehype-sanitize 删除语义对齐（design D4），零执行面 |
| 数学 `$...$` / `$$...$$` | wave 2/3 新增：**提取为可读纯文本替代** | 自写轻量正则遍历 AST（零新增依赖，不用 remark-math）；块级 math 拆分为独立段落 |
| GFM alert `> [!NOTE]` 等 | wave 2/3 新增：**样式化文本框** | CALLOUT_TYPES 对齐 GitHub GFM（NOTE/TIP/INFO/WARNING/CAUTION）+ md-bundle/clairis 扩展（IMPORTANT/DANGER/SUCCESS/…/TODO/QUOTE/…）；未知键降级普通 blockquote |
| 脚注 | 引用降级为 `[^label]` 文本，定义不输出 | 与 HTML 路径一致 |
| 未知节点 | 尽力输出文本内容，不丢内容 | 行内/块级均有兜底 |
| 符号扩展 `(tm)` → ™ | 同 HTML 路径转换（`replaceSymbols` + 哨兵） | 来源文本永不被修改 |

**输出部件**：`[Content_Types].xml` / `_rels/.rels` / `word/document.xml` / `word/_rels/document.xml.rels` / `word/styles.xml` / `word/numbering.xml` / `word/media/*`（位图）。`packRaw` 打包 = 标准 OOXML 容器，**不注入 manifest.json**（非 mdpkg 容器）。

**样式表**：docDefaults 用 Calibri + eastAsia 宋体、1.15 倍行距（line 360 auto）；内置 Normal / Heading1–6 / ListParagraph / Quote / Table / CodeBlock / Hyperlink 最小集。

---

## 三、测试与互操作证据

- `test/docx.test.ts`（wave 1，34 个测试）+ PR #6 新增（281 全量，含 `image-size.test.ts`、spec-scenario parity、**跨端契约测试：浏览器 toDocx ↔ CLI render**）。
- 覆盖：单元序列化断言（4.1）/ fixtures 往返（4.2：符号、include 嵌套、多级 include、`sec-html-injection`）/ HTML↔docx 文本一致性（4.3）/ 互操作（4.4：`unzip -l` 列条目、soffice/textutil 可打开且文本非空）/ CLI 负例（4.5：`--inline`/`--dir` 互斥、非法格式、SVG 警告不失败、缺省 `-o` 按包名换 `.docx`）。
- 浏览器 `mdpkg-web` 的 `toDocx` 与 CLI 同一函数——**无需重写即可跨端**。

---

## 四、md-bundle 现有实现差异对比（优化对接的起点）

md-bundle `apps/web/src/lib/exportDocx.ts`（基于 `docx` 库 ^9.7.1 + 手写简易解析器）vs 上游 `toDocx`（**注：该对比为对接前基线，自研实现已被薄封装替换，保留作为差距依据**）：

| 维度 | md-bundle 自研 | mdpkg `toDocx` | 差距判定 |
|---|---|---|---|
| 解析器 | 手写正则行解析，不追求 CommonMark 兼容 | remark-parse + remark-gfm（完整 mdast） | 自研有解析偏差面（复杂嵌套回退纯文本） |
| 删除线 / 任务列表 | ✗ 缺失 | ✓（strike / checkbox） | 需补 |
| 嵌套列表 | ✗ 仅 level 0 | ✓ ilvl 0–7 | 需补 |
| 行内图片 | ✗ 段落中直接跳过 | ✓ 嵌入 drawing | 需补 |
| 图片尺寸 | 固定 400×300 拉伸（无固有宽高比） | wave 2/3 读固有尺寸等比 | 需补 |
| SVG | 错误地把 svg dataUrl 当 png 发 | alt 占位 + 警告（明确语义） | 需修（自研是 bug） |
| 表格 | 内容宽度估算列宽（中文字符×2），表头标题 3 | 表头底纹 + 加粗 + 自适应 | 接近，语义略异 |
| 代码块 language | 解析了但 `language` 字段未用 | wave 2/3 写入 OOXML | 需补 |
| 符号扩展 / include | ✗ 无 | ✓ 与 HTML 路径同一函数 | 需补（网页端打开 `.mdpkg` 时才有 include 意义） |
| 数学 / GFM alert | ✗ 无 | wave 2/3 有（降级/样式化） | 需补 |
| YAML frontmatter | ✓ 剥离（`---` 块） | ✗ 无（remark 会渲染成 `<hr>` + 正文） | **mdpkg 反而缺**（backport 规划 A1 已列） |
| 依赖 | `docx` 库（重，Packer.toBlob） | 零依赖 + `packRaw` | bundle 体积与可控性 toDocx 占优 |
| 错误模型 | `throw`（调用方捕获） | MdeError 抛结构错 + onWarning 非致命 | toDocx 更细 |
| 测试 | `exportDocx.test.ts`（单测） | 4.1–4.5 + 互操作 + 跨端契约 | toDocx 更全 |

---

## 五、网页端对接建议

### 前置（阻塞项）——✅ 已完成

1. ~~合并 PR #6~~ → **已合并**（2026-09-12，v0.3.0.0，281 测试）。
2. ~~md-bundle 更新 vendor~~ → **已完成**（`mdpkg-web.js`/`mdpkg-web.iife.js` 替换 + `mdpkg-web.d.ts` 补 `toDocx`/`toZip` 声明；bundle 未手改，遵循 never-edit 约定）。
3. 版本配套：`lib/mdpkg.ts` 的 `Manifest` 类型与上游无破坏性变更，已随 vendor 更新同步。

### 实际落地形态（md-bundle 侧，2026-09-13）

`apps/web/src/lib/exportDocx.ts`（86 行薄封装，`exportDocx(opts) → Promise<ExportDocxResult>`）：

```
剥离 YAML frontmatter（保留自研行为，补上游缺项）
→ 组装 files Map（ENTRY_FILENAME=document.md + dataUrlToBytes(asset.dataUrl)）
→ toDocx(files, { symbols: true }, onWarning)   // symbols 与 HTML 路径一致
→ Uint8Array → Blob（OOXML MIME）→ downloadBlob
→ 异常收敛为 { ok: false, error }（绝不 throw，符合 md-bundle 导出契约）
```

### 路线 A：换用 vendored `toDocx`（推荐）

- md-bundle 已有资产转换层可复用：`lib/exportMdpkg.ts` 的「Asset[] → files Map（`dataUrlToBytes`）」模式——docx 导出同样组 `document.md` + 资产字节 Map，调 `toDocx(files, opts, onWarning)` 得字节 → Blob 下载。
- 消费侧包装（spec 明确）：调用点捕获 `MdeError` 转确定性 `{ error }` 结果对象（符合 md-bundle「NEVER throw across open/save/export wrappers」契约）；`onWarning` 收集为非致命提示（可并入导出成功后的提示条）。
- **图片尺寸决策点**：上游默认最大宽 6 英寸（约 15.2cm，偏大），网页端导出建议显式传 `imageWidthEmu`（如 4 英寸 ≈ 3657600 EMU）或接受缺省后验收排版。
- **SVG 机会**：md-bundle 已有 `lib/exportPng.ts` 栅格化管线（svgFromHtml/svgToPngBlob）——可将 SVG **预栅格化为 PNG** 再进 files Map，消除上游「SVG 不嵌入」降级。栅格化质量与体积需单独验收（SVG 文本渲染一致性）。
- 删除自研 `exportDocx.ts`（或保留 `ExportDocxOptions` 外壳做包装层，内部委托 `toDocx`，最小化 UI 调用点改动）。

### 路线 B：保留自研、对齐补齐（不推荐，理由见差异矩阵）

- 需补：删除线 / 任务列表 / 嵌套列表 / 行内图片 / 固有尺寸 / 代码语言 / 符号扩展 / 数学 / alert，且手写解析器与 @md-bundle/renderer 的 marked 语义仍有偏差风险；固定 400×300 与 SVG 误发 png 两个 bug 需先修。
- 仅当「DOCX 导出不能引入 fflate 打包的字节流依赖 / vendor 更新受限」时才考虑。

### 验收建议

- 对齐 mdpkg 的 fixture 用例：符号、include 嵌套、表格、任务列表、多级列表、SVG 降级提示、图片固有尺寸（非 4:3 资源不拉伸）。
- Playwright e2e：下载 `document.docx` → 前端解 ZIP 读 `document.xml` 断言（md-bundle 已有 `makeZip.ts` 测试基建可复用）。
- 与钉钉/WPS 兼容性实测（国内主要消费端：Word 之外的真实打开器）。

---

## 六、已知缺口 / 风险

| 项 | 状态 | 说明 |
|---|---|---|
| PR #6 合并 | 阻塞中 | OPEN + MERGEABLE，需先落地（含 281 测试目标） |
| 数学提取 | 降级实现 | 纯文本替代（可读），非 OOXML OMML 公式对象；学术排版需求 ≠ docx 目标 |
| GFM alert | 样式化文本框 | 与 md-bundle reader 的 callout 视觉可能有差，需对齐验收 |
| frontmatter | mdpkg 缺失 | backport 规划（`plans/mdpkg-backport-md-bundle-html.md` A1）已列，合并后 docx 路径自动受益 |
| Word 专有特性 | 范围外 | 页眉页脚/目录/TOC 域/分节符等不在能力矩阵，需求出现再评估 |
| 大数据量 | 无专门优化 | 与 HTML 路径同管线（include 展开、符号转换），无流式处理 |

## 参考

- 实现：`packages/mdpkg/src/docx.ts`（wave 1）/ PR #6（wave 2/3，含 `src/image-size.ts`）
- 测试：`packages/mdpkg/test/docx.test.ts`、PR #6 `image-size.test.ts` + 跨端契约测试
- 浏览器 re-export：`packages/mdpkg/web/mdpkg-web.ts`（`toDocx`）
- 规范：`spec/mdpkg-format-spec.md`（§8.1 渲染管线；PR #6 同步更新 spec + fixtures）
- md-bundle 现状：`apps/web/src/lib/exportDocx.ts`、`lib/exportMdpkg.ts`、`lib/dataUrl.ts`、`vendor/mdpkg-web.d.ts`