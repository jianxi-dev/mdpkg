# Issue tracker: GitHub

> 最后更新：2026-09-10

本仓库的 issue、spec、缺陷统一使用 GitHub Issues 管理，仓库为 `jianxi-dev/mdpkg`。所有操作优先使用 `gh` CLI。

## 开发事故与恢复

涉及未提交代码、共享工作区、错误计划路由、snapshot 恢复或破坏性 Git 操作时，先阅读 `docs/agents/incident-uncommitted-work-loss.md`。其中的恢复门禁优先于普通 issue 操作：先保护工作区、再隔离验证、最后才覆盖或提交。

## 基本操作

- **创建 issue**：`gh issue create --title "..." --body "..."`，多行 body 用 heredoc。
- **查看 issue**：`gh issue view <编号> --comments`。
- **列出 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, labels: [.labels[].name], comments: [.comments[].body]}]'`。
- **评论 / 打标签 / 关闭**：`gh issue comment`、`gh issue edit --add-label`/`--remove-label`、`gh issue close`。
- **自动识别仓库**：在仓库克隆目录内运行 `gh` 会自动读取 `git remote -v`。

## 项目专用标签

除 `triage-labels.md` 中的 5 个 canonical 标签外，按本仓实际需要补充标签。通用层如下，模块层按本仓实际填写：

| 标签 | 含义 |
|---|---|
| `bug` | 真实缺陷 |
| `p0` | 阻塞级，无法发布 |
| `p1` | 高优先级，主流程受损 |
| `p2` | 中优先级，有 workaround |
| `p3` | 低优先级 / 体验优化 |
| `<module-a>` / `<module-b>` 等 | 模块标签，按本仓实际模块划分（安装时 setup.sh 按 `MODULE_LABELS` 创建） |

### 已废弃标签

| 标签 | 原因 |
|---|---|
| 阶段标识类标签（如 wave-N） | 阶段标识非缺陷属性，用 milestone 或 Projects 字段替代 |
| `in-progress` | 用 GitHub Projects 或 assignee 替代 |

## PR 作为 triage 入口

**否**。本仓库不将外部 PR 当作 feature request 处理。

## 当 skill 要求"发布到 issue tracker"

创建一个 GitHub issue，并打上合适的标签。

## 当 skill 要求"获取相关 ticket"

运行 `gh issue view <编号> --comments`。
