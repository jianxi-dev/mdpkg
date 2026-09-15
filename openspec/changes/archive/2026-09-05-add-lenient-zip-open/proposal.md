# 宽容打开无 manifest 的 zip 文档（add-lenient-zip-open）

## Why

外部工具（Obsidian 导出、AI 会话导出、课程资料打包等）普遍通过**普通 zip**（目录树 + Markdown 文件，无 `manifest.json`）交流文档。mdpkg 当前打开路径硬性要求 `manifest.json`（`validatePackage` 对缺 manifest 的包报 E102 即失败），用户拿到别人给的 zip 无法直接使用工具链——必须先手动 unpack 再造 manifest 再 pack，摩擦大。目标：**input tolerant, output strict**——宽容打开任何 Markdown zip，严格输出规范 mdpkg。

## What Changes

- **CLI 输入宽容**：`render` / `export` 接受无 manifest 的 zip（`.zip` 与 `.mdpkg` 扩展名同等接受）。解开后检测不到 `manifest.json` 时进入**推断模式**：推断入口 → 临时构建 manifest → 走既有渲染管道。
- **浏览器库同步**：`openMdpkg` 支持同一降级路径（md-bundle 集成场景受益），返回结果中标注来源降级。
- **入口推断规则（确定性）**：`document.md` > `README.md` > `README.zh-CN.md` > 字典序第一个 `.md`（排除隐藏路径）。无任何 Markdown 文件时报错（不拿二进制当入口）。
- **未校验标注（强制性）**：宽容打开的输出/结果 MUST 标注「未校验来源（缺少 manifest.json）」。标注不得把降级打开描述为已验证/可信（与 pipeline spec 的完整性校验边界要求一致）。
- **validate 严格性不变**：`validate` 对无 manifest 包仍报 E102——校验语义不稀释；宽容只存在于打开/渲染输入层。
- **输出严格不变**：从宽容输入重新 `pack` 产出的仍是规范 mdpkg（manifest 重建、size/sha256 重算）。
- **无 BREAKING**：既有 `.mdpkg` 路径行为不变；变更只新增输入分支。
- **与 issue #1 正交**：分块 push 修复（fflate 2108 条目截断）先行落地，宽容打开在其之上实现（宽容路径同样受解析器能力约束）。

## Capabilities

### New Capabilities

- **`lenient-open`** — 宽容输入边界：无 manifest 检测与降级语义、入口推断规则、未校验来源标注。

### Modified Capabilities

- **`pipeline`** — 渲染/打开管线对「无 manifest 输入」的降级分支（现有 Requirement「渲染管线顺序」步骤 2「校验 manifest」的输入边界条件扩展）。
- **`conformance`** — fixtures 体系补充宽容打开用例约定（无 manifest 输入包、`expect` 新增降级标注断言字段）。

## Impact

- **代码**：`packages/mdpkg/src/cli.ts` / `manifest.ts` / `web/mdpkg-web.ts`（打开与渲染输入路径）+ `test/`（新测试文件）。
- **API**：`openMdpkg` 返回结果新增降级来源标注（扩展 `degraded` 语义或新增字段）；CLI `render`/`export` 输出标注。
- **依赖**：无新增。
- **规范正文**：`spec/mdpkg-format-spec.md` 不改——宽容打开是输入层能力，格式定义（带 manifest 的结构）不动；如未来标准化需要，可在附录增加「导入兼容层」说明。
- **文档**：README 打开能力说明、CHANGELOG、docs/。