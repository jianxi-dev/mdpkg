# Changelog

## [0.2.0.0] - 2026-09-05

### Added

- **docx 导出**：`render --format docx` / 浏览器 `toDocx`——自研最小 OOXML 写入器，位图资源嵌入 `word/media/`，SVG 降级为 alt 文本 + 警告；可被 Word / LibreOffice / WPS / Pages 直接打开。
- **zip 交付物导出**：`export --zip` / 浏览器 `toZip`——展开后 Markdown + 全部资源 + README 的标准 zip（无 manifest，交付给普通用户）。
- **md 导出**：`export --md` / 浏览器 `toMarkdown`——展开后入口文档单文件（include 内联、路径重写、符号保持源文本）。
- **html 导出 API**：浏览器 `toHtml`——自包含单文件 HTML（与 `openMdpkg().html` 同源）。
- **文件夹/多条目直开**：浏览器拖入文件夹（含同级附件，图片内联显示）或 md+附件多选；`openFiles` 统一 Map 渲染入口；`openMarkdown` 单 .md 直开。
- **相对引用解析**：`../assets/a.png` 与 `./` 引用按文档目录语义解析（含中文路径），渲染与校验（checkClosure）一致。
- **demo 导出栏**：打开包后四格式导出按钮（.md / .mdpkg / .html / .zip）+ 打印 / 另存为 PDF（`window.print()` 兜底）。

### Fixed

- **入口引用双重前缀**：入口文档引用不再按文档目录重复拼接（带顶层文件夹名的引用如 `ima笔记使用指南/attachment/1.gif` 可正确匹配）。
- **packMdpkg 入口推断**：lenient / 单 md 包重打包不再报 E303（回退 `inferEntrypoint`）。
- **中文路径 percent-encode**：渲染时解码非 ASCII 路径（remark-rehype 编码还原）。

## [0.1.1.0] - 2026-09-05

### Added

- **lenient-open：打开普通 ZIP 文档**——`render` / `export` / 浏览器 `openMdpkg` 接受无 `manifest.json` 的 zip（`.zip` 与 `.mdpkg` 同等对待）。入口按确定性规则推断：`document.md`（任意深度取最浅）> `README.md` > `README.zh-CN.md` > 根目录字典序首个 `.md`。
- **未校验来源标注**：宽容打开的包在 CLI stderr 提示、浏览器 API 返回 `unverified: true` 与 `entry`（实际采用入口）；`demo.html` 显示「未校验」徽标与推断入口提示。
- **5 个 lenient-open conformance fixtures**（入口推断、E303/E102 边界）。

### Fixed

- **unpack/list 静默截断根治**（数据完整性）：超过约 2108 条目的包此前会被 fflate 递归解析限制静默丢弃内容（issue #1）——改为按 local header 边界分块 push 后，任意条目数完整解包；E602（1 万条）/E604（1GB）限额保护恢复可达。
- **web 端标题与入口一致**：lenient 包不再显示错误的 `document.md` 标题，与推断入口对齐。
- `export --raw` 对无 Markdown 的裸 zip 保持可用（不因入口推断报错）。

### Changed

- 测试套件 108 → **136**（分块边界、lenient、限额回归）；浏览器 bundle 重建（分块 + lenient 更新进入 mdpkg-web）。

---

## [0.1.0.0] - 2026-09-05

### Added

- **mdpkg-web 浏览器打包库**：`openMdpkg`（读）/ `packMdpkg`（写，重打包）/ `readEntrySource` 全链路在浏览器可跑（含演示页 `demo.html`）。超大演示产物（imademo.*）已从仓库移除，可由 demo.html 重新生成。
- **zip-core 跨端核心层**：打包/解包/列表/路径规范化抽为浏览器与 Node 共用的零 Node 依赖模块（CLI 入口不变）。
- **编辑-重打包闭环**：`packMdpkg` 产出与 CLI `pack` 逐字节一致、可重复构建；新增 repack 往返测试。
- **限额与边界测试**：单文件 200MB 上限（E603）、空包检测（E101）、toBase64 跨分块边界一致性。

### Changed

- 资源哈希从 `node:crypto` 切换为 `js-sha256`（浏览器可用，输出字节不变）。
- `container.ts` 瘦身为 zip-core 的 re-export 层，既有 `import` 路径不受影响。
- 符号扩展、页面工具目录（.codex/.gemini/.opencode 等）与 QA 报告目录加入 `.gitignore`。

### Fixed

- **pack 拒绝非 Markdown 入口**（E303）：不再产出 validate 会拒绝的包（对齐 validate 语义）。
- **web 重打包与渲染统一入口守卫**：`packMdpkg` 与 `render` 与 CLI 同规则拒绝非 Markdown/缺失入口。
- **非法百分号转义不再崩溃**：`[下载](100%.pdf)` 类链接按字面引用处理，pack 不再以「内部错误」退出。
- **损坏 manifest 报 E302**：CLI render 路径对非法 JSON 给出规范错误码，而非裸 SyntaxError。

### Removed

- `node:crypto` 在 sha256 层的依赖（由 js-sha256 替代）。

---

**已知缺口**（见 issue #1）：`unpack` 对超过约 2100 条目的包存在 fflate 解析截断（静默丢内容），E602/E604 限额保护暂不可达；修复计划已登记。