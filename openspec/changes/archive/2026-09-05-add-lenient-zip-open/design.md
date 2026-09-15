# 宽容打开无 manifest 的 zip 文档 — Design

## Context

mdpkg 的打开/渲染路径当前行为（实测核对）：

| 路径 | 无 manifest 时现状 |
|---|---|
| CLI `render` | 可渲染**仅当**存在 `document.md`（`render()` 里 `manifest=null → entry=DEFAULT_ENTRYPOINT`）；否则 E303 |
| CLI `export` | 同上（entry 取 `DEFAULT_ENTRYPOINT`，无文件则 E303） |
| 浏览器 `openMdpkg` | `validation.ok=false`（E102）**但 html 仍渲染**（render 照跑）——已是隐式宽容 |
| CLI `validate` | 报 E102（严格）——保持不变 |

**核心发现：宽容能力已半存在**——缺的不是"能不能渲染"，而是三件事：① 入口推断规则（现在是写死 `document.md`，不支持 README/首 md/子目录）；② 未校验来源的显式标注（CLI 无提示，API 无字段）；③ 规则文档化（specs 已补，正文不改）。

因此本 change 的实动量集中在小的、明确的位置，而非新建一条全量管线。

## Goals / Non-Goals

**Goals**
- 无 manifest 的 zip（目录树 + Markdown）在 `render` / `export` / `openMdpkg` 可打开，入口按确定性规则推断
- 未校验来源显式标注（CLI stderr + API 字段）
- `.zip` / `.mdpkg` 扩展名同等接受（文档化现状行为）
- 既有 `.mdpkg` 路径零行为变化；`validate` 严格性不变（E102）

**Non-Goals**
- 不改 `spec/mdpkg-format-spec.md` 正文（格式定义不动；兼容层最多进附录，另行决定）
- 不为无 manifest 输入提供完整性校验（无声明可校验——标注未校验即答案）
- 不做通用 zip 查看器（仍要求目录可解析为文档树：有入口 Markdown）
- 不解决 issue #1（fflate 2108 截断）——正交，另排

## Decisions

**D1 — 入口推断放 `manifest.ts`，导出 `inferEntrypoint(files): string`**
规则（与 lenient-open spec 一致）：`document.md` > `README.md` > `README.zh-CN.md` > 其余 `.md` 按 UTF-8 码位字典序首个；排除 `.` 开头隐藏路径；无 `.md` 抛 E303。放 `manifest.ts` 与 `DEFAULT_ENTRYPOINT`/`buildManifest` 相邻（依赖 `normalizePath` 已在同域），`render.ts` / `web/mdpkg-web.ts` / `cli.ts` 均从 `manifest.ts` 导入。
- 备选：独立 `entrypoint.ts`——本 change 量级下过度拆分；备选：放 `include.ts`——语义不符。

**D2 — `render()` 内入口解析统一走推断分支**
无 manifest 时 `entry = inferEntrypoint(files)`（替代现写死的 `DEFAULT_ENTRYPOINT`），有 manifest 时维持 `manifest.entrypoint ??` 逻辑不变。一处改动同时覆盖 CLI `render`/`export` 与浏览器 `openMdpkg`（三路径共用 `render()`）。
- 影响面：无 manifest 且无 `document.md` 但存在 `chapter1.md` 的输入，从"E303 报错"变为"渲染 chapter1.md（标注未校验）"——行为宽容化，符合本 change 目标；无任何 `.md` 仍 E303，无破坏。

**D3 — 未校验标注：API 新增 `unverified: boolean`，不重载 `degraded`**
`OpenResult`（web/mdpkg-web.ts）现 `degraded` 语义是"资源超 50MB 体积降级"；来源未校验是不同维度，复用会撞语义。新增 `unverified: true`（无 manifest 推断模式时）。CLI `render`/`export` 在推断模式下 stderr 打印：「未校验来源（缺少 manifest.json），按规则推断入口 `<entry>`」。
- 备选：复用 `degraded`——语义污染，拒绝；备选：CLI 退出码变化——不（仍 0，提示非错误）。

**D4 — include 错误保持严格，资源闭包不检查**
推断模式下 include 展开照旧抛 E501-E508（文本管道前置步骤，无优雅降级路径）；**不**运行 `checkClosure`（E401 资源缺失检查）——`render()` 本就不调它，缺失资源在渲染层表现为 broken 相对路径（现状行为，可接受且与"宽容打开"目标一致）。

**D5 — `validate` 不动**
E102 对无 manifest 包保持报错 + 退出码 1——校验语义是格式的锚点，宽容只在打开/渲染输入层。

**D6 — fixtures 进 `spec/fixtures/`，`case.json` 加 `lenient: true` + `expect.degraded`/`entry` 断言**
复用既有 conformance 驱动（`fixtures.test.ts` 按 `case.json` 跑），新用例 kind 用 `render`/`validate` 即可，不新增 kind。

## Risks / Trade-offs

- **[R1] 入口推断可能不符合用户预期**（文档在子目录、README 是索引而非正文）→ mitigation：规则文档化 + 推断模式 stderr 明确打印所选入口（用户可见、可纠错）；fixtures 锁定规则防漂移。
- **[R2] `unverified` 与 `degraded` 未来混淆** → mitigation：字段名 + 类型注释语义分离；md-bundle 消费方适配说明写进 README。
- **[R3] 推断模式的宽容可能掩盖"包结构损坏"**（用户把残缺 zip 当 .mdpkg 用）→ mitigation：标注是强制项（CLI stderr + API 字段），校验路径（`validate`）从不宽容。
- **[R4] 子目录入口判定歧义**（见 Open Questions）→ 若采用全树扫描，用 fixtures 锁死优先级（document.md 深度不限 > README 深度不限 > …）。

## Migration Plan

- 能力新增，无迁移；浏览器 `openMdpkg` 返回结构**向后兼容**（只增 `unverified` 字段，缺省 `false`）
- md-bundle / clairis 消费者按需读取新字段，不读不影响
- 回滚：撤销入口推断改动即回既有行为（无状态、无数据迁移）

## Open Questions

1. **入口查找范围**：仅 zip 根目录，还是全树（含子目录）？Obsidian 导出常见 `docs/document.md`——全树更实用，但"README.md 在三级目录"也入选会怪。倾向：`document.md`/`README.md`/`README.zh-CN.md` 全树任意深度查找（取最浅者），兜底字典序仅根目录。待 fixtures 确认。
2. **`pack --referenced-only` 的默认入口是否统一用 `inferEntrypoint`**：现为 `DEFAULT_ENTRYPOINT`/首键——统一后行为更一致，但涉及打包侧语义，是否纳入本 change 由实现时评估。
3. **README 变体宽度**：`README.zh-CN.md` 是唯一中文变体约定，还是再收 `README-cn.md`（Obsidian 生态常见）？当前建议只认 `zh-CN`，如遇真实案例再扩。