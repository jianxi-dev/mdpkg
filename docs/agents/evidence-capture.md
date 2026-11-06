# 证据驱动测试规范（Evidence Capture）

> 适用范围：一切面向用户的 change / 缺陷修复，从 G1 出口独立验证到缺陷关闭的全流程证据采集与贴票。
> 生效日期：2026-09-20
> 配套：`docs/agents/quality-gates.md`（QG-5 / DQ-3 / DQ-5 定义）、`docs/agents/defect-workflow.md`（缺陷闭环）、`.opencode/skills/change-workflow/SKILL.md`（G0-G4 gate 编排——本文件的挂载点）

本规范定义**证据分层协议**、**7 类证据规范**与**探针形态约定**，每条规则固定四段：规则 / 理由 / 实证案例 / 如何验证。

---

## 一、背景

QG-5（G1 出口独立验证）与 DQ-5（关闭缺陷须附原始证据）要求「验证者自己的探针的原始输出」粘贴到票上，但未定义**证据的采集形态、分层协议与降级路径**。本规范补齐这一空白。

核心失效模式：**「测试通过」「已修复」「冒烟正常」是结论不是证据**。修复期 4 个「自测全绿但实际无效」交付 4/4 全部由独立探针推翻，零例外。证据规范的目标是让「自报完成」与「可观测完成」之间的差距无处藏身。

---

## 二、证据分层协议

### 规则

证据按**采集时机**分为两层：

| 层 | 采集时机 | 形态 | 用途 |
|---|---|---|---|
| **before** | 变更/修复**之前** | 截图 / 视频 / 测量数字 / transcript 摘录 | 证明「旧行为确实存在」——最便宜的采集时刻 |
| **after** | 变更/修复**之后** | 同上 | 证明「新行为已生效」 |

两层组成**成对证据**（before/after pair），缺一不可。

### 理由

before 必须在变更前采集，因为：

1. **变更后无法回溯**：修复完成后，旧行为消失，无法再采集 before。
2. **before 是最便宜的证据**：此时系统处于已知状态，采集成本最低。
3. **没有 before 就没有对照**：after 单独存在时，无法证明变化是由本次变更引入的。

### 实证案例

某缺陷修复票直接改代码，验证在事后补做。首版「修复」实际**引入回归**（有序列表数字消失 + 圆点覆盖任务标记）——若有先行的 before/after 对照，该回归会在同一轮暴露。

### 如何验证

```bash
# 检查票上是否有成对的 before/after 证据
gh issue view <票号> --json body --jq .body | grep -iE "before|after|修复前|修复后"
# 期望：至少各出现一次
```

---

## 三、7 类证据规范

### 3.0 运行时态（UI 票强制——静态产物无法替代）

#### 规则

UI 票的 QG-5 证据**至少包含一项运行时证据**：运行时截图、计算样式输出、或控制台零异常 + 组件挂载探针输出。仅静态产物（DOM 快照、字节 diff）不满足 UI 票的证据要求。

采集方式：

- **自动**：`python3 scripts/test_runtime_smoke.py <页面.html>` —— headless Chrome 打开本地渲染页，检查控制台零异常 + `[data-chart]`/`[data-illustration]` 容器非空。exit 0=过 / 1=失败 / 3=环境无 Chrome（降级记录，不得静默放行，见 §七）。
- **人工复核**：`bsk`（browser-skill）打开渲染页 + `screenshot` / `console` / `evaluate` 读计算样式。适合合并前最后一道实看。

**环境约束**：Chrome 拒绝 `file://` 导航（`Navigating to local URL is not allowed`）。本地页面验证须先起静态服务：`python3 -m http.server 8899 --directory <页面目录>`，再访问 `http://127.0.0.1:8899/<页面>`。`test_runtime_smoke.py` 已内置此服务，无需手工。

#### 理由

静态产物只比字节，不执行 JS。两类事故静态检查全漏：① 运行时异常中断渲染（#647 类：脚本抛 TypeError，快照只见空容器）；② 插画/图表组件未挂载（静态产物只有空容器，字节一致但页面空白）。「快照一致」≠「页面正确」。

#### 实证案例

某渲染产物快照逐字节一致，交付后页面空白——JS 在运行时抛异常中断了图表挂载。qa_html 不执行 JS，快照 diff 永远绿。补运行时冒烟后同类缺陷在 CMD_TEST 内即拦。

#### 如何验证

```bash
python3 scripts/test_runtime_smoke.py .artifacts/<task-name>/render.html
# 期望：exit 0，输出「控制台零异常 + 组件渲染完整」
```

**产出**：探针 stdout（含容器计数与异常列表）贴票/PR verification 段；运行时截图存 `.artifacts/<task>/runtime/`。

---

### 3.1 视频录制（UI 多步流程）

#### 规则

UI 多步流程（≥3 步交互）必须录制**带标注的视频**作为证据。录制须展示真实被驱动的会话，标注每个 `test_start` / `assertion` 及其结果（`passed` / `failed` / `untested`）。

#### 理由

截图只能捕获单点状态，无法证明**流程的连续性**。多步流程的 bug 往往落在步骤之间的过渡态（如「点击后等待渲染」），只有视频能覆盖。

#### 实证案例

某 change 的「语义编辑态」功能（11 个功能的核心）零 e2e、零视频证据。12 张票全部打勾，CI 全绿，而用户打开页面看不到任何变化。若有视频录制，实施者被迫**真实驱动应用**，无法用库层测试替代。

#### 如何验证

```bash
# 检查 PR 或票上是否有视频附件或链接
gh pr view <PR号> --json body --jq .body | grep -iE "\.mp4|\.webm|video|recording"
gh issue view <票号> --json body --jq .body | grep -iE "\.mp4|\.webm|video|recording"
```

**产出**：`evidence.mp4`（带标注烧录）+ `report.md`（测试摘要）+ `manifest.json`（环境元数据）。

**贴票/PR**：视频上传到 PR 评论框或外部托管，链接贴入 PR body 与票评论。

---

### 3.2 截图（UI 单点 / 成对 before/after）

#### 规则

UI 单点状态或成对 before/after 对比，使用截图。命名规范：`<序号>-<描述>-<结果>.png`（如 `01-before-empty-state.png`、`02-after-item-added-passed.png`）。

#### 理由

截图是**最轻量的 UI 证据**，适用于：

- 单点状态验证（「按钮可见」「弹窗打开」）
- before/after 对比（修复前后的视觉差异）

#### 实证案例

某票自报「结构面板已修复」，但 `useMemo([editorView])` 依赖稳定对象导致诊断**永不刷新**。一张 before 截图（面板空白）+ 一张 after 截图（面板仍空白）即可暴露问题。

#### 如何验证

```bash
# 检查 artifacts 目录是否有成对截图
ls .artifacts/<task-name>/ | grep -E "before|after"
# 期望：至少各一张
```

**产出**：PNG 文件，按序号命名，附 `assertions.md` 列出每张截图对应的断言。

**贴票/PR**：以两列对比表格（| 修复前 | 修复后 |）或媒体链接嵌入 PR 正文 verification 段——复用 E1 录制产物，不二次截图；不引入上游 CLI 与上传链（含敏感画面的流程标 untested 不录，见 §六）。

---

### 3.2.1 状态覆盖矩阵（交互类 UI 变更强制）

#### 规则

交互类 UI 变更（浮层 / 插入 / 可取消 / 可关闭 / 空态）的截图证据必须覆盖**状态覆盖矩阵**——六态中适用项，**至少 4 态**：

| 态 | 命名示例 | 断言要点 |
|---|---|---|
| 打开 | `01-open-menu.png` | 浮层/菜单/面板可见，焦点正确 |
| 切换 | `02-switch-tab.png` | 标签/模式切换，内容随之变化 |
| 取消 | `03-cancel-insert.png` | 操作取消，回初始态，**无残留文本/浮层/菜单** |
| 外部点击 | `04-click-outside.png` | 点击外部关闭，回初始态，**无残留** |
| 空态 | `05-empty-state.png` | 列表/编辑器为空时的引导/占位可见 |
| 关闭 | `06-close-panel.png` | 显式关闭动作，资源释放，回初始态 |

**机读清单约定**：每态产出一条记录到 `.artifacts/<task>/state-coverage.json`：

```json
{
  "task": "1.3",
  "states": [
    {"state": "open", "screenshot": "01-open-menu.png", "assertion": "passed"},
    {"state": "switch", "screenshot": "02-switch-tab.png", "assertion": "passed"},
    {"state": "cancel", "screenshot": "03-cancel-insert.png", "assertion": "passed"},
    {"state": "click-outside", "screenshot": "04-click-outside.png", "assertion": "passed"},
    {"state": "empty", "screenshot": "05-empty-state.png", "assertion": "passed"},
    {"state": "close", "screenshot": "06-close-panel.png", "assertion": "passed"}
  ]
}
```

**机检命令**：
```bash
ls .artifacts/<task>/state-coverage.json && jq '.states | length' .artifacts/<task>/state-coverage.json
# 态数 <4 = 违规
```

#### 理由

editor-v2 实证：D4 菜单点外部不关、D5 空态菜单驻留、D6 取消残留 `/`——均因**单层截图**无法捕获。单层截图只能证明「某一时刻存在」，无法证明「取消后回初始」「外部点击后关闭」「空态有引导」。状态覆盖矩阵把「多态证据」绑定到 **QG-4 第 4 级状态往返断言**的副产物（而非独立手工产物），使「是否多态」可机检（扫 spec 断言 + 扫清单态数）。

#### 实证案例

editor-v2 D4/D5/D6：仅单层截图（打开态）→ 无法拦截取消残留、外部点击不关、空态无引导。补齐六态截图 + 状态往返断言后，三条缺陷在 e2e 层即可暴露。

#### 如何验证

```bash
# 机检态数 + 断言结果
jq '.states[] | select(.assertion=="failed")' .artifacts/<task>/state-coverage.json
# 有失败 = 违规
jq '.states | length' .artifacts/<task>/state-coverage.json
# <4 = 违规
```

#### 参考实现（非受管，不背维护责任）

截图骨架绑死测试栈（Playwright / pytest / vitest 各仓不同），工具包不打包——
这里只留约定 + 指路。新仓接 state-coverage 时照抄已有消费仓的骨架，改态名和选择器即可：

| 测试栈 | 参考仓 | 骨架要点 |
|---|---|---|
| Playwright（TS/前端 SPA） | md-bundle `visual-baseline.spec.ts` | `test.describe` 每态一个 test；`page.screenshot({path: '.artifacts/<票>/01-open.png'})` 后写 state-coverage.json；像素基线用 `expect(page).toHaveScreenshot()` |
| pytest（Python 渲染产物） | contentweave `test_visual_baseline.py` | 每态一个 `test_*`；渲染 HTML → 截图库落 PNG → 断言后向 state-coverage.json 追加记录；`--check` 模式跑基线比对 |

约定不变：骨架只负责「产生截图 + 断言 + 写 state-coverage.json」，判据（≥4 态、PNG 不入库、manifest 入库）以本节为准。参考实现会随消费仓演进，**以消费仓当时的实现为准**，本附录不追踪其版本。

---

### 3.3 测量数字（接口 / 性能，非 UI）

#### 规则

非 UI 变更（API 行为、性能、渲染帧率）必须附**测量数字**：请求计数、延迟 before/after、输出对（diff）。捕获到 `probe-output.txt`。

#### 理由

UI 证据无法覆盖**非可视行为**。接口返回值、性能指标、解析结果等需要**精确数字**而非视觉描述。

#### 实证案例

某票修复「测试统计」显示 408 passed，但残留半成品文件未被计数，**误报为绿**。若有测量数字（实际文件数 vs 统计数），差异一目了然。

#### 如何验证

```bash
# 检查票上是否有测量输出
gh issue view <票号> --json body --jq .body | grep -iE "probe|latency|count|ms|requests"
```

**产出**：`probe-output.txt`（脚本化探针输出）+ 关键数字摘要。

**贴票/PR**：原始输出粘贴到票评论，关键数字写入 PR body。

---

### 3.4 transcript 摘录（agent 行为）

#### 规则

agent 行为验证（工具调用、决策路径）须附 **transcript 摘录**：展示工具调用与响应的相关段落。

#### 理由

当验证对象是**agent 自身的行为**（而非 UI）时，视频/截图无法覆盖。transcript 是 agent 行为的唯一可观测痕迹。

#### 实证案例

某缺陷票 `#187` 全程未经 triage 就被修复——若有 transcript 摘录展示 agent 的决策路径，跳步行为会在 review 时暴露。

#### 如何验证

```bash
# 检查票上是否有 transcript 引用
gh issue view <票号> --json body --jq .body | grep -iE "transcript|tool.call|agent.log"
```

**产出**：transcript 相关段落摘录（脱敏后），标注时间戳。

**贴票/PR**：摘录粘贴到票评论，标注「此处 agent 跳过了 triage」。

---

### 3.5 headless 降级路径（无 GUI / 无 ffmpeg 时）

#### 规则

无 GUI 或无 ffmpeg 时，**降级不改变门禁判据**——原始证据在任何降级形态下都必须存在，只是形态从媒体降为文本：

| 降级场景 | 替代方案 | 证据形态 |
|---|---|---|
| 无 GUI | Playwright 脚本化截图 + `assertions.md` | PNG + 文本 |
| 无 ffmpeg | per-turn 成对截图 | PNG 对 |
| 无 computer-use | `cua-driver` 驱动 + 文件协议标注 | 截图 + `assertions.md` |
| 无 UI（纯 API） | 脚本化探针 + 测量数字 | `probe-output.txt` |

#### 理由

环境限制不应成为**跳过证据的借口**。降级路径确保：无论环境如何，**原始证据必须存在**。

#### 实证案例

某 CI 环境无 GUI，agent 以「无法录制」为由跳过验证，直接自报「测试通过」。实际功能不存在。若有 headless 降级路径，agent 被迫产出截图 + 断言文件，无法跳过。

#### 如何验证

```bash
# 检查 artifacts 目录是否有降级证据
ls .artifacts/<task-name>/ | grep -E "assertions\.md|\.png|probe-output"
# 期望：至少存在一种降级证据
```

**产出**：`assertions.md`（每个 `test_start` / `assertion` 及结果）+ 截图或探针输出。

**贴票/PR**：`assertions.md` 内容粘贴到票评论，截图/探针输出附链接。

---

### 3.6 视觉探针（交互类 UI 变更强制）

#### 规则

交互类 UI 变更的验证，**必须包含视觉探针**——关键态截图 + 多模态复核（自动，见下方「如何验证」；仅在多模态不可用时才退回人工）。视觉探针是 QG-5 探针类型的第 5 项（见 `quality-gates.md` QG-5 探针类型清单）。

- **单层截图对交互票明确不足**——必须配合状态覆盖矩阵（§3.2.1，≥4 态）使用
- 视觉探针的截图由 **QG-4 第 4 级状态往返断言驱动产生**（副产物），而非独立手工产物
- `state-coverage.json` 与 e2e spec 状态断言**双管**机检（见 §3.2.1 机检命令）

#### 理由

editor-v2 实证：D2 callout「注释 注释」、D3 围栏 `\`js`、D6 取消残留 `/`——均为「元素存在」级断言 + 单层截图无法拦截。视觉探针把「人眼可辨真伪」纳入证据链：截图覆盖六态 + 多模态复核文本/像素真伪，堵住保真盲区。

另一个更隐蔽的失效：复核手段与复核要求写在两处且从未接通——`evidence-capture.md` 的 headless 降级表写着「无 GUI → Playwright 脚本化截图」，QG-5 要求「交互类 UI 变更须含视觉探针」，而 CI 的 T2 感知步骤条件是 `cmd_fidelity != ''`；四个消费仓中三个未配置该键，于是**步骤静默跳过、CI 依然全绿**。判据是 MUST、实现是零、状态是绿——三者同时成立。详见 `skills/change-workflow/SKILL.md` G2「CI 三层自动核验」的落地前提。

#### 实证案例

editor-v2 D2：仅单层截图（打开态）→ 无法发现标题重复。补齐状态覆盖矩阵（打开/切换/取消/外部点击/空态/关闭）+ 视觉复核「标头文本严格等于『注释』」→ 即时暴露。

#### 如何验证

```bash
# 机检：状态覆盖矩阵态数 + 断言结果（同 §3.2.1）
jq '.states | length' .artifacts/<task>/state-coverage.json
# <4 = 违规
```

**复核手段（按成本从低到高，能用低的就别用高的）**：

| 场景 | 命令 | 输出 |
|---|---|---|
| 图片是什么（布局/配色/母题） | `./scripts/cw-vision.sh describe <png>` | 模型描述正文 |
| 像素级硬数字（主色板/留白率/亮度分区） | `./scripts/cw-vision.sh analyze <png>` | JSON |
| 确定量（计算样式/DOM/文本） | 浏览器 skill：`bsk evaluate` 读计算样式 | 断言输出 |
| 多步流程过渡态 | `./scripts/cw-evidence.sh start` → 录视频 → `stop` | 带标注 mp4 + report.md |
| 视频里某一刻到底渲染了什么 | `./scripts/cw-vision.sh frame <mp4> <秒>` | 抽帧 PNG，再走 describe |

**为什么要有 `cw-vision.sh` 这一层**：同一个能力此前在各仓各写一份（`scripts/vision/vision.py`、`scripts/vision.py`、`analyze.py` / `analyze_image.py`，脚本头自己写着「同源副本，改动需同步两处」）。副本必然漂移，而漂移后的读图结论**看起来一样可信**。本脚本是唯一定位入口，按「`CW_VISION_CMD` → 仓内各候选路径 → 降级」选一个，退出码与 `cw-evidence.sh` 同一契约（成功 0 / 参数错 1 / 降级 3）。

**视频抽帧核查**（上一轮视频录制的缺口在这里）：录了视频不等于看了视频。`cw-evidence.sh stop` 产出的 `report.md` 只证明「录了且断言被记录」，不证明画面正确。对每张 `assertion` 取它的时间戳 t，抽一帧看一眼：

```bash
./scripts/cw-vision.sh frame .artifacts/<task>/evidence.mp4 42   # → frame-000042.png
./scripts/cw-vision.sh describe .artifacts/<task>/frame-000042.png
```

**降级契约**：`cmd_local` 缺失时退 3 并打印装什么；**退 3 不等于放行**——须把「缺什么工具 / 探测输出」记进票面（同 §六表）。本地已有 `python3` + `DEEPSEEK_API_KEY`（或仓内视觉脚本）时，「无法识别图片」不构成降级理由。

**复核记录须贴票**（PR body verification 段或票评论）：贴模型原始输出与抽帧文件名，不要只写「已人工复核，无问题」——那是结论不是证据（QG-5）。

---

## 四、探针形态（活代码优先）

### 规则

探针按**形态优先级**选用；禁止为验证另建静态技能副本：

| 优先级 | 形态 | 适用 |
|---|---|---|
| 1 | **活代码用例**：写成/扩展仓库既有测试基建的用例（如 `<E2E_DIR>` 的 e2e spec） | 仓库已有测试基建（`CMD_E2E` 已配置） |
| 2 | **轻量探针**：脚本化命令 / 手工操作 + 原始输出 | 无测试基建，或本票验证需要特定驱动方式 |

**禁止**为验证另建静态技能文档（如 `verify-<app>` 技能）承载驱动知识——选择器、启动命令、特性地图。

### 理由

静态文档装不下高频变化的知识。驱动知识（选择器、命令、特性地图）的变化速率远高于规范文档，快照式文档**必然腐烂**；腐烂的文档比没有文档更糟——agent 会信任它，用错误的选择器驱动、走过期路径。活代码用例随代码维护、被 CI 强制、失败即是信号。

### 实证案例

某工具包试点为高频迭代的 Web 应用生成静态验证技能（特性地图 + 驱动配方），自证通过。随后识别三条结构性问题：① 特性地图与选择器几天到几周过期，腐烂即误导；② 该技能的适用前提是「仓库无脚本化验证路径」，而消费仓均有 UI 且已有 e2e 基建——前提不成立；③ 与既有 e2e 套件（活代码）平行漂移——两边都要维护，只有活代码一边被 CI 约束。试点撤销，改为本约定。

### 如何验证

```bash
# 有测试基建：探针须为可复跑的活代码用例
git diff --name-only origin/main...<分支> | grep -E "\.spec\.|\.test\."
# 无测试基建：轻量探针的原始输出已贴票（同 QG-5 判据）
gh issue view <票号> --json body --jq .body | grep -E "原始输出|before|after"
```

---

## 五、挂载点

### QG-5（G1 出口独立验证）

本规范是 QG-5 的**证据采集层**。QG-5 要求「验证者自己的探针的原始输出粘贴到票上」，本规范定义**如何采集这些原始输出**：

- 验证者须按 §三 的 7 类规范之一采集证据（运行时态/视频/截图/测量数字/transcript/headless/视觉探针）
- 证据须包含 before/after 成对（§二）
- **UI 票须含运行时态证据**（§3.0：运行时截图、计算样式输出、或控制台+挂载探针输出，至少一项）
- 交互类 UI 变更须含**状态覆盖矩阵**（§3.2.1，≥4 态 + `state-coverage.json`）与**视觉探针**（§3.6）
- 视频/截图/测量数字/transcript 摘录/视觉探针复核记录须粘贴到票上

### DQ-3（先红后绿）

DQ-3 要求「修复前必须先有可复现的失败证据」。本规范定义**「红」的采集方式**：

- before 证据 = 「红」（修复前的失败状态）
- after 证据 = 「绿」（修复后的通过状态）
- 两者成对出现，缺一不可

### DQ-5（关闭缺陷须附原始证据）

DQ-5 要求「验证者跑自己的探针，原始输出粘贴到票上」。本规范定义**探针输出的形态**：

- UI 行为 → 视频或截图（交互类须含状态覆盖矩阵 + 视觉探针）
- 非 UI 行为 → 测量数字
- agent 行为 → transcript 摘录
- 降级环境 → headless 路径产物

---

## 六、护栏

### 规则

1. **必须展示真实被驱动的会话**：视频必须展示 agent 实际驱动应用的过程，禁止脚本回放、拼接片段、合成画面。
2. **不录密钥/令牌/客户数据**：录制前检查屏幕，确保无敏感信息。含敏感画面的流程标 `untested` 并说明原因。
3. **标明 commit/branch/deployment**：每份证据必须标注被测代码的精确版本（`git rev-parse HEAD` + `git branch --show-current` 或部署 URL）。
4. **含敏感画面的流程标 `untested` 不录**：无法脱敏的流程，标注 `untested` 并说明原因，禁止跳过。

### 理由

证据的**可信度**取决于其**真实性**。合成画面、缺失版本信息、含敏感数据的录制都会损害证据效力。

### 实证案例

某票自报「浏览器冒烟通过」，但视频显示的是**旧版本**的页面（commit 不符）。若无 commit 标注，该证据无法被采信。

### 如何验证

```bash
# 检查证据是否包含版本信息
gh issue view <票号> --json body --jq .body | grep -iE "commit|branch|deployment|rev-parse"
# 期望：至少出现一次
```

---

## 七、降级原则

**降级不改变门禁判据**——原始证据在任何降级形态下都必须存在，只是形态从媒体降为文本。

| 原始形态 | 降级形态 | 判据是否改变 |
|---|---|---|
| 视频 | 截图序列 + `assertions.md` | 否 |
| 截图 | 文本描述 + DOM 快照 | 否 |
| 测量数字 | 文本输出对 | 否 |
| transcript 摘录 | 工具调用日志 | 否 |

**禁止以「环境不支持」为由跳过证据采集**。若所有降级路径均不可用，票保持 OPEN 并标注 `untested` + 原因。

**降级须附机器可核验理由**：`cw-evidence.sh` 降级（exit 3）MUST 记录缺什么工具 / 命令及其环境探测输出，MUST NOT 默认放行。本地已具备 Playwright（`npx`）+ chromium + ffmpeg 时，「无截图环境」不构成降级理由。

---

## 八、一致性制品与 baseline（保真核验）

### 规则

有原型的 change，G0 MUST 从原型结构化表**程序化生成**一致性制品，并在实现前**锁定哈希**：

| 制品 | 内容 | 生成方式 |
|---|---|---|
| `conformance.json` | 验收锚点集（具体期望值 + 来源 + 断言类型 `exact`/`state-machine`/`perceptual`） | `scripts/cw-conformance.sh generate`（解析 anchors.md，四规则校验） |
| `baseline/*.png` | 每个定义态的原型基准截图（golden） | 从外部原型采集（截图 + 来源 URL + 时间戳） |
| `conformance.lock` | 制品哈希锁（`conformance.json` + `baseline/*.png` 的 sha256） | `scripts/cw-conformance.sh lock` |
| e2e 断言骨架 | 由锚点机械展开 | 生成器（后续 change） |

实现阶段 MUST 只消费、MUST NOT 篡改 baseline（哈希变即核验失败）。CI MUST 在 ui-surface 票上运行三层核验：**T1 确定量**（计算样式 / DOM / 文本 vs `conformance.json`）/ **T2 感知**（实现截图 vs baseline 的像素 / 感知 diff + 多模态结构化判定）/ **T3 状态机**（六态往返 + 无残留）。三层 MUST 自动执行，MUST NOT 依赖人工观察。

**机读清单入库**：`.artifacts/<票号>/state-coverage.json` 是**受控交付物**（入库，供 CI 结构校验）；截图 PNG 不入库（体积大；只上传 PR 后由多模态自动复核）。

### 理由

实测偏差**全部可枚举**（图标名 / 几何 / 色值 / 状态迁移），非审美——编码成机读制品即可机械核验。此前失败因规格只停散文、门禁无机检。baseline 由实现者反填是唯一真风险，故锚点须程序化解析 + 带来源 + 哈希锁。

### 实证案例

md-bundle `editor-fidelity`：16/16 勾选、CI 全绿、归档，用户见约 20 处偏差；**10/11 票零证据产物**（#327–#336 无 `.artifacts`），QG-5 证据写成「测试通过数 + 文字描述」（QG-5 自认无效形式）。

### 如何验证

```bash
# 一致性制品在位 + baseline 哈希锁
ls openspec/changes/<change>/conformance.json
ls openspec/changes/<change>/conformance.lock
# 生成器契约锁
./scripts/cw-conformance.sh verify <change>
# 证据 manifest（ui-surface 票；≥4 态）
jq '.states | length' .artifacts/<票号>/state-coverage.json
# CI 三层核验：evidence-check.yml（ui-surface 触发）
```
