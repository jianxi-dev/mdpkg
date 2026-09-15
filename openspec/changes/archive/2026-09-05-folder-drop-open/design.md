# Design: 文件夹/同级附件拖入直开

## Context

现状：`.md` / `.mdpkg` / `.zip` 三类文件已在浏览器直开（openMdpkg / openMarkdown，lenient 渲染）。痛点：md 引用的同级附件（`assets/*.png` 等）在单文件/单 md 拖入时无法访问文件系统，图片断链。渲染管线 `assetsPlugin`（render.ts，inline 模式把 Map 内相对路径资源转为 data URI）已具备图片显示能力——zip 场景已生效。缺口在浏览器端「收集文件夹树为包 Map」。

约束：零新依赖（浏览器原生 API）；demo.html 为纯静态页（无构建，改动直接生效）；web bundle 经 `npm run build:web` 重建；Node 22 内置类型剥离、erasable syntax、中文注释；测试底线 184 用例。

## Goals / Non-Goals

**Goals:**
- 拖入文件夹 / md+附件多选 → 完整渲染（图片 data URI 内联显示）
- `openFiles(files, opts?)` 统一 Map 渲染入口（openMarkdown 委托，md-bundle 未来可复用目录上传）
- 目录场景 include 展开可用；单 md 直开语义不变
- 上限防护（条目/深度/单文件/总量）+ 不支持目录的浏览器友好提示

**Non-Goals:**
- 不做 md 直开后的「补选附件文件夹」交互（showDirectoryPicker 增强，见 Open Questions）
- 不做文件系统持久访问（File System Access API 的持久句柄）
- 不改渲染管线/推断规则/zip-core 等核心（纯浏览器层能力）
- 不支持 Firefox 目录条目（仅提示）

## Decisions

### D1: 目录读取用拖拽 webkitGetAsEntry，不用 showDirectoryPicker
drop 事件里遍历 `e.dataTransfer.items`，`item.webkitGetAsEntry()`（Safari 同；新版 Chrome 亦支持 `getAsEntry`）拿目录条目，`createReader().readEntries()` 循环读取（readEntries 分批返回，需循环到空）、`entry.file()` 读字节。备选 showDirectoryPicker 需安全上下文 + 用户手势且 file:// 不可用——拖拽是本产品已确立的交互（用户习惯拖入），零授权弹窗。
**替代方案**：showDirectoryPicker 强制弹目录选择器（否决：多一步交互、file:// 受限、与现有拖入习惯冲突）；input webkitdirectory（否决：仅限目录选择器，多条目组合拖拽不支持）。

### D2: 路径语义：保留相对路径 → Map 键
目录条目以**顶层拖入名**为根（拖入文件夹 `mydoc/` → 键前缀 `mydoc/`；多选 md+assets → 各条目原名平铺合并），文件字节经 `file.arrayBuffer()` 读为 Uint8Array。入口推断用既有 `inferEntrypoint`（任意深度已支持）；图片引用 `assets/a.png` 与键匹配 → `assetsPlugin` 内联，**渲染核心零改动**。收集时跳过隐藏路径段（与包规则一致）。
**理由**：与 ZIP 包 Map 结构同构——lenient 渲染路径完全复用，无分支差异。
**替代方案**：把收集内容重排为平铺（丢目录前缀）→ 引用路径失配（否决）；自己写资源解析（否决：重复 assetsPlugin）。

### D3: `openFiles` 统一入口 + openMarkdown 委托
`web/mdpkg-web.ts` 新增：
```ts
export async function openFiles(files: Map<string, Uint8Array>, opts?: OpenOptions & { include?: boolean }): Promise<OpenResult>
```
= 现有 openMdpkg 的「Map → validation + renderMarkup + wrapDocument」段（不含 unpack），入口推断 try/catch 同模式。`openMarkdown(name, bytes, opts)` 改为委托：构造单文件 Map → `openFiles(map, { ...opts, include: false })`（保持 include:false 与 entry 回退逻辑在 openMarkdown 内部）。
**理由**：openMdpkg / openMarkdown / openFiles 三段共用「renderMap(files, {inline:true, symbols, include})」helper，删除重复；demo 目录收集后一行调用。
**替代方案**：demo 直接内联渲染逻辑（否决：库能力应沉淀给 md-bundle）。

### D4: demo drop 重写：同步快照防 DataTransfer 失效
`dataTransfer.items` **在 drop 事件 handler 返回后失效**（条目引用不可异步持有）——handler 内必须**同步**把 items 转为 entry/File 快照数组，再异步递归读取。状态机：`pendingEntries: (FileSystemEntry | File)[]` → 递归 resolve（目录 readEntries 循环；文件 arrayBuffer）→ 中途任何超限即 abort（见 D5）→ 完成后按输入形态分派：
- 纯单文件 .mdpkg/.zip → openMdpkg（行为不变）
- 单 .md → openMarkdown（行为不变）
- 含目录或多条目（含 md+附件）→ 合并 Map → openFiles(files, { include: true 缺省 })，入口由 lenient 推断
- 无 .md 候选 → 友好错误（E303 文案透传）
**风险**：readEntries 分批返回（每次 ≤ 100 条）——循环直到空；错误项（权限/损坏）跳过并在 warnings 汇总。

### D5: 收集上限（防滥用）
常量：`MAX_ENTRIES=1000`、`MAX_DEPTH=8`、`MAX_FILE_BYTES=50MB`、`MAX_TOTAL_BYTES=200MB`（与内联阈值/解包防护同精神）。超限 → 停止收集 + OpenResult.error 中文信息（或 demo 直接错误提示，不抛未捕获异常）。warnings 收集跳过项。
**理由**：浏览器内存安全是硬约束（data URI 膨胀 ~33%）。

### D6: 兼容性检测
`item.webkitGetAsEntry || item.getAsEntry` 存在 → 支持；否则（Firefox）目录/多条目无法保结构 → 显示提示「目录拖入请使用 Chrome / Edge / Safari（单文件拖入不受影响）」。`isDirectory`/`isFile` 标记用于分派。

### D7: 相对引用解析——引用文本 ≠ 条目路径
根因（实测）：zip 内 `docs/doc.md` 引用 `../assets/a.png` 时，`include.ts` 的 `rewriteLine` 对引用文本调 `normalizePath` → 拒绝 `..` 段 → E202 整包渲染失败（用户「zip 图片不显示」的真实原因）。原则：**条目路径校验（pack/unpack 的 ZIP 遍历防护）与 Markdown 引用文本解析是两回事**——引用文本按文档目录语义解析，越出包根视为外部引用保留原文。
实现（共享 resolver）：
- 新增 `src/refpath.ts`：`resolveRef(baseDir: string, ref: string): string | null`——纯字符串段级压平（`.`/`..`），越出根返回 null；不触文件系统、不碰 normalizePath
- `include.ts` `rewriteLine`：引用先 `resolveRef(被包含文件 dirname, ref)` → 成功写解析后路径；null（越根）保留原文（不再 E202）
- `render.ts` `assetsPlugin`：入口文档引用先精确查 Map，未命中按 `resolveRef(entry 目录, src)` 再查 → 命中内联；越根/未命中保持现状（不阻断）
- `docx.ts` `imageToXml`：同 render 语义（docx 保真一致）
**理由**：三路径（lenient zip / 文件夹直开 / docx）共享同一 manifest 自由语义；解析只影响「能否匹配 Map 键」，安全面不动。
**替代方案**：全局放宽 normalizePath 允许 `..`（否决：直接破坏 zip 条目路径遍历防护，安全回归）；只修 include 不修 render（否决：入口文档自身的 `../` 引用仍断链）。

## Risks / Trade-offs

- [DataTransfer 异步失效 → 读取空/异常] → D4 同步快照 + entry.file() 回调内读取；测试覆盖快速 drop
- [大目录内存爆炸 → 页面卡死] → D5 上限 + 进度状态文案；超限 abort
- [图片 data URI 体积膨胀] → 沿用内联阈值精神；超大图超单文件上限时跳过 + warning
- [浏览器差异（Safari/Firefox）] → D6 检测提示；Chrome/Edge 为验证主路径
- [openMarkdown 委托行为漂移] → 既有 open-markdown.test.ts 4 用例作为回归锁

## Migration Plan

1. `web/mdpkg-web.ts`：抽 `renderMap` helper → `openFiles` 导出 → `openMarkdown` 委托（先重构后新功能，测试锁行为）
2. `build:web` 重建（bundle 含 openFiles）
3. `demo.html`：drop/change 处理器重写（快照 + 递归 + 上限 + 分派），banner 文案「拖入 .md / .mdpkg / .zip / 文件夹」
4. 测试：openFiles Node 单测 + 浏览器端到端（Playwright 拖目录）
5. 文档：md-bundle-integration.md 补 openFiles/目录场景；回滚：demo 处理器与 openFiles 独立，移除零风险

## Open Questions

- md 直开后用户再选附件文件夹（showDirectoryPicker 补选）是否值得 v1.1 做？——当前不做，目录整体拖入已覆盖主场景
- 目录收集是否把非 `.md` 文本（如 `.txt` 引用）纳入入口候选？——沿用 inferEntrypoint（仅 .md），文本资源仍入 Map（可被 include/引用）