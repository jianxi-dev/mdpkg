# DOCX Export Quality — Learnings

## Wave 1 (2026-09-10)

### 数学 AST 前处理 pass

- **递归遍历的陷阱**：初始实现中 `processBlock` 在递归子节点时跳过了 `paragraph` 和 `heading` 类型（`c.type !== 'paragraph' && c.type !== 'heading'`），导致根节点的直接段落子节点永远不会进入 `splitMathInInline`。修复：移除跳过条件，让所有子节点都递归进入 `processBlock`，在函数内部判断是否调用 `splitMathInInline`。
- **正则设计**：`/\$\$([\s\S]+?)\$\$|\$([^\s$][^$]*?)\$/g` 中 `$$...$$` 优先匹配（正则交替顺序），`[^\s$]` 防止 `$ 空格` 误匹配，`[^$]*?` 非贪婪防止跨 `$` 对误匹配。
- **块级 math 段落拆分**：`$$...$$` 在 mdast 中作为 paragraph 的子节点存在，但 OOXML 中段落不能嵌套段落。解决方案：在 `blockToXml` 的 `paragraph` case 中检测块级 math 节点，调用 `splitParagraphAtBlockMath` 将段落拆分为多个独立段落。
- **guardEscapes 不干扰**：`guardEscapes` 只处理 CORE 符号表中的 `\(tm)` 等，不影响 `$`，所以 `\$` 转义无需额外处理（`$` 本身不在 CORE 表中）。

### Callout 识别

- **remark-gfm 不解析 alert 为特殊节点**：GFM alert `> [!TYPE]` 被 remark-gfm 解析为普通 blockquote，首行文本为 `[!TYPE]\n后续内容`。需要自写正则 `^\[!([A-Za-z]+)\]\s*(?:\n|$)` 匹配首行。
- **正则必须允许换行**：初始实现用 `^\[!([A-Za-z]+)\]\s*$` 要求整行只有标签，但实际文本是 `[!TIP]\n提示内容`，`$` 不匹配换行后的位置。修复：用 `(?:\n|$)` 替代 `$`。
- **键集快照**：CALLOUT_TYPES 对齐 GitHub GFM 标准（NOTE/TIP/INFO/WARNING/CAUTION）+ md-bundle/clairis 扩展（IMPORTANT/DANGER/SUCCESS/HELP/FAQ/ABSTRACT/SUMMARY/TLDR/TODO/QUOTE/CITATION/EXAMPLE）。未知键降级为普通 blockquote。

### 任务列表复选框

- **最小改动**：将 `[x] ` / `[ ] ` 文本前缀替换为 `☑ ` / `☐ `（Unicode U+2611/U+2610），一行改动。
- **已有测试需同步更新**：原 4.1 列表测试断言 `[x]` / `[ ]` 前缀文本，需改为断言 `☑` / `☐` 字形。

### 通用

- **零新增依赖约束**：数学提取未引入 remark-math，自写轻量正则遍历。
- **erasable TypeScript**：全部使用 type 别名（`interface` 改为 `type` 或内联），无 enum/namespace/构造函数参数属性。

## Wave 2 (2026-09-10)

### 代码块语言标注

- **mermaid 排除**：` ```mermaid ` 不插语言标注，保持代码块降级（与 HTML 路径一致，mermaid 在 HTML 中也是代码块）。
- **标注 run 样式**：灰色（808080）9pt（sz=18）非等宽（Calibri），插在代码内容 run 之前，保持代码行 Consolas + F6F8FA 底纹不变。
- **F6F8FA 在 styles.xml**：CodeBlock 样式的底纹定义在 styles.xml 而非 document.xml，测试需解包读 styles.xml。

### 固有图片尺寸

- **EMU 换算**：1px = 9525 EMU（96dpi），默认宽 6 英寸 = 5486400 EMU。
- **宽高比保持**：`w = min(pxW * 9525, imageWidthEmu)`，`h = w * ih/iw`；显式 `imageHeightEmu` 仍覆盖。
- **JPEG 边界条件**：`while (offset + 9 <= data.length)` 用 `<=` 而非 `<`，否则最小 SOF 头（11 字节）无法进入循环。
- **PNG 头布局**：宽度 @ offset 16，高度 @ offset 20（8 字节签名 + 4 长度 + 4 "IHDR" + 4W + 4H）。
- **WebP VP8X**：宽高值 = 存储值 + 1（24 位小端），VP8/VP8L 各有不同的位打包布局。
- **回退警告**：无法读取固有尺寸时回退 6"×4.5"（5486400 × 4114800 EMU）并推入 `ctx.warnings`。

### 表头加粗 + 内容宽度列

- **tableCell 内容结构**：remark-gfm 的 tableCell 子节点是 text 节点直接（非 paragraph），`blockToXml` 的 `default` case 忽略 `extra`，所以 `headerBold` 不能通过 `blockToXml` 传播到单元格 run。
- **解决方案**：在 `tableToXml` 层面直接提取单元格文本，构造 `<w:r><w:rPr><w:b/></w:rPr><w:t>...</w:t></w:r>` 加粗 run。
- **内容宽度启发式**：CJK 计 2 / ASCII 计 1，×120 DXA，min 800，总宽超 9000 等比压缩，全空列等分兜底。
- **computeTableColumnWidths 参数类型**：`rows` 是 `tableRow[]`（有 `children` 属性），不是二维数组，需通过 `row.children[ci]` 访问单元格。

## Wave 3 (2026-09-10)

### 跨端契约测试

- **toDocx 非致命问题走 onWarning**：SVG 降级、头解析失败均通过 `onWarning` 回调上报且不抛异常；缺失资源走 alt 占位不触发警告（渲染路径语义，与 HTML 路径一致）。
- **最小合法 PNG 构造**：8 字节签名 + IHDR  chunk（长度 13 + 宽高各 4 字节 + 5 字节头参数 + 4 字节 CRC），宽高 @ offset 16/20。截断 PNG（仅 8 字节签名）会触发固有尺寸回退警告。
- **docxText 不解码 XML 实体**：`docxText` 助手只拼接 `<w:t>` 内容不解码 `&gt;`/`&lt;`；涉及 `>`/`<` 的断言（如 mermaid `A --> B`、raw HTML `<em>`）需用未包含这些字符的内容或断言 XML 转义形式。

### spec 同步

- **mermaid 描述修正**：spec 原写「按代码块 + 语言标注降级呈现」与实现不符；实现与 HTML 路径一致（mermaid 不插语言标注）。已修正 spec 为「按普通代码块降级呈现（不插语言标注）」。
- **缺失资源不警告**：spec 补充说明「渲染路径不执行完整校验，不触发警告」，与 `render.ts` 的 `if (!data) return` 语义对齐。
- **新增场景**：空文档回归、mermaid 降级、缺失资源静默降级、表格表头加粗 + 列宽启发式、callout 视觉细节（左边框 + 底纹）。
