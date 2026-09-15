# Tasks: folder-drop-open（文件夹/同级附件拖入直开）

## 0. 相对引用解析（zip 图片根因，共享基础）

- [x] 0.1 新建 `packages/mdpkg/src/refpath.ts`：`resolveRef(baseDir: string, ref: string): string | null`——纯字符串段级压平（`.`/`..`），越出根返回 null；零文件系统、不触 normalizePath；中文注释
- [x] 0.2 `include.ts` `rewriteLine`：引用先 `resolveRef(被包含文件 dirname, ref)` → 成功写解析后路径（可含 . 段）；null（越根）保留原文——不再因引用文本触发 E202（条目路径校验保持不变）
- [x] 0.3 `render.ts` `assetsPlugin`：入口文档引用精确查 Map 失败时按 `resolveRef(entry 目录, src)` 再查 → 命中内联 data URI；不命中保持现状（alt/原文）
- [x] 0.4 `docx.ts` `imageToXml`：同 0.3 语义（docx 导出保真一致，`../` 引用可嵌入）
- [x] 0.5 测试：zip2 场景（`docs/doc.md` + `../assets/a.png` + `assets/a.png`）→ render 成功且内联（不再 E202）；`../../x.png` 越根 → 不抛错不内联；include 内 `../` 引用重写后正确内联；`./` 同级；render.test / docx.test 新增加用例（toDocx 的 `../` 图片嵌入）

## 1. mdpkg-web 统一入口（openFiles）

- [x] 1.1 `web/mdpkg-web.ts`：抽共享 helper `renderMap(files, { symbols, include }): { html, degraded }`（从 openMdpkg 的 renderMarkup 调用段提取），供三入口复用
- [x] 1.2 新增导出 `openFiles(files: Map<string, Uint8Array>, opts?: OpenOptions & { include?: boolean }): Promise<OpenResult>`：入口推断（try/catch → entry 空串）、validatePackage、renderMap（inline:true、include 缺省 true-跟随 render 语义）、wrapDocument；返回结构与 openMdpkg 同构
- [x] 1.3 `openMarkdown` 重构为委托 `openFiles`（构造单文件 Map + `include: false`；entry 回退 document.md 逻辑保留在 openMarkdown），既有 open-markdown.test.ts 4 用例原样通过（行为锁定）
- [x] 1.4 `npm run build:web` 通过，ESM + IIFE bundle 含 openFiles（grep 验证）

## 2. demo 拖放层升级

- [x] 2.1 `demo.html` drop handler 重写：同步遍历 `dataTransfer.items` → 快照 `(FileSystemEntry | File)[]`（DataTransfer 失效防护：handler 内完成快照后再异步递归）
- [x] 2.2 目录递归读取：`entry.isDirectory` → `createReader().readEntries()` 循环（分批 ≤100 到空）；`entry.isFile` → `file().arrayBuffer()` → Uint8Array；路径键 = 顶层拖入名 + 目录相对路径；隐藏路径段跳过
- [x] 2.3 收集上限常量：MAX_ENTRIES=1000 / MAX_DEPTH=8 / MAX_FILE_BYTES=50MB / MAX_TOTAL_BYTES=200MB；超限停止 + 中文错误（不抛未捕获）
- [x] 2.4 分派逻辑：纯单文件 .mdpkg/.zip → openMdpkg；纯单 .md/.markdown → openMarkdown；含目录或多条目（md+附件混合）→ 合并 Map → openFiles（include 缺省展开）；无 .md → 透传 E303 友好信息
- [x] 2.5 兼容性检测：`item.webkitGetAsEntry || item.getAsEntry` 缺失（Firefox）→ 目录/多条目提示「请使用 Chrome / Edge / Safari」，单文件路径不受影响
- [x] 2.6 change 事件（文件选择器）同步支持多选目录？——fileInput 保持单/多文件；`webkitdirectory` 属性不启用（目录走拖拽）；banner 文案更新「拖入 .md / .mdpkg / .zip / 文件夹」

## 3. 测试

- [x] 3.1 新建 `test/open-files.test.ts`（Node 直调 `../web/mdpkg-web.ts` 的 openFiles，可复用 helpers 或自建 Map 构造）：
  - lenient Map（docs/a.md + docs/assets/p.png，a.md 引用图片）→ entry=`docs/a.md`、unverified=true、html 含 `data:image/png;base64,`、`<title>a.md</title>`
  - include 展开：Map 含 document.md（`<<< includes/c.md`）+ includes/c.md → html 含展开内容、无 `<<<` 残留（openFiles 缺省 include 开启）
  - `include: false` 透传：同 Map → `<<<` 降级可见文本（`&#x3C;&#x3C;&#x3C;`）
  - 无 .md → entry 空串、validation 结构、不抛异常（错误语义与 openMdpkg 对齐）
  - 根/子目录混合入口推断（最浅优先，lenient.test.ts 同规则）
- [x] 3.2 既有回归：open-markdown.test.ts / lenient.test.ts / web-export.test.ts 原样通过；`npm test` 全量（184 基线 + 新增）0 fail
- [x] 3.3 浏览器端到端清单（Playwright 手测，写入手测记录而非自动化）：拖整体文件夹（md+assets 图片显示）/ md+assets 多选同拖 / 单文件回归（.md/.mdpkg/.zip）/ 上限触发（可选构造）/ console 干净

## 4. 文档

- [x] 4.1 `packages/mdpkg/docs/md-bundle-integration.md`：补充 openFiles 签名与目录场景调用示例（与 openMdpkg 并列）
- [x] 4.2 demo.html 相关文案（banner/说明）已在 2.6 完成；`AGENTS.md` COMMANDS 无 CLI 面变化（web 能力），如各 section 提及 demo 能力则同步一句
- [x] 4.3 spec 归档确认：folder-open 能力 spec 与实现逐条对齐（1.1-3.3 完成后核对）

## 5. 收尾验证

- [x] 5.1 `npm test` 全量 0 fail；`npm run build:web` 通过
- [x] 5.2 Playwright 端到端：拖入 `/User 级示例文件夹`（含 md + assets png + include）+ 硬刷新（cache-buster）后图片可见、include 展开、console 无新增错误
- [x] 5.3 单文件回归三态（.md / .mdpkg / .zip）拖入行为与改动前一致