## ADDED Requirements

### Requirement: docx 排版规范
docx 导出 MUST 遵循中文文档排版规范：标题层级（Heading1–6）的中文文本 MUST 使用黑体（样式表 `w:rFonts w:eastAsia="黑体"`）呈现；正文与段落文本 MUST 保持宋体（`docDefaults` 的 `eastAsia="宋体"` 不变）。独立成段的图片（该段落唯一子节点为图片，且不位于表格单元格、列表项内）MUST 居中对齐（段落 `w:jc w:val="center"`）；行内图片（段落同时含文本）与表格单元格内图片 MUST 保持默认对齐（不居中）。

#### Scenario: 标题中文黑体
- **WHEN** 源包 Markdown 含中文标题（如 `# 一级标题`）执行 `--format docx`
- **THEN** `word/styles.xml` 中 Heading1–Heading6 样式均含 `<w:rFonts w:eastAsia="黑体"/>`，中文标题以黑体呈现

#### Scenario: 正文保持宋体
- **WHEN** 导出任意含正文段落的包
- **THEN** `word/styles.xml` 的 `docDefaults` 仍为 `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/>`，正文以宋体呈现

#### Scenario: 独立图片居中
- **WHEN** 源包 Markdown 含独立成段的图片 `![图](assets/a.png)`
- **THEN** docx 中该图片所在 `<w:p>` 含 `<w:jc w:val="center"/>`

#### Scenario: 行内图片不居中
- **WHEN** 源包 Markdown 段落为「文字 ![图](assets/a.png) 文字」
- **THEN** docx 中该段落不含 `<w:jc w:val="center"/>`

#### Scenario: 表格单元格图片不居中
- **WHEN** 表格单元格内含图片
- **THEN** docx 中该单元格段落不含 `<w:jc w:val="center"/>`
