# symbols Specification

## Purpose
TBD - created by archiving change mdpkg-v1-initial. Update Purpose after archive.
## Requirements
### Requirement: 符号扩展定位与可配置性
符号扩展是渲染期转换，作用于普通文本节点，不修改包内原始 Markdown。可配置，默认 `core`。v1 的 Core profile 映射表为唯一强制集：`(tm)`→™、`(c)`→©、`(r)`→®、`+/-`→±、`=/=`→≠、`-->`→→、`<--`→←、`<-->`→↔、`<=`→≤、`>=`→≥。Extended profile 不在 v1 实现范围（`...`→…、`1/2`→½ 等），采用时 MUST 保留 PyMdown Extensions（MIT）版权声明。

#### Scenario: core 符号在普通文本中转换
- **WHEN** 渲染含 `(tm)`、`-->` 等 core 符号的文档
- **THEN** 普通文本节点中符号被转换为对应字符

#### Scenario: symbols 配置为 off 时不转换
- **WHEN** manifest 中 `extensions.symbols` 为 `"off"`
- **THEN** 任何符号均不被转换

### Requirement: 符号排除区
以下区域 MUST NOT 转换：代码块、行内代码、链接与图片的目标地址、HTML 属性、原始 HTML 块、自动链接。实现需在 mdast 上遍历 `text` 节点即可天然满足——code / inlineCode / link.url / html 均不是 `text` 节点。

#### Scenario: 代码与链接地址不转换
- **WHEN** 符号出现在代码块、行内代码、链接/图片地址、HTML 属性或原始 HTML 中
- **THEN** 这些区域内的符号保持原样

### Requirement: 词边界规则
仅当匹配序列前邻为行首 / 空白 / 中文标点，且后邻为行尾 / 空白 / 中文标点时才转换，否则 MUST 保留原文。中文标点集：`，。、；：！？（）【】《》「」『』—…·`。例：`a<=b` 不转换（前邻 `a`）；`步骤 1 --> 步骤 2` 转换。

#### Scenario: 前邻非边界不转换
- **WHEN** 符号序列前邻为普通字符（如 `a<=b`）
- **THEN** 该序列保留原文不转换

#### Scenario: 中文标点邻接时转换
- **WHEN** 符号序列前后为中文标点或空白（如 `步骤 1 --> 步骤 2`）
- **THEN** 该序列被转换

#### Scenario: 混排不误伤
- **WHEN** 文档含版本号、路径等含 `-->`、`<=` 的普通文本（如 `v1.2-->v2`）
- **THEN** 不满足词边界的序列保持原样

### Requirement: 符号转义（哨兵法）
`\` 前缀转义：`\(tm)` 表示字面 `(tm)`。实现 MUST 采用哨兵法：解析前把源码中 `\` + 符号 的序列替换为私有区哨兵（`U+E000`）+ 符号；正常解析与符号转换（哨兵是 Markdown 不解析的字符，且不满足词边界的前邻条件，故其后符号不被转换）；转换后删除哨兵，还原为字面符号。

#### Scenario: 转义符号保留字面
- **WHEN** 文档含 `\(tm)` 
- **THEN** 渲染后输出字面 `(tm)` 而非 ™

#### Scenario: 未转义符号正常转换
- **WHEN** 文档含 `(tm)` 且前邻为空白
- **THEN** 渲染后输出 ™

