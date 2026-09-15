# lenient-open Specification

## Purpose
宽容打开层：mdpkg 打开/渲染路径对「无 manifest.json 的普通 zip（目录树 + Markdown）」的降级支持。input tolerant, output strict——打开宽容，输出与校验严格。

## ADDED Requirements

### Requirement: 无 manifest 输入降级打开
打开/渲染入口（CLI `render` / `export` 与浏览器 `openMdpkg`）在解包后检测不到 `manifest.json` 时，MUST 进入推断模式而非报错：按入口推断规则确定 entrypoint，临时构建最小 manifest（仅用于驱动既有管道），继续渲染流程。推断模式的结果 MUST 标记来源降级。含 manifest 的既有路径 MUST 行为不变（先校验后渲染，无降级标注）。

#### Scenario: 裸 zip 目录树可渲染
- **WHEN** 对不含 `manifest.json` 的 zip 执行 `mdpkg render`
- **THEN** 按入口推断规则选定入口并正常渲染输出，且结果标注未校验来源

#### Scenario: 带 manifest 路径不变
- **WHEN** 对含 `manifest.json` 的 `.mdpkg` 执行 `mdpkg render`
- **THEN** 走既有「校验 manifest → 渲染」路径，不出现降级标注

### Requirement: 入口推断规则
无 manifest 输入时，entrypoint MUST 按以下优先级确定：`document.md` > `README.md` > `README.zh-CN.md` > 其余 `.md` 文件按 UTF-8 码位字典序取第一个。候选 MUST 排除以 `.` 开头的隐藏路径。入口 MUST 为 Markdown 文件（`.md` 后缀）。输入中不存在任何 Markdown 文件时，MUST 报 `MDPKG-E303` 拒绝打开，不得以非 Markdown 文件充当入口。

#### Scenario: 默认入口优先
- **WHEN** 打开含 `document.md` 且同时含其他 `.md` 的裸 zip
- **THEN** 以 `document.md` 为入口渲染

#### Scenario: 无默认名取字典序第一个
- **WHEN** 打开仅含 `chapter2.md` 与 `chapter1.md` 的裸 zip
- **THEN** 以 `chapter1.md` 为入口渲染

#### Scenario: 无 Markdown 文件报错
- **WHEN** 打开不含任何 `.md` 文件的裸 zip
- **THEN** 报 `MDPKG-E303` 拒绝打开

### Requirement: 未校验来源标注
推断模式（无 manifest）的结果 MUST 标注「未校验来源（缺少 manifest.json）」，且 MUST NOT 使用「已验证 / 可信 / 完整」等表述（与 pipeline 完整性校验边界一致）。CLI MUST 在 stderr 打印该提示；浏览器 API MUST 在返回结构中用显式字段呈现（值可为真）。

#### Scenario: CLI 打开裸 zip 打印提示
- **WHEN** 对无 manifest 的 zip 执行 `mdpkg render`
- **THEN** stderr 输出含「未校验来源」的提示文案

#### Scenario: API 返回降级字段
- **WHEN** `openMdpkg` 打开无 manifest 的 zip
- **THEN** 返回结果中降级来源标注字段为真

### Requirement: validate 严格性保持
`validate` 命令对缺少 `manifest.json` 的包 MUST 保持报错（`MDPKG-E102`），不得因宽容打开能力而放宽。宽容打开仅适用于 open/render/export 输入路径。

#### Scenario: validate 裸 zip 仍拒绝
- **WHEN** 对无 manifest 的 zip 执行 `mdpkg validate`
- **THEN** 报 `MDPKG-E102` 且退出码为 1