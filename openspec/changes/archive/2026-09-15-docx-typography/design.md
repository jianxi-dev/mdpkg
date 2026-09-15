# DESIGN — docx-typography

## Context

- issue #21 反馈：docx 导出图片左对齐 + 标题宋体不符合中文排版规范。
- 现状实现 `packages/mdpkg/src/docx.ts`（1053 行）——OOXML 手写序列化，零 Node 专属 API。
- 样式表位于 `STYLES_XML` 常量（docx.ts:920-938），Heading1–6 当前 `<w:rPr>` 仅含 `<w:b/>` + `<w:sz>`，中文字体继承 docDefaults 的 `eastAsia="宋体"`。
- 图片序列化在 `blockToXml` paragraph case（docx.ts:599-614）：当前无居中逻辑。
- 约束：零新增依赖；跨端（Node CLI + 浏览器）不得引入 Node 专属 API；erasable TypeScript。

## Goals / Non-Goals

**Goals:**
- Heading1–6 中文以黑体呈现（样式表注入 `w:eastAsia="黑体"`）。
- 独立成段图片居中对齐（段落 `w:jc w:val="center"`）。
- 行内图片、表格单元格图片、列表项图片保持默认对齐（不居中）。
- 正文保持宋体（docDefaults 不变）。

**Non-Goals:**
- 不改变 ascii/hAnsi 字体（保持 Calibri）。
- 不改变表格单元格内图片对齐方式。
- 不引入新的 CLI 参数或 API 形态。

## Decisions

### D1 黑体仅作用于 Heading1–6 覆盖 eastAsia
在 STYLES_XML 的 Heading1–6 样式 `<w:rPr>` 中插入 `<w:rFonts w:eastAsia="黑体"/>`（放在 `<w:b/>` 之前）。仅覆盖 eastAsia 属性，不碰 ascii/hAnsi（保持继承 Calibri）。docDefaults 不动（`eastAsia="宋体"` 保持）。
- 备选（否决）：在 docDefaults 层加黑体再在 Normal 覆盖宋体 —— 破坏继承链，影响所有非标题段落。

### D2 居中判定条件与排除面
在 `blockToXml` paragraph case 中，当以下条件全部满足时注入 `<w:jc w:val="center"/>`：
1. `extra?.style` 为空（排除 `style: 'Table'` 表格单元格、`style: 'Quote'` 引用块）。
2. `extra?.numPr` 为空（排除列表项）。
3. 段落子节点长度为 1 且唯一子节点 `type === 'image'`（排除行内图片）。
- 备选（否决）：在 image 节点层加居中 —— image 是行内节点，居中必须作用在段落层，不能在 run/drawing 层实现。

## Risks / Trade-offs

- [黑体字体在部分阅读器缺失时的回退] → 若系统无黑体，Word/LibreOffice 会回退到默认中文字体（通常是宋体或微软雅黑），不会崩文档。
- [居中判定对自定义样式段落的影响] → 仅当 `extra.style` 为空时触发，自定义样式（Table/Quote）不受影响。

## Migration Plan

- 纯加性演进：`docx.ts` 样式表 + 序列化逻辑扩展 + 测试；无数据迁移、无 CLI/API 变化。
- archive/sync 时以本 change 的 ADDED delta 更新 `openspec/specs/docx-export/spec.md`。
