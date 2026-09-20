# 未提交代码丢失事故复盘与开发流程改进

> 最后更新：2026-09-10

> 事故类型：共享工作区中的未提交 UI 代码被破坏性回滚覆盖
>
> 影响范围：上一轮 mockup 驱动的 Toolbar、Landing、LeftRail、TabStrip、OutlineMenu 及相关导出/交互改动
>
> 状态：已从 OMO/OpenCode 会话 snapshot 恢复主要代码；恢复后仍需由维护者确认视觉效果

## 1. 事故结论

这不是 Hashline 失效，而是错误使用了历史回滚操作。

Hashline 的职责是：读取文件后给行附加内容哈希，编辑时验证目标行仍未变化。它能阻止 Agent 基于过期内容改错行，但不能生成未提交代码的历史快照，也不能通过 `LINE#ID` 恢复文件。

本次能够恢复，依靠的是 OMO/OpenCode 在本机保存的会话 patch 和 snapshot tree，而不是 Git commit 或 Hashline。这个恢复源不应被视为长期备份。

## 2. 时间线与根因

### 直接原因

1. 共享工作区存在大量未提交改动。
2. 一个子 Agent 被错误路由到无关的 `defect-management` 计划。
3. 该 Agent 生成了不属于当前目标的提交 `f496903`。
4. 为清除错误提交，执行了：

   ```text
   git reset --hard 952163f5fbd2474066dc7b30e89b266af2a7467e
   ```

5. `reset --hard` 同时丢弃了工作区中未提交的精细化 UI 文件。

### 系统性原因

- 没有在破坏性 Git 操作前强制保存工作区 patch。
- 没有把“当前计划”和“Agent 实际执行的计划”作为硬校验条件。
- 没有将未提交工作区视为需要保护的资产。
- 计划状态残留：OMO boulder 仍指向已结束的 `defect-management`，导致后续持续注入无关完成门。
- `/ship`、缺陷修复、视觉重构和会话恢复混在同一个工作树中，边界不清。
- 依赖 Agent 会话 snapshot 作为恢复方案，但没有提前确认 snapshot 是否是完整树、累计 diff，或只是工具输出摘要。
- 过早宣称“已经恢复”，实际只恢复了基础 commit 或重新生成了近似 UI。

## 3. 造成的影响

- 用户之前完成的精细化 UI 被替换为旧的 Emoji Toolbar 版本。
- `Gallery.tsx`、`OutlineMenu.tsx`、`gallery-examples.ts` 等未提交改动丢失。
- 后续恢复过程中出现了混合版本：旧基础代码、当前会话 P0 修复、上一轮 UI patch 同时存在。
- 测试证据文件与源码版本不一致，产生了 PNG 尺寸断言和 byline 断言失败。
- 用户无法判断当前页面是原始版本、恢复版本，还是 Agent 新生成的近似版本。

## 4. 恢复措施

### 已执行

1. 停止继续设计和 ship，不再用当前页面外观推断原始代码。
2. 检查 Git reflog、stash、dangling objects。
3. 检查 OMO/OpenCode 会话数据库：

   ```text
   ~/.local/share/opencode/opencode.db
   ```

4. 找到上一轮相关会话和子 Agent：
   - UI 整改会话
   - 水印/导出会话
   - 侧栏/最近文档会话
   - 图片交互会话
   - 相对路径会话

5. 找到项目专属 OMO snapshot tree：

   ```text
   ~/.local/share/opencode/snapshot/
   ```

6. 在临时目录中验证 snapshot 内容，确认 Toolbar 使用 `const ICON` SVG 系统，而不是 Emoji。
7. 在真实工作区覆盖前保存当前状态：

   ```text
   /var/folders/.../md-bundle-recovery/worktree-before-full-restore/
   ```

8. 恢复上一轮 snapshot 中的完整源代码和相关新增文件。
9. 恢复后通过 typecheck、build 和大部分单测/e2e 回归。

### 当前恢复证据

- Toolbar 已包含 `const ICON` 和 `onCopyBodyAsImage`。
- Landing、TabStrip、LeftRail、OutlineMenu 已回到上一轮 mockup 驱动版本。
- `gallery-examples.ts` 已从会话 patch 单独取回。
- `pnpm -r typecheck` 通过。
- `pnpm -r build` 通过。
- `pnpm -r lint` 无错误，但仍有 3 个 warning。
- 单测剩余失败属于旧 PNG 证据尺寸不一致，不是 TypeScript 编译失败。
- e2e 剩余失败属于旧 share-card byline 断言不一致。

## 5. 经验教训

### Git 回滚不是工作区恢复

`git reset --hard <commit>` 只能回到 Git 记录的 commit。它不会知道用户刚才在编辑器里写了什么，也不会保护未提交文件。

### Hashline 不是版本控制

Hashline 保护的是“这次编辑引用的行仍然是刚才读到的行”。它不保存完整历史，不恢复已丢失的文件，也不替代 commit、stash、patch 或备份。

### Snapshot 也要先辨认语义

会话数据库里的内容可能是：

- 当前步骤的累计 diff
- 某个工具调用的 patch
- 完整工作树 snapshot
- 仅用于上下文恢复的摘要

不能看到一个 hash 就直接当成 Git commit 使用。必须验证对象类型、文件树、时间点和应用基线。

### “测试通过”不等于“恢复正确”

旧测试可能覆盖功能但不覆盖用户视觉要求。恢复 UI 时必须同时检查：

- 视觉标记是否符合 mockup
- 关键图标是否仍为 SVG
- 页面结构是否属于正确版本
- 测试证据是否与当前源码匹配

## 6. 以后开发的强制流程

### A. 任何破坏性操作前：先冻结并备份

在执行以下命令前，必须先保存工作区：

```text
git reset --hard
git clean
git checkout -- <path>
git restore <path>
批量覆盖文件
切换到会改变同一工作树的恢复 snapshot
```

最低保护动作：

```bash
git diff --binary > /tmp/<project>-worktree-<timestamp>.patch
git status --short
```

如果有未跟踪文件，还必须复制未跟踪文件；仅保存 `git diff` 不够。

### B. 共享工作区：禁止直接 reset

默认规则：

- Agent 不得对共享工作区执行 `reset --hard`。
- 不得执行 `git clean`。
- 不得用 `git checkout -- <path>` 清理别人的改动。
- 发现错误提交时，优先用 `git revert` 或在隔离 worktree 修复。
- 若确实需要覆盖，先向用户说明将丢失什么，并取得明确确认。

### C. 复杂任务：每个目标使用独立 worktree

以下任务不能共用一个未提交工作树：

- UI 设计重构
- 缺陷修复
- `/ship` 发布准备
- snapshot 恢复
- 大型迁移

建议结构：

```text
md-bundle/                         # 用户当前工作区
md-bundle-recovery/                # 恢复候选
md-bundle-ui-review/               # UI 设计任务
md-bundle-ship/                    # 发布验证
```

任务完成后，用 diff 选择性合并，不把整棵目录互相覆盖。

### D. Agent 开工前：验证计划身份

每个 Agent 必须先报告：

```text
目标计划：<明确路径>
目标分支：<分支>
工作树：<绝对路径>
将修改：<文件清单>
不会修改：<明确排除项>
```

如果系统注入的 boulder/plan 与用户当前目标不一致，立即停止该 Agent，不得“先做完再说”。

### E. 每个逻辑单元完成后：立即形成可恢复点

优先顺序：

1. 写一个小而完整的 patch。
2. 运行对应测试。
3. 保存 patch 或提交一个原子 commit。
4. 记录恢复点、验证结果和剩余问题。

对于不适合立即 commit 的用户工作，也至少保存：

```text
.recovery/<timestamp>/worktree.patch
.recovery/<timestamp>/untracked-files/
.recovery/<timestamp>/manifest.txt
```

### F. 开启 Hashline，但不要误解它

可在 `~/.omo/omo.jsonc` 中开启：

```jsonc
{
  "hashline_edit": true,
}
```

开启后：

- 使用 Hashline 防止旧行误改。
- 仍然需要 Git commit / patch / snapshot 做历史恢复。
- 每次跨文件或长时间任务开始前重新读取目标文件。
- 看到 stale hash 错误时重新读取，不绕过校验。

### G. 恢复操作：四步门禁

任何恢复必须满足：

1. **来源确认**：知道 snapshot/patch 来自哪个会话和时间点。
2. **隔离重放**：先在临时目录应用。
3. **差异审查**：列出恢复、删除、新增和冲突文件。
4. **用户确认**：展示候选 diff 后才覆盖真实工作区。

禁止直接把一个未经验证的 snapshot 复制到项目根目录。

### H. 验证必须分两层

源码层：

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -r build
```

产品层：

- 启动 dev server。
- 用真实浏览器打开 Landing 和 workspace。
- 检查 Toolbar 图标、TabStrip、LeftRail、OutlineMenu、编辑态和预览态。
- 检查浏览器 console 和关键点击路径。
- 如果浏览器环境不可用，明确标记为未完成，不把单测结果写成完整 QA 通过。

## 7. 后续开发优化建议

### 立即执行

- 将当前恢复后的精细 UI 作为一个独立原子 commit 保存。
- 将 `apps/web/src/components/gallery-examples.ts` 纳入 Git，避免再次成为未跟踪丢失文件。
- 为每次大规模 UI 任务在开始时创建恢复 patch。
- 清理并修复旧 PNG evidence 尺寸断言，不要让旧产物决定当前测试状态。
- 为 `.omo/plans/` 和 boulder 状态增加“已结束计划不得继续注入”的检查。

### 短期优化

- 把 UI 设计快照和功能修复分成不同 commit。
- 在 `AGENTS.md` 中保持当前 UI 事实来源指针，指向 mockup 和设计文档。
- 为 Toolbar 建立“无 Emoji 图标”测试断言。
- 为关键 UI 建立截图证据，并在恢复后逐张对比。
- 给恢复工具增加 `--dry-run`、`--target`、`--manifest` 和冲突报告能力。

### 中期优化

- 把 App 状态逻辑继续拆分，减少一个 Agent 修改整个 `App.tsx` 的机会。
- 为重要 UI 组件建立独立的视觉回归页面。
- 在每个 wave 结束时自动生成：源码 patch、文件 manifest、测试结果、snapshot 标识。
- 将工作区状态、计划状态、Git 状态和 Agent 会话 ID 写入一份恢复 manifest。

## 8. 当前恢复后的工作规则

在用户确认恢复后的视觉效果之前：

- 不继续 `/ship`。
- 不关闭 GitHub issues。
- 不运行新的 UI 重构 Agent。
- 不覆盖恢复后的 UI 文件。
- 只允许做验证、报告和用户明确授权的修正。

恢复后的版本必须先被用户确认“页面效果已经回到上一轮版本”，再进入缺陷修复和发布流程。
