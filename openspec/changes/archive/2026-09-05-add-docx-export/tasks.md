# Tasks: Add docx export

## 1. OOXML 序列化核心

- [x] 1.1 新建 `packages/mdpkg/src/docx.ts`：实现最小 OOXML 写入器 `toDocx(files: Map<string, Uint8Array>, opts): Uint8Array`（纯逻辑，无 Node 专属 API），输出 `[Content_Types].xml` / `_rels/.rels` / `word/document.xml` / `word/_rels/document.xml.rels` / `word/styles.xml`，容器用 `zip-core` 打包
- [x] 1.2 实现 mdast → OOXML 序列化：heading(1-6)/paragraph/strong/em/code(block+inline)/ul/ol/li/blockquote/table(remark-gfm)/hr/link，按块类型选择 styleId
- [x] 1.3 文本层符号转换：在序列化阶段对文本节点复用 `symbols.ts` 转换函数（含 `guardEscapes` 哨兵语义），保证与 HTML 路径文本一致
- [x] 1.4 raw HTML 节点降级：`<script>/<style>` 内容体丢弃，其余 raw HTML 输出字面量文本（不解析、无执行面）
- [x] 1.5 位图资源嵌入：png/jpg/gif/webp 写入 `word/media/img-N.ext` + relationship + `<w:drawing>`；SVG 不嵌入，以 alt 文本占位
- [x] 1.6 `word/styles.xml` 基础样式表：Normal / Heading 1-6 / ListParagraph / Table / CodeBlock

## 2. CLI 接入

- [x] 2.1 `cli.ts` `render` 分支增加 `--format html | docx`（缺省 html，向后兼容），解析 `--format` 并校验与 `--inline/--dir` 互斥（冲突报用法错误，退出码 2）
- [x] 2.2 `--format docx` 输出路径：`-o` 缺省时按包名替换 `.docx`；复用现有 render 入口（解包 → 校验 → expand → parse），仅输出目标走 `docx.ts`
- [x] 2.3 SVG 降级警告输出至 stderr（退出码保持 0）

## 3. 浏览器端 API

- [x] 3.1 `web/mdpkg-web.ts` 暴露 `toDocx(files, opts): Uint8Array`（复用同一 `docx.ts` 核心），供 md-bundle 消费
- [x] 3.2 `npm run build:web` 构建通过，ESM + IIFE bundle 均含 docx 导出

## 4. 测试

- [x] 4.1 单元测试 `test/docx.test.ts`：heading/列表/表格/代码块/链接/hr 序列化断言（结构节点存在 + 文本保真）
- [x] 4.2 往返与保真测试：fixtures 复用（spec fixtures 43 例中选取含 include/符号/资源样例）→ `toDocx` → 解包断言文本含展开后内容与转换后符号、无 `<<<` 残留
- [x] 4.3 内容一致性：同一包 HTML 渲染文本 vs docx 文本对比（符号/展开语义一致）
- [x] 4.4 互操作测试：产物 docx 可被 `unzip -l` 列出标准条目；用 LibreOffice（`soffice --headless --convert-to txt`）验证可打开
- [x] 4.5 负例：`--format docx --inline` 报用法错误（退出码 2）；SVG 降级给出警告且退出码 0
- [x] 4.6 全量回归：`npm test` 既有 136 用例全部通过

## 5. 文档

- [x] 5.1 `AGENTS.md` 命令表补充 `render --format docx`
- [x] 5.2 `packages/mdpkg/docs/md-bundle-integration.md` 补充 docx 导出调用节（`toDocx` 用法）
- [x] 5.3 spec 变更归档说明（docx-export 能力 + pipeline delta 已含，确认无遗漏）

## 6. 浏览器端 zip 导出 API

- [x] 6.1 `web/mdpkg-web.ts` 暴露 `toZip(files, opts): Uint8Array`（expanded 产物集 + README + zip-core 打包），供 md-bundle 导出菜单消费
- [x] 6.2 `npm run build:web` 构建通过，ESM + IIFE bundle 均含 zip 导出

## 7. zip 导出 CLI 与测试（P2）

- [x] 7.1 `cli.ts` `export` 分支增加 `--zip`：产物集 = expanded 内容 + README.md（包来源/打开方式说明），与 `--raw/--expanded` 互斥（冲突报用法错误，退出码 2）；`-o` 缺省按包名替换 `.zip`
- [x] 7.2 zip 单测：解压后目录结构与包内一致、无 manifest 条目、Markdown 文本与源包一致（含 include 展开）
- [x] 7.3 互操作测试：`unzip -l` 列出标准条目，系统解压工具可开（负例：`--zip --raw` 报用法错误）
- [x] 7.4 `npm test` 全量回归：既有 136 用例 + 新增全部通过