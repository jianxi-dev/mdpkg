## MODIFIED Requirements

### Requirement: docx 内容保真
docx 文档文本 MUST 与源包内容一致：include 已展开（`<<<` 指令不残留）、符号已转换（`--symbols` 语义与 HTML 路径一致）、相对路径文本不被改写、代码块等 Markdown 结构以 OOXML 对应语义呈现。原始 HTML 注入 MUST NOT 生效（无执行面、无格式化效果）。呈现策略与 HTML 路径有意不同（design D4）：`<script>` / `<style>` 内容体不呈现，其余 raw HTML 节点以字面文本呈现（XML 转义），而非与 HTML 路径相同的整块丢弃。数学表达式（行内 `$...$` 与块级 `$$...$$`）MUST 以可读形式呈现（去定界符纯文本），不得在输出中残留原始 `$` 定界符；代码块与表格内的 `$` 保持原样。GFM alert 语法（`> [!TYPE]`）MUST 以带类型标签与视觉区分的独立块呈现；未知类型键降级为普通引用块。任务列表项（`- [ ]` / `- [x]`）MUST 以复选框字形（☐ / ☑）呈现，不得输出为文字 `[ ]` / `[x]` 前缀。代码块 MUST 携带语言标注（`[lang]` 灰色 run，9pt）；mermaid 代码块不渲染图，按普通代码块降级呈现（不插语言标注，与 HTML 路径一致）。表格表头行单元格 MUST 显式加粗（含灰底 F2F2F2），不依赖 Word 自动格式；列宽按内容宽度启发式分配（CJK 计 2 / ASCII 计 1，min 800 DXA，全空列等分兜底）。

#### Scenario: include 已展开
- **WHEN** 源包含多级 `<<<` include 的包执行 `--format docx`
- **THEN** docx 中为展开后内容，不包含 `<<<` 指令文本

#### Scenario: 符号已转换
- **WHEN** 源包含 core 符号集文本（如 `->`）执行 `--format docx`
- **THEN** docx 中显示转换后的符号（`→`），与 HTML 渲染结果一致

#### Scenario: 原始 HTML 不生效
- **WHEN** 源包 Markdown 含 `<script>` 或内嵌样式 HTML
- **THEN** docx 中 script/style 内容体不呈现，其余 raw HTML 节点以字面量文本呈现（XML 转义，无执行面）

#### Scenario: 数学不残留定界符
- **WHEN** 源包 Markdown 含 `$a^2 + b^2$` 与块级 `$$...$$` 数学
- **THEN** docx 中以可读纯文本呈现（`a^2 + b^2`），不包含原始 `$` 字符；代码块与表格内的 `$` 保持原样

#### Scenario: callout 呈现独立块
- **WHEN** 源包 Markdown 含 `> [!TIP]` 及其内容
- **THEN** docx 中该内容以带类型标签（TIP）的独立块呈现（左边框 + 底纹），与普通引用块视觉可区分

#### Scenario: 未知 callout 键降级
- **WHEN** 源包 Markdown 含未知类型的 `> [!FOO]`
- **THEN** docx 中该内容按普通引用块呈现，不报错不阻断导出

#### Scenario: 任务列表复选框
- **WHEN** 源包 Markdown 含 `- [x] 已完成` 与 `- [ ] 未完成`
- **THEN** docx 中以 ☑ 与 ☐ 字形呈现，无文字 `[x]` / `[ ]` 前缀

#### Scenario: 代码块语言标注
- **WHEN** 源包 Markdown 含 ```ts 代码块
- **THEN** docx 代码块首行前插 `[ts]` 灰色标注 run（9pt），代码行保持 Consolas 等宽 + F6F8FA 底纹

#### Scenario: mermaid 代码块降级
- **WHEN** 源包 Markdown 含 ```mermaid 代码块
- **THEN** docx 中以 CodeBlock 样式呈现代码内容，不渲染图，不插语言标注（与 HTML 路径降级一致）

#### Scenario: 表格表头加粗
- **WHEN** 源包 Markdown 含表格
- **THEN** docx 中表头行单元格显式加粗（`<w:b/>`）+ 灰底 F2F2F2，数据行不加粗；列宽按内容宽度启发式分配

#### Scenario: 空文档回归
- **WHEN** 源包 Markdown 仅含标题无正文
- **THEN** docx 仍输出合法 OOXML（含段落、styles、Content_Types），标题文本保真

### Requirement: docx 资源嵌入
包内引用图片资源（png / jpg / gif / webp 等位图）MUST 嵌入 docx（`word/media/` + relationship），并在正文中以图片节点呈现。嵌入尺寸 MUST 按资源固有宽高比等比缩放：以 `imageWidthEmu`（缺省 6 英寸）为最大宽度，高度按固有比例换算；显式提供 `imageHeightEmu` 时按显式值渲染；不得以固定 4:3 形状拉伸资源。固有尺寸 MUST 从资源字节头解析（PNG IHDR / JPEG SOF / GIF 头 / WebP 头，纯字节、无 Node 专属 API）；头解析失败的资源回退为缺省尺寸（6"×4.5"）并通过 `onWarning` 上报警告。SVG 图片 v1 MUST 不嵌入，替换为 alt 文本占位并通过 `onWarning` 上报警告。缺失资源不阻断导出，以 alt 文本占位呈现（渲染路径不执行完整校验，与 HTML 渲染路径行为一致，不触发警告）；完整性由 `validate` 命令负责报错。

#### Scenario: 位图嵌入
- **WHEN** 包内 Markdown 引用 `assets/logo.png` 且执行 `--format docx`
- **THEN** 图片嵌入 docx 资源目录并在文档中显示

#### Scenario: SVG 降级
- **WHEN** 包内 Markdown 引用 SVG 图片且执行 `--format docx`
- **THEN** 输出不包含该 SVG，替换为 alt 文本，`onWarning` 收到警告且命令退出码为 0

#### Scenario: 固有宽高比保留
- **WHEN** 包内引用固有尺寸非 4:3 的位图（如 800×300）且执行 `--format docx`
- **THEN** docx 中图片按 8:3 固有比例呈现，最大宽度对齐 `imageWidthEmu`

#### Scenario: 头解析失败回退
- **WHEN** 包内引用头部损坏的位图资源且执行 `--format docx`
- **THEN** 图片以缺省尺寸嵌入，`onWarning` 收到警告且命令退出码为 0

#### Scenario: 缺失资源不阻断
- **WHEN** 包内 Markdown 引用了包内不存在的资源
- **THEN** 导出完成，以 alt 文本占位，不触发警告（渲染路径语义），不抛出异常

### Requirement: docx 跨端可用
docx 转换核心 MUST 不依赖 Node 专属 API（与 `zip-core` 相同的跨端约束），MUST 同时供 Node CLI 与浏览器端（`mdpkg-web`，供 md-bundle 消费）调用。浏览器端 API MUST 暴露 `toDocx(files, opts, onWarning?)` 等价函数返回 docx 字节（`Uint8Array`）。错误模型：结构/清单错误通过 `MdeError` 抛出（跨端一致，CLI 兜底为明确退出码与消息）；非致命问题（SVG、头解析失败、未知节点）通过 `onWarning` 回调上报且不阻断导出；缺失资源走 alt 占位不触发警告（渲染路径语义）。md-bundle 消费侧 MUST 对 `toDocx` 调用做调用点包装（捕获 `MdeError` 转为确定性错误结果），该包装属消费侧职责。

#### Scenario: 浏览器端导出可用
- **WHEN** md-bundle 通过 `mdpkg-web` 调用 docx 导出函数
- **THEN** 获得完整 `.docx` 字节（Uint8Array）并可直接下载打开

#### Scenario: Node 端与浏览器端同源
- **WHEN** 对同一包分别在 Node CLI 与浏览器调用导出
- **THEN** 生成的 docx 内容一致（允许字节级非确定性差异之外的语义一致）

#### Scenario: 非致命问题不阻断
- **WHEN** 导出遇到 SVG 图片或头解析失败
- **THEN** 导出完成、`onWarning` 收到对应警告、不抛出异常

#### Scenario: 缺失资源静默降级
- **WHEN** 导出遇到缺失资源
- **THEN** 导出完成、alt 占位、不触发警告、不抛出异常（与 HTML 渲染路径一致）