# Tasks: export-formats（导出格式矩阵 md/mdpkg/html/zip）

## 1. md 导出核心（toMarkdown）

- [x] 1.1 `src/` 新增 `toMarkdown(files: Map<string, Uint8Array>, opts?): string`（可放 render.ts 或新 `markdown-export.ts`）：入口解析（manifest.entrypoint 优先否则 inferEntrypoint，无 .md 抛 E303）→ `expand(files, entry).text`（展开后文本，include 内联 + 路径重写）→ 返回；符号保持源文本（不转换）；中文注释
- [x] 1.2 `web/mdpkg-web.ts` 导出 `toMarkdown`（re-export src 层函数）
- [x] 1.3 `web/mdpkg-web.ts` 新增 `toHtml(files, opts?): string`：复用 renderMap + wrapDocument（与 openMdpkg().html 同源）；入口推断同 openFiles；导出
- [x] 1.4 `npm run build:web` 通过，bundle 含 toMarkdown/toHtml

## 2. CLI export --md

- [x] 2.1 `cli.ts` `export` 分支增加 `--md`：parseArgs 加 `md: { type: 'boolean' }`；与 `--raw/--expanded/--zip` 互斥（`in` 判定，冲突 die 用法错误退出码 2）；`-o` 缺省 `defaultOutName(pkg, '.md')`（复用既有 helper）
- [x] 2.2 实现：unpack → 入口解析 → expand 展开文本 → 写文件 + stdout（复用 src 层 toMarkdown 或等价展开逻辑；CLI 不依赖 web 模块）
- [x] 2.3 负例：`export --md --zip` 互斥退出码 2；缺省输出名（demo.mdpkg → demo.md；无后缀追加不覆盖）

## 3. demo 导出 UI

- [x] 3.1 `demo.html` panel 内新增导出栏：四按钮「导出 .md / .mdpkg / .html / .zip」+「打印 / 另存为 PDF」（window.print）；样式与既有卡片/按钮风格一致（中文文案）
- [x] 3.2 handler：闭包捕获当前 `r.files`/`r.entry`；.md → `toMarkdown(r.files)`（Blob text/markdown）；.mdpkg → `packMdpkg(r.files, r.manifest ?? undefined)`；.html → `toHtml(r.files)`（text/html）；.zip → `toZip(r.files)`；文件名 = 入口 basename 替换扩展名；`URL.createObjectURL` + `<a download>` + `revokeObjectURL`
- [x] 3.3 导出失败 → 复用 showError（不崩溃）；下载成功状态提示；单 md 直开与 lenient zip 场景导出可用

## 4. 测试

- [x] 4.1 `test/markdown-export.test.ts`（或并入既有）：toMarkdown 展开语义（include 内联、无 `<<<` 残留、路径重写）、符号保持源文本（`(tm)` 不转 ™）、无 .md 抛 E303、lenient 推断入口
- [x] 4.2 toHtml 测试：与 `openMdpkg().html` 一致（同输入对比）、图片 data URI 内联、`<!doctype html>` 开头
- [x] 4.3 CLI `export --md` 测试：单文件产出（内容 = 展开后文本）、互斥负例（--md --zip 退出码 2）、缺省输出名、无后缀追加不覆盖
- [x] 4.4 全量回归：`npm test`（201 基线 + 新增）0 fail；`npm run build:web` 通过

## 5. 文档与收尾

- [x] 5.1 `AGENTS.md` 命令表补 `export --md`；`md-bundle-integration.md` 导出节补 toMarkdown/toHtml
- [x] 5.2 Playwright 端到端：demo 打开包 → 四按钮导出下载（文件名/内容抽查）+ 打印按钮存在；console 干净
- [x] 5.3 spec 归档确认：md-export/html-export 能力与实现逐条对齐