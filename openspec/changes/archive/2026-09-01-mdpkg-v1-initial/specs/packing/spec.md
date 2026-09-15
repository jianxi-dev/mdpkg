## ADDED Requirements

### Requirement: 文档内资源引用
文档 MUST 使用包内相对路径引用资源（如 `![产品截图](assets/images/product.png)`）。实现 MUST NOT 要求或生成 `mdpkg://` 协议——解压/导出后必须仍是标准 Markdown，`mdpkg://` 会破坏降级路径。外部 URL（`http://`、`https://`、协议相对 `//`）默认保留为外链，不下载。

#### Scenario: 相对路径引用被正确打包
- **WHEN** 文档以包内相对路径引用图片资源
- **THEN** 打包时该资源进入包内且路径保持相对

#### Scenario: 外链默认保留不下载
- **WHEN** 文档引用 `https://` 外部 URL
- **THEN** 打包时该 URL 保留为外链，不发起下载

### Requirement: 入口解析
`mdpkg pack` 的入口解析顺序 MUST 为：`--entry` 指定；否则 `dir/document.md`；否则若 `dir/manifest.json` 存在则继承其 `entrypoint`。三者皆无 → `MDPKG-E301`。

#### Scenario: 无法确定入口时报错
- **WHEN** 打包目录既无 `document.md` 也无 `manifest.json` 且未指定 `--entry`
- **THEN** 报 `MDPKG-E301`

### Requirement: 打包模式
`mdpkg pack` 默认 MUST 打包 `dir` 内全部文件（排除输出文件自身）。`--referenced-only` 仅打包引用闭包（入口 + include 传递展开后可达的全部本地引用）+ 入口 + `manifest.json`。

#### Scenario: 默认全量打包
- **WHEN** 执行 `mdpkg pack <dir>` 且未指定模式
- **THEN** 目录内全部文件（除输出文件）被打包

#### Scenario: --referenced-only 只打包引用闭包
- **WHEN** 执行 `mdpkg pack <dir> --referenced-only`
- **THEN** 仅入口、include 传递展开后可达的本地引用与 manifest 被打包

### Requirement: 引用校验
两种打包模式下都执行引用校验：从入口出发遍历 include 闭包，收集全部本地引用，任何被引用的本地文件不存在于待打包集合 → 报错退出（`MDPKG-E401`），不静默跳过。收集 MUST 基于 Markdown AST（mdast 的 `image` / `link` 节点 URL），不得用正则扫全文——示例代码块中的 Markdown 语法不视为真实引用。这一步 MUST 走 include 传递闭包，只扫入口文档会漏掉被包含子文档里的图片。到本地 Markdown 的链接属文档间导航，不算附件，不强制打包。

#### Scenario: 引用的本地资源缺失时报错
- **WHEN** 文档引用一个不在待打包集合中的本地文件
- **THEN** 报 `MDPKG-E401` 并退出，不静默跳过

#### Scenario: 代码块中的示例引用不误报
- **WHEN** 文档的代码块内出现含 Markdown 语法的示例（如 `![图](assets/a.png)`）
- **THEN** 引用收集基于 AST 排除该示例，不报 `MDPKG-E401`

#### Scenario: 被包含子文档中的引用被收集
- **WHEN** 被 include 的子文档内引用图片资源
- **THEN** 该资源进入引用闭包，缺失时报 `MDPKG-E401`

#### Scenario: 到本地 Markdown 的链接不强制打包
- **WHEN** 文档链接到本地其他 Markdown 文件（文档间导航）
- **THEN** 该链接不算附件，不触发 `MDPKG-E401`

### Requirement: 孤儿资源与 --fetch 边界
孤儿资源（在包内但未被任何文档引用）MUST 产生 warning 而非错误（`MDPKG-E404`）。`--fetch` 显式下载外链并改写为包内相对路径、在 `resources[].source_url` 记录来源，默认 MUST 关闭；参考实现 v1 不提供此开关，外链一律保留原样由 `validate` 统计数量并提示「本包含 N 个外部引用，不可完全离线」。若将来提供，必须带协议白名单（仅 http/https）、重定向上限、大小上限与内网地址拒绝。

#### Scenario: 孤儿资源仅警告
- **WHEN** 包内存在未被任何文档引用的资源
- **THEN** 打包给出 warning（`MDPKG-E404`）而非报错

#### Scenario: validate 统计外链数
- **WHEN** `validate` 检查含外部引用的包
- **THEN** 输出统计「本包含 N 个外部引用，不可完全离线」