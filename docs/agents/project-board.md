# 完成跟踪看板(GitHub Projects)

> 生效日期：2026-09-12
> 状态：**已创建并配置完成**（2026-09-12，token 已补 `project` scope，API 全自动）

## 看板信息

- 看板：**MD-Bundle 开发看板** → https://github.com/orgs/jianxi-dev/projects/1
- Project ID（GraphQL）：`PVT_kwDOE0POlM4BjPai`
- Status 字段 ID：`PVTSSF_lADOE0POlM4BjPaizhiEhFM`
- 列（Status 单选项）：`Backlog`(GRAY) / `Ready`(BLUE) / `In Progress`(YELLOW) / `Done`(GREEN)
- 已实测：`addProjectV2ItemById` + `updateProjectV2ItemFieldValue` 全链路通过（issue #16 已在看板 Backlog）

## 日常维护（无需手动）

- 看板按 label 自动归类，不手动拖卡
- 每轮开发会话末：`openspec status --change <名> --json` 对账 tasks.md 与 issue 关闭数
- 完成跟踪入口 = GitHub Issues 列表 + 本看板（双视图同源）

## 常用 API（agent 可复用）

```bash
# 添加 issue 到看板
gh api graphql -f query='mutation { addProjectV2ItemById(input: {projectId: "PVT_kwDOE0POlM4BjPai", contentId: "<issue-node-id>"}) { item { id } } }'

# 设置状态列（optionId: Backlog=8c7f2979 Ready=a50766ca InProgress=a7011ca0 Done=4cbd348f）
gh api graphql -f query='mutation { updateProjectV2ItemFieldValue(input: {projectId: "PVT_kwDOE0POlM4BjPai", itemId: "<item-id>", fieldId: "PVTSSF_lADOE0POlM4BjPaizhiEhFM", value: {singleSelectOptionId: "8c7f2979"}}) { projectV2Item { id } } }'
```

## 与 label 状态机的对应

| 看板列 | 对应 label | 含义 |
|---|---|---|
| Backlog | `needs-triage` | 待评估 |
| Ready | `ready-for-agent` | 可执行 |
| In Progress | — | PR 打开中 |
| Done | — | issue closed |

> 注：GraphQL 无 workflow 更新 mutation，label→列自动化的开关在 UI（Workflows）配置。内置 workflow（Auto-add / Item closed 等）已存在，按需在 UI 启用。

## label→列 自动化（路径 2B）：建立时机与操作

**决策（2026-09-12）**：不在当前建立，**跟随下一个新 OpenSpec change 的 Task B 试点**一起落地。

### 为什么不是现在

- 当前 0 个 open issue、看板仅 1 个 item — 自动化规则无处生效，建了空转
- label 映射规则（needs-triage→Backlog、ready-for-agent→Ready）未经真实 issue 验证，试点后可能调整
- 内置 workflow 已覆盖核心闭环（进板→Backlog、PR 关联→In Progress、关闭/合并→Done）
- secret 维护有安全成本，过早建立要长期维护

### 建立时机：触发信号

```
下一个新 change 启动
  → openspec-propose 建 change + tasks
  → Task B 试点: to-tickets 发布第一批子 issue ← 关键信号，此时动手
  → 建 secret + workflow，让试点直接跑在自动化上
```

### 试点当天操作顺序

1. **建 secret**：把带 `project` scope 的 PAT 存为仓库 secret `PROJECT_TOKEN`（一次）
2. **写 `.github/workflows/project-board-automation.yml`**：label→列映射 + reopened→Backlog（合并进同一文件，一次配齐）
3. **试点跑通**：to-tickets 发布 issue → label 触发自动移列 → agent 捡活 → PR → 合并 → Done
4. **沉淀 skill**：试点结束，Task C 收尾（跑通 3-5 个真实 PR 后）

### 试点之前的替代方案（零配置，够用）

agent 创建 issue 时直接用上方"常用 API"的 `updateProjectV2ItemFieldValue` 手动设列（已实测通过）。试点开始后由 workflow 取代。

### label → 列 映射规则（待试点验证）

| label | 目标列 |
|---|---|
| `needs-triage` | Backlog |
| `ready-for-agent` | Ready |
| `ready-for-human` | Backlog（待人工） |
| issue reopened | Backlog（无 label，事件触发） |
| issue closed / PR merged | Done（内置 workflow 已覆盖） |

---

_配套：`docs/agents/task-tracking.md`(任务发布)、`docs/agents/defect-workflow.md`(缺陷流程)、`docs/agents/triage-labels.md`(状态标签)_
