# PROJECT KNOWLEDGE BASE — mdpkg (Markdown Enhanced)

**Generated:** 2026-08-30
**Commit:** 0b1140b
**Branch:** main

## OVERVIEW

mdpkg 标准（`.mdpkg` 格式）的设计规划仓库。核心目标：让 Markdown 支持图片自动打包、符号扩展、文件包含，并可用单文件传输。当前阶段为纯规划（无任何实现代码），技术路线未最终拍板。

## 用户约定（MANDATORY）

- **对用户的一切反馈使用中文**。所有文档均为中文撰写，交流语言保持一致。

## STRUCTURE

```
mdpkg/
├── PLAN_MERGED.md       # 【现行立场】合并规划：PLAN 需求 + Codex 方案 + 双方审查（唯一现行来源）
├── PLAN.md              # 历史输入：原始需求与主计划（立场已被 PLAN_MERGED 取代）
├── PROPOSAL_COD.md      # 历史输入：mdpkg-DC 双层容器二进制方案（非 v1 范围，候选设计记录）
├── comparison.md        # 历史输入：ZIP vs mdpkg-DC 对比矩阵（已降级为 ADR 素材）
├── spec/                # 【现行规范】mdpkg-format-spec.md（正文 + 错误码 + fixtures 定义 + Schema）
├── packages/mdpkg/        # 【参考实现】Node/TS CLI：errors/container/cli + test
│   └── web/               # 【浏览器库】mdpkg-web（openMdpkg/packMdpkg/readEntrySource）+ demo.html
├── memoryos_data/       # MemoryOS 存储骨架（空占位，勿写入业务内容）
├── .pi-glla/            # 代理会话元数据（运行时噪音，勿编辑）
├── .omo/                # OMO 会话延续状态（运行时噪音，勿编辑）
└── .codegraph/          # 代码图谱索引缓存（自动生成；source.json 指向兄弟仓库 ~/mdpkg）
```

## WHERE TO LOOK

| 任务 | 位置 | 备注 |
|------|------|------|
| 项目背景/路线图（历史） | PLAN.md | 三阶段 MVP 计划（立场已被 PLAN_MERGED 取代） |
| 二进制格式备选方案（历史） | PROPOSAL_COD.md | 字节级布局、威胁模型（非 v1 范围） |
| 方案取舍决策依据（历史） | comparison.md | ZIP vs mdpkg-DC 逐维度对比（ADR 素材） |
| 现行立场与已拍板决策 | PLAN_MERGED.md §13/§14 | 已拍板 6 项见 §13，治理与下一步见 §14 |
| v1 格式规范（现行） | spec/mdpkg-format-spec.md | MUST/SHOULD/MAY 正文；附录 A 错误码 / B fixtures / C Schema |
| 实现代码 | packages/mdpkg/src/ | container.ts（ZIP 安全/可重复构建）、errors.ts、cli.ts |
| 落地计划与探针结论 | plans/mdpkg-review-round2.md | 可行性分析 + M0 探针结果 + M1 结果 |
| 真实代码（如有） | ~/mdpkg | .codegraph/source.json 指向的兄弟仓库（已不存在，实现改在本仓库 packages/）|

## CONVENTIONS

- 全部文档使用中文，术语保留英文缩写（mdpkg, MVP, ZIP）。
- 文档结构：上下文 → 方案 → 对比 → 阶段计划 → 验证 → 风险。新文档沿用此骨架。
- 已拍板：实现语言 Node.js/TypeScript（Python 次选）、符号集先 core 后 extended（PyMdown SmartSymbols 为来源，许可证 MIT 声明）。

## ANTI-PATTERNS (THIS PROJECT)

- 不写入来源不明的方案结论：所有技术选型必须有对比依据（参照 comparison.md 的矩阵格式）。
- 不创建**规划文档以外**的多余文件。实现代码放 `packages/mdpkg/`（原「实现应放 `~/mdpkg`」已失效——`~/mdpkg` 就是本仓库，与「不创建实现代码」自相矛盾）。
- 实现用 Node 22.18+ 的**内置类型剥离**直接跑 `.ts`，不加构建配置；因此只能用 erasable syntax（禁用构造函数参数属性、enum、namespace）。
- 不动工具目录（.pi-glla/, .omo/, .codegraph/, memoryos_data/）内容。

## COMMANDS

```bash
# 实现（packages/mdpkg/）
cd packages/mdpkg && npm test                      # node --test test/*.test.ts（136 用例）
npm run build:web                                  # 构建浏览器库（ESM + IIFE bundle）
node src/cli.ts pack <dir> -o out.mdpkg            # 打包
node src/cli.ts list out.mdpkg                     # 列条目（只读 header，不解压）
node src/cli.ts unpack out.mdpkg -o dir            # 解包
node src/cli.ts validate out.mdpkg                 # 校验（Schema + size/sha256 + 引用闭包）
node src/cli.ts render out.mdpkg -o out.html       # 渲染（默认 inline 单文件；>50MB 自动降级 --dir）
node src/cli.ts render out.mdpkg --format docx -o out.docx  # 渲染为 OOXML 文档（资源嵌入）
node src/cli.ts export --raw out.mdpkg -o dir      # 导出：结构保持、文本未改
node src/cli.ts export --expanded out.mdpkg -o dir # 导出：include 已展开、相对路径已按包根重写
node src/cli.ts export --md out.mdpkg -o out.md    # 导出：展开后 Markdown 单文件（include 内联、路径重写、符号保持源文本）
node src/cli.ts export --zip out.mdpkg -o out.zip  # 导出：标准 zip 交付物（展开后 Markdown + 资源 + README）
node src/cli.ts diff a.mdpkg b.mdpkg                 # 对比两包（解包后 diff -ruN）
unzip -l out.mdpkg                                 # 互操作验证：通用 ZIP 工具可读

# 仓库
git log --oneline          # 变更历史
git status                 # 工作区状态（PLAN_MERGED.md / spec/ / packages/ / plans/ 已在 ae3ffd7 跟踪提交）
```

## NOTES

- 立场已收敛：v1 = ZIP + manifest.json 容器（见 PLAN_MERGED.md）。PLAN.md / PROPOSAL_COD.md / comparison.md 均为历史输入，**写作时引用 PLAN_MERGED.md，避免三者混用**。
- 安全风险已在 PLAN_MERGED.md §8/§9 记录：ZIP 解包需防目录遍历、炸弹、符号链接与 include 放大。
- **全部文档与实现已在提交 ae3ffd7 跟踪提交**。PLAN_MERGED.md / spec/ / packages/ / plans/ 均受版本控制。
- M0 可行性探针（S1–S4）已全部 PASS，结论见 `plans/mdpkg-review-round2.md` §2.4.1。两个实测陷阱：fflate 的 `size` 是压缩后大小（`originalSize` 才是原始，用错会让炸弹防护失效）；符号转义必须用哨兵法（Markdown 解析会先消费反斜杠）。
- 规范测试集（conformance fixtures）已落盘：`spec/fixtures/<id>/{case.json,input/}` 共 43 个用例，驱动 `packages/mdpkg/test/fixtures.test.ts`。

## CURRENT STATE（2026-09-05）

- 立场：`PLAN_MERGED.md`；规范：`spec/mdpkg-format-spec.md`；计划：`plans/mdpkg-review-round2.md`。
- 已完成：M0 可行性探针（4/4 PASS）、M1 容器骨架（9/9 + `unzip -l` 互操作 + diff 往返）、M2 manifest + `validate`（16/16 + E401 负向）、M3 `render` + core 符号（25/25 + 自包含 HTML）、M4 `include`（35/35 + 多级 include 端到端）。**v1 三项能力（资源随包 / 符号扩展 / 文件包含）至此全部实现。**
- 已完成 M5：conformance fixtures **43 个用例**（`spec/fixtures/<id>/{case.json,input/}`，驱动 `packages/mdpkg/test/fixtures.test.ts`）。
- 已完成 M6：规范与实现逐条对齐，补齐 5 处「规范承诺但实现缺失」（E701/E702 版本协商、`--referenced-only`、`export --raw/--expanded`、`mdpkg diff`），`--fetch` 显式标注为 v1 不提供。
- **M0–M6 全部完成**（M7 为延后项）。
- 已完成 zip-core 跨端核心层 + mdpkg-web 浏览器库（`openMdpkg` / `packMdpkg` / `readEntrySource`）+ repack 往返能力 + 限额与边界回归测试。**全量测试 136 用例**。
- 已完成 lenient-open（宽容打开普通 ZIP 文档）上线：`render` / `export` / `openMdpkg` 接受无 manifest 的 zip，推断入口 + 标注 `unverified` / `entry`；unpack/list 静默截断根治（分块 push 替代 fflate 递归限制，issue #1 关闭）。
- 已完成 docx 导出（`render --format docx`）+ zip 交付物导出（`export --zip`）：OOXML 文档含嵌入资源 / 标准 zip 含展开后 Markdown + 资源 + README。
- 导出格式矩阵定案：md（`export --md` / `toMarkdown`）/ mdpkg（`pack` / `packMdpkg`）/ html（`render` / `toHtml`）/ zip（`export --zip` / `toZip`）/ docx（`render --format docx` / `toDocx`）；pdf 用浏览器打印兜底（`window.print()`），不做导出能力。
- 已完成浏览器端 `openFiles` 统一入口：任意文件 Map 的 lenient 渲染（入口推断 + 未校验标注），供目录/多条目拖入场景使用；`openMarkdown` 内部委托它。demo/浏览器库支持拖入 .md / .mdpkg / .zip / 文件夹（文件夹含同级附件，图片内联显示）。
- 已知缺口：`--fetch` 未提供（规范已标注为参考实现 v1 不提供）；M7（VS Code 插件）在采用可行性验证前不启动。
- 定位：先自用后标准化，3 个月止损判据；VS Code 插件（M7）在采用可行性验证前不启动。
- 2026-08-31：MDE → mdpkg 统一改名完成（错误码 MDPKG-EXXX，manifest 标识字段 format:"mdpkg"），三仓库拆分：mdpkg（本仓库，格式+CLI）/ md-bundle（网页工具占位，新建）/ clairis（桌面旗舰）