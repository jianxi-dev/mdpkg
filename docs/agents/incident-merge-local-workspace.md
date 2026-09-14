# 事故复盘：合并收尾切回旧分支导致本地工作流失效

> 适用：本仓库所有涉及分支合并/跨仓库同步的收尾操作
> 最后更新：2026-09-14

## 事故（2026-09-14）

上游 mdpkg 修复 docx 导出 8 项缺陷后，将新构建的 web/mdpkg-web.js 同步至 md-bundle（PR #96）。
合并成功后收尾执行了：

git checkout <任务前分支>   # 切回任务前分支
git stash drop             # 丢弃临时改动
git branch -D <已合并分支>

**后果**：本地工作区文件随 checkout 还原为旧版本，dev server 直接从磁盘加载该文件
→ 本地验证「修复未生效」→ 误判为部署/修复失败，排查成本翻倍。

## 根因

- 收尾逻辑只考虑「恢复任务前现场」，未考虑本地运行时（dev server）对工作区文件的依赖
- 跨仓库场景放大：修复在 A 仓、生效在 B 仓，线上/本地/vendor 拷贝状态交叉，更容易误判

## 规则（MANDATORY）

1. 合并/收尾后本地工作区必须停留在 main 并 git pull——禁止切回任务前分支（除非显式声明对本地 dev 工作流的影响）
2. 删除已合并分支前：确认当前 checkout 目标为 main，且 git status 干净
3. drop stash 前三确认：stash 内容已提交或已无价值（git stash show 核对）
4. 涉及 checkout/stash/reset/worktree 增删前：检查是否有本地进程依赖本工作区（dev server 等：lsof -nP -iTCP:<port> -sTCP:LISTEN），有则收尾后提示重启或保留目标分支

## 收尾检查单（合并后逐项确认）

- [ ] git checkout main && git pull origin main（本地 = 线上）
- [ ] git status 干净（或仅声明过的残留）
- [ ] 已合并分支删除时确认在 main 上执行
- [ ] 本地 dev server 加载的是新代码（必要时提示硬刷新/重启）
- [ ] 向用户明确汇报「本地状态 ≠ 线上状态」的差异（如有）

## 相关

- 变更工作流：change-workflow（G3 收尾）
- 类似事故处理：incident-uncommitted-work-loss.md
