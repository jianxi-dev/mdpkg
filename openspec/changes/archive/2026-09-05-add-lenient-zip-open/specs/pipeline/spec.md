# pipeline Specification (delta)

## MODIFIED Requirements

### Requirement: 渲染管线顺序
渲染管线顺序 MUST 固定：1 读取并解包 ZIP；2 校验 manifest（Schema + 资源 size/sha256）——若输入无 `manifest.json` 且命令为打开/渲染/导出路径（`render` / `export` / 浏览器 `openMdpkg`），则跳过校验并进入 lenient-open 推断模式（入口推断与未校验来源标注按 lenient-open 规则）；`validate` 路径对无 manifest 输入仍按既有规则拒绝（`MDPKG-E102`）；3 预处理 include 展开（循环/深度/大小限制 + 相对 URL 重写）；4 解析 Markdown → AST；5 符号转换（仅作用于 text 节点，词边界 + 转义）；6 渲染 AST → HTML（安全清理）；7 输出。

#### Scenario: 渲染按固定顺序执行
- **WHEN** 执行 `mdpkg render` 且输入含 manifest
- **THEN** 依次完成解包、manifest 校验、include 展开、解析、符号转换、HTML 渲染与输出

#### Scenario: 无 manifest 输入走推断模式
- **WHEN** 执行 `mdpkg render` 且输入不含 manifest.json
- **THEN** 跳过校验步骤、按 lenient-open 规则推断入口后完成后续渲染，输出标注未校验来源

#### Scenario: validate 对无 manifest 输入拒绝
- **WHEN** 执行 `mdpkg validate` 且输入不含 manifest.json
- **THEN** 报 `MDPKG-E102`，不进入推断模式