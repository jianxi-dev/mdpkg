# 任务发布与跟踪（to-tickets 桥接规范）

> 适用范围：把 OpenSpec change 的 tasks 发布为 GitHub issue，打通"spec → 开发 → 完成跟踪"全链路。
> 生效日期：2026-09-12
> 配套：`docs/agents/quality-gates.md`（**QG-1..QG-7 质量门禁——票的 AC 与完成判据**）、`docs/agents/issue-tracker.md`（issue 操作）、`docs/agents/triage-labels.md`（状态标签）、`docs/agents/defect-workflow.md`（缺陷流程）

---

## 1. 核心原则

- **tasks.md 是唯一权威清单**，GitHub issue 是执行与跟踪面。issue 关闭时回写 tasks.md checkbox。
- **功能票与 bug 票统一仓库共存**：功能票标题带 `[change=<change名>]` 前缀，bug 票带 `[Px]` 前缀，靠标签区分。
- **1 task = 1 ticket**：每条任务一个 issue，带验收条件（AC）+ 阻塞关系（Blocked by）。

## 2. 拆票粒度

- **一条 task 一票**：tasks.md 本身就是垂直切片粒度（每条约 1 commit），天然匹配。
- **Parent = 源 issue（to-tickets/to-spec 原语）**：每张子票统一引用其来源 spec issue（G0-PRE 由 to-spec 创建）作为 Parent，**不另设 wave/change 级 parent**；对账锚点即该 spec issue（§4）。
- 标题前缀防刷屏：`[change=md-bundle-v2/1.3]` 格式。

## 3. 发布规则（走 GitHub issue）

to-tickets 流程在本仓库一律发布为 GitHub issue（不使用本地 `.scratch/`），因为 tracker 配置就是 GitHub。

每个 ticket 必须包含：
- **Parent**：源 spec issue（to-spec 创建的规格票）引用
- **What to build**：从用户视角描述端到端行为
- **Acceptance criteria**：具体可验证的 AC 清单（**须满足 QG-1**，见下）
- **Blocked by**：阻塞它的其他 ticket 引用（无则 "None — can start immediately"）
- **接线归属**（QG-3）：本票导出的新 API 由**哪张票**负责接进 `apps/web`，及其**具体接线位置**
- 标签：`ready-for-agent` + 模块标签，或加 `no-ui-impact`（豁免 QG-1/QG-2）

### 3.1 AC 质量门禁（QG-1 / QG-3）

> 完整定义见 `docs/agents/quality-gates.md`。此处仅列发布时必须通过的检查。

**QG-1｜面向用户的票，AC 必须含浏览器可观测陈述**：

```
在 `pnpm --filter @md-bundle/web dev` 打开的页面中，
<具体操作> 之后，<可具体观测的结果>。
验证：apps/web/test/<feature>.spec.ts 通过。
```

**反向验收判据**：若一条 AC 能在**不修改 `apps/web`** 的前提下被满足 → 票切错了（QG-7）。

**QG-3｜分派接线**：任何导出新 API 的票，必须显式指定接线票与接线位置；无引用且未指定 → 拒票。

**禁入信号（出现任一即拒票）**：
- AC 全部是库层断言（如「`getBlocks()` 返回块数组」「类型检查通过」）
- AC 无法用「打开页面操作一次」验证
- 导出新 API 却无 `apps/web` 引用、且未指定接线票

## 4. 子票关联与对账（Parent = 源 spec issue）

to-tickets 拆出的每张子票统一引用其**来源 issue**（G0-PRE 由 to-spec 创建的 spec issue）作为 Parent——**不另设 wave/change 级 tracking issue**（遵循 to-tickets/to-spec 原语；spec issue 即需求定义面与对账锚点）：

```markdown
## 子票信息

**Parent**: #<spec issue 号>（源规格票：需求定义与对账锚点）
**What to build**: 从用户视角描述端到端行为
**Acceptance criteria**: 具体可验证的 AC 清单
**Blocked by**: 阻塞它的其他子票引用（无则 "None — can start immediately"）
```

- 子票标题统一 `[change=<名>/<task号>]` 前缀
- 标签：`ready-for-agent` + 模块标签
- **生命周期**：spec issue 保持 OPEN 贯穿整个 change（需求可评论迭代）→ 全部子票随 PR 合并 `fixes #N` 自动关闭 → change 收口（§8）时主流程 `gh issue close` 关闭 spec issue
- **对账**：子票（`[change=<名>/` 前缀精确匹配）数量与 tasks.md task 数一致；tasks.md checkbox ↔ 子票关闭数逐条对账（§5）

## 5. 完成回写

- 开发完成：commit 写 `fixes #<issue号>` → GitHub 自动关 issue
- 关 issue 时同步勾选 tasks.md 对应 checkbox
- 每轮开发会话末：`openspec status --change <名> --json` 对账 tasks.md 与 issue 关闭数

## 6. commit 规范（审计链）

- `fixes #N`：PR 合并时自动关闭 issue N
- `refs #N`：仅关联引用，不自动关闭
- 分支命名：`feat/<slug>`（功能）/ `fix/<slug>`（缺陷），1 分支 = 1 PR

## 7. Skill 编排与质量保证（2026-09-12 定稿）

> 对应 Lavish 联动方案 3.9 节。脚本（`pr-automation.sh`）负责确定性机械动作，skill 负责判断性质量保证——脚本不能替代 skill，skill 不能替代脚本。

### 7.1 执行前（实施阶段）

| Skill | 作用 | 强制? |
|---|---|---|
| `implement` | 总编排：按 spec/tickets 实施，自动内嵌 tdd + 定期 typecheck/test，完成后调 code-review | ✅ 必用 |
| `tdd` | 测试先行（红→绿 + 垂直切片），锁定行为契约。**测试须满足 QG-4**（驱动真实路径，禁止绕过 keymap/事件/公共 API） | ✅ implement 内嵌 |
| `programming` | 代码规范对照（no any / 250 LOC 上限） | 可选叠加 |
| 四件套硬门禁 | `pnpm -r typecheck/lint/test`（+e2e 涉及时），push 前强制 | ✅ `pr-automation.sh` 已内置 |
| **e2e 硬门禁（QG-2）** | 用户可见变更**必须**新增/扩展 `apps/web/test/*.spec.ts`，否则票上须有 `no-ui-impact` | ✅ **新增门禁，push 前强制** |
| **独立验证（QG-5）** | 验证者跑自己的探针并把**原始输出**粘贴到票上；未附原始证据的「已完成」不予采信 | ✅ **新增门禁** |
| **集成 checkpoint（QG-6）** | change ≥6 票时，每 ≤4 票合并 + `pnpm -r build` + 浏览器打开一次 | ✅ **新增门禁** |

> **QG-2 的由来（2026-09-20）**：`editor-v2` change 期间新增 e2e 为 **0**，CI 跑的是 v1 旧行为——「CI 绿」只等于「旧功能没坏」，与「新功能存在」逻辑上无关。CI 已在跑 e2e，此门禁**不增加基建成本**，只是让覆盖跟上新功能。完整根因见 `docs/agents/retro-editor-v2-quality.md`。

### 7.2 执行后（发布阶段）

| Skill | 作用 | 触发条件 |
|---|---|---|
| `code-review` | 双轴自审（Standards 代码规范 + Spec 需求符合，并行防互相掩盖）。**须对照 QG-4 逐条检查测试是否驱动真实路径** | ✅ 每次提交后 |
| `review` | Pre-Landing 结构审查（SQL 安全/LLM trust boundary/条件副作用/scope drift） | ⚠️ 仅 risk-medium/high |
| `qa` | 浏览器真机验证（diff-aware），health score + ship-readiness | 发布前 |
| `ship` | 全自动发布（版本 bump + CHANGELOG + PR） | 正式发版 |

> **关于 ship 与测试的重复（2026-09-12 实测修正）**：ship skill 源码硬编码 "Never skip tests"（SKILL.md:1406）且禁止因 CI 已跑而跳过验证（line 879）。**ship 每次都会重跑测试——这是 skill 的强制行为，无法通过文档说明省略**。但实测本仓库 test 仅 ~3s（371 passed / 3.10s），且 ship 测的是 merge-base 合并后状态（与 CI 测的 PR head 状态不完全等同），重复成本可忽略、有独立价值。**结论：ship 测试保留，不算冗余**。真正该省的"大重复"是本地四件套与 CI 之间的浪费（本地 30s 拦截 vs CI 3min 权威），已在 §7.1 通过硬门禁解决。

### 7.3 收尾（闭环，每轮必做）

| Skill | 作用 | 时机 |
|---|---|---|
| `learn` | 沉淀经验（模式/陷阱/偏好），`/learn` 管理 | ✅ **ship（push + PR 创建）后立即** |
| `sync-gbrain` | 刷新代码索引，后续 agent 可语义检索新代码 | ✅ learn 之后立即 |

> **时序修正（2026-09-12）**：learn + sync-gbrain 在 **ship（推送 + 创建 PR）后立即执行，不等合并**。理由：
> - learn/sync-gbrain 操作的是**本地工作区文件**，代码推送后本地即最新，无需等远端合并
> - risk-medium/high 的 PR 需人工合并，若等合并才收尾，会**阻塞下一个 change 启动**
> - 合并发生时只需一次增量 `gbrain sync` 对账（秒级），不构成依赖
>
> 正确闭环：实现 → 四件套 → code-review → commit → push + PR → **learn → sync-gbrain → 下一轮 change**；合并为异步事件，事后可选增量 sync。

### 7.4 重复点优化（按风险分级的最小充分集）

- **test 4 层保留前三层**：tdd 单测（秒级反馈，锁行为）→ 本地四件套（push 前全量，防浪费 CI 轮次）→ CI build-test（权威环境，锁文件/平台差异）。价值递进非冗余。
- **ship 内 test 删除**：CI 已全绿，ship 只做版本+bump+CHANGELOG+PR，不重跑测试。
- **code-review 与 review 错开**：low → 仅 code-review；medium/high → 加 review。
- **净效果**：low = tdd→四件套→CI→code-review；medium/high = 上述 + review。

### 7.5 闭环示意（任务级）

```
捡 issue → 校验 QG-1(AC 可页面验证)/QG-3(接线已归属)
  → implement(tdd + typecheck/test，测试须满足 QG-4 真实路径)
  → 四件套硬门禁 + e2e 硬门禁(QG-2)
  → code-review(对照 QG-4) → [QG-5 独立验证：粘贴原始输出]
  → git-master 提交 fixes #N → push → pr create(risk 分级)
  → CI → low:auto-merge / medium/high:review+人工
  → learn → sync-gbrain → 下一轮 issue
  [QG-6] change ≥6 票时每 ≤4 票插入集成 checkpoint
qa(发布前真机) / ship(正式发版) 按需接入
```

> **QG-5 的强制位置**：独立验证发生在 **code-review 之后、commit 之前**。未附验证者原始输出的「已完成」不得进入 G2 提交。

## 8. Change 级收尾（自动触发，无需手动喊）

> OpenSpec change 是任务的**上级单元**：一个 change 含多个 tasks（→ 多个 issues）。任务级闭环（§7）管单个 issue；本节管整个 change 的生命周期终点——**全部 tasks 完成 + 关联 PR 全合并后，自动 sync + archive，不等人触发**。

### 8.1 自动触发条件（agent 每轮收尾检查）

agent 在每次任务级收尾（learn + sync-gbrain 后）自动运行：

```bash
openspec status --change <名> --json   # 检查 completedTasks == totalTasks
gh issue list --label ready-for-agent --state open   # 检查该 change 无残留任务
gh pr list --state open --head <关联分支>            # 检查无未合并 PR
```

**全部满足 → 自动进入 §8.2 收尾序列**（无需用户确认；risk-low 文档/归档操作为可逆，直接执行）。

### 8.2 收尾序列（自动执行）

| 步骤 | 命令 | 作用 | 失败处理 |
|---|---|---|---|
| 1. 一致性修订 | `/opsx-update` | 实施中若有漂移，先修订规划产物与代码对齐 | 无漂移则跳过 |
| 2. 主 spec 同步 | `/opsx-sync` | delta specs 智能合并回 `openspec/specs/<capability>/spec.md` | 无 delta 则跳过 |
| 3. 严格验证 | `npx openspec validate <名> --strict` | 验证 change + 主 spec 一致性 | 失败 → 修复后重跑，不归档 |
| 4. 归档 | `/opsx-archive` | change 移入 `openspec/changes/archive/YYYY-MM-DD-<名>` | — |
| 5. 看板收口 | `gh issue close` spec issue + 看板置 Done | 生命周期终点记录 | — |
| 6. 索引刷新 | `gbrain sync` 增量 | main specs 变更入索引 | — |

### 8.3 与任务级闭环的关系（两级闭环）

```
【任务级】(每个 issue,§7)
  issue → implement → 四件套 → code-review → push+PR → learn → sync-gbrain → 下个 issue
【Change 级】(整个 change,§8,自动触发)
  全部 tasks [x] + PR 全合并
    → /opsx-update(如有漂移) → /opsx-sync → validate --strict
    → /opsx-archive → 看板 Done → gbrain 增量
```

**设计要点**：
- 任务级闭环管"单 issue 是否交付"，change 级管"整个 change 是否收口"——两级串行，互不阻塞
- 收尾全程自动：agent 检测到完成条件即执行，无需用户喊 `/opsx-sync` `/opsx-archive`
- 唯一人工介入点：risk-medium/high 的 PR 合并确认（机制既有规则）

---

_最后更新：2026-09-20_
