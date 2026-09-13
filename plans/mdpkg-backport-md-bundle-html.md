# mdpkg 反哺移植：md-bundle 导出 HTML 优化（规划）

## Context

md-bundle（`/Users/mason/ToHighs/md-bundle` @ `d23dc4b`）在「Markdown → HTML 渲染 / 导出」上已积累 46 个优化点（`packages/renderer/` 同步管线 + `apps/web/src/lib/exportHtml.ts` 导出层），其中两个关键提交：`5016a94`（公式水合竞态消除 + 预览可见性性能）、`5327e35`（导入导出补全 + ESC 全屏）。

mdpkg 现状（`packages/mdpkg/src/render.ts`，148 行）：unified/remark/rehype **同步管线**（符号转换 → 消毒 → 资源内联）+ `wrapDocument` 最小单主题文档壳。能力空白：**零公式、零代码高亮、零 frontmatter 处理、单主题**。全量测试 225 用例，渲染断言面在 `render.test.ts`（18 用例）+ conformance fixtures（`htmlContains` / `htmlNotContains`）。

本规划回答三件事：**哪些优化值得反哺、浏览器侧的「懒优化」如何在 Node 环境等价改写、分几个 PR 落地与验收**。立场依据：探索任务全量清单（详见附录 A）。本规划不实施代码——优化实施将按 §三 拆分单独开 PR。

---

## 一、渲染架构对比（差异决定改写方式）

| 维度 | md-bundle | mdpkg | 差异含义 |
|---|---|---|---|
| 解析器 | marked（同步，`async:false`）| unified/remark/rehype（`processSync`）| 同为同步核心，但增强层不同：md-bundle 在**浏览器 DOM** 侧做「懒」，mdpkg 应在 **AST/字符串** 侧做「一次同步做完」 |
| 消毒 | DOMPurify（DOM）| rehype-sanitize（AST 级）| mdpkg 无 DOM → **不可**照搬 DOMPurify 白名单（含 `style` 允许），必须保持 sanitize 剥离 style |
| 公式 | 懒水合：`data-math-tex` 占位符 + 动态 import KaTeX | 无 | CLI 同步渲染**无竞态**，正确形态是服务端 `rehype-katex` 一次渲染 + 字体内联 |
| 代码高亮 | 动态 import + LRU + 20k 守卫 | 无 | CLI 单次渲染无 LRU 价值；20k 守卫阈值可直接复用 |
| 文档壳 | `buildHtmlDocument`：双主题 1322 行 CSS + token 覆盖 + KaTeX 条件注入 | `wrapDocument`：单主题 138 行 | 双主题结构可移植（纯 CSS）；1322 行全量搬移不现实 |
| 图片内联 | 正则字符串级：data: 保留 → 绝对 URL **移除** → 相对路径三级匹配 | AST 级 `assetsPlugin`：外链保留 + `referrerpolicy`、包内精确/D7 相对解析 | 决策矩阵有**立场冲突**（见 §2.4） |

**核心改写原则**：md-bundle 在浏览器侧「懒加载/延迟/水合」做的事，mdpkg 全部在 Node 同步管线内一次完成；md-bundle 的 DOM 遍历（TreeWalker）改在 remark AST 的 `text` 节点上做（与既有 `symbolsPlugin` 同位置，天然跳过 code/inlineCode/属性）。

---

## 二、优化点全景与移植判定

### 2.1 P0 必移植（反哺核心，按推荐执行顺序）

| # | 优化点 | md-bundle 来源 | 环境等价改写 | 理由 |
|---|---|---|---|---|
| A1 | **YAML frontmatter 剥离** | `renderer/src/markdown.ts` L179/L383（`^\uFEFF?---\s*\n...\n---`，容忍 BOM）| include 展开后、解析前做字符串预处理，非贪婪匹配首个 `---` 到下一 `---` | 纯正确性修复：mdpkg 目前无 frontmatter 处理，`---` 会被 remark 渲染成 `<hr>` + YAML 正文，输出糟糕；零依赖 |
| A2 | **CJK 间距插入 + 20 万字符守卫** | `markdown.ts` L261-302/L334-337（TreeWalker 插零宽 `<span class="cjk-pad">`，`textContent >= 200_000` 跳过，跳过 pre/code/.katex）| 改为 remark AST `visit` text 节点（与 `symbolsPlugin` 同位置）：中英文/中文数字之间插 `\u200B`；累计 text 长度 ≥ 200_000 后整段跳过；天然不进入 code/inlineCode | 中文排版质量 + 大文档性能保护，纯逻辑零依赖，直接命中中文用户场景；AST 级改写天然规避 md-bundle 需手动排除的 pre/code |
| A3 | **KaTeX 公式支持（同步渲染 + 条件注入 + Node fs 字体内联）** | `katexFonts.ts` L11-47/L67-95（hasKatex 双信号检测；`createRequire`+`readFileSync` 读字体——该路径在 md-bundle 中就是给 Node/vitest 用的；结果缓存）| 管线加 `remark-math` + `rehype-katex`；`hasKatex`（`class="katex"` / `data-math-tex` 信号）命中才向 `wrapDocument` 注入 KaTeX CSS + 字体；模块级缓存 | 补全公式能力；md-bundle 已验证 Node fs 字体内联路径，纯逻辑可复用。**代价：新增 3 个依赖**（§五） |
| A4 | **图片内联口径核对与补齐** | `exportHtml.ts` L27-40 + `assets.ts` L88-96（剥 `./` → 精确匹配 → basename 匹配；绝对 URL 返回 null）| 核对 `assetsPlugin` 的 `decodeURIComponent` + `resolveRef` 路径已覆盖 md-bundle 的「剥 `./` + 精确匹配」口径；**不新增 basename 兜底**（包内路径语义优于扁平资产兜底，同名文件歧义风险）；绝对 URL 决策不变（见 §2.4）| 修正边界错配，零依赖；结论偏向「已有实现更强，仅核对 + 补测试」，代码改动极小 |

### 2.2 P1 建议移植（后续 PR，本次不承诺）

| 优化点 | md-bundle 来源 | 改写方式 | 理由 |
|---|---|---|---|
| 双主题 CSS | `readerCss.ts` L22-1313 + `exportHtml.ts` L89-112 | `wrapDocument` 升级为 `prefers-color-scheme` 双块（纯 CSS、零 JS、零 XSS 面）；复用现有 138 行 CSS 做 token 化双主题，不搬 1322 行 | 单文件 HTML 暗色模式，导出物体验升级；与 mdpkg 自包含定位吻合 |
| 代码高亮 20k 字符守卫（常数对齐） | `highlight.ts` L82（`MAX_HIGHLIGHT_CHARS = 20_000`）| 将来加高亮时直接复用该阈值 | 防超长代码块卡死；LRU/动态 import 在 CLI 单次渲染无价值，不移植 |
| 单图上限并入降级决策 | `assets.ts` L13（`MAX_ASSET_BYTES = 15MB`）| 可选：单图内联体积阈值并入 50MB 总量降级的细粒度决策 | 现有总量降级已覆盖主要风险；并入会改变降级语义，需独立评审 |

### 2.3 P2 留给 mdpkg-web 浏览器库（本次不做）

| 优化点 | 来源 | 说明 |
|---|---|---|
| 公式占位符水合模式（竞态消除） | `math.ts` L14-46 + `lazy.ts` L64-101（5016a94 核心）| CLI 同步渲染无竞态；mdpkg-web 的 `toHtml` 若将来支持客户端更新，借鉴「DOM 内嵌占位符替代全局 store」的教训 |
| 懒加载 / 可见性门控 / useMemo | `lazy.ts` L18-62 + `PreviewView.tsx` L56-96 | CLI 无「可见性」概念；web 库若做编辑器内预览才有意义 |

### 2.4 不移植（立场冲突 / 浏览器专属，记录原因防误回）

| 优化点 | 不移植原因 |
|---|---|
| 绝对 URL 外链**移除**（`exportHtml.ts` L27-31）| **立场冲突**：mdpkg 立场是外链保留（`validate` 计数外链、`assetsPlugin` 补 `referrerpolicy="no-referrer"` 防泄露）。md-bundle 移除是为「排版不裂图」，两者意图不同，保留 mdpkg 现状并补测试固化 |
| DOMPurify 白名单允许 `style` 属性 | mdpkg 无 DOM，无法用 `contain: layout` 约束 `position:fixed` 逃逸；放开 style 会引入 XSS 面，保持 sanitize 默认剥离 |
| byline / share-card 品牌注入 | 与 mdpkg 中立定位冲突：导出物不应带第三方品牌 |
| 主题三态 + localStorage + watchSystemTheme | 浏览器专属交互；mdpkg 暗色正确形态是纯 CSS `prefers-color-scheme`（§2.2）|
| Block HTML 深度配对 tokenizer（`markdown.ts` L19-125）| marked 的缺陷补偿；remark 官方解析无「吞到空行」双关问题，mdpkg 无此 bug |
| Callout 22-key 映射（`markdown.ts` L181-259）| 规范未承诺该渲染语义，注入会扩大渲染面，需规范先行 |
| 可见性门控水合 / ESC 全屏 / 下载注入 / PNG 导出（`exportPng.ts` 等）| 浏览器 app UI 层专属；PNG/PDF 已定用浏览器打印兜底，不做导出能力 |
| 严格 base64 解码校验（`dataUrl.ts`）| mdpkg `toBase64` 是编码方向，自产 data URI 必然合法；该点针对外部输入，收益低 |

---

## 三、PR 拆分与实施顺序

### PR-A「渲染正确性 + 中文排版」（零依赖，改动最小，先行）

**改动点**（均在 `src/render.ts` + 测试）：
1. **frontmatter 剥离**：`expand` 之后、`guardEscapes`/解析之前，对展开后文本做 `^\uFEFF?---\s*\n([\s\S]*?)\n---(?:\n|$)` 非贪婪剥离；文档中部 `---` 不受影响。
2. **CJK 间距插件**：AST `visit` text 节点（`symbolsPlugin` 同位置），中英文/中文数字间插 `\u200B`；累计 text 长度 ≥ 200_000 跳过；跳过 code/inlineCode 天然成立。`RenderOptions` 暴露 `cjkSpacing?: boolean`（默认开启，与 md-bundle 对齐）。
3. **assetsPlugin 核对**：补绝对 URL 保留 + `referrerpolicy` 的回归测试；核对 `./` 前缀与 `resolveRef` 现有覆盖，缺则补。

**验收标准**：
- 全量 `npm test`（225 + 新增）通过；**受影响的渲染断言同步更新**（预期：含中英混排文本的 `htmlContains` 断言需对齐零宽字符）；`npm run build:web` 通过。
- 新增测试：frontmatter 不渲染为 `<hr>`；代码块内不插零宽；200k+ 文本跳过插距；绝对 URL 保留且带 `referrerpolicy`。
- conformance fixtures（43 个）不新增、不改——frontmatter/CJK 属参考实现渲染扩展，非规范语义。

### PR-B「KaTeX 公式支持」（新增依赖）

**改动点**：
1. `package.json` 新增 `katex` / `remark-math` / `rehype-katex`。
2. `render.ts` 管线插入 `remark-math`（`remark-gfm` 后）+ `rehype-katex`（消毒前——`rehype-katex` 产出的 `<span class="katex">` 需过 sanitize，与既有「消毒先于内联」管线顺序一致）。
3. 新增 `katex-fonts.ts`：`hasKatex(html)` 双信号检测；`createRequire` 定位 katex 包内字体 + `readFileSync` 内联 CSS；模块级缓存（一次读取）。
4. `wrapDocument` 条件注入：命中公式才追加 `<style>`（KaTeX CSS + 字体 @font-face），**无公式文档零字节增量**。

**验收标准**：
- 公式渲染测试：行内 `$...$` / 块级 `$$...$$` 输出 `<span class="katex">`；无公式文档不注入 KaTeX 资源（字节断言）。
- 字体内联测试：产物 HTML 含 `@font-face` 且字体文件存在（Node fs 路径）。
- mdpkg-web `toHtml` 复用 render 管线自动获得公式能力；`web.test.ts`/`web-export.test.ts` 同步。
- 体积记录：KaTeX CSS ≈10KB + 全量字体 ≈100KB+，计入 `maxInlineBytes` 总量决策（>50MB 自动降级 `--dir` 的既有行为覆盖此开销，不单列规则）。

### PR-C「双主题 CSS」（可选，纯 CSS 零依赖）

**改动点**：`wrapDocument` 升级为 `prefers-color-scheme` 双块（`@media (prefers-color-scheme: dark)` 覆盖 token：底色/文字/边框/代码块/表格斑马纹）；不引入 JS、不引入 `[data-theme]` 切换（零 XSS 面优先）。

**验收标准**：CSS 双块存在；无 `<script>`；浏览器暗色模式下手动验证渲染正确。

---

## 四、验证

| 项 | PR-A | PR-B | PR-C |
|---|---|---|---|
| 单元测试新增 | frontmatter / CJK / 守卫 / 外链 | 公式渲染 / 条件注入 / 字体内联 | CSS 结构断言 |
| 既有测试影响 | **需同步更新渲染断言**（零宽字符进 HTML）| 符号/消毒断言需复核（math 与符号转义的交互：`$` 在 symbolsPlugin 词边界内？）| 无 |
| fixtures | 不动 | 不动（公式不进规范 fixtures）| 不动 |
| 全量回归 | `npm test` + `build:web` | 同左 | 同左 |
| 手工 | demo.html 中文混排目检 | demo.html 公式目检 | 暗色模式目检 |

**边界提醒**：PR-B 需确认 `rehype-katex` 的输出不被 `rehype-sanitize` 剥离（默认 schema 对 `span/class` 的 allowlist）；以及 `$...$` 与既有符号转义 `(tm)` 类规则的互不干扰。

---

## 五、风险与取舍

| 风险 | 评估 | 对策 |
|---|---|---|
| 新依赖（katex 家族 3 个）| katex 纯 JS 无重依赖；体积由条件注入控制 | 无公式文档零增量的硬约束写入 PR-B 验收；规范不承诺公式（参考实现扩展）|
| 零宽字符 `\u200B` 副作用 | 复制粘贴携带零宽字符；md-bundle 已接受该取舍 | 沿用；若未来不可接受，AST 级可切换为 `<span class="cjk-pad">` 方案（同位置另一实现）|
| CJK 默认开启破坏既有断言 | 确定性影响：含中文的渲染输出变化 | 默认开启 + 同步更新断言（PR-A 验收项）；`cjkSpacing: false` 逃生开关 |
| frontmatter 剥离边界 | 非贪婪匹配首个 `---`；与 include 展开顺序（剥离在展开后，被包含文件各自不以 `---` 开头视为普通文本——需测试确认）| PR-A 测试矩阵覆盖「文档中部 `---`」「被包含文件以 `---` 开头」两种边界 |
| 渲染语义扩展 vs 规范 | 公式/frontmatter/CJK 均不在 v1 规范承诺内 | 均作为参考实现渲染扩展，不写进 `spec/mdpkg-format-spec.md`；测试落在 `render.test.ts` 而非 fixtures |
| 未来误引入已否决项 | §2.4 立场记录 | 本清单作为 plans 留存，后续 PR 参考 |

---

## 附录 A：探索来源清单

- 仓库：`/Users/mason/ToHighs/md-bundle`（活跃主线，`fix` 分支 @ `d23dc4b`；`md-bundle-feat` 为同提交 worktree）
- 关键提交：`5016a94`（公式水合竞态消除 + 预览可见性性能）、`5327e35`（导出补全 + ESC 全屏）、`dfba92b`（渲染器与主题 token 基线）
- 关键文件（全量 46 点清单由 explore 任务产出，本规划引用其中 P0/P1 部分）：
  - `packages/renderer/src/markdown.ts`（387 行：frontmatter / CJK / 守卫 / Callout / URL 中和）
  - `packages/renderer/src/katexFonts.ts`、`apps/web/src/lib/exportHtml.ts`、`apps/web/src/lib/assets.ts`
  - `packages/renderer/src/highlight.ts`、`math.ts`、`lazy.ts`、`readerCss.ts`（1322 行双主题 CSS）