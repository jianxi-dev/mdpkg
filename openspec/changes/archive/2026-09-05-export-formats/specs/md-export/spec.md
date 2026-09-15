## ADDED Requirements

### Requirement: md 导出命令形态
`mdpkg export --md <pkg> -o out.md` MUST 将包内**入口文档**导出为单个 `.md` 文件，内容为**展开后**的 Markdown（include 已内联、相对路径已按包根重写，与 `export --expanded` 语义一致）；符号保持源文本（不转换——导出的是 Markdown 源，符号转换是渲染期行为）。`--md` 与 `--raw` / `--expanded` / `--zip` 互斥（冲突报用法错误，退出码 2）。`-o` 缺省按包名替换 `.md`（无 `.mdpkg` 后缀时追加 `.md`，不覆盖输入）。

#### Scenario: 基本 md 导出
- **WHEN** 执行 `mdpkg export --md demo.mdpkg -o out.md`
- **THEN** 生成 `out.md`：入口文档展开后文本（`<<<` 不残留、被包含文件引用已重写），符号为源文本

#### Scenario: 与其它导出模式互斥
- **WHEN** 执行 `mdpkg export --md demo.mdpkg --zip -o out.md`
- **THEN** 报用法错误（退出码 2）且不产生输出

### Requirement: md 导出库 API
`mdpkg-web` MUST 导出 `toMarkdown(files: Map<string, Uint8Array>, opts?): string`——返回展开后的入口文档 Markdown 文本（与 CLI `export --md` 同源语义）。无 manifest 时按 lenient 规则推断入口；无 .md 抛 E303（与 openMdpkg 错误语义一致）。

#### Scenario: toMarkdown 展开语义
- **WHEN** 调用 `toMarkdown(files)`（files 含 `document.md` 与 `<<< includes/c.md` 及 `includes/c.md`）
- **THEN** 返回文本含展开内容、无 `<<<` 残留、被包含文件引用已按包根重写

### Requirement: html 导出库 API
`mdpkg-web` MUST 导出 `toHtml(files: Map<string, Uint8Array>, opts?): string`——返回自包含单文件 HTML（`<!doctype html>` + 内联样式 + 资源 data URI 内联），与 `openMdpkg().html` 同源（同一 render + wrapDocument 管线）。供浏览器端下载。

#### Scenario: toHtml 自包含
- **WHEN** 调用 `toHtml(files)`（含图片资源）
- **THEN** 返回完整 HTML 文档，图片以 `data:image/...;base64,` 内联，可直接保存为 .html 打开

### Requirement: demo 导出 UI
demo.html 打开包后 MUST 显示导出栏，含四按钮「导出 .md / .mdpkg / .html / .zip」与「打印 / 另存为 PDF」（`window.print()`）。点击导出按钮 MUST 下载对应格式文件（文件名 = 入口 basename 替换扩展名）；导出失败 MUST 复用错误提示（不崩溃）。单 md 直开与 lenient zip 场景导出均可用。

#### Scenario: 四格式导出
- **WHEN** 打开包后点击「导出 .md / .mdpkg / .html / .zip」
- **THEN** 分别下载 `入口名.md` / `.mdpkg` / `.html` / `.zip`，内容与对应库 API 一致

#### Scenario: 打印兜底
- **WHEN** 点击「打印 / 另存为 PDF」
- **THEN** 触发浏览器打印对话框（用户可另存为 PDF），零依赖