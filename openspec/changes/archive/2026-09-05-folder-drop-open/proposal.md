# Proposal: 文件夹/同级附件拖入直开（folder-drop-open）

## Why

`.md` / `.mdpkg` / `.zip` 已支持浏览器直开，但文档内引用的**同级附件文件夹中的图片不显示**——浏览器单文件拖入无法访问文件系统，`![图](assets/logo.png)` 断链。用户需求明确：加载同级附件文件夹里的图片资源，让文档完整渲染。

渲染管线本身**零缺口**：`assetsPlugin`（render.ts）对 Map 内相对路径资源在 inline 模式自动内联 data URI（zip 场景图片渲染已生效，同一路径）。缺口仅在浏览器端如何把「md 旁边的文件夹」变成包 Map。

## What Changes

- **相对引用解析（zip 图片不显示的根因修复）**：实测确认——zip 内子目录 md（如 `docs/doc.md`）引用父级资源（`../assets/a.png`）时，`include.ts` 的引用重写把**引用文本**误当条目路径校验（`normalizePath` 拒绝 `..` 段）→ 整包渲染抛 E202 失败。修复：引用文本按文档目录语义解析（压平 `./`/`../`，越出包根视为外部引用保留原文），条目路径校验不变（ZIP 遍历防护不受影响）。收益：lenient zip、文件夹直开、docx 三条路径的 `../` 引用全部可解析内联。
- **拖放层升级**（demo.html）：drop 处理器从「取第一个文件」改为遍历 `dataTransfer.items`，识别**目录条目**（`webkitGetAsEntry` / `getAsEntry`）并递归读取，构造保留相对路径的包 Map。支持三类输入：整体文件夹（md+附件）、md+附件多选同拖、既有单文件（.md / .mdpkg / .zip 行为不变）。
- **统一渲染入口**（mdpkg-web）：新增 `openFiles(files: Map<string, Uint8Array>, opts?): Promise<OpenResult>`——任意 Map 的 lenient 渲染（入口推断 + 校验 + 图片内联 + include 展开可用），与 `openMdpkg`/`openMarkdown` 返回结构同构；`openMarkdown` 内部委托（保持 include: false 语义）。md-bundle 等消费端从此可「上传/选择目录」复用。
- **include 语义升级**：目录 Map 内 include 目标文件存在 → `<<<` 正常展开（单 md 直开仍降级可见文本）。
- **安全上限**：目录递归设条目数 / 深度 / 单文件大小上限（沿用解包防护精神），防止大目录拖入爆内存。
- **兼容性提示**：不支持目录条目的浏览器（如 Firefox）给出友好提示而非静默失败。

## Capabilities

### New Capabilities
- `folder-open`: 目录/多条目拖入直开——浏览器端收集文件夹树（含 md 与同级附件资源）构造包 Map，复用 lenient 渲染管线（入口推断、校验、图片 data URI 内联、include 展开），输出与 `openMdpkg` 同构的 OpenResult。

### Modified Capabilities
- `lenient-open`: 「入口推断规则」与渲染语义不变；`openMarkdown` 演进为 `openFiles` 的委托实现（行为保持）。若判定需要 delta 记录，仅描述入口矩阵扩展（单文件 → 目录），由实现后评审确认。

## Impact

- **代码**：`packages/mdpkg/web/mdpkg-web.ts`（新增 `openFiles`，`openMarkdown` 委托）；`packages/mdpkg/web/demo.html`（drop/change 处理器重写：目录递归 + 多条目 + 上限 + 分派）；`npm run build:web` 重建 bundle。
- **API**：`mdpkg-web.openFiles(files, opts?)` 新增导出（OpenResult 同构）。
- **依赖**：零新依赖（`webkitGetAsEntry` 为浏览器原生 API，读取用 `FileReader`/`arrayBuffer`）。
- **测试**：Node 侧 `openFiles` 单测（lenient 渲染 / 图片内联 / include 展开 / 入口推断 / 错误语义）；demo 目录拖入的浏览器端到端验证（Playwright）。
- **文档**：`packages/mdpkg/docs/md-bundle-integration.md` 补充 `openFiles` 与目录场景；demo.html 文案同步（拖入文件夹）。