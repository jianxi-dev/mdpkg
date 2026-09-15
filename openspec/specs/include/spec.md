# include Specification

## Purpose
TBD - created by archiving change mdpkg-v1-initial. Update Purpose after archive.
## Requirements
### Requirement: include 语法与触发规则
文件包含语法为 `<<< path`，路径可带引号（`<<< "includes/a b.md"`）。指令 MUST 仅在列 0（行首无缩进）且整行匹配正则 `^<<<\s*(.+?)\s*$` 时触发。规范不要求感知代码块上下文：列 0 的围栏代码块内若出现符合上式的行会被展开（已知且可接受行为，规范不修复）；缩进 ≥1 空格或写在代码块内容中的指令天然不触发。

#### Scenario: 列 0 指令触发展开
- **WHEN** 文档某行以列 0 的 `<<< includes/ch1.md` 开头
- **THEN** 该指令被替换为其目标文件内容

#### Scenario: 缩进指令不触发
- **WHEN** 指令行前有 ≥1 空格缩进
- **THEN** 该行保持原样不展开

#### Scenario: 带引号路径正确解析
- **WHEN** 指令为 `<<< "includes/a b.md"`
- **THEN** 目标为含空格的路径 `includes/a b.md`

### Requirement: include 路径解析与边界
路径相对包根解析，MUST 规范化后位于包根内。MUST NOT 访问包外文件、URL、其他 `.mdpkg` 包（`MDPKG-E501` / `MDPKG-E502`）。目标类型仅包内 Markdown 文件，非 Markdown 目标 → `MDPKG-E503`。目标不存在 → `MDPKG-E508`。

#### Scenario: 指向包外文件被拒
- **WHEN** include 目标解析后位于包根之外
- **THEN** 报 `MDPKG-E501`

#### Scenario: 指向 URL 被拒
- **WHEN** include 目标是 URL 或外部包
- **THEN** 报 `MDPKG-E502`

#### Scenario: 指向非 Markdown 被拒
- **WHEN** include 目标不是 Markdown 文件
- **THEN** 报 `MDPKG-E503`

#### Scenario: 目标不存在报错
- **WHEN** include 目标在包内不存在
- **THEN** 报 `MDPKG-E508`

### Requirement: 相对基准与 URL 重写
被包含文件 `P`（包内路径）中的相对图片/资源引用 `R`，在展开时 MUST 以纯文本方式重写为 `normalize(dirname(P) + "/" + R)`。绝对 URL、协议相对 URL、`data:` URI MUST NOT 被重写。代码块与行内代码中的示例路径 MUST NOT 被重写——实现需跟踪围栏状态（`` ``` `` / `~~~`）以跳过代码块内的行。重写发生在展开阶段（文本层），使展开后的文本自洽；`render` 与 `export --expanded` 共用同一份中间产物。

#### Scenario: 嵌套文件内相对引用被重写
- **WHEN** `includes/chapter-1.md` 内含 `img/fig.png`
- **THEN** 展开后该引用被重写为 `includes/img/fig.png`

#### Scenario: 绝对 URL 不被重写
- **WHEN** 被包含文件内含 `https://` 绝对 URL 或 `data:` URI
- **THEN** 该引用保持原样

#### Scenario: 代码块内的示例路径不被重写
- **WHEN** 被包含文件代码块内含示例路径（如 `![图](img/demo.png)`）
- **THEN** 该示例路径保持原样不被篡改

### Requirement: include 硬限制与循环检测
允许嵌套包含，逐层递归执行同一管线，深度计入上限。硬限制 MUST 存在默认值：最大深度 32（`MDPKG-E504`）、单文档展开后总字节 10 MB（`MDPKG-E505`）、单包内 include 指令总次数 1000（`MDPKG-E506`）。循环检测 MUST 维护展开栈，同一文件在栈中重复出现即报 `MDPKG-E507`。实现 SHOULD 维护「展开后行号 → (源文件, 原始行号)」映射，使报错携带原始出处。

#### Scenario: 深度超限报错
- **WHEN** include 嵌套深度超过 32
- **THEN** 报 `MDPKG-E504`

#### Scenario: 展开后体积超限报错
- **WHEN** 单文档展开后总字节超过 10 MB
- **THEN** 报 `MDPKG-E505`

#### Scenario: 循环包含报错
- **WHEN** include 形成循环（如 a→b→a）
- **THEN** 报 `MDPKG-E507`

#### Scenario: include 次数超限报错
- **WHEN** 单包内 include 指令总次数超过 1000
- **THEN** 报 `MDPKG-E506`

