<!-- change-workflow 工具包模板 —— 由 setup.sh 安装到目标项目 docs/agents/。
     示例值（模块列表 / 看板 ID / 质量门禁命令）请按目标项目调整；
     占位符 jianxi-dev/mdpkg / PVT_kwDOE0POlM4BjPai / PVTSSF_lADOE0POlM4BjPaizhiEhFM / {{OPT_*}} 由 setup.sh 自动替换。 -->

# Triage 标签

> 最后更新：2026-09-07

工程 skill 使用 5 个 canonical triage 角色。本文件将这些角色映射到本仓库 issue tracker 中实际使用的标签字符串。

| mattpocock/skills 标签 | 本仓库标签 | 含义 |
|---|---|---|
| `needs-triage` | `needs-triage` | 维护者需要先评估此 issue |
| `needs-info` | `needs-info` | 等待报告者补充信息 |
| `ready-for-agent` | `ready-for-agent` | 已充分定义，可交给 agent 执行 |
| `ready-for-human` | `ready-for-human` | 需要人类决策或实现 |
| `wontfix` | `wontfix` | 不处理 |

当 skill 提到某个角色（例如"apply the AFK-ready triage label"）时，使用上表右侧对应的标签字符串。

## 项目补充标签

缺陷严重级别、wave 标签、模块标签等详见 `docs/agents/issue-tracker.md`。
