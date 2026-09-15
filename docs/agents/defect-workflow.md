<!-- change-workflow 工具包模板 —— 由 setup.sh 安装到目标项目 docs/agents/。
     示例值（模块列表 / 看板 ID / 质量门禁命令）请按目标项目调整；
     占位符 jianxi-dev/mdpkg / PVT_kwDOE0POlM4BjPai / PVTSSF_lADOE0POlM4BjPaizhiEhFM / {{OPT_*}} 由 setup.sh 自动替换。 -->

# 缺陷管理流程

> 本仓库所有缺陷统一使用 **GitHub Issues** 管理，仓库：`jianxi-dev/mdpkg`
> 
> 本地文件 `bug-registry-*.md` 仅作为缓存，**GitHub Issues 是唯一事实来源**。
> 
> **缓存策略（2026-09-12 起）**：废弃本地 `bug-registry-*.md` 缓存维护，一律以 `gh issue list` 为准。需要本地快照时临时生成，不再维护"缓存 ↔ GitHub"双向同步。

> 涉及未提交改动、错误计划、snapshot 恢复或 `reset`/批量覆盖时，先阅读 `docs/agents/incident-uncommitted-work-loss.md`；该文档是共享工作区保护和恢复流程的唯一来源。

---

## 快速操作

### 创建新缺陷

```bash
# 交互式创建
cd /Users/mason/ToHighs/md-bundle
gh issue create --title "[bug] 缺陷标题" --body "详细描述" --label "bug,p0,editor"

# 或一次性创建（推荐用于批量导入）
cd /Users/mason/ToHighs/md-bundle
gh issue create \
  --title "[bug] 缺陷标题" \
  --body "## 问题描述
描述问题...

## 期望行为
期望的结果...

## 复现步骤
1. 步骤1
2. 步骤2

---
*模块: editor*
*优先级: P0*" \
  --label "bug,p0,editor"
```

### 查看缺陷列表

```bash
# 列出所有开放缺陷
cd /Users/mason/ToHighs/md-bundle
gh issue list --state open

# 按标签过滤
gh issue list --label "bug,p0" --state open

# JSON 格式输出
gh issue list --state open --json number,title,labels,assignees
```

### 更新缺陷状态

```bash
# 添加评论
cd /Users/mason/ToHighs/md-bundle
gh issue comment <编号> --body "修复中..."

# 移交 triage 状态（5 个 canonical 标签）
gh issue edit <编号> --add-label "ready-for-agent"    # 已充分定义，可交给 agent 执行
gh issue edit <编号> --add-label "ready-for-human"    # 需要人类决策或实现
gh issue edit <编号> --remove-label "needs-triage"    # 离开待评估队列

# 关闭缺陷（修复完成）
cd /Users/mason/ToHighs/md-bundle
gh issue close <编号> --comment "已修复，提交 commit: xxx"
```

---

## 严重级别定义

| 级别 | 名称 | 定义 | 响应时间 |
|------|------|------|----------|
| P0 | 阻塞级 | 阻塞发布，核心功能无法使用 | 立即处理 |
| P1 | 高优先级 | 主流程受损，有 workaround | 24小时内 |
| P2 | 中优先级 | 有 workaround，体验受影响 | 1周内 |
| P3 | 低优先级 | 体验优化，功能增强 | 排期处理 |

---

## 模块标签

- `landing` - 落地页模块
- `editor` - 编辑器模块
- `renderer` - 渲染器模块
- `tabs` - 多页签模块
- `fsa` - FSA 文件工作区模块
- `save` - 保存模型模块
- `theme` - 主题模块
- `share` - 分享模块

---

## 状态流转

```
待评估 (open + needs-triage)
    ↓
已确认 (open + bug)
    ↓
待执行 (open + ready-for-agent) / 待人工 (open + ready-for-human)
    ↓
已关闭 (closed)
```

---

## 从聊天反馈创建缺陷

当用户通过聊天反馈缺陷时，按以下流程操作：

1. **提取信息**
   - 问题描述
   - 期望行为
   - 复现步骤
   - 严重级别判断 (P0/P1/P2/P3)
   - 模块归属

2. **创建 GitHub Issue**
   ```bash
   cd /Users/mason/ToHighs/md-bundle
   gh issue create \
     --title "[bug] 问题摘要" \
     --body "## 用户反馈
问题描述...

## 期望行为
...

## 复现步骤
...

---
*来源: 聊天反馈*
*模块: xxx*
*优先级: Px*" \
     --label "bug,px,模块"
   ```

3. **通知用户**
   - 回复用户："已创建 GitHub Issue #xxx 追踪此问题"
   - 提供链接：`https://github.com/jianxi-dev/mdpkg/issues/xxx`

---

## 批量导入（从本地文件）

如果缺陷先记录在本地 `bug-registry-*.md`，批量导入命令：

```bash
# 先确保所有标签已创建
cd /Users/mason/ToHighs/md-bundle
for label in "p0" "p1" "p2" "p3" "bug" "landing" "editor" "renderer" "tabs" "fsa" "save" "theme" "share"; do
  gh label create "$label" --force
done

# 然后逐个创建 issue（或使用脚本批量创建）
gh issue create --title "..." --body "..." --label "..."
```

---

## 查看缺陷看板

GitHub Projects 看板地址：
https://github.com/jianxi-dev/mdpkg/projects

或直接在仓库 Issues 页面查看：
https://github.com/jianxi-dev/mdpkg/issues

---

_最后更新：2026-09-12_
