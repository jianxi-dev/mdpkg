## ADDED Requirements

### Requirement: docx 导出命令形态
`mdpkg render <pkg> --format docx [-o out.docx]` MUST 将 `.mdpkg` 包渲染为 `.docx`（OOXML 文档）。`--format` 缺省值为 `html`（向后兼容，现有行为不变）；指定 `--format docx` 时，`-o` 未提供则输出路径延用包名并替换扩展名为 `.docx`。docx 路径 MUST 复用同一渲染管线输入侧（解包 → 校验 → include 展开 → 解析 → 符号转换），仅输出目标不同。

#### Scenario: 基本导出
- **WHEN** 执行 `mdpkg render demo.mdpkg --format docx -o demo.docx`
- **THEN** 生成 `demo.docx`，内容为源包经 include 展开与符号转换后的 Markdown 文档

#### Scenario: 默认输出名
- **WHEN** 执行 `mdpkg render demo.mdpkg --format docx` 且未指定 `-o`
- **THEN** 输出 `demo.docx`（包名替换扩展名）

#### Scenario: 缺省格式保持 HTML
- **WHEN** 执行 `mdpkg render demo.mdpkg` 且未指定 `--format`
- **THEN** 行为与现有 HTML 渲染完全一致（含 `--inline | --dir` 与阈值降级）

### Requirement: docx 内容保真
docx 文档文本 MUST 与源包内容一致：include 已展开（`<<<` 指令不残留）、符号已转换（`--symbols` 语义与 HTML 路径一致）、相对路径文本不被改写、代码块等 Markdown 结构以 OOXML 对应语义呈现。原始 HTML 注入 MUST NOT 生效（无执行面、无格式化效果）。呈现策略与 HTML 路径有意不同（design D4）：`<script>` / `<style>` 内容体不呈现，其余 raw HTML 节点以字面文本呈现，而非与 HTML 路径相同的整块丢弃。

#### Scenario: include 已展开
- **WHEN** 源包含多级 `<<<` include 的包执行 `--format docx`
- **THEN** docx 中为展开后内容，不包含 `<<<` 指令文本

#### Scenario: 符号已转换
- **WHEN** 源包含 core 符号集文本（如 `->`）执行 `--format docx`
- **THEN** docx 中显示转换后的符号（`→`），与 HTML 渲染结果一致

#### Scenario: 原始 HTML 不生效
- **WHEN** 源包 Markdown 含 `<script>` 或内嵌样式 HTML
- **THEN** docx 中该片段以纯文本呈现，不产生可执行或格式化效果

### Requirement: docx 资源嵌入
包内引用图片资源（png / jpg / gif / webp 等位图）MUST 嵌入 docx（`word/media/` + relationship），并在正文中以图片节点呈现。SVG 图片 v1 MUST 不嵌入，替换为 alt 文本占位并在 stderr 打印警告。缺失资源不阻断导出，以 alt 文本占位呈现（与 HTML 渲染路径行为一致）；完整性由 `validate` 命令负责报错（渲染路径不执行完整校验，与渲染管线语义一致）。

#### Scenario: 位图嵌入
- **WHEN** 包内 Markdown 引用 `assets/logo.png` 且执行 `--format docx`
- **THEN** 图片嵌入 docx 资源目录并在文档中显示

#### Scenario: SVG 降级
- **WHEN** 包内 Markdown 引用 SVG 图片且执行 `--format docx`
- **THEN** 输出不包含该 SVG，替换为 alt 文本，stderr 打印警告且命令退出码为 0

### Requirement: docx 互操作
`--format docx` 产出 MUST 是标准 OOXML 文档（ZIP 容器 + `[Content_Types].xml` + `word/document.xml`），MUST 可被主流 Word 兼容工具（Microsoft Word / LibreOffice / WPS / Pages）直接打开且无修复提示。产出 MUST 包含基础样式（标题层级、段落间距、列表、代码块）。

#### Scenario: 标准工具可打开
- **WHEN** 用 LibreOffice 或 Word 打开导出的 `.docx`
- **THEN** 文档正常打开，标题/段落/列表以对应样式呈现

#### Scenario: 容器结构合法
- **WHEN** 用 `unzip -l` 检查导出的 `.docx`
- **THEN** 可见 `[Content_Types].xml`、`word/document.xml` 等标准条目

### Requirement: docx 跨端可用
docx 转换核心 MUST 不依赖 Node 专属 API（与 `zip-core` 相同的跨端约束），MUST 同时供 Node CLI 与浏览器端（`mdpkg-web`，供 md-bundle 消费）调用。浏览器端 API MUST 暴露 `toDocx(files, opts)` 等价函数返回 docx 字节（`Uint8Array`）。

#### Scenario: 浏览器端导出可用
- **WHEN** md-bundle 通过 `mdpkg-web` 调用 docx 导出函数
- **THEN** 获得完整 `.docx` 字节并可直接下载打开

#### Scenario: Node 端与浏览器端同源
- **WHEN** 对同一包分别在 Node CLI 与浏览器调用导出
- **THEN** 生成的 docx 内容一致（允许字节级非确定性差异之外的语义一致）