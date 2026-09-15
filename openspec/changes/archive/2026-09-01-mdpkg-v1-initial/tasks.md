## 1. M0 可行性探针

- [x] 1.1 验证 fflate 压缩/解压与条目顺序控制：确认条目顺序由插入顺序决定、库不自动排序（S1）
- [x] 1.2 验证可重复构建：mtime 固定 1980-01-01、权限 0644/0755、`unzip -l` 正确显示（S2）
- [x] 1.3 验证符号转义哨兵法：确认「先解析后转换」顺序下 `\(tm)` 被误转换、哨兵法可行（S3）
- [x] 1.4 验证 AST 引用收集：确认 mdast 的 `text`/`code`/`inlineCode`/`link.url` 节点划分满足排除区需求（S4）

## 2. M1 容器骨架

- [x] 2.1 实现 ZIP 容器读写（fflate）：pack 全量打包、条目按路径码位升序、mtime 固定
- [x] 2.2 实现 `unpack`：强制路径校验（绝对路径/`..`/符号链接/盘符）
- [x] 2.3 实现 `list`：只读 header 列资源
- [x] 2.4 验证：9/9 单测 + `unzip -l` 互操作 + diff 往返

## 3. M2 manifest + validate

- [x] 3.1 实现 manifest 生成：`resources[]` 覆盖全部文件、按 path 升序、size + sha256
- [x] 3.2 实现字段归属：重打包保留作者意图字段、重算机器事实字段
- [x] 3.3 实现 `validate`：Schema（ajv 2020-12）+ size + sha256 + 路径规则 + 引用闭包
- [x] 3.4 实现负向用例：`MDPKG-E302` 等
- [x] 3.5 验证：16/16 单测 + `MDPKG-E401` 负向

## 4. M3 render + core 符号

- [x] 4.1 实现渲染管线：解包 → manifest 校验 → include 展开 → 解析 → 符号转换 → HTML 消毒 → 输出
- [x] 4.2 实现 core 符号映射表（10 项）+ 词边界规则 + 哨兵法转义
- [x] 4.3 实现 HTML 安全：rehype-sanitize、SVG 以 `<img>` 引用、外链 `referrerpolicy`
- [x] 4.4 实现 `--inline` / `--dir` 输出形态与 50 MB 自动降级
- [x] 4.5 验证：25/25 单测 + 自包含 HTML

## 5. M4 include

- [x] 5.1 实现 `<<<` 语法与列 0 触发规则（正则 `^<<<\s*(.+?)\s*$`）
- [x] 5.2 实现相对 URL 重写：`normalize(dirname(P) + "/" + R)`、围栏跟踪跳过代码块
- [x] 5.3 实现硬限制：深度 32 / 展开字节 10 MB / 次数 1000 / 循环检测
- [x] 5.4 验证：35/35 单测 + 多级 include 端到端

## 6. M5 conformance fixtures

- [x] 6.1 落盘 43 个 fixture 用例（`spec/fixtures/<id>/{case.json,input/}`）
- [x] 6.2 实现 fixture 驱动（`packages/mdpkg/test/fixtures.test.ts`）：六条通道 + `path`
- [x] 6.3 pack 类用例自动附加可重复性断言
- [x] 6.4 验证：全量 79/79（36 单测 + 43 fixture）

## 7. M6 规范-实现对齐

- [x] 7.1 补齐 5 处「规范承诺但实现缺失」：E701/E702 版本协商、`--referenced-only`、`export --raw/--expanded`、`mdpkg diff`
- [x] 7.2 `--fetch` 显式标注为 v1 不提供
- [x] 7.3 收尾补齐 `unpack-roundtrip` fixture，规范清单 43 个用例全覆盖
- [x] 7.4 验证：全量 79/79 保持

## 8. 治理补录（本 change）

- [x] 8.1 将现行规范按能力拆分补录为 7 个 OpenSpec 能力 spec
- [x] 8.2 记录技术选型与关键决策（design.md）
- [x] 8.3 归档本 change，使 `openspec/specs/` 成为后续变更的规范来源