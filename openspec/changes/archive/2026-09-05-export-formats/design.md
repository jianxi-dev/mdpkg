# Design: 导出格式矩阵（md / mdpkg / html / zip）

## Context

导出格式定案：md / mdpkg / html / zip。现状：mdpkg（packMdpkg/pack）、zip（toZip/export --zip）、html（CLI render 已有，库层缺 toHtml API）已实现；**md 单文件导出是缺口**（CLI 只有目录导出 raw/expanded）；demo 无导出 UI。pdf 探讨结论：v1 不做（零依赖约束 + PDF 二进制自研成本高 + docx 已覆盖文档交付 + 浏览器打印兜底），demo 提供打印按钮。

约束：零新依赖；Node 22 内置类型剥离、erasable syntax、中文注释；测试底线 201 用例；demo 纯静态页（改动直接生效）；web bundle 经 build:web 重建。

## Goals / Non-Goals

**Goals:**
- 四格式导出能力齐备：md（新）/ mdpkg（有）/ html（库补 API）/ zip（有）
- demo 导出 UI：四按钮 + 打印兜底
- 库 API 与 CLI 同源语义（toMarkdown ↔ export --md；toHtml ↔ render html）

**Non-Goals:**
- 不做 pdf 导出能力（打印兜底替代；pdf 列为未来候选）
- 不做 md 导出时资源随行（单文件 md 语义；资源走 zip 导出）
- 不改 docx 导出（已有，不在本矩阵）

## Decisions

### D1: md 导出语义——展开后单文件，符号保持源文本
`toMarkdown` / `export --md` 输出**展开后**入口文档（include 内联、路径重写——复用 `expand` 的中间产物，与 `export --expanded` 同源），**符号不转换**（导出的是 Markdown 源，`(tm)` 保持 `(tm)`；符号转换是渲染期行为）。图片引用保留相对路径（`assets/a.png`），资源不随行。
**理由**：展开后自包含文本（可编辑、可重打包）；符号保持源文本符合「导出 = 源格式」语义（与 export --raw/--expanded 一致）。
**替代方案**：导出原文（include 未展开）→ 与 --raw 重复且不实用；导出符号转换后文本 → 破坏 Markdown 源语义（`→` 等符号在源里是文本）。

### D2: toHtml 复用既有管线，不新写
`toHtml(files, opts?)` = `render(files, { inline: true, symbols })` + `wrapDocument(title, html)`——与 `openMdpkg().html` 完全同源（openMdpkg 内部已用此组合）。实现：在 mdpkg-web.ts 抽 `renderMap` 已有（folder-drop-open 落地），`toHtml` 直接调 renderMap + wrapDocument，入口推断同 openFiles。
**理由**：零新逻辑；demo 下载的 html 与预览完全一致（所见即所得）。
**替代方案**：新写 HTML 生成（否决：重复管线）。

### D3: demo 导出 UI——panel 内导出栏 + Blob 下载
打开包后（showResult）在 panel 内显示导出栏：四按钮（.md / .mdpkg / .html / .zip）+ 打印按钮。handler 闭包捕获当前 `r.files` / `r.entry`：
- .md → `toMarkdown(r.files)` → Blob(text/markdown)
- .mdpkg → `packMdpkg(r.files, r.manifest ?? undefined)` → Blob(octet-stream)
- .html → `toHtml(r.files)` → Blob(text/html)
- .zip → `toZip(r.files)` → Blob(octet-stream)
- 打印 → `window.print()`
文件名 = `r.entry.split('/').pop()` 替换扩展名（doc.md → doc.md/doc.mdpkg/doc.html/doc.zip）。下载：`URL.createObjectURL` + `<a download>` + `revokeObjectURL`。导出失败 → 复用 showError。
**理由**：与库 API 一一对应；打印零依赖兜底 pdf。
**替代方案**：导出区独立于 panel（否决：与打开结果分离，体验割裂）。

### D4: CLI export --md 接入
`cli.ts` `export` 分支：`--md` 布尔选项；与 `--raw/--expanded/--zip` 互斥（`in` 判定同既有模式）；`-o` 缺省 `defaultOutName(pkg, '.md')`（复用既有 helper，无后缀追加不覆盖）；实现 = unpack → 入口解析 → expand 展开文本 → 写文件（复用 `export --expanded` 的展开逻辑或 `toMarkdown` 核心——倾向 CLI 直接调 src 层展开函数，避免 web 依赖）。
**理由**：CLI 与库同源语义；互斥/缺省名与既有 export 模式一致。

## Risks / Trade-offs

- [md 导出符号保持源文本 vs 用户期望转换后] → D1 明确「导出=源格式」语义；渲染预览仍显示转换后（预览与导出分离）
- [toHtml 与预览一致性依赖 renderMap 稳定] → 复用同一函数，天然一致；既有 201 测试锁定
- [demo 导出大包内存] → 与打开时同量级（files 已在内存）；zip/docx 导出沿用既有上限精神
- [打印兜底体验（浏览器差异）] → window.print 全浏览器支持；pdf 质量由浏览器决定（可接受）

## Migration Plan

1. `src/`：`toMarkdown` 核心（展开语义，可放 render.ts 或新 `markdown-export.ts`）
2. `web/mdpkg-web.ts`：导出 `toMarkdown` / `toHtml`（复用 renderMap）
3. `cli.ts`：`export --md` 分支（互斥 + 缺省名）
4. `demo.html`：导出栏（四按钮 + 打印）
5. 测试：toMarkdown/toHtml 单测 + CLI --md + demo 浏览器端到端
6. 文档：AGENTS.md / md-bundle-integration.md；回滚：各层独立，移除零风险

## Open Questions

- md 导出是否支持「导出全部 md 文件」（多文档包）？——v1 仅入口文档（单文件语义）；多文档走 zip 导出
- toMarkdown 是否提供 `{ raw?: boolean }`（原文 vs 展开）？——v1 仅展开（与 --expanded 对齐）；raw 语义由 export --raw 目录覆盖