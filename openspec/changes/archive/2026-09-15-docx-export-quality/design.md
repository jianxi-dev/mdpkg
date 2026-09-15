# DESIGN — docx-export-quality

## Context

- 能力归属：DOCX 导出是 mdpkg 的 `docx-export` 能力（`mdpkg render <pkg> --format docx` + 浏览器端 `toDocx` 供 md-bundle 消费）。此前该质量计划误挂在 md-bundle 侧（针对其自研 `exportDocx.ts` 的缺陷清单），按能力归属迁至本仓库——本 design 是迁移后的 mdpkg 侧设计。
- 现状实现 `packages/mdpkg/src/docx.ts`（481 行）——OOXML 手写序列化，零 Node 专属 API（跨端约束同 `zip-core`）：解包 → 校验 → include 展开 → `<<<` 降级 → 符号转换 → remark 解析（remarkGfm）→ AST → XML 序列化 → `packRaw` 出 ZIP。已具备：标题 1–6 样式、嵌套列表 8 级（numbering.xml 物化）、位图嵌入（PNG/JPEG/GIF/WebP，`word/media/` + relationship）、行内图片（`<wp:inline>`）、粗体/斜体/删除线/行内码/外链 `<w:hyperlink>`、空文档合法输出、SVG/缺失资源 alt 占位 + `ctx.warnings` → `onWarning` 回调。
- 差距矩阵（逐项对照 `docx.ts` 代码）：
  | 项 | 现状 | 差距 |
  |---|---|---|
  | 数学 `$...$` | 无处理，原样透传含 `$` | 需提取与降级 |
  | callout `> [!TYPE]` | 无处理（按 blockquote） | 需识别与块呈现 |
  | 任务列表 | 文本前缀 `[x]`/`[ ]`（docx.ts:225-226） | 需复选框字形 |
  | 图片尺寸 | 固定 6"×4.5"（DEFAULT_IMAGE_WIDTH_EMU×0.75） | 需固有尺寸解析 + 等比 |
  | 代码块语言 | `node.lang` 不读 | 需语言标注 |
  | 表格表头 | `ri===0` 灰底（F2F2F2）+ tblLook firstRow | 需显式加粗 |
  | 表格列宽 | 均分 `9000/colCount`（docx.ts:287） | 内容启发式（可选项） |
  | 错误契约 | `toDocx` 结构错误 throw `MdeError` | 保持（跨端一致），消费侧包装归 md-bundle |
- 约束：零新增依赖优先；跨端（Node CLI + 浏览器）不得引入 Node 专属 API（无 `Buffer`，用 `Uint8Array` 视图）；remarkGfm 已解析 `listItem.checked`、`code.lang`、GFM table；`Markdown 渲染管线语义`（validate 不阻断、缺失资源不报错）保持。

## Goals / Non-Goals

**Goals:**
- 消除差距矩阵全部条目：数学可读降级、callout 块、任务复选框字形、固有尺寸等比、代码语言标注、表头显式加粗、列宽内容启发式。
- 保持无 BREAKING：CLI 形态、`toDocx` 签名、`MdeError`/`onWarning` 契约、SVG/缺失资源降级行为均不变。
- 每个改动在 `test/docx.test.ts` 有对应场景（素材直接对齐能力域 spec 场景）；浏览器面 `web-export.test.ts` 同步覆盖。

**Non-Goals:**
- OMML 数学对象（Word 原生可编辑公式）——v1 降级纯文本，OMML 为后续版本。
- mermaid 渲染为图形——保持代码块 + 语言标注降级（与 HTML 路径一致）。
- HTML 渲染路径（`render.ts`）的任何行为变更——本变更仅 docx 路径。
- callout 能力自研插件/新语法——只识别 GFM alert（`> [!TYPE]`），键集快照对齐 md-bundle/clairis 既有 `calloutTypeMap`。
- Node CLI 的表格列宽交互选项、图片尺寸 CLI 参数——保持 `imageWidthEmu`/`imageHeightEmu` 现有 opts 语义。

## Decisions

### D1 数学降级：AST 前处理 pass（文本切分），输出纯文本
在 remark 解析后、序列化前的 AST pass 中，遍历 inline 文本与段落：按 `$$...$$` / `$...$` 切分文本节点，数学片段转为专用节点（`{ type: 'math', value }`），序列化时输出无 `$` 的纯文本 run（行内数学随段落流，块级数学单独成段，对齐保留）。理由：remark-math 插件只做 AST 标记仍需自行转文本，且新增依赖；自实现正则切分在统一链内零依赖、边界可控（表格/代码块内不提取——代码块与表格内容不走该 pass）。
- 备选（否决）：输出 LaTeX 源文本前加 `[公式]` 标签 —— 纯文本即可，不加前导语。

### D2 callout：blockquote 首行识别 + 键集快照
AST 层识别：`blockquote` 首个子文本节点匹配 `^\[!([A-Za-z]+)\]` → 转 callout 节点（类型标签归一化大写），其余子节点为内容。序列化：段落组 = 标签 run（灰底 + 加粗，如 `TIP`）+ 内容段落 + 左边条（`pBdr left` single 粗 3）+ 浅色底纹（`shd`，按类型色系：info 蓝 / success 绿 / warn 琥珀 / danger 红 / 其余中性——仅 4 色系归一，不做 22 键全量配色）。未知键 → 保持 blockquote 原样（降级，不报错）。键集快照对齐 md-bundle 的 `calloutTypeMap`（文档级注释说明快照来源与更新方式）。
- 备选（否决）：22 键全量配色表 —— 文档级 docx 呈现只需 4 色系归一，避免维护面扩散。

### D3 任务复选框：读 `listItem.checked`，☐/☑ 字形 run
remarkGfm 已解析 checkbox（`listItem.checked` 布尔）。序列化层：`checked !== undefined` 时，首 run 前插字形 run `☐`（U+2610）/ `☑`（U+2611）+ 空格（几何字符，SimSun/Calibri 通用，无需 Wingdings 映射），删除现有文本前缀逻辑（docx.ts:225-226）。
- 备选（否决）：OOXML 表单域（`<w:fldSimple>` 或内容控件）——LibreOffice/WPS 兼容性差且复杂度高，v1 不引入。

### D4 图片固有尺寸：新工具 `image-size.ts` + EMU 等比换算
新模块 `packages/mdpkg/src/image-size.ts`（纯字节解析，跨端零 Node API）：
- PNG：IHDR 宽高（偏移 16-23）。
- JPEG：SOF0/1/2 段扫描（0xFFC0-C3，精确到标记段）。
- GIF：逻辑屏幕描述符（偏移 6-9）。
- WebP：VP8X / VP8L / VP8 头读取（含 canvas 尺寸字段）。
- 解析失败 / 未知格式 → `null`。
嵌入换算：`w = min(imageWidthEmu, intrinsicWpx * 9525)`（9525 EMU/px，96dpi）；`h = w * ih/iw`；显式提供 `imageHeightEmu` 时覆盖为显式值（保持现 opts 语义）；`null` → 缺省 6"×4.5" + `ctx.warnings`（新警告条目，复用 `onWarning` 通道）。
- 备选（否决）：canvas/Image 解码获取尺寸 —— 浏览器面可行但 Node 面无解码器，破坏同源语义；字节头解析两侧一致。

### D5 代码块语言标注
序列化层读 `node.lang`：代码块首行（`<w:p>`）run 序列前插标注 run（`[lang] `，灰字、9pt、非 monospace 视觉区分，与代码 run 同段）；无 `lang` 或 `mermaid` 不插标注（mermaid 按普通代码块输出，与 HTML 路径降级一致）。保留 Consolas + F6F8FA 底纹。

### D6 表头显式加粗 + 列宽内容启发式
- 表头：`tableToXml` `ri===0` 分支，单元格内段落 run 序列整体加粗（`b:true`，不覆盖既有语义）；灰底 F2F2F2 保留。
- 列宽：改造 `colW = Math.floor(9000/colCount)` 为内容宽度启发式：每列 = max(表头/行内文本展示宽度)（CJK 计 2、ASCII 计 1，`~120 DXA/单位` 估算），min 800 DXA（对齐 md-bundle 既有经验值），总宽超 9000 等比压缩。列为质量改进项；等分仍为兜底（全空列）。

### D7 错误契约：保持 `MdeError` 抛出模型（跨端一致）
不引入双错误模型：结构/清单错误继续 `MdeError`（CLI 已兜底 `die` + 明确退出码）；非致命问题继续 `onWarning`。md-bundle 消费侧包装转 `{error}` 是消费侧职责（spec「docx 跨端可用」已写死该约定），本仓库不做浏览器包装层。

### D8 测试：对齐 spec 场景，双面覆盖
`test/docx.test.ts` 每场景一用例（数学不残留 `$`、callout 块含标签 run、☑/☐ 字形、固有比例 EMU 换算、头解析失败回退警告、语言标注、表头 bold run、列宽启发式、空文档回归、SVG/缺失资源回归）；`image-size.ts` 独立单测（PNG/JPEG/GIF/WebP 真实头样本 + 截断/空字节 → null）；浏览器面 `web-export.test.ts` 补 toDocx 新特性冒烟。既有 225 测试保持全绿。

## Risks / Trade-offs

- [数学正则边界（`$` 在表格/代码块/转角括号内）] → D1 明确代码块与表格不走提取 pass；`\$` 转义与未闭合 `$` 按纯文本原样保留（不吞文本、不崩）。
- [callout 键集快照与 md-bundle/clairis 漂移] → 快照值 + 文档注释标注来源与更新时机；未知键降级 blockquote，漂移只影响视觉不破坏文档。
- [图片头解析边界（EXIF 旋转方向、GIF 多帧、JPEG 非 SOF 顺序）] → 仅解析标准头字段，任何异常回退 `null` → 缺省尺寸 + 警告，绝不写坏图。
- [AST 结构随 remark/unified 版本变化] → 新逻辑集中于序列化层与前置 pass，既有 225 测试为回归锚点；统一链解析不变。
- [列宽启发式对窄表头长内容的视觉溢出] → min 800 DXA + 9000 上限压缩兜底，Word 自动换行保障可读性。
- [零新增依赖约束下的数学纯文本观感] → 已知 trade-off：公式无排版（`a^2` 保持 ASCII），OMML 列入非目标与后续版本。

## Migration Plan

- 纯代码加性演进：`docx.ts` 内新增/改造序列化函数 + 新增 `image-size.ts`（+ 对应测试）；无数据迁移、无 CLI/API 形态变化；回滚 = git revert 对应提交。
- archive/sync 时以本 change 的 delta 更新 `openspec/specs/docx-export/spec.md`（「docx 内容保真」「docx 资源嵌入」「docx 跨端可用」的需求与场景）。
- md-bundle 引入（后续独立 change）：vendor mdpkg-web 升级暴露 `toDocx` → 删除其自研 `exportDocx.ts` → 调用点 `MdeError` 包装为 {error} → 菜单接线。本仓库不承担该侧工作。

## Open Questions

1. 表头列宽启发式系数（120 DXA/单位）是否入 spec —— 默认仅实现细节，spec 只承诺「按内容宽度启发式」。
2. `imageHeightEmu` 显式覆盖语义是否保留 —— 默认保留（现 opts 契约，兼容既有调用方）。
3. callout 4 色系（info/success/warn/danger + 中性）是否够 —— 默认够；22 键快照仅用于标签归一，视觉归一按 4 色系。