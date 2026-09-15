## ADDED Requirements

### Requirement: 相对引用解析（父级 ../ 与同级 ./）
Markdown 引用相对路径资源时，渲染 MUST 按**文档所在目录**语义解析引用文本：`docs/doc.md` 中引用 `../assets/a.png` → 解析为 `assets/a.png`（与包 Map 键匹配 → data URI 内联）；`./assets/a.png` → `assets/a.png`。解析仅作用于**引用文本**（markdown 链接/图片 src、include 指令路径），不改变条目路径校验（`normalizePath` 对 zip 条目路径的 `..` 拒绝保持——ZIP 遍历防护不放松）。解析后越出包根（如 `../../x.png`）的引用 MUST 不作为包内资源内联（保留原文或按外链处理），且 MUST NOT 导致整包渲染报错。

#### Scenario: 子目录父级引用内联
- **WHEN** zip/文件夹含 `docs/doc.md`（引用 `![a](../assets/a.png)`）与 `assets/a.png`
- **THEN** 渲染成功（不抛 E202），图片以 data URI 内联显示

#### Scenario: 同级 ./ 引用
- **WHEN** `docs/doc.md` 引用 `![a](./assets/a.png)` 且 `docs/assets/a.png` 存在
- **THEN** 解析为 `docs/assets/a.png`，图片内联

#### Scenario: 越根引用不阻断
- **WHEN** md 引用 `../../outside.png`（解析后越出包根）
- **THEN** 不内联、不抛错，渲染继续（引用按原文保留或外链处理）

#### Scenario: include 指令内 ../ 引用
- **WHEN** 被包含文件 `includes/ch1.md` 引用 `![a](../assets/b.png)` 且有 `assets/b.png`
- **THEN** 重写后指向 `assets/b.png`（按被包含文件目录解析），图片内联

### Requirement: 目录/多条目拖入直开
浏览器端（demo.html）MUST 支持三类拖入输入并正确分派：
1. 拖入**文件夹**（含 .md 与同级附件资源）→ 递归收集目录树，构造保留相对路径的包 Map，按 lenient 语义渲染（图片内联显示）
2. 拖入 **md + 附件多选**（多个文件/文件夹条目同时拖入）→ 合并同一 Map 后同路径渲染
3. 既有单文件（.md / .mdpkg / .zip）→ 行为保持（openMarkdown / openMdpkg 现状）

目录收集 MUST 使用 `dataTransfer.items` 的目录条目 API（`webkitGetAsEntry` 或 `getAsEntry`），在 drop 事件处理内同步快照条目（DataTransfer 生命周期限制——异步读取前必须已持有 entry 引用），再递归 `createReader().readEntries` 读取目录、`file()` 读文件字节。

#### Scenario: 拖入整体文件夹
- **WHEN** 用户把含 `doc.md`、`assets/a.png`（doc.md 引用 `![图](assets/a.png)`）的文件夹拖入 demo
- **THEN** 渲染预览中图片可见（data URI 内联），推断入口为 `doc.md`，标注未校验来源

#### Scenario: md 与附件多选同拖
- **WHEN** 用户同时选中 `doc.md` 与 `assets/` 文件夹拖入
- **THEN** 两者合并渲染，`![图](assets/a.png)` 正常显示

#### Scenario: 单文件拖入行为保持
- **WHEN** 拖入单个 `.mdpkg` / `.zip` / `.md`
- **THEN** 分别走 openMdpkg / openMarkdown 既有路径，行为与之前完全一致

### Requirement: 路径与条目语义
目录收集的 Map 键 MUST 为文件夹内相对路径（含顶层文件夹名或拖入的文件名），入口推断复用 `inferEntrypoint`（lenient 规则：document.md > README.md > README.zh-CN.md > 最浅优先同深码位序，隐藏路径段排除）。收集时 MUST 跳过隐藏路径段（任一路径段以 `.` 开头，与包内规则一致）。

#### Scenario: 目录结构与包同构
- **WHEN** 文件夹 `mydoc/` 含 `document.md` 与 `assets/logo.png` 拖入
- **THEN** Map 键为 `mydoc/document.md`、`mydoc/assets/logo.png`，入口为 `mydoc/document.md`，图片内联正常

#### Scenario: 隐藏路径排除
- **WHEN** 文件夹内含 `.hidden.md` 或 `dir/.x/` 内容
- **THEN** 隐藏路径段不进入 Map，不参与入口候选与资源匹配

### Requirement: include 展开语义
目录 Map 下 include 展开 MUST 按默认语义启用（`render` 无 manifest 时默认展开）：`<<< includes/ch1.md` 在目标文件存在于 Map 时正常内联。单 .md 直开场景（openMarkdown）保持 include 关闭（`<<<` 降级可见文本）。

#### Scenario: 目录内 include 可用
- **WHEN** 文件夹含 `document.md`（含 `<<< includes/ch1.md`）与 `includes/ch1.md`
- **THEN** 渲染结果为展开后内容，无 `<<<` 残留

### Requirement: 收集上限与防滥用
目录递归 MUST 设置上限：条目总数（默认 ≤ 1000）、递归深度（默认 ≤ 8）、单文件大小（默认 ≤ 50 MB）、总字节（默认 ≤ 200 MB）。超限 MUST 停止收集并返回明确中文错误（OpenResult.error 语义），不抛出未捕获异常。

#### Scenario: 超限报错
- **WHEN** 拖入目录条目数或总字节超过上限
- **THEN** 停止收集，提示明确上限信息，页面不崩溃

### Requirement: 兼容性提示
目录条目 API 不可用（如 Firefox 无 `getAsEntry`/`webkitGetAsEntry`）时，demo MUST 检测并提示「目录拖入请使用 Chrome / Edge / Safari」，单文件拖入不受影响。

#### Scenario: 不支持目录的浏览器
- **WHEN** 在不支持目录条目的浏览器中拖入文件夹
- **THEN** 显示中文提示建议 Chromium/Safari，不产生部分渲染的误导结果

### Requirement: openFiles 统一入口
`mdpkg-web` MUST 导出 `openFiles(files: Map<string, Uint8Array>, opts?): Promise<OpenResult>`——任意 Map 的 lenient 渲染（入口推断 + 校验 + 渲染 + 图片内联），返回结构与 `openMdpkg`/`openMarkdown` 完全同构（files/manifest/validation/html/degraded/error/unverified/entry）。`openMarkdown` MUST 内部委托 `openFiles`（保持其单文件语义：非 .md 名回退 document.md、include 关闭）。`openFiles` MUST 支持 include 透传（缺省跟随 render 默认 = 无 manifest 时展开）。

#### Scenario: openFiles 渲染 Map
- **WHEN** 调用 `openFiles(new Map([['docs/a.md', …], ['docs/assets/p.png', …]]))`
- **THEN** 返回 OpenResult：entry=`docs/a.md`、unverified=true、html 内含图片 data URI（`data:image/png;base64,` 前缀）

#### Scenario: openMarkdown 委托保持语义
- **WHEN** 调用 `openMarkdown('x.md', bytes)`（含 `<<<` 引用）
- **THEN** 行为与既有一致：`<<<` 降级可见文本、entry='x.md'、unverified=true