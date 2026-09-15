# Tasks — 宽容打开无 manifest 的 zip 文档

## 1. 入口推断核心（manifest.ts）

- [ ] 1.1 在 `packages/mdpkg/src/manifest.ts` 实现并导出 `inferEntrypoint(files: Map<string, Uint8Array>): string`：
  - 规则：`document.md`（任意深度取最浅）> `README.md` > `README.zh-CN.md` > 根目录其余 `.md` 按 UTF-8 码位字典序首个
  - 排除以 `.` 开头的隐藏路径；无任何 `.md` 抛 `MdeError(E.E303, 'entrypoint 不存在: ...')`
  - 与 `DEFAULT_ENTRYPOINT` / `buildManifest` 同域，注释引用 lenient-open spec
- [ ] 1.2 新增 `test/entrypoint.test.ts`（或 `manifest.regression-2.test.ts`）覆盖：默认名优先 / README 兜底 / 中文 README 变体 / 字典序首个 / 隐藏路径排除 / 子目录 document.md 优先于根 README / 无 md 抛 E303

## 2. render 入口统一（render.ts）

- [ ] 2.1 `packages/mdpkg/src/render.ts`：无 manifest（`manifestRaw` 缺失或解析为 `{}`）时 `entry = inferEntrypoint(files)`，替代现写死的 `DEFAULT_ENTRYPOINT`；有 manifest 时维持 `manifest.entrypoint ??` 逻辑。注：E303 提示文案保持「entrypoint 不存在」格式
- [ ] 2.2 新增渲染入口测试：无 manifest + 多 md 的包，render/openMdpkg 选中 `inferEntrypoint` 结果；既有 web.test「manifest.json missing → E102」用例继续通过（校验与渲染分离）

## 3. 未校验来源标注

- [ ] 3.1 `web/mdpkg-web.ts`：`OpenResult` 新增 `unverified: boolean`（缺省 `false`；推断模式即无 manifest 时为 `true`）——不重载 `degraded`（体积降级语义分离），类型注释写明两字段区别
- [ ] 3.2 `cli.ts`：`render` / `export` 推断模式下 stderr 打印「未校验来源（缺少 manifest.json），按规则推断入口 <entry>」（退出码仍 0）
- [ ] 3.3 测试：`openMdpkg` 对裸 zip 返回 `unverified: true`（与既有 degraded 测试并存）；CLI render 裸 zip 的 stderr 含「未校验来源」断言

## 4. Conformance fixtures（spec/fixtures/）

- [ ] 4.1 新增 lenient 用例目录（`lenient-open-*`）：
  - 裸 zip 含 document.md → `expect.entry: document.md`、`expect.degraded: true`（或等价断言字段，与 fixtures.test.ts 解析对齐）
  - 裸 zip 仅 chapter2/chapter1.md → 入口 chapter1.md
  - 裸 zip 子目录 document.md → 入口为子目录路径
  - 裸 zip 无 .md → `expect.errorCode: MDPKG-E303`
  - validate 裸 zip → `expect.errorCode: MDPKG-E102`（严格性保持）
- [ ] 4.2 `fixtures.test.ts`：若 case.json 需要新断言字段（lenient/degraded/entry），扩展解析并跑通全量

## 5. 文档与验证收尾

- [ ] 5.1 README（EN + ZH）：打开能力说明——`.zip` 与 `.mdpkg` 同等接受、入口推断规则、未校验来源标注、`unverified` 字段（供 md-bundle/clairis 消费方）
- [ ] 5.2 全量测试 + 手动 CLI 验证：真实裸 zip（含中文文件名/子目录）render → 检查 stderr 标注与产物；`validate` 裸 zip 确认仍 E102
- [ ] 5.3 CHANGELOG 条目（随 0.1.1.0 或既定版本发布时）；spec 正文不动，若需附录说明另行评审