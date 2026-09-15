# zip-export Specification

## Purpose
TBD - created by archiving change add-docx-export. Update Purpose after archive.

## Requirements

### Requirement: zip 导出命令形态
`mdpkg export --zip <pkg> -o out.zip` MUST 将 `.mdpkg` 包导出为单个标准 `.zip` 文件。内容 MUST 等价于 `export --expanded` 的产物集（include 已展开的 Markdown + 全部资源 + 相对路径已按包根重写），另附加 `README.md` 说明文件（注明包来源、打开方式与内容构成）；若包内已存在根级 `README.md`（如入口即 README），则不生成模板、保留展开后的用户内容作为说明。文本 MUST 与源包一字不改（除 include 展开与路径重写外）。添加 `--zip` 时不可再指定 `--raw` / `--expanded`（互斥，冲突报用法错误，退出码 2）。`-o` 未提供时输出路径按包名替换扩展名为 `.zip`（包路径无 `.mdpkg` 后缀时追加 `.zip`，不得覆盖输入文件）。

#### Scenario: 基本 zip 导出
- **WHEN** 执行 `mdpkg export --zip demo.mdpkg -o demo.zip`
- **THEN** 生成标准 zip：解压后含展开后 Markdown、全部资源与 README.md，文本与源包一致

#### Scenario: 与 raw/expanded 互斥
- **WHEN** 执行 `mdpkg export --zip demo.mdpkg --raw -o out.zip`
- **THEN** 报用法错误（退出码 2）且不产生输出文件

### Requirement: zip 互操作
zip 导出产物 MUST 是标准 ZIP 容器（`unzip -l` / `unzip -p` 可列可提），MUST 不含 `manifest.json` 等 mdpkg 特定条目（是交付给普通用户的最终形态，不是 `.mdpkg` 包）。产出目录结构 MUST 保持包内相对路径。

#### Scenario: 通用工具可直接解压
- **WHEN** 用 `unzip -l out.zip` 或用系统解压工具打开
- **THEN** 目录结构与包内一致，无 manifest 条目，无 mdpkg 依赖提示

### Requirement: zip 跨端可用
zip 导出核心 MUST 不依赖 Node 专属 API（与 `zip-core` 相同的跨端约束），MUST 同时供 Node CLI 与浏览器端（`mdpkg-web`，供 md-bundle 导出菜单使用）调用。浏览器端 API MUST 暴露 `toZip(files, opts)` 等价函数返回 `Uint8Array`。

#### Scenario: 浏览器端导出可用
- **WHEN** md-bundle 通过 `mdpkg-web` 调用 zip 导出函数
- **THEN** 获得完整 `.zip` 字节并可直接下载解压
