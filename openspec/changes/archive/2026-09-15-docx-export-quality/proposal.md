# PROPOSAL — docx-export-quality

## Why

DOCX 导出是 **mdpkg 的能力**（`mdpkg render <pkg> --format docx` CLI + 浏览器端 `toDocx` 供 md-bundle 消费，见 `docx-export` 能力域），md-bundle 仅负责引入。此前「DOCX 导出质量」误作为 md-bundle 侧计划（针对其自研 `exportDocx.ts` 的缺陷清单），按能力归属应迁至本仓库完成——本 change 即该计划的迁移落地。

mdpkg v0.2.0.0 的 docx 导出已具备基础保真（全部实现于 `packages/mdpkg/src/docx.ts`，481 行 OOXML 手写序列化，零 Node 专属 API）：标题 1–6 级样式、嵌套列表 8 级、位图（png/jpg/gif/webp）嵌入与行内图片、空文档合法输出、粗体/斜体/删除线/行内码/外链、SVG 与缺失资源 alt 占位降级。但存在明确质量缺口：**数学（`$...$`/`$$...$$`）无任何处理原样透传**、**callout 无处理**、**任务列表仅文本前缀 `[x]`/`[ ]` 无复选框呈现**、**图片固定 6"×4.5" 忽略固有宽高比（拉伸变形）**、**代码块不读 `lang` 无语言标注**、**表头行无显式加粗强调（依赖 Word 的 tblLook 自动格式）**。这些缺口直接劣化 md-bundle 消费端与最终用户拿到的 Word 文档。

## What Changes

- **解析/AST 层（docx 序列化路径）**：
  - 数学：识别行内/块级数学表达式，转为可读纯文本（去 `$` 定界符）或 OMML 数学对象（design 决策）；绝不原样残留 `$`。
  - callout：识别 GFM alert 语法（`> [!TYPE]`）→ 以带左边条/底纹 + 类型标签的块呈现，与 md-bundle 消费语义对齐（关键词集对齐既有能力约定）。
  - 任务列表：`- [ ]` / `- [x]` → 复选框字形 run（☐ / ☑），替代纯文本前缀；列表嵌套/编号行为不变。
  - 代码块：读取代码块 `lang` → 输出语言标注，保留 Consolas + 底纹；mermaid 代码块标注明示（不渲染图）。
- **图片层**：从包内资源字节读取固有尺寸（PNG IHDR / JPEG SOF / GIF 头 / WebP VP8X，纯字节解析、跨端约束同 zip-core）→ 换算 EMU 按最大导出宽等比缩放（对齐 `imageWidthEmu`/`imageHeightEmu` 可配置语义）；SVG 与缺失资源保持 alt 占位 + stderr 警告（现行为不变）。
- **表格层**：表头行单元格显式加粗（`<w:b/>`），灰底保留；列宽按内容宽度启发式（在既有均分基础上改进，design 细化）。
- **跨端错误契约**：mdpkg 侧保持 `MdeError` 抛出模型（跨端一致，CLI 已兜底），docx-export 能力域明确 md-bundle 浏览器消费侧的 {error} 包装约定（消费侧落地，属 md-bundle 引入工作）。
- **无 BREAKING**：`mdpkg render --format docx` 形态、默认输出名、`--format` 缺省 html、`toDocx(files, opts, onWarning)` 签名均不变；SVG/缺失资源降级行为不变。

## Capabilities

### New Capabilities
<!-- 不引入新能力域：全部变更归属既有 docx-export 能力域。 -->

### Modified Capabilities
- `docx-export`: 「docx 内容保真」扩展（数学降级/呈现、callout 块、任务复选框、代码块语言标注、表头显式加粗）+「docx 资源嵌入」修订（固有尺寸等比缩放，替代固定 6"×4.5"）+「docx 跨端可用」修订（错误契约与 md-bundle 消费约定）。场景补充：数学、callout、任务复选框、宽高比、语言标注、表头加粗。

## Impact

- **代码**：`packages/mdpkg/src/docx.ts`（AST 变换 + OOXML 序列化扩展）、新增图片头解析工具（纯字节、可单测）、`test/docx.test.ts` 与 `test/web-export.test.ts` 扩展；`render.ts`（HTML 路径）不是目标，行为不变；`cli.ts` 无改动。
- **依赖**：优先零新增依赖（docx 序列化面已手写）；数学/callout 若走 remark 插件生态则需显式评估（design 决策），astro 语法兼容以现有 unified 链为准。
- **规范**：archive/sync 时更新 `openspec/specs/docx-export/spec.md`。
- **md-bundle 引入（后续独立 change）**：vendor mdpkg-web 升级以暴露 `toDocx`、本地自研 `exportDocx.ts` 下线、{error} 包装与菜单接线——不属本变更范围，但本变更的 API 契约（签名/错误模型/警告回调）为消费侧前置条件。