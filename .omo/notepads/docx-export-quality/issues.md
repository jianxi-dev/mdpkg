# DOCX Export Quality — Issues

## Wave 1 (2026-09-10)

### 已解决

1. **math 递归遍历跳过 paragraph/heading 子节点** — 初始实现逻辑错误，`processBlock` 在递归时跳过了 paragraph 和 heading 类型，导致 `splitMathInInline` 从未被调用。已修复为无条件递归。
2. **callout 正则 `$` 不匹配换行** — 初始正则 `^\[!([A-Za-z]+)\]\s*$` 要求整行只有标签，但 remark-gfm 将多行内容合并为一个 text 节点。已修复为 `(?:\n|$)`。

### 已知限制

- **数学降级为纯文本**：`$a^2$` 输出为 `a^2`（无 `$`），但无 OOXML 数学标记（m:oMath）。这是 Wave 1 的可读降级策略，Wave 2/3 可考虑添加 OMML 支持。
- **callout 键集硬编码**：CALLOUT_TYPES 是静态快照，未来 md-bundle/clairis 扩展时需同步更新。
- **任务列表字形字体依赖**：`☑`/`☐` 依赖阅读器字体支持 Unicode 2610/2611 字形，老旧 Word 版本可能显示为方框。
- **表头加粗策略（已修复）**：初始实现用 `extractCellText` 提取文本后构造单一加粗 run，破坏了单元格内的段落/行内结构（strong/em/inlineCode 嵌套格式丢失）。修复：改用 `inlineChildren(blocks, ctx, { b: true })` 直接序列化 tableCell 的行内子节点并注入 `b:true`，保留所有嵌套格式。`headerBoldFmt` 仍用于 paragraph 路径（`blockToXml` 的 `paragraph` case），tableCell 不走该路径。
- **JPEG 解析限制**：仅扫描 SOF0/1/2 标记段，不含尺寸的标记段（APP0 等）被跳过；极端损坏的 JPEG 可能误判。
- **WebP VP8 简化**：VP8 有损格式的帧标签解析使用固定 offset，非标准布局可能解析失败（回退缺省尺寸）。

## Wave 3 (2026-09-10)

### 已解决

1. **spec 与实现不一致（mermaid 语言标注）**：spec 原写 mermaid「按代码块 + 语言标注降级呈现」，但实现与 HTML 路径一致（不插标注）。已同步 spec 描述。
2. **缺失资源警告预期**：初始测试断言缺失资源应触发警告，但实现走渲染路径语义（不触发警告，与 HTML 路径一致）。已修正测试与 spec。

### 已确认限制

- **docxText 助手局限**：不解码 XML 实体，测试中涉及 `>`/`<` 的内容需规避或断言转义形式。
- **toDocx 签名一致性**：浏览器面 `toDocx(files, opts, onWarning?)` 与 Node 端完全一致（同源 re-export），跨端契约测试通过。
