## Context

mdpkg v1 的格式规范与参考实现已完成（M0–M6），本 design 是对**已落地实现**的技术选型与关键决策的补录记录，供后续变更与审查追溯「为什么这么做」。背景约束：

- 定位：先自用后标准化；3 个月止损判据；v1 只提供三项能力（资源随包 / 符号扩展 / 文件包含）。
- 运行环境：Node 22.18+（内置类型剥离直接跑 `.ts`，无构建步骤，只能用 erasable syntax——禁用构造函数参数属性、enum、namespace）。
- 容器：标准 ZIP + `manifest.json`；必须可重复构建、可校验、可互操作（`unzip -l` 可读）。
- 现有文档：`PLAN_MERGED.md`（立场）、`spec/mdpkg-format-spec.md`（规范正文）、`packages/mdpkg/`（实现）、`plans/mdpkg-review-round2.md`（里程碑记录）。

## Goals / Non-Goals

**Goals:**
- 单一 `.mdpkg` 文件可承载主文档 + 全部引用资源 + 可包含子文档，单文件交付。
- 同一输入两次打包产生**字节相同**的包（可重复构建 → 缓存/签名/误改动检测友好）。
- 完整性可校验（size + sha256），但**明示不防篡改**（v1 无签名机制）。
- 安全默认：解包防目录遍历/炸弹/符号链接，渲染防 XSS/恶意 SVG。
- 实现零构建步骤、零新增运行时依赖负担，用 Node 内置能力直接执行 TS。

**Non-Goals:**
- 不提供 `--fetch`（外链下载）——引入网络依赖与 SSRF 面，与「不下载、可预测」立场冲突。
- 不做防篡改签名（需要包外锚点，v1 不做）。
- 不实现 extended 符号集（`...`→`…`、`1/2`→`½` 等，误伤风险高，需更多边界数据）。
- 不做 VS Code 插件（M7 延后，待采用可行性验证）。
- 不做 mdpkg-DC 双层容器二进制方案（已降级为历史记录 `PROPOSAL_COD.md`）。

## Decisions

### D1. 容器 = 标准 ZIP（非自定义二进制）

- **决策**：`.mdpkg` 是标准 ZIP 归档，根含 `manifest.json`。
- **理由**：`unzip -l` / `unzip -p` 等通用工具可列可提 → 互操作免费；无需自研字节布局；失败可降级为「普通 ZIP」处理（识别失败不猜修复）。
- **备选**：mdpkg-DC 双层容器（`PROPOSAL_COD.md`）——字节级布局可嵌入元数据，但牺牲通用工具互操作，v1 不采用。

### D2. 实现语言与执行方式 = Node.js/TypeScript + 内置类型剥离

- **决策**：Node 22.18+ 直接运行 `.ts`（`node --experimental-strip-types` / 内置剥离），无 tsc 构建步骤。
- **理由**：生态顺手（后续 VS Code 插件）、零构建配置；强制 erasable syntax 使代码天然可被任意 TS 运行时执行。
- **备选**：Python——次选，生态做桌面端不如 TS。

### D3. Markdown 解析/渲染 = remark/unified 管线

- **决策**：`remark-parse`（GFM：`remark-gfm`）→ mdast → 符号转换（遍历 `text` 节点）→ `remark-rehype` → `rehype-sanitize` → HTML。
- **理由**：符号转换「排除区」天然满足——code / inlineCode / link.url / html 均不是 `text` 节点，零自研 tokenizer；AST 引用收集同样基于 mdast（`image` / `link` 节点 URL），排除代码块与行内代码（示例代码不误报）。
- **实测**：dogfood 打包项目自身 README 时，正则实现两次误报（示例 `assets/a.png`、真实链接 `spec/mdpkg-format-spec.md`），改 AST 后一次通过。

### D4. ZIP 读写 = fflate

- **决策**：`fflate`（压缩/解压）+ 自行控制条目顺序与 mtime。
- **理由**：fflate 可精确控制条目插入顺序与时间戳 → 直接满足可重复构建（§2.4）；流式 `Unzip` 便于解压中计数（炸弹防护）；无 native 依赖。
- **实现陷阱（实测，已写入规范 §8.4 注记）**：
  - `Unzip` 回调的 `size` 是**压缩后**大小，`originalSize` 才是解压后大小；`compressedSize` 为 `undefined`。误用 `size` 做上限判定会让炸弹防护失效。
  - 文件回调必须传给构造函数 `new Unzip(cb)`；`register()` 只注册编解码器，否则抛 `no stream handler`。
  - 条目顺序由调用方插入顺序决定，库不自动排序——实现 MUST 自行按路径码位升序排序后再插入。

### D5. 符号转义 = 哨兵法（非「先解析后转换」）

- **决策**：解析前把 `\` + 符号 替换为私有区哨兵（`U+E000`）+ 符号 → 正常解析与转换 → 转换后删除哨兵。
- **理由**：Markdown 解析阶段会先消费 `\(` 转义，text 节点只剩 `(tm)`，转换器无法区分「用户写了 `\(tm)` 想保留字面」与「用户写了 `(tm)` 想转换」；哨兵法使哨兵后的符号不满足词边界前邻条件（不被转换），成本约 3 行。
- **备选（未采用）**：取消 `\` 转义，改用行内代码 `` `(tm)` ``——零实现成本但牺牲「在普通文本中保留字面且不显示为代码」。

### D6. 引用收集 = 基于 AST 的 include 传递闭包

- **决策**：pack 时从入口遍历 include 闭包，基于 mdast 收集 `image` / `link` 节点 URL（本地相对路径），缺失即报 `MDPKG-E401`。
- **理由**：只扫入口文档会漏掉被包含子文档里的图片；正则扫全文会把代码块示例误判为引用。
- **边界**：到本地 Markdown 的链接属文档间导航，**不算附件，不强制打包**；外链 URL 默认保留不下载。

### D7. 可重复构建策略

- **决策**：条目按路径 Unicode 码位升序（`manifest.json` 最前）；mtime 固定 `1980-01-01`；权限 0644/0755；不写本机绝对路径/UID/GID/扩展属性/注释；生成时间不进 manifest。可选 `--preserve-mtime` 放弃该保证。
- **理由**：同输入 → 同字节，用于缓存与误改动检测；不承诺 ZIP 在 Git 中可读 diff（版本差异用 `mdpkg diff`）。

### D8. 完整性校验 = size + sha256（明确不防篡改）

- **决策**：manifest 记录每个资源未压缩字节数与 sha256，`validate` 全量比对。
- **边界（MUST 在输出中明示）**：摘要与资源同包，可被同步改写 → 仅检测损坏/误传/字节漂移，不提供防篡改保证；输出不得描述为「未被篡改 / 可信 / 已验证来源」。

### D9. 解包安全 = 流式计数 + 读 header 预判

- **决策**：解压过程中流式计数（资源总数 10 000 / 单文件 200 MB / 总量 1 GB / 压缩比 1000:1），达到上限即不启动该条目解压流，只读 central directory header 判定。
- **实测**：120 MB 炸弹（120 KB 压缩包）只读 header 拒绝耗时 0 ms，完整解压需 156 ms 且未落盘。
- 另：路径校验拒绝绝对路径 / `..` / 符号链接 / 硬链接 / 盘符（打包与解包双侧）。

### D10. JSON Schema 校验 = ajv（draft 2020-12）

- **决策**：`ajv` 校验 manifest，Schema 落盘 `spec/schema/manifest-1.0.json`。
- **实现注记（M2 实测）**：`source_url` 不用 `"format": "uri"`——ajv 8 的 2020-12 入口不内置 format，会打 `unknown format "uri" ignored`，需额外 `ajv-formats`；为一个可选校验加依赖不值，降为字符串约束。ajv 8 默认只含 draft-07/2019-09，2020-12 必须 `import Ajv2020 from 'ajv/dist/2020.js'`（ESM 需带 `.js` 扩展名）。

## Risks / Trade-offs

- [include 指令不感知代码块上下文] → 列 0 围栏代码块内符合 `^<<<\s*(.+?)\s*$` 的行会被展开。已知且可接受（解析前展开阶段无法正确做围栏扫描），规范明示不修复；缩进 ≥1 空格的指令天然不触发。
- [URL 重写可能篡改代码块内的示例路径] → 重写阶段跟踪围栏状态（`` ``` `` / `~~~`）跳过代码块内行；与引用收集的 AST 排除共用「排除代码块」原则。实测各出过一次缺陷。
- [ZIP 炸弹防护依赖 fflate 字段语义] → 必须用 `originalSize` 而非 `size`，已写入规范注记并加单测覆盖。
- [符号集 extended 误伤风险] → v1 只做 core（10 个映射），extended 延后至有充分边界数据。
- [manifest 与资源同包 → 防篡改失效] → v1 明示不提供防篡改，输出措辞约束（§8.3）。
- [可重复构建与 mtime 保存冲突] → `--preserve-mtime` 启用时放弃可重复保证，输出提示。

## Migration Plan

- 本 change 为治理补录，不涉及部署或代码迁移。
- 归档后：`openspec/specs/` 为规范治理来源；`spec/mdpkg-format-spec.md` 为发布渲染稿；后续规范变更先走 OpenSpec delta，再同步发布稿（二者以 openspec 为准）。

## Open Questions

- 规范发布稿（`spec/mdpkg-format-spec.md`）与 `openspec/specs/` 的双轨同步由谁维护、多久一次——建议后续变更流程中约定「archive 时同步发布稿」。
- 错误码表（附录 A）与退出码是否应成为独立 capability（当前归入 `pipeline`）——若后续错误码膨胀，可拆分。