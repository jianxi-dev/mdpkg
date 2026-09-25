# 证据驱动测试规范（Evidence Capture）

> 适用范围：一切面向用户的 change / 缺陷修复，从 G1 出口独立验证到缺陷关闭的全流程证据采集与贴票。
> 生效日期：2026-09-20
> 配套：`docs/agents/quality-gates.md`（QG-5 / DQ-3 / DQ-5 定义）、`docs/agents/defect-workflow.md`（缺陷闭环）、`.opencode/skills/change-workflow/SKILL.md`（G0-G4 gate 编排——本文件的挂载点）

本规范定义**证据分层协议**与 **5 类证据规范**，每条规则固定四段：规则 / 理由 / 实证案例 / 如何验证。

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

## 三、5 类证据规范

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

**贴票/PR**：使用 `before-and-after` CLI 生成对比 Markdown 嵌入 PR。

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
| 无 ffmpeg | `before-and-after` CLI 或 per-turn 截图 | PNG 对 |
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

## 四、挂载点

### QG-5（G1 出口独立验证）

本规范是 QG-5 的**证据采集层**。QG-5 要求「验证者自己的探针的原始输出粘贴到票上」，本规范定义**如何采集这些原始输出**：

- 验证者须按 §三 的 5 类规范之一采集证据
- 证据须包含 before/after 成对（§二）
- 视频/截图/测量数字/transcript 摘录须粘贴到票上

### DQ-3（先红后绿）

DQ-3 要求「修复前必须先有可复现的失败证据」。本规范定义**「红」的采集方式**：

- before 证据 = 「红」（修复前的失败状态）
- after 证据 = 「绿」（修复后的通过状态）
- 两者成对出现，缺一不可

### DQ-5（关闭缺陷须附原始证据）

DQ-5 要求「验证者跑自己的探针，原始输出粘贴到票上」。本规范定义**探针输出的形态**：

- UI 行为 → 视频或截图
- 非 UI 行为 → 测量数字
- agent 行为 → transcript 摘录
- 降级环境 → headless 路径产物

---

## 五、护栏

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

## 六、降级原则

**降级不改变门禁判据**——原始证据在任何降级形态下都必须存在，只是形态从媒体降为文本。

| 原始形态 | 降级形态 | 判据是否改变 |
|---|---|---|
| 视频 | 截图序列 + `assertions.md` | 否 |
| 截图 | 文本描述 + DOM 快照 | 否 |
| 测量数字 | 文本输出对 | 否 |
| transcript 摘录 | 工具调用日志 | 否 |

**禁止以「环境不支持」为由跳过证据采集**。若所有降级路径均不可用，票保持 OPEN 并标注 `untested` + 原因。
