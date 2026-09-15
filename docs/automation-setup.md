---
type: guide
title: mdpkg 自动化配置指南
captured_at: '2026-09-01T00:56:05.946Z'
created: '2026-09-01T00:56:05.946Z'
ingested_at: '2026-09-01T01:19:29.155Z'
source_kind: put_page
captured_via: capture-cli
ingested_via: put_page
---

# mdpkg 自动化配置指南

## 概述

mdpkg 项目采用多层自动化配置，确保代码质量和提交规范。配置参考 clairis 项目的最佳实践。

## 配置文件清单

### 1. Git Hooks（.husky/）

#### pre-commit
- **位置**: `.husky/pre-commit`
- **功能**: 提交前自动运行格式化和测试
- **流程**:
  1. 运行 `lint-staged` 格式化暂存文件
  2. 运行单元测试 `node --test test/*.test.ts`
- **效果**: 任何步骤失败则阻止提交

#### commit-msg
- **位置**: `.husky/commit-msg`
- **功能**: 校验提交信息格式
- **格式**: Conventional Commits (`<type>(<scope>): <description>`)
- **允许的类型**: `feat|fix|docs|style|refactor|test|chore|ci|perf|build`

### 2. lint-staged（增量格式化）

**位置**: `package.json`

```json
"lint-staged": {
  "*.{ts,tsx,mts,cts}": ["prettier --write"],
  "*.md": ["prettier --write"],
  "*.{json,yaml,yml}": ["prettier --write"]
}
```

**特点**:
- 只处理暂存文件（增量，快速）
- 按文件类型分组处理
- 自动格式化，无需手动干预

### 3. Prettier（代码格式化）

**位置**: `.prettierrc`

```json
{
  "useTabs": false,
  "tabWidth": 2,
  "printWidth": 80,
  "singleQuote": false,
  "trailingComma": "es5",
  "semi": true,
  "arrowParens": "always"
}
```

### 4. EditorConfig（编辑器统一）

**位置**: `.editorconfig`

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

### 5. 验证脚本（scripts/verify.sh）

**位置**: `scripts/verify.sh`

**功能**: 一站式验证套件，交付前必跑

**检查项**:
1. TypeScript 类型检查
2. 单元测试
3. 格式检查（Prettier）

**使用方法**:
```bash
npm run verify
# 或
bash scripts/verify.sh
```

### 6. GitHub Actions CI

**位置**: `.github/workflows/test.yml`

**触发条件**:
- push 到 main 分支
- Pull Request

**检查项**:
- Node.js 22 环境
- npm ci 安装依赖
- 运行测试

## 提交流程

### 正常提交流程

```bash
# 1. 修改代码
# 2. 暂存文件
git add .

# 3. 提交（自动触发 pre-commit hook）
git commit -m "feat: add new feature"
```

### 提交信息格式

```bash
# 正确格式
git commit -m "feat: add new feature"
git commit -m "fix(module): resolve bug"
git commit -m "docs: update documentation"
git commit -m "test: add unit tests"

# 错误格式（会被阻止）
git commit -m "update code"
git commit -m "fix bug"
```

### 验证流程

```bash
# 交付前完整验证
npm run verify
```

## 工作流示意

```
代码修改
    ↓
git add . (暂存)
    ↓
git commit
    ↓
┌─────────────────────────────────┐
│  pre-commit hook 自动执行        │
│  1. lint-staged (格式化)         │
│  2. 单元测试                     │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│  commit-msg hook 自动执行        │
│  校验提交信息格式                 │
└─────────────────────────────────┘
    ↓
提交成功
    ↓
push 到远程
    ↓
┌─────────────────────────────────┐
│  GitHub Actions CI 自动执行      │
│  1. TypeScript 检查              │
│  2. 单元测试                     │
│  3. 格式检查                     │
└─────────────────────────────────┘
```

## 常见问题

### Q: 提交时提示 "Tests failed"

**原因**: 单元测试未通过
**解决**: 
```bash
cd packages/mdpkg && node --test test/*.test.ts
# 查看失败原因并修复
```

### Q: 提交时提示 "Lint-staged failed"

**原因**: 代码格式不符合规范
**解决**:
```bash
npx prettier --write "*.{ts,tsx,md,json}"
# 或让 lint-staged 自动修复
git add . && git commit
```

### Q: 提交信息格式错误

**原因**: 不符合 Conventional Commits 规范
**解决**: 使用正确的格式，如 `feat: description`

### Q: 如何跳过 hooks（紧急情况）

```bash
git commit --no-verify -m "emergency fix"
```

**注意**: 仅在紧急情况使用，事后应补充验证。

## 扩展配置

### 添加新的文件类型检查

编辑 `package.json` 中的 `lint-staged` 配置：

```json
"lint-staged": {
  "*.{ts,tsx,mts,cts}": ["prettier --write"],
  "*.md": ["prettier --write"],
  "*.{json,yaml,yml}": ["prettier --write"],
  "*.css": ["prettier --write"],
  "*.rs": ["rustfmt"]
}
```

### 添加新的验证步骤

编辑 `scripts/verify.sh`，在现有步骤后添加：

```bash
# 4. 自定义检查
echo ""
echo "── 4. Custom Check ──"
if your-command; then
  echo "  ✅ Custom check"
else
  echo "  ❌ Custom check failed"
  FAIL=1
fi
```

## 参考资料

- [Conventional Commits](https://www.conventionalcommits.org/)
- [lint-staged](https://github.com/lint-staged/lint-staged)
- [Prettier](https://prettier.io/)
- [EditorConfig](https://editorconfig.org/)
- [Husky](https://typicode.github.io/husky/)
