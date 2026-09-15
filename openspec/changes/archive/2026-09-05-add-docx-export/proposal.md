# Proposal: docx 导出功能（归属 mdpkg 标准包）

## Why

用户与消费端（CLI 用户、md-bundle 网页工具、clairis 桌面端）都需要将 `.mdpkg` 包导出为 docx 格式文档，但未明确该能力归属。若在 md-bundle 中实现，会导致同一转换逻辑在三个仓库重复开发、且无法复用 mdpkg 已有的渲染管线与跨端 zip-core。

**导出矩阵现状（md-bundle 已有导出：md / mdpkg / html / 长图）**：该矩阵分两层——`md`、`mdpkg`、`html` 属**格式转换层**（纯数据 → 数据转换，可跨端共享），`长图` 属**产品封装层**（浏览器截图渲染，md-bundle 独有，mdpkg 核心无法提供）。docx 与 zip 均属格式转换层，与长图不同，无浏览器 DOM 依赖。

**决策：docx 与 zip 导出均在 mdpkg 标准包（参考实现）中实现，md-bundle 作为消费端复用，不自行实现。** 依据：

1. **单一实现源**：三个消费端（md-bundle / clairis / CLI）都需要导出能力；放在 mdpkg 一处实现，消费端通过既有 `mdpkg-web` 浏览器 API 模式与 CLI 复用，避免三份重复转换代码。md-bundle 现有矩阵中的 md/mdpkg/html 同样应遵从调用共享核心的原则（长图除外）。
2. **管线复用**：渲染管线（解包 → 校验 → include 展开 → 解析 → 符号转换）已就绪，docx 只是新增一个输出目标（替换 rehype→HTML 为 Markdown AST → OOXML）。若放 md-bundle，需在另一仓库重建整条管线或跨仓库暴露中间产物，接口膨胀且语义易漂移。
3. **zip-core 跨端已就绪**：docx 本质是 ZIP + OOXML 容器；mdpkg 的 `zip-core` 已同时支持 Node 与浏览器，容器层零新依赖。
4. **职责边界**：md-bundle 的定位是产品组装层（解包 → 编辑 → 重打包闭环），格式转换引擎属于 mdpkg 参考实现的职责范围（与 `render` HTML、符号转换同理）。

## What Changes

- 新增 docx 导出能力：`mdpkg render --format docx`（或等价命令形态），将 `.mdpkg` 包渲染为 `.docx` 文档。
- 新增 zip 导出能力：`mdpkg export --zip`，将展开后的包（Markdown + 全部资源 + README 说明）打包为单文件标准 `.zip`，交付给无 mdpkg 工具的收件人。**定位 P2**：实现成本极低（复用 `export --expanded` 产物集 + zip-core），与 docx 同批实施。
- 复用现有渲染管线输入侧：解包、校验、include 展开、符号转换在 docx / zip 路径下保持与 HTML 路径一致的行为。
- 新增跨端导出模块（Node CLI 与浏览器共用），基于 mdpkg 既有跨端核心模式（如 `zip-core`、`mdpkg-web`）。
- 修改 `pipeline` 能力：`命令契约` 增加 docx 与 zip 导出命令；`render 输出形态` 增加 `--format docx` 输出目标及其行为。
- `.mdpkg` 容器格式规范不变（docx / zip 是导出格式，不属于容器格式；格式规范 `spec/mdpkg-format-spec.md` 不改）。
- md-bundle 仓库不在本变更实现范围内（后续单独集成，调用本仓库导出 API）。

## Capabilities

### New Capabilities
- `docx-export`: docx 格式导出——将 `.mdpkg` 包（含 include 展开、符号转换后的 Markdown 与资源）转换输出为 OOXML `.docx` 文档的能力，含命令行入口与跨端转换 API。
- `zip-export`: zip 交付物导出——将展开后的 `.mdpkg` 包内容（Markdown + 全部资源 + README 说明）打包为单文件标准 `.zip` 的能力，供无 mdpkg 工具的用户直接解压使用。

### Modified Capabilities
- `pipeline`: `命令契约` 新增 docx 与 zip 导出命令契约；`render 输出形态` 扩展为支持 `--format docx` 输出目标（含资源（图片）打包进 docx 的行为、默认值、与 HTML 路径的异同）。

## Impact

- **代码**：`packages/mdpkg/src/` 新增 docx 转换模块（`docx.ts`）与 zip 导出模块（复用 expanded 产物组装，并入 `export` 分支）；`cli.ts` 增加命令分支；`render.ts` 输出目标抽象化（若需要）；`zip-core.ts` 复用不修改；`web/mdpkg-web.ts` 增加 docx 与 zip 导出 API（供 md-bundle 消费）。
- **API**：CLI 新增 `render --format docx` 与 `export --zip`；`mdpkg-web` 暴露 `toDocx` / `toZip` 函数（供 md-bundle 导出菜单消费）。
- **依赖**：docx 生成自研最小 OOXML 写入器（零新依赖，见 design D2）；zip 导出零新依赖。禁止引入破坏 Node 22 内置类型剥离约束的依赖。
- **测试**：docx 往返验证（导出的 docx 可被标准工具打开、内容与源包一致）、zip 解压验证（unzip 可解、无 manifest）、跨端核验、与既有 136 用例不冲突。
- **文档**：`AGENTS.md` 命令表、`packages/mdpkg/docs/` 集成指南补充 docx 与 zip 能力。