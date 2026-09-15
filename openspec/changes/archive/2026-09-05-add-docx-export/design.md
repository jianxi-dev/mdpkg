# Add docx export

## Context

mdpkg 仓库（格式标准 + Node/TS CLI 参考实现）当前渲染能力为 HTML：`render` 命令经「解包 → 校验 → include 展开 → 解析（unified/remark）→ 符号转换 → rehype → 消毒 → 资源内联」管线产出单文件 HTML 或目录模式。跨端基础已就绪：`zip-core.ts` 同时服务 Node CLI 与浏览器（`mdpkg-web`，供 md-bundle 网页工具消费）。

三仓库分工（2026-08-31 拆分）：mdpkg（本仓库，格式 + CLI 参考实现）、md-bundle（网页工具，占位新建，通过 `mdpkg-web` 复用本仓库能力）、clairis（桌面旗舰）。需求：导出 `.mdpkg` 为 docx 文档；归属决策为在 mdpkg 标准包实现（proposal 已论证单一实现源 / 管线复用 / 跨端 zip-core / 职责边界四点）。

约束：实现用 Node 22 内置类型剥离直接跑 `.ts`，仅可用 erasable syntax（禁用构造函数参数属性、enum、namespace）；不新增重依赖；全部文档中文。

## Goals / Non-Goals

**Goals:**
- `render --format docx` 将包渲染为 OOXML `.docx`，文本与 HTML 路径保真（include 已展开、符号已转换）
- `export --zip` 产出标准 zip 交付物（展开后 Markdown + 全部资源 + README，单文件）
- 转换核心跨端：Node CLI 与浏览器（`mdpkg-web` / md-bundle 消费）同一源码
- 位图资源嵌入 docx；SVG 降级为 alt 文本 + 警告
- 输出可被主流 Word 兼容工具直接打开

**Non-Goals:**
- 不在 md-bundle 仓库实现转换逻辑（本变更只在本仓库交付核心能力与 API 面）
- 不改 `.mdpkg` 容器格式规范（docx 是导出格式，不是容器格式）
- 不支持 docx → mdpkg 反向导入
- 不承诺 Word 商业级排版还原（复杂表格合并、页眉页脚、主题样式不在 v1）
- 不引入宏 / vbaProject 等可执行内容

## Decisions

### D1: 命令形态——`render --format docx`，而非新命令或 `export --docx`
`render` 的语义是「渲染为其它格式」（现为 HTML）；docx 是同族输出目标。`export` 的语义是「解包回 Markdown 目录结构」，放 docx 会混淆两种语义。新增独立命令则扩大命令面且与 render 共享 90% 上游。
**替代方案**：`export --docx`（否决：export 语义是还原 Markdown，且与 `--raw/--expanded` 模式冲突）；独立 `docx` 命令（否决：命令面膨胀，上游管线仍要复用 render 的入口）。

### D2: docx 生成自研最小 OOXML 写入器，不引入第三方 docx 库
`docx.ts` 直接写 `[Content_Types].xml`、`_rels/.rels`、`word/document.xml`、`word/_rels/document.xml.rels`、`word/media/*`、`word/styles.xml`（基础样式表：标题 1-6、段落、列表、代码块、表格），容器层复用 `zip-core` 打包。转换路径：mdast（remark-parse + remark-gfm 已就绪）→ OOXML 文本节点序列化。
**理由**：零新依赖（符合项目极简与内置类型剥离约束）；OOXML 子集有限（段落/run/图片/表格/列表/代码块），~300-500 行可覆盖 v1；`zip-core` 已跨端，容器层无缝；浏览器端无 DOM 依赖（`html-to-docx` 类库需 jsdom，直接否决）。
**替代方案**：`docx` npm 库（否决：新依赖、浏览器 bundle 膨胀、OOXML 抽象过重不利于保真控制）；`html-to-docx`（否决：依赖 DOM，Node 端要 jsdom；且 HTML 路径已含消毒，多一步转换引入二次失真）。

### D3: 输出文本保真——符号转换在 mdast 文本层完成，不经 HTML
HTML 路径的符号转换（`symbolsPlugin`）作用在 hast 上。docx 路径不含 rehype，需将符号转换在 mdast → OOXML 序列化阶段对文本节点应用同一转换函数（复用 `symbols.ts` 的转换与 `guardEscapes` 哨兵处理）。include 展开（`include.expand`）在解析前完成，与 HTML 路径顺序一致。
**理由**：两条输出路径共享同一版符号语义（spec §符号集），避免 docx 与 HTML 渲染不一致。
**替代方案**：docx 路径先转 HTML 再 html→docx（否决：引入 jsdom/DOM 依赖，见 D2）。

### D4: 原始 HTML 降级为纯文本，不解析
mdast 的 raw HTML 节点（`<script>`、内嵌样式等）在 docx 序列化时以纯文本输出 `innerText` 语义（对 `<script>/<style>` 直接丢弃内容体或输出文本？取：script/style 内容丢弃，其余 raw HTML 输出其原文字面量）。与 HTML 路径 `rehype-sanitize` 的拒绝语义等价：不产生可执行效果。
**理由**：docx 无 HTML 引擎，注入面天然为零；保留字面量与 HTML 路径「消毒而非删除」的语义一致。

### D5: 资源嵌入——位图进 `word/media/`，SVG 降级
png/jpg/gif/webp 经 `zip-core` 写入 `word/media/img-N.ext`，`document.xml.rels` 建立 relationship，正文 `<w:drawing>` 引用。SVG：v1 不嵌入（Word 兼容性差），以 alt 文本段落占位 + stderr 警告，退出码保持 0。缺失资源由既有 `validate` 阶段提前报错（与 HTML 路径共享）。
**替代方案**：SVG 原样嵌入 + fallback（否决：OOXML svgBlip 的 fallback 机制复杂，v1 收益低）；位图转 SVG 为 PNG（否决：引入 raster 依赖）。

### D6: 跨端结构——`src/docx.ts` 纯逻辑 + 双入口
`docx.ts` 不 import 任何 Node 专属模块（输出 `Uint8Array`），Node CLI（`cli.ts`）与浏览器（`web/mdpkg-web.ts` 暴露 `toDocx(files, opts): Uint8Array`）共用。zip 容器侧区分平台：CLI 用 `zip-core` 既有 Node 路径，浏览器用其 Web 路径（现状已验证的 `packMdpkg` 模式）。
**理由**：与 `zip-core` / `mdpkg-web` 既有跨端模式完全一致，md-bundle 集成零摩擦（照 `md-bundle-integration.md` 模式加一节即可）。

### D7: 样式最小集——内联 styles.xml，不用模板
`word/styles.xml` 携带基础样式（Normal、Heading 1-6、ListParagraph、Table、CodeBlock），序列化按块类型选择 styleId。不基于某 Word 模板拷样式（版权与体积问题），不做主题（theme1.xml）v1 可省（Word 无主题时用默认）。
**理由**：可打开性（Word 对无主题文档完全兼容）+ 体积最小 + 零来源版权风险。

### D8: zip 导出——命令形态与定位
`mdpkg export --zip <pkg> -o out.zip`：产物集 = `export --expanded` 的展开后 Markdown + 全部资源 + 新增 `README.md`（注明包来源、打开方式），用 `zip-core` 打包为单文件标准 zip。与 `--raw/--expanded` 互斥。**不**用 `render --format zip`（zip 是容器交付形态，不是渲染格式；render 语义是「转换为可渲染格式」）。
**理由**：补「零工具依赖交付」缺口——`.mdpkg` 虽是 ZIP 但扩展名自定义，收件人双击无关联程序；zip 人人可解。同时与 lenient-open 形成闭环：对方解压 zip 得到 Markdown 目录，任何人可重打包回 `.mdpkg`。成本极低（expanded 产物组装 + zip-core 已有）。
**替代方案**：不做 zip 导出（否决：md-bundle 的 md 导出丢资源，zip 是保留资源结构的通用交付形态）；只靠 `.mdpkg` 改名 `.zip`（否决：未展开、含 manifest，对普通用户不友好）；zip 放 md-bundle（否决：同 docx 归属论证，转换层归 mdpkg）。

### D9: md-bundle 导出矩阵对齐原则
md-bundle 现有导出（md / mdpkg / html / 长图）中，`md`、`mdpkg`、`html` 属格式转换层，后续变更中应逐步对齐为调用 mdpkg 共享核心（`mdpkg-web` 的 `toZip` / `toDocx` / `packMdpkg` / render API）；`长图` 属产品封装层（浏览器截图），保持 md-bundle 独有。本变更只交付核心能力与 API 面，md-bundle 侧对齐为后续集成工作（不在本仓库实现）。

## Risks / Trade-offs

- [docx 保真度低于 HTML 路径（复杂结构如嵌套列表/表格单元格内多块）] → v1 明确 Non-Goal；测试以标准 markdown 结构集（spec fixtures 43 例可复用）为基准，复杂结构走「降级为平面段落 + 不破坏文档」
- [自研 OOXML 子集遗漏导致部分工具修复提示] → 互操作测试矩阵含 LibreOffice + Word/WPS 可打开验证；docx 互操作 requirement 已立测试门槛
- [浏览器端字节体积（docx 打包含资源）] → 与 `packMdpkg` 现有内存模型一致，限额沿用；>50MB 场景浏览器端本就非主路径
- [符号转换双路径漂移（HTML vs docx）] → D3 固定为共享 `symbols.ts` 函数，测试断言两路径文本一致
- [SVG 降级为 alt 文本导致语义损失] → stderr 警告显式提示，文档记录限制

## Migration Plan

1. `src/docx.ts`（OOXML 序列化 + 打包）落地，纯逻辑 + 单元测试
2. `cli.ts` 接 `--format` 分支（html 缺省，docx 新路径），复用既有 render 入口
3. `web/mdpkg-web.ts` 暴露 `toDocx`
4. 测试：fixtures 复用 + 互操作打开验证 + 端到端
5. 文档：AGENTS.md 命令表、docs/ 集成指南补 docx 节
6. 回滚：`--format` 缺省 html，docx 分支独立模块，移除零风险

## Open Questions

- 嵌套列表/表格内多块的保真边界：v1 采用「展开为平面」还是「嵌套呈现」？（倾向嵌套呈现列表，表格内多块转段落）
- `--format docx` 与 `--symbols` 开关交互：docx 路径是否同样支持 `--no-symbols`？（倾向与 HTML 路径对齐）