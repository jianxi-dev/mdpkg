## MODIFIED Requirements

### Requirement: 命令契约
`mdpkg` MUST 提供以下命令：`pack <dir> -o out.mdpkg`（打包，§6.2 行为）、`unpack <pkg> -o dir`（还原目录并强制解包上限）、`list <pkg>`（列出 `resources[]` 的 path / media_type / size）、`validate <pkg>`（Schema + size + sha256 + 路径规则 + 限制项，统计外链数）、`render <pkg>`、`export --raw <pkg> -o dir`（输出目录、保持包内结构、文本一字不改）、`export --expanded <pkg> -o dir`（输出目录，含展开后 Markdown + 全部资源）、`export --zip <pkg> [-o out.zip]`（输出单文件 zip 交付物：展开后 Markdown + 全部资源 + README，见 zip-export 能力）、`diff <a> <b>`（双方解包到临时目录后 `diff -ruN`）。`--raw` MUST 输出目录而非单文件；`--expanded` 的产出可被任何标准 Markdown 工具打开。`render` MUST 支持 `--format html | docx`（缺省 `html`），`--format docx` 时 `--inline | --dir` 选项不适用并 MUST 报用法错误。`export --zip` 与 `--raw` / `--expanded` 互斥（同时指定 MUST 报用法错误）。退出码：`0` 成功；`1` 校验/业务错误；`2` 用法错误；`3` 内部错误。

#### Scenario: list 只读 header
- **WHEN** 执行 `mdpkg list <pkg>`
- **THEN** 列出资源 path / media_type / size，不解压资源内容

#### Scenario: export --raw 保持结构
- **WHEN** 执行 `mdpkg export --raw <pkg> -o dir`
- **THEN** 输出目录保持包内结构且文本一字不改

#### Scenario: diff 对比两包
- **WHEN** 执行 `mdpkg diff a.mdpkg b.mdpkg`
- **THEN** 双方解包到临时目录后以 `diff -ruN` 对比

#### Scenario: docx 格式与 html 选项互斥
- **WHEN** 执行 `mdpkg render demo.mdpkg --format docx --inline`
- **THEN** 报用法错误（退出码 2）且不产生输出文件

#### Scenario: zip 与 raw/expanded 互斥
- **WHEN** 执行 `mdpkg export --zip demo.mdpkg --raw -o out.zip`
- **THEN** 报用法错误（退出码 2）且不产生输出文件

### Requirement: render 输出形态
`mdpkg render <pkg> [-o out.html] [--inline | --dir] [--max-inline-bytes N] [--format html]`。默认 `--inline`：资源以 data URI 内联，产出单个自包含 HTML 文件。资源总字节 > `--max-inline-bytes`（默认 50 MB）时，MUST 自动降级为 `--dir` 并在 stderr 打印提示。显式指定 `--inline` 或 `--dir` 时忽略阈值。`--dir`：解包资源到输出 HTML 旁的同级目录，HTML 用相对路径引用。`mdpkg render <pkg> --format docx [-o out.docx]`：产出 OOXML 文档，资源嵌入 docx（见 docx-export 能力）；docx 输出 MUST 不适用内联/目录二元模式。

#### Scenario: 默认内联单文件
- **WHEN** 执行 `mdpkg render <pkg> -o out.html` 且资源总量 ≤ 50 MB
- **THEN** 产出单个自包含 HTML 文件，资源以 data URI 内联

#### Scenario: 超过阈值自动降级
- **WHEN** 资源总字节超过默认 50 MB 阈值且未显式指定模式
- **THEN** 自动降级为 `--dir` 并在 stderr 打印提示

#### Scenario: 显式模式忽略阈值
- **WHEN** 显式指定 `--inline` 或 `--dir`
- **THEN** 忽略 `--max-inline-bytes` 阈值按指定模式输出

#### Scenario: docx 输出形态
- **WHEN** 执行 `mdpkg render <pkg> --format docx -o out.docx`
- **THEN** 产出单个 `.docx` 文件，资源嵌入文件内，无旁目录产出