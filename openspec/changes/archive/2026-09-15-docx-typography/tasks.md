# TASKS — docx-typography

- [x] 1.1 `docx.ts` 排版实现：Heading1–6 注入 `w:rFonts w:eastAsia="黑体"`；独立成段图片段落注入 `w:jc w:val="center"`（行内/单元格/列表项排除）。QA: `test/docx.test.ts` 新增 5 用例 + 既有 318 全绿。Commit: `fix(docx): center standalone images + 黑体 headings`
- [x] 1.2 门禁与产物：`npm test` 全绿、`npm run build:web` 重建 bundle、`openspec validate --strict` 通过。QA: 三条命令输出。
