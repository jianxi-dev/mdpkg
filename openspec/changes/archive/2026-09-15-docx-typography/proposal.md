# PROPOSAL — docx-typography

## Why

GitHub issue #21 反馈 docx 导出存在两类排版缺陷：
1. **图片未居中**：独立成段图片（段落唯一子节点为图片）默认左对齐，不符合中文文档图片排版规范。
2. **标题字体未按中文规范**：Heading1–6 样式继承 docDefaults 的 `eastAsia="宋体"`，中文标题以宋体呈现；按中文文档规范，标题应使用黑体（SimHei），正文保持宋体。

## What Changes

- **样式表（styles.xml）**：Heading1–6 样式各注入 `<w:rFonts w:eastAsia="黑体"/>`（仅覆盖 eastAsia，ascii/hAnsi 保持继承 Calibri），中文标题以黑体呈现。
- **段落序列化（document.xml）**：独立成段图片（段落唯一子节点为图片，且不在表格单元格、列表项、引用块内）段落注入 `<w:jc w:val="center"/>` 居中对齐。
- **无 BREAKING**：`docDefaults` 保持 `eastAsia="宋体"` 不变；行内图片、表格单元格图片、列表项图片不居中；`toDocx` 签名、CLI 形态、`MdeError`/`onWarning` 契约均不变。

## Capabilities

### Modified Capabilities
- `docx-export`: 新增「docx 排版规范」需求（标题黑体 + 图片居中），场景覆盖：标题黑体、正文宋体、独立图片居中、行内图片不居中、表格单元格图片不居中。

## Impact

- **代码**：`packages/mdpkg/src/docx.ts`（样式表 6 处 `<w:rFonts w:eastAsia="黑体"/>` + `blockToXml` paragraph case 居中判定）、`test/docx.test.ts`（新增 5 用例）。
- **依赖**：零新增。
- **规范**：archive/sync 时以本 change 的 ADDED delta 更新 `openspec/specs/docx-export/spec.md`。
