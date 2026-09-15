## Why

mdpkg（Markdown Enhanced）v1 的需求整理、格式规范与参考实现已在 OpenSpec 机制之外提前完成（M0–M6 里程碑，规范 `spec/mdpkg-format-spec.md`、实现 `packages/mdpkg/`、测试 79/79 全绿）。项目缺少 OpenSpec 治理基线：`openspec/` 仅有空壳，变更历史、能力边界与需求来源无法在 OpenSpec 中追溯。本 change 将这段已完成的工作按 OpenSpec 机制补录归档，使 `openspec/specs/` 成为后续变更的规范来源。

## What Changes

- 将现行规范 `spec/mdpkg-format-spec.md` 按能力拆分补录为 7 个 OpenSpec 能力 spec（container / manifest / packing / symbols / include / pipeline / conformance），覆盖规范全部 MUST/SHOULD 要求与附录 A/B/C。
- 记录技术选型与关键决策（design.md）：Node.js/TypeScript、remark/unified 管线、fflate、rehype-sanitize、ajv、哨兵法符号转义、AST 引用收集。
- 记录已执行的里程碑与验证结果（tasks.md）：M0 可行性探针、M1 容器骨架、M2 manifest+validate、M3 render+符号、M4 include、M5 conformance fixtures、M6 规范-实现对齐。
- 归档后 `openspec/specs/` 成为现行规范来源；`spec/mdpkg-format-spec.md` 保留为发布用渲染稿（README 引用），两者以 openspec 为准。

## Capabilities

### New Capabilities

- `container`: ZIP 容器格式——基本约束、识别条件、压缩策略、可重复构建、目录结构、路径与编码规则（对应规范 §2/§3/§5）
- `manifest`: `manifest.json` 结构与字段——格式标识、spec_version、entrypoint、extensions、resources 索引、字段归属规则（对应规范 §4 与附录 C Schema）
- `packing`: `mdpkg pack` 行为——入口解析、全量/`--referenced-only` 模式、AST 引用收集与闭包校验、孤儿资源 warning、`--fetch` 边界（对应规范 §6）
- `symbols`: 符号扩展——core profile 映射、词边界规则、排除区、哨兵法转义（对应规范 §7.1）
- `include`: 文件包含——`<<<` 语法与触发规则、路径解析、相对 URL 重写、嵌套与硬限制、循环检测（对应规范 §7.2）
- `pipeline`: 处理管线与命令行——渲染管线顺序、HTML 安全、完整性校验边界、解包安全上限、版本协商、命令契约、render 输出形态、三层兼容性（对应规范 §8/§9 与附录 A 错误码）
- `conformance`: 一致性测试向量——fixtures 目录与格式、case.json 字段、驱动通道、可重复性断言（对应规范附录 B）

### Modified Capabilities

- （无——本项目首次引入 OpenSpec 治理，`openspec/specs/` 当前为空）

## Impact

- **新增**：`openspec/specs/<capability>/spec.md`（7 个能力 spec）；`openspec/changes/mdpkg-v1-initial/`（本 change，归档后移入 `openspec/changes/archive/`）。
- **保留不动**：`spec/mdpkg-format-spec.md`（发布用渲染稿）、`spec/schema/manifest-1.0.json`、`spec/fixtures/`、`packages/mdpkg/` 实现与测试、`PLAN_MERGED.md`（历史立场记录）。
- **无代码变更**：本 change 是治理补录，不修改任何实现或测试行为。
- **后续约束**：新需求/变更须走 OpenSpec 流程（`/opsx-propose` → specs → `/opsx-apply` → archive），修改规范以 delta spec 形式落盘，再同步发布稿。