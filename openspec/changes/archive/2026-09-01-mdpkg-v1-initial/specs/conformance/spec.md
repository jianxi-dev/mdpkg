## ADDED Requirements

### Requirement: fixtures 目录与格式
一致性测试向量（conformance fixtures）是规范的可执行形式，与实现无关。每个用例 MUST 位于 `spec/fixtures/<case-id>/`，结构为 `case.json`（用例定义）+ `input/`（输入目录或 input.mdpkg）+ 可选 `expected/`（期望产出：manifest / html / 解包树）。`case.json` 字段：`id` / `title` / `kind`（`pack` | `unpack` | `list` | `validate` | `render` | `export` | `diff`）/ `input`（默认 `input/`）/ `entry` / `args` / `tamper` / `expect`（`exitCode` | `errorCode` | `manifest` | `tree` | `html` | `stderrContains` 等）。断言内联，只有大产物才放 `expected/` 目录。任何语言的实现跑通同一批用例即视为合规。

#### Scenario: fixture 驱动实现验证
- **WHEN** 一个实现以 `spec/fixtures/` 下同一批用例运行
- **THEN** 每个用例按 `case.json` 的 `expect` 断言通过

#### Scenario: 负向用例断言错误码
- **WHEN** 用例为负向（如篡改、越界）
- **THEN** `expect.errorCode` 必填且实际错误码与之匹配

### Requirement: 可重复性断言
`pack` 用例 MUST 额外断言可重复性：以相同输入打包两次，两次产物字节相同。实现驱动对所有 `pack` 类用例自动附加「两次打包字节相同」断言，不单独立用例。

#### Scenario: pack 用例自动附加可重复性断言
- **WHEN** 驱动运行任一 `pack` 类 fixture
- **THEN** 自动执行两次打包并断言产物字节相同

### Requirement: 驱动通道
fixture 驱动 MUST 覆盖六条通道：`pack` / `validate` / `render` / `expand` / `export` / `unpack`（外加不依赖文件树的 `path`）。`unpack-roundtrip` 断言 pack→unpack 后除 `manifest.json`（工具生成）外每个文件逐字节相同。受执行环境限制的用例（大小写/NFC 冲突、ZIP 炸弹）不进 fixture，改由实现单测用内存 Map / 直接构造覆盖。

#### Scenario: 往返一致性
- **WHEN** 运行 `unpack-roundtrip` 用例
- **THEN** pack → unpack 后除 `manifest.json` 外每个文件与原目录逐字节相同

#### Scenario: 环境受限用例由单测覆盖
- **WHEN** 用例涉及 macOS APFS 无法构造的输入（大小写冲突、ZIP 炸弹）
- **THEN** 该用例不进 fixtures，由实现单测以内存数据结构覆盖

### Requirement: 用例覆盖范围
fixtures MUST 覆盖：正向（pack-basic、pack-reproducible、pack-unicode-path、unpack-roundtrip、render-symbols、render-include-nested、export-raw/expanded、validate-clean）；符号边界（word-boundary、escape、profile-off、cjk-punct）；include（single、multi-level、cycle、duplicate、missing、outside-root、non-markdown、quoted-path、indented-not-triggered、depth/size/count-limit、url-rewrite）；安全（path-traversal、absolute-path、windows-drive、symlink、duplicate-entry、zip-bomb-ratio、total-size-limit、entry-count-limit、malicious-svg、html-injection、sha-mismatch、external-url）；路径/编码（nfd-conflict、case-conflict、non-utf8）；版本/扩展（major-mismatch、required-unsupported、unknown-ignored）；互操作（unzip、renderer）。落地状态：已实现 43 个用例，全部通过（全量 79/79，含 36 个实现单测）。

#### Scenario: 覆盖目标达成
- **WHEN** 检查 `spec/fixtures/` 用例清单
- **THEN** 43 个用例覆盖上列全部类别且由 `packages/mdpkg/test/fixtures.test.ts` 驱动通过