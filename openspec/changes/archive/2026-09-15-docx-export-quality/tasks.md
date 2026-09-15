# TASKS — docx-export-quality

## 1. Wave 1 — AST/解析层（docx 序列化路径前置 pass）

- [x] 1.1 数学 AST 前处理 pass：remark 解析后按 `$$...$$` / `$...$` 切分文本节点为 `math` 节点（代码块与表格内容不提取；`\$` 转义与未闭合 `$` 按纯文本原样保留，不吞文本）。QA: `packages/mdpkg/test/docx.test.ts` 新增单测（行内/块级/相邻文本/表格代码块内不提取/未闭合不崩溃）。Commit: `feat(docx): math extraction pass (readable plain-text degradation)`
- [x] 1.2 callout 识别：`blockquote` 首行 `^\[!([A-Za-z]+)\]` → callout 节点（标签归一化大写，键集快照对齐 md-bundle/clairis `calloutTypeMap` 并在注释注明来源）；未知键 → blockquote 原样降级。QA: 已知键/未知键/无首行标签三用例。Commit: `feat(docx): GFM alert callout recognition (key snapshot aligned)`
- [x] 1.3 任务复选框：序列化层读 `listItem.checked` → 首 run 插 ☐(U+2610)/☑(U+2611) 字形 run，删除文本前缀逻辑（docx.ts:225-226 一带）。QA: 勾选/未勾选/常规列表项（无 checked 字段不插）三用例。Commit: `fix(docx): task-list checkbox glyphs (replace text prefix)`

## 2. Wave 2 — 序列化层（docx.ts + 新工具）

- [x] 2.1 代码块语言标注：读 `node.lang` → 代码块首行 run 前插 `[lang] ` 灰字标注 run（9pt，非 monospace）；无 lang 或 `mermaid` 不插（mermaid 保持代码块降级，与 HTML 路径一致）。QA: 有 lang/无 lang/mermaid 三用例 + 等宽底纹保留断言。Commit: `feat(docx): code block language annotation`
- [x] 2.2 新建 `packages/mdpkg/src/image-size.ts`：纯字节头解析（PNG IHDR@16 / JPEG SOF0-2 标记段扫描 / GIF 逻辑屏幕描述符 / WebP VP8X·VP8L·VP8），返回 `{width,height}|null`（Uint8Array 视图，零 Node 专属 API）；`docx.ts` 嵌入换算：`w=min(imageWidthEmu, px*9525)`、`h=w*ih/iw`、显式 `imageHeightEmu` 覆盖、`null` → 缺省 6"×4.5" + `ctx.warnings` 新警告。QA: image-size 独立单测（真实头样本 ×4 + 截断/空字节 → null）+ docx 宽高比用例。Commit: `feat(docx): intrinsic image sizing (image-size.ts, aspect-preserving EMU)`
- [x] 2.3 表头显式加粗 + 列宽内容启发式：`tableToXml` `ri===0` 单元格 run 整体加粗（灰底 F2F2F2 保留）；列宽由 `9000/colCount` 均分改为内容宽度启发式（CJK 计 2 / ASCII 计 1，实测换算系数，min 800 DXA，总宽超 9000 等比压缩，全空列等分兜底）。QA: 表头 bold run 断言 + 窄/宽列分布用例 + 空行兜底。Commit: `feat(docx): table header bold emphasis + content-based column widths`

## 3. Wave 3 — 契约、测试与门禁

- [x] 3.1 跨端错误契约核验：`MdeError` 抛出模型与 `onWarning` 通道双面行为不变（结构错误 throw、非致命走回调）；`web/mdpkg-web.ts` 的 `toDocx` 导出面无改动，消费侧包装约定在 spec「docx 跨端可用」落文。QA: `web-export.test.ts` 新增冒烟（正常导出 + 非致命警告不抛异常）。Commit: `test(docx): cross-end contract smoke (web surface)`
- [x] 3.2 测试对齐 spec 场景：`test/docx.test.ts` 逐条覆盖新增/修订场景（数学无 `$` 残留、callout 标签块、☑/☐ 字形、固有比例 EMU、头解析失败回退警告、语言标注、表头加粗、空文档回归、SVG/缺失资源回归）。QA: `npm test`（packages/mdpkg，node --test）全绿且既有用例零回归。Commit: `test(docx): spec-scenario parity suite`
- [x] 3.3 门禁与规范收尾：`bash scripts/verify.sh` 全绿（含 tsc --noEmit + 全量测试）；`npm run build:web` 通过；`openspec validate --changes docx-export-quality` 通过；archive/sync 更新 `openspec/specs/docx-export/spec.md`（内容保真/资源嵌入/跨端可用三需求 + 场景）。QA: 三条命令全绿、零新增依赖（package.json diff 为空）。Commit: `docs(spec): sync docx-export quality requirements`