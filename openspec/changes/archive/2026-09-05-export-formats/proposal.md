# Proposal: 导出格式矩阵定案（md / mdpkg / html / zip）+ pdf 探讨

## Why

导出格式需要明确统一：**md / mdpkg / html / zip** 四种。现状盘点：
- **mdpkg**：已有（库 `packMdpkg`、CLI `pack`）
- **html**：CLI `render -o out.html` 已有；**库层缺 `toHtml` API**（渲染产物在 `openMdpkg().html`，无下载入口）
- **zip**：已有（库 `toZip`、CLI `export --zip`）
- **md**：**缺口**——CLI 只有 `export --raw/--expanded`（输出目录），**无单文件 .md 导出**；库层无 `toMarkdown`
- **pdf**：未实现——本提案探讨必要性并给出结论

demo（网页打开器）目前无导出 UI，需把四格式导出做成按钮。

## What Changes

- **md 导出（新能力）**：库 `toMarkdown(files, opts?): string`——导出**展开后**的入口文档 Markdown（include 已内联、相对路径已按包根重写，与 `export --expanded` 语义一致）；CLI `export --md <pkg> -o out.md`（单文件）。图片引用保留相对路径（资源不随行——单文件 md 语义；需要资源请用 zip 导出）。
- **html 导出（库补 API）**：`toHtml(files, opts?): string`——复用 `render` + `wrapDocument`（与 `openMdpkg().html` 同源），供 demo/md-bundle 下载自包含 HTML。CLI 行为不变（已有）。
- **demo 导出 UI**：打开包后显示导出栏，四按钮「导出 .md / .mdpkg / .html / .zip」，Blob 下载（文件名 = 入口 basename 替换扩展名）。
- **pdf：v1 不做导出能力**（论证见下），demo 提供「打印 / 另存为 PDF」按钮（`window.print()`，浏览器原生，零依赖）作为轻量替代。

### pdf 必要性探讨（结论：v1 不做，打印兜底）

**支持 pdf 的论据**：pdf 是最终交付形态（打印、分享、不可编辑），部分用户场景需要。

**反对论据（更强）**：
1. **零依赖约束**：浏览器端 pdf 生成需第三方库（pdfmake / jspdf 等）——违反项目「零新依赖」硬约束；CLI 端需外部工具（pandoc / weasyprint）——引入系统级依赖。
2. **自研成本**：docx 之所以自研 OOXML 写入器，是因为 OOXML 是 XML 子集、可手写；**PDF 是二进制格式，自研成本高一个量级**，且排版引擎（分页、字体嵌入、CJK）复杂度远超 docx。
3. **定位**：mdpkg 是「Markdown 增强格式」（容器/符号/include），pdf 属于渲染消费端职责；docx 已覆盖「文档交付」场景，pdf 与 docx 高度重叠。
4. **浏览器原生兜底**：`window.print()` 可将渲染后的 HTML 另存为 PDF（Chrome/Edge/Safari 均支持），零依赖覆盖「打印/存 pdf」需求。

**结论**：v1 不做 pdf 导出能力；demo 提供打印按钮兜底；pdf 导出列为未来候选（若采用可行性验证后，优先评估浏览器打印路径的完善而非引入库）。

## Capabilities

### New Capabilities
- `md-export`: Markdown 导出——将包内入口文档导出为展开后的单文件 `.md`（include 已内联、路径已重写），含库 API `toMarkdown` 与 CLI `export --md`。
- `html-export`: HTML 导出——库 API `toHtml`（自包含单文件 HTML，与 CLI `render` 同源），供浏览器端下载。

### Modified Capabilities
- `pipeline`: `命令契约` 增加 `export --md`（若 CLI 侧实现）；`render 输出形态` 不变（html 已有）。若判定需要 delta 记录，仅描述命令矩阵扩展。

## Impact

- **代码**：`packages/mdpkg/src/` 新增 `toMarkdown`（可放 render.ts 或新模块，复用 expand 语义）；`web/mdpkg-web.ts` 导出 `toMarkdown` / `toHtml`；`cli.ts` `export` 分支增加 `--md`；`demo.html` 导出栏（四按钮 + 打印按钮）；`npm run build:web` 重建。
- **API**：`mdpkg-web.toMarkdown(files, opts?)`、`mdpkg-web.toHtml(files, opts?)` 新增；CLI `export --md`。
- **依赖**：零新依赖（pdf 不做；打印用浏览器原生）。
- **测试**：`toMarkdown`（展开语义/路径重写/符号保留原文）、`toHtml`（与 openMdpkg().html 一致）、CLI `export --md`（单文件产出/互斥）、demo 导出按钮浏览器端到端。
- **文档**：`AGENTS.md` 命令表、`md-bundle-integration.md` 导出节（md/html 补全）。