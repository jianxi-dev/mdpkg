## ADDED Requirements

### Requirement: ZIP 容器基本约束
包 MUST 是有效的 ZIP 归档（APPNOTE.TXT 6.3.x 兼容）。包根 MUST 直接包含 `manifest.json`。包 MUST NOT 包含目录条目以外的绝对路径、`..` 段、符号链接、硬链接条目。同一包内 MUST NOT 存在两个规范化后相同的路径。所有文本（Markdown / JSON / include 源文件 / 文本附件）MUST 为 UTF-8、MUST NOT 含 BOM、MUST NOT 含 U+0000。路径分隔符统一为 `/`。

#### Scenario: 有效包通过基本约束
- **WHEN** 实现读取一个包含 `manifest.json`、路径合法的 ZIP 归档
- **THEN** 包被接受并按 mdpkg 处理

#### Scenario: 含 `..` 段的包被拒绝
- **WHEN** ZIP 内存在含 `..` 段的路径条目
- **THEN** 实现拒绝处理该包并报路径非法错误（`MDPKG-E202`）

#### Scenario: 含符号链接条目的包被拒绝
- **WHEN** ZIP 内存在符号链接或硬链接条目
- **THEN** 实现拒绝处理并报 `MDPKG-E601`

#### Scenario: 非 UTF-8 文本被拒绝
- **WHEN** 包内文本文件含 BOM 或非 UTF-8 字节
- **THEN** pack 阶段报 `MDPKG-E203`

### Requirement: 包识别条件
一个文件是 mdpkg 包，当且仅当全部成立：扩展名为 `.mdpkg`（不区分大小写）；且是有效 ZIP；且包根含 `manifest.json`；且 `manifest.json` 可解析为 JSON 对象、`format` 字段等于字符串 `"mdpkg"`、`spec_version` 存在且主版本号为实现所支持。任一条件不成立，实现 MUST 按「普通 ZIP」处理，不得强行当作 mdpkg，也不得猜测修复。

#### Scenario: 识别失败按普通 ZIP 处理
- **WHEN** 打开一个非 ZIP 或缺少 manifest 或 `format` 不匹配的 `.mdpkg` 文件
- **THEN** 实现按普通 ZIP 处理并给出非错误提示（`MDPKG-E103`）

#### Scenario: 非 ZIP 文件被识别拒绝
- **WHEN** 打开阶段发现文件不是有效 ZIP
- **THEN** 报 `MDPKG-E101`，不按 mdpkg 处理

#### Scenario: 缺少 manifest.json 被识别拒绝
- **WHEN** 文件是有效 ZIP 但包根缺少 `manifest.json`
- **THEN** 报 `MDPKG-E102`，不按 mdpkg 处理

### Requirement: 压缩策略
Markdown / JSON / 纯文本 MUST 使用 DEFLATE（级别 9）；PNG / JPEG / GIF / WebP / 音视频 / PDF / 已压缩归档 MUST 使用 Store（不压缩）；其他类型实现 MAY 自行决定，SHOULD 默认 Store。

#### Scenario: 文本压缩而媒体不压缩
- **WHEN** 打包包含 Markdown 文本与 PNG 图片的目录
- **THEN** 文本条目以 DEFLATE 存储、PNG 条目以 Store 存储

### Requirement: 可重复构建
同一输入目录两次打包 MUST 产生字节相同的包。ZIP 条目顺序 MUST 为包内路径的 Unicode 码位升序（`manifest.json` 排在最前）；所有条目时间戳 MUST 为 `1980-01-01 00:00:00`；普通文件权限位 MUST 为 `0644`、目录 MUST 为 `0755`；MUST NOT 写入本机绝对路径、UID/GID、扩展属性、注释字段；生成时间 MUST NOT 进入 `manifest.json`。实现 MAY 提供 `--preserve-mtime`，启用时本条整体失效且 MUST 在输出中提示「已放弃可重复构建」。

#### Scenario: 同输入两次打包字节一致
- **WHEN** 对同一输入目录连续执行两次 `mdpkg pack`
- **THEN** 两次产物字节完全相同

#### Scenario: 条目顺序为码位升序
- **WHEN** 检查已生成包的条目顺序
- **THEN** 条目按路径 Unicode 码位升序排列且 `manifest.json` 位于首位

#### Scenario: 启用 --preserve-mtime 时提示放弃可重复构建
- **WHEN** 用户以 `--preserve-mtime` 打包
- **THEN** 输出提示「已放弃可重复构建」且条目时间戳不再固定

### Requirement: 目录结构约定
规范只强制 `manifest.json` 的存在与位置。其余目录布局（`assets/`、`includes/` 等）是惯例，实现 MUST NOT 依赖惯例布局做判断，一律以 `manifest.entrypoint` 与实际路径为准。

#### Scenario: 非惯例布局仍被正确打包
- **WHEN** 打包一个入口文档不在根目录、无 `assets/` 目录的目录
- **THEN** 实现依据 `manifest.entrypoint` 与实际路径处理，不依赖惯例布局

### Requirement: 路径与编码规则
路径 MUST NOT 以 `/` 开头、MUST NOT 含 `.` 或 `..` 段、MUST NOT 含空段（`//`）、MUST NOT 含 U+0000、MUST NOT 含 Windows 盘符或保留设备名。路径与文件名在入库前 MUST 统一 Unicode NFC 归一化。归一化后相同的两个路径（含仅大小写不同者）MUST 在打包阶段被拒绝（`MDPKG-E201`）。路径长度 MUST NOT 超过 1024 字节（UTF-8）。实现 MUST 拒绝符号链接与硬链接条目（`MDPKG-E601`）。

#### Scenario: NFD/NFC 同名冲突被拒
- **WHEN** 目录中存在仅 Unicode 归一化形式不同（NFD vs NFC）的同名文件
- **THEN** 打包阶段报 `MDPKG-E201`

#### Scenario: 大小写冲突被拒
- **WHEN** 目录中存在仅大小写不同的两个路径
- **THEN** 打包阶段报 `MDPKG-E201`

#### Scenario: 路径超长被拒
- **WHEN** 存在 UTF-8 字节长度超过 1024 的路径
- **THEN** 打包阶段报 `MDPKG-E204`