## ADDED Requirements

### Requirement: 渲染管线顺序
渲染管线顺序 MUST 固定：1 读取并解包 ZIP；2 校验 manifest（Schema + 资源 size/sha256）；3 预处理 include 展开（循环/深度/大小限制 + 相对 URL 重写）；4 解析 Markdown → AST；5 符号转换（仅作用于 text 节点，词边界 + 转义）；6 渲染 AST → HTML（安全清理）；7 输出。

#### Scenario: 渲染按固定顺序执行
- **WHEN** 执行 `mdpkg render`
- **THEN** 依次完成解包、manifest 校验、include 展开、解析、符号转换、HTML 渲染与输出

### Requirement: HTML 安全
输出 MUST 经 HTML 消毒（清 `script` / `on*` 事件属性 / `javascript:` URL）。SVG MUST 以 `<img>` 引用方式渲染，不得插入 HTML DOM；`<img src="data:image/svg+xml;base64,...">` 属于 `<img>` 引用（其中的 SVG 不执行脚本），`render --inline` 可安全地对 SVG 使用 data URI；把 SVG 节点插入 HTML DOM 树的行为 v1 禁止，即使显式开关也不提供。外部 URL 图片 MUST 附 `referrerpolicy="no-referrer"`。文档内联的原始 HTML MUST 经消毒，消毒行为 MUST 可审计（记录被移除的节点类型数）。

#### Scenario: 恶意 HTML 被消毒
- **WHEN** 文档内联 HTML 含 `script` 或 `on*` 事件属性
- **THEN** 渲染输出中这些元素被移除或无害化，且审计记录被移除的节点类型数

#### Scenario: SVG 不进 DOM
- **WHEN** 渲染含 SVG 资源的包
- **THEN** SVG 以 `<img>` 引用方式渲染，不插入 HTML DOM 树

#### Scenario: 外部图片附 referrerpolicy
- **WHEN** 渲染输出含外部 URL 图片
- **THEN** 图片标签带 `referrerpolicy="no-referrer"`

### Requirement: 完整性校验边界
`manifest.json` 记录的 SHA-256 用于检测非恶意的完整性问题（传输损坏、误传、解包后被外部程序改写、跨平台 NFC/NFD 字节漂移）。它不提供防篡改保证——manifest 与被校验资源位于同一 ZIP 内，任何能重写包的人都可同步更新摘要。实现 MUST NOT 在输出信息中把校验通过描述为「未被篡改 / 可信 / 已验证来源」。

#### Scenario: sha256 不符报完整性错误
- **WHEN** `validate` 发现资源 sha256 与 manifest 记录不符
- **THEN** 报 `MDPKG-E403`，且输出不含「篡改」等防篡改表述

#### Scenario: size 不符报错
- **WHEN** `validate` 发现资源 size 与 manifest 记录不符
- **THEN** 报 `MDPKG-E402`

### Requirement: 解包安全上限
实现 MUST 在解包/读取时强制下列上限且默认值必须存在（可用参数覆盖）：资源总数 10 000（`MDPKG-E602`）、单文件解压后字节 200 MB（`MDPKG-E603`）、总解压字节 1 GB（`MDPKG-E604`）、单条目压缩比 1000:1（`MDPKG-E605`）。检测 MUST 在解压过程中流式计数，不得先完整解压再统计；判定只需读条目的 central directory header，达到上限即不启动该条目的解压流。解包强制路径校验（绝对路径 / `..` / 符号链接 / 硬链接 / 盘符 → `MDPKG-E202` / `MDPKG-E601`）。

#### Scenario: 压缩比异常被拒
- **WHEN** 包内存在压缩比超过 1000:1 的条目（疑似 ZIP 炸弹）
- **THEN** 解包报 `MDPKG-E605`，且只读 header 即拒绝、不完整解压

#### Scenario: 资源总数超限被拒
- **WHEN** 包内资源总数超过 10 000
- **THEN** 解包报 `MDPKG-E602`

#### Scenario: 目录遍历被拒
- **WHEN** 包内存在 `../` 绝对路径等恶意条目
- **THEN** 解包报 `MDPKG-E202`，不写入包外

### Requirement: 版本协商
主版本不同 → MUST 拒绝处理并报错（`MDPKG-E701`）。次版本更高 → 处理已知的 v1 字段，忽略未知字段（MUST NOT 因未知字段报错）。`extensions_required` 中存在实现不支持的项 → MUST 报错退出（`MDPKG-E702`），不得静默降级。

#### Scenario: 主版本不匹配被拒
- **WHEN** 读取 `spec_version` 主版本与实现不支持的包
- **THEN** 报 `MDPKG-E701` 拒绝处理

#### Scenario: 次版本更高可处理
- **WHEN** 读取 `spec_version` 次版本更高（如 `1.1`）的包
- **THEN** 处理已知 v1 字段、忽略未知字段，不因未知字段报错

### Requirement: 命令契约
`mdpkg` MUST 提供以下命令：`pack <dir> -o out.mdpkg`（打包，§6.2 行为）、`unpack <pkg> -o dir`（还原目录并强制解包上限）、`list <pkg>`（列出 `resources[]` 的 path / media_type / size）、`validate <pkg>`（Schema + size + sha256 + 路径规则 + 限制项，统计外链数）、`render <pkg>`、`export --raw <pkg> -o dir`（输出目录、保持包内结构、文本一字不改）、`export --expanded <pkg> -o dir`（输出目录，含展开后 Markdown + 全部资源）、`diff <a> <b>`（双方解包到临时目录后 `diff -ruN`）。`--raw` MUST 输出目录而非单文件；`--expanded` 的产出可被任何标准 Markdown 工具打开。退出码：`0` 成功；`1` 校验/业务错误；`2` 用法错误；`3` 内部错误。

#### Scenario: list 只读 header
- **WHEN** 执行 `mdpkg list <pkg>`
- **THEN** 列出资源 path / media_type / size，不解压资源内容

#### Scenario: export --raw 保持结构
- **WHEN** 执行 `mdpkg export --raw <pkg> -o dir`
- **THEN** 输出目录保持包内结构且文本一字不改

#### Scenario: diff 对比两包
- **WHEN** 执行 `mdpkg diff a.mdpkg b.mdpkg`
- **THEN** 双方解包到临时目录后以 `diff -ruN` 对比

### Requirement: render 输出形态
`mdpkg render <pkg> [-o out.html] [--inline | --dir] [--max-inline-bytes N]`。默认 `--inline`：资源以 data URI 内联，产出单个自包含 HTML 文件。资源总字节 > `--max-inline-bytes`（默认 50 MB）时，MUST 自动降级为 `--dir` 并在 stderr 打印提示。显式指定 `--inline` 或 `--dir` 时忽略阈值。`--dir`：解包资源到输出 HTML 旁的同级目录，HTML 用相对路径引用。

#### Scenario: 默认内联单文件
- **WHEN** 执行 `mdpkg render <pkg> -o out.html` 且资源总量 ≤ 50 MB
- **THEN** 产出单个自包含 HTML 文件，资源以 data URI 内联

#### Scenario: 超过阈值自动降级
- **WHEN** 资源总字节超过默认 50 MB 阈值且未显式指定模式
- **THEN** 自动降级为 `--dir` 并在 stderr 打印提示

#### Scenario: 显式模式忽略阈值
- **WHEN** 显式指定 `--inline` 或 `--dir`
- **THEN** 忽略 `--max-inline-bytes` 阈值按指定模式输出

### Requirement: 三层兼容性
容器兼容：`.mdpkg` MUST 是标准 ZIP，`unzip -l` / `unzip -p` 可列可提。文档兼容：包内 Markdown 是标准 Markdown + 相对路径；符号保持源文本；`<<<` 降级为可见文本。导出兼容：`export --raw` / `--expanded` 的产出 MUST 可被任何标准 Markdown 工具打开。不承诺：普通文本编辑器直接打开 `.mdpkg` 即获得完整渲染。

#### Scenario: 通用 ZIP 工具可读
- **WHEN** 用 `unzip -l` / `unzip -p` 打开 `.mdpkg`
- **THEN** 条目可列、内容可提取

#### Scenario: 降级路径成立
- **WHEN** 用不支持 mdpkg 扩展的渲染器打开包内原始 Markdown
- **THEN** 文本可读，`<<<` 显示为可见文本，符号保持源文本