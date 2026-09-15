## ADDED Requirements

### Requirement: manifest.json 结构
包根 MUST 包含 `manifest.json`。`resources` MUST 覆盖包内除 `manifest.json` 外的全部文件（包含入口文档自身）；`resources` 顺序 MUST 按 `path` 码位升序。`resources[].path` 为包内相对路径且已 NFC 归一化；`resources[].media_type` 为 IANA 媒体类型（未知用 `application/octet-stream`）；`resources[].size` 为未压缩字节数；`resources[].sha256` 为小写 64 位十六进制；`resources[].source_url` 仅当该资源由外链下载得到时存在。

#### Scenario: manifest 覆盖全部资源
- **WHEN** 检查打包产物的 `manifest.json`
- **THEN** `resources` 覆盖包内除 manifest 外的全部文件且按 `path` 码位升序排列

#### Scenario: 入口文档自身在 resources 中
- **WHEN** 检查打包产物的 `manifest.json`
- **THEN** 入口文档自身作为资源之一被记录

#### Scenario: entrypoint 指向无效目标报错
- **WHEN** `validate` 发现 `entrypoint` 指向不存在或非 Markdown 文件
- **THEN** 报 `MDPKG-E303`

#### Scenario: resources 未覆盖全部文件报错
- **WHEN** `validate` 发现包内存在未被 `resources` 覆盖的文件
- **THEN** 报 `MDPKG-E304`

### Requirement: manifest 字段语义
`format` 恒为 `"mdpkg"`；`spec_version` 为 `"<major>.<minor>"`（本规范 `"1.0"`）；`entrypoint` 为入口文档包内路径（省略时取 `"document.md"`）；`encoding` 恒为 `"utf-8"`（省略时同）；`extensions` 表达作者意图——`symbols` ∈ `off|core|extended`（默认 `core`）、`include` ∈ `true|false`（默认 `true`）；`extensions_required` 为硬依赖列表，渲染器不支持其中任何一项 MUST 报错退出，不得静默降级。

#### Scenario: 省略 entrypoint 取默认值
- **WHEN** manifest 未含 `entrypoint` 字段
- **THEN** 实现以 `"document.md"` 作为入口

#### Scenario: extensions_required 不支持时报错
- **WHEN** manifest 的 `extensions_required` 含实现不支持的项
- **THEN** 渲染器报 `MDPKG-E702` 退出，不静默降级

### Requirement: 字段归属规则
用户解包 → 编辑 → 重打包时，`mdpkg pack` MUST 按下表处理：`resources[]`、`size`、`sha256`、`media_type` 为机器事实，每次重算覆盖原值；`entrypoint`、`extensions`、`extensions_required`、`encoding` 为作者意图，存在则保留、缺失才取默认值；`spec_version` 由工具决定不继承；`resources[].source_url` 为历史来源，保留。

#### Scenario: 重打包保留作者配置
- **WHEN** 用户解包一个含自定义 `entrypoint` 与 `extensions` 的包、编辑后重打包
- **THEN** 作者意图字段被保留，机器事实字段（size/sha256 等）被重算覆盖

#### Scenario: 重打包刷新过期哈希
- **WHEN** 用户编辑了包内文档后重打包
- **THEN** 被编辑资源的 `size` 与 `sha256` 被重新计算而非沿用旧值

### Requirement: manifest JSON Schema
manifest MUST 符合 `spec/schema/manifest-1.0.json`（draft 2020-12）：`format` 为 const `"mdpkg"`、`spec_version` 匹配 `^1\.\d+$`、`resources` 为必填数组且每项必含 `path`/`media_type`/`size`/`sha256`。Schema 不表达语义约束（路径合法性、NFC、引用闭包、顺序），语义约束由 `validate` 按路径/打包/包含规则实现。

#### Scenario: 不符合 Schema 的 manifest 被拒
- **WHEN** `validate` 遇到缺失 `format` 或 `resources` 的 manifest
- **THEN** 报 `MDPKG-E302`

#### Scenario: 未知扩展字段被忽略
- **WHEN** manifest 含 Schema 未定义的未知字段
- **THEN** `validate` 忽略该字段并给出 warning（`MDPKG-E703`）