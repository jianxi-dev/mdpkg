#!/usr/bin/env bash
# =============================================================================
# pr-automation.sh — issue 驱动的分支/PR 自动化流水线
#
# 用法:
#   ./scripts/pr-automation.sh --role feat   --issue 42 --title "feat: ..."
#   ./scripts/pr-automation.sh --role fix    --issue 42 --risk low
#   ./scripts/pr-automation.sh --list-ready
#   ./scripts/pr-automation.sh --role feat --issue 42 --title "..." --resume-branch feat/x [--files ...]
#   ./scripts/pr-automation.sh --role feat --issue 42 --title "..." --refs-only   # PR body 用 Refs #N（不关 issue）
#
# --refs-only: PR body 关联用 `Refs #N`（parent/spec issue 场景，避免合并提前关闭）
# auto-merge: risk-low 尝试启用；仓库未启用时 fail-open（提示手动合并，退出 0）
#
# 流程: 校验仓库干净 → 基于 origin/main 建分支 → 本地验证四件套硬门禁
#        → 显式 git add 白名单提交 → push → gh pr create(模板+风险标签)
#        → 按风险分级启用 auto-merge
#
# --resume-branch 模式 (change-workflow G2): 分支已由实施阶段创建(1 票 1 PR 模型),
#   跳过建分支; 支持未提交改动 + --files 白名单提交; PR 检测一致性校验
#   (head==branch && base==main && state==OPEN) 后 create/edit 同步 title/risk。
#
# 质量保证(2026-09-12 起): push 前强制跑 pnpm -r typecheck/lint/test,
#        任一失败即中止(防浪费 CI 轮次)。--skip-checks 为逃生舱,不推荐。
#
# 规则(见 docs/agents/):
#   - 1 分支 = 1 PR,绝不复用
#   - 分支名: feat/<slug> / fix/<slug>,基于 origin/main
#   - commit 引用 fixes #N → PR 合并自动关 issue
#   - risk-low → auto-merge; risk-medium/high → 人工评审
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- 载入项目配置（可选）-----------------------------------------------------
# 目标项目根放置 .change-workflow.conf（由 setup.sh 生成）；缺失则用内置默认值。
CONF="$REPO_ROOT/.change-workflow.conf"
if [[ -f "$CONF" ]]; then
  # shellcheck disable=SC1090
  source "$CONF"
fi
CMD_TYPECHECK="${CMD_TYPECHECK:-}"
CMD_LINT="${CMD_LINT:-}"
CMD_TEST="${CMD_TEST:-}"
LABEL_RISK_LOW="${LABEL_RISK_LOW:-risk-low}"
LABEL_RISK_MEDIUM="${LABEL_RISK_MEDIUM:-risk-medium}"
LABEL_RISK_HIGH="${LABEL_RISK_HIGH:-risk-high}"
LABEL_SOURCE="${LABEL_SOURCE:-ai-generated}"
LABEL_READY="${LABEL_READY:-ready-for-agent}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"

usage() {
  sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
}

run_gate() {
  local name="$1" cmd="$2"
  if [[ -z "$cmd" ]]; then
    echo "    [$name] （未配置，跳过）"
    return 0
  fi
  echo "    [$name] $cmd"
  bash -c "$cmd" || { echo "❌ $name 失败,中止(加 --skip-checks 强制提交)"; exit 1; }
}

# --- 参数解析 ---------------------------------------------------------------
ROLE="" ISSUE="" TITLE="" RISK="medium" SLUG="" RESUME_BRANCH="" SKIP_CHECKS="0" REFS_ONLY="0" FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role)    ROLE="$2"; shift 2 ;;
    --issue)   ISSUE="$2"; shift 2 ;;
    --title)   TITLE="$2"; shift 2 ;;
    --risk)    RISK="$2"; shift 2 ;;
    --slug)    SLUG="$2"; shift 2 ;;
    --resume-branch) RESUME_BRANCH="$2"; shift 2 ;;
    --files)   FILES+=("$2"); shift 2 ;;
    --refs-only) REFS_ONLY="1"; shift ;;
    --skip-checks) SKIP_CHECKS="1"; shift ;;
    --list-ready) gh issue list --label "$LABEL_READY" --state open --json number,title,labels \
                    --jq '.[] | "#\(.number) [\(.labels|map(.name)|join(","))] \(.title)"'; exit 0 ;;
    --help|-h) usage ;;
    --) shift; FILES+=("$@"); break ;;
    -*) echo "未知参数: $1" >&2; usage ;;
    *)  FILES+=("$1"); shift ;;
  esac
done

[[ -z "$ROLE" ]] && { echo "缺少 --role (feat|fix)" >&2; usage; }
[[ "$ROLE" != "feat" && "$ROLE" != "fix" ]] && { echo "--role 只能为 feat|fix" >&2; usage; }
[[ "$RISK" != "low" && "$RISK" != "medium" && "$RISK" != "high" ]] && { echo "--risk 只能为 low|medium|high" >&2; usage; }
[[ -n "$RESUME_BRANCH" && -n "$SLUG" ]] && { echo "--resume-branch 与 --slug 互斥" >&2; usage; }
case "$RISK" in
  low)    RISK_LABEL="$LABEL_RISK_LOW" ;;
  medium) RISK_LABEL="$LABEL_RISK_MEDIUM" ;;
  high)   RISK_LABEL="$LABEL_RISK_HIGH" ;;
esac

# --- 前置校验 ---------------------------------------------------------------
[[ -n "$ISSUE" ]] && gh issue view "$ISSUE" --json number,title --jq '.number' >/dev/null 2>&1 \
  || { echo "issue #$ISSUE 不存在或无法访问" >&2; exit 1; }

# --- 分支确定 ---------------------------------------------------------------
if [[ -n "$RESUME_BRANCH" ]]; then
  BRANCH="$RESUME_BRANCH"
  git show-ref --verify --quiet "refs/heads/$BRANCH" \
    || { echo "本地分支 $BRANCH 不存在（resume 要求分支已存在）" >&2; exit 1; }
else
  if [[ -z "$SLUG" ]]; then
    SLUG=$(gh issue view "$ISSUE" --json title --jq '.title' \
      | tr '[:upper:]' '[:lower:]' \
      | sed 's/[^a-z0-9]+/-/g; s/^-//; s/-$//' \
      | cut -c1-48)
    [[ -z "$SLUG" ]] && SLUG="issue-$ISSUE"
  fi
  BRANCH="$ROLE/$SLUG"

  # 分支名冲突检查(worktree 规则:一分支一窗口)
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    echo "分支 $BRANCH 已存在(可能被另一 worktree 占用)" >&2
    exit 1
  fi
fi

# --- 工作区校验 -------------------------------------------------------------
in_files() {
  local p; local rel="${1#./}"
  for p in "${FILES[@]}"; do [[ "${p#./}" == "$rel" ]] && return 0; done
  return 1
}

# resume 白名单: 全部工作区改动 (M/A/D/R/??) 均须属于 --files; rename(R) 双路径都须在白名单
validate_whitelist() {
  local out_of_scope=()
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local code="${line:0:2}"
    local path="${line:3}"
    if [[ "$code" == "R"* ]]; then
      local old="${path%% -> *}" new="${path##* -> }"
      for p in "$old" "$new"; do
        if ! in_files "$p"; then out_of_scope+=("${code} ${p}"); fi
      done
    else
      if ! in_files "$path"; then out_of_scope+=("${code} ${path}"); fi
    fi
  done < <(git status --porcelain)
  if [[ ${#out_of_scope[@]} -gt 0 ]]; then
    echo "❌ 白名单外工作区改动，拒绝提交:" >&2
    printf '   %s\n' "${out_of_scope[@]}" >&2
    exit 1
  fi
}

if [[ -n "$RESUME_BRANCH" ]]; then
  DIRTY=$(git status --porcelain)
  if [[ ${#FILES[@]} -eq 0 ]]; then
    if [[ -n "$DIRTY" ]]; then
      echo "工作区有改动但未提供 --files，拒绝。请先自行提交或补 --files 白名单:" >&2
      echo "$DIRTY" >&2
      exit 1
    fi
  else
    validate_whitelist
  fi
else
  # 从头模式: 仓库必须干净(运行时噪音除外——显式白名单提交,禁止 -A)
  DIRTY_TRACKED=$(git status --porcelain | grep -v '^??' || true)
  if [[ -n "$DIRTY_TRACKED" ]]; then
    echo "工作区有已跟踪的未提交改动,请先 stash 或提交:" >&2
    echo "$DIRTY_TRACKED" >&2
    exit 1
  fi
fi

# --- 流水线 -----------------------------------------------------------------
if [[ -z "$RESUME_BRANCH" ]]; then
  echo "==> 1/6 基于 origin/$DEFAULT_BRANCH 建分支: $BRANCH"
  git fetch origin
  git checkout -b "$BRANCH" "origin/$DEFAULT_BRANCH"

  echo "==> 2/6 实施改动(由 agent/人在分支上完成)"
else
  echo "==> 1/6 resume 模式: 确认当前分支"
  if [[ "$(git branch --show-current)" != "$BRANCH" ]]; then
    echo "    切换到 $BRANCH"
    git checkout "$BRANCH" || { echo "❌ 无法切换到 $BRANCH" >&2; exit 1; }
  fi
  echo "==> 2/6 分支已存在，跳过建分支（1 票 1 PR 模型，G1 已创建）"
fi

if [[ ${#FILES[@]} -gt 0 ]]; then
  echo "==> 2.5/6 本地验证四件套(硬门禁,任一失败即中止)"
  if [[ "$SKIP_CHECKS" == "1" ]]; then
    echo "    --skip-checks 已设置,跳过本地验证(不推荐)"
  else
    run_gate typecheck "$CMD_TYPECHECK"
    run_gate lint "$CMD_LINT"
    run_gate test "$CMD_TEST"
    echo "    [4/4] 完成,本地验证全绿"
  fi

  echo "==> 3/6 显式 add 白名单提交"
  git add "${FILES[@]}"
  git status --short
  git commit -m "$TITLE

fixes #$ISSUE"
else
  echo "==> 跳过提交(无 --files 参数)。分支上已有 commit; 直接 push + PR 检测"
fi

echo "==> 4/6 推送分支"
git push -u origin "$BRANCH"

echo "==> 5/6 创建/检测 PR"
PR_JSON=$(gh pr view --head "$BRANCH" --json number,headRefName,baseRefName,title,state 2>/dev/null || echo "NO_PR")
if [[ "$PR_JSON" == "NO_PR" || "$PR_JSON" == "null" ]]; then
  BODY_FILE="$(mktemp)"
  cat > "$BODY_FILE" <<EOF
## 变更概述
$TITLE

## 关联 Issue
$( [[ "$REFS_ONLY" == "1" ]] && echo "Refs #$ISSUE" || echo "Closes #$ISSUE" )

## 变更内容
(待 agent/人填写: 改动模块、核心文件清单)

## 影响范围
(待填写: 接口/下游/线上风险)

## 验证方式
- [ ] 质量门禁（typecheck / lint / test，按 .change-workflow.conf 配置）
$( [[ "$ROLE" == "fix" ]] && echo "- [ ] 复现步骤验证通过" )

## 风险评估
**风险等级**: $RISK
**来源**: $LABEL_SOURCE

## 回滚方案
git revert <merge-commit> 即可回滚
EOF

  PR_URL=$(gh pr create --base "$DEFAULT_BRANCH" --head "$BRANCH" \
    --title "$TITLE" \
    --body-file "$BODY_FILE" \
    --label "$RISK_LABEL,$LABEL_SOURCE")
  rm -f "$BODY_FILE"
  echo "    PR: $PR_URL"
else
  PR_NUM=$(printf '%s' "$PR_JSON" | jq -r '.number')
  _head=$(printf '%s' "$PR_JSON" | jq -r '.headRefName')
  _base=$(printf '%s' "$PR_JSON" | jq -r '.baseRefName')
  _state=$(printf '%s' "$PR_JSON" | jq -r '.state')
  if [[ "$_head" != "$BRANCH" || "$_base" != "$DEFAULT_BRANCH" || "$_state" != "OPEN" ]]; then
    echo "❌ 已有 PR #$PR_NUM 但 head/base/state 校验不符 (head=$_head/base=$_base/state=$_state)，拒绝接管" >&2
    exit 1
  fi
  echo "    PR #$PR_NUM 已存在且校验通过 (head=$BRANCH, base=$DEFAULT_BRANCH, OPEN)"

  if [[ -n "$TITLE" ]]; then
    CURRENT_TITLE=$(printf '%s' "$PR_JSON" | jq -r '.title')
    if [[ "$CURRENT_TITLE" != "$TITLE" ]]; then
      gh pr edit "$PR_NUM" --title "$TITLE" >/dev/null
      echo "    title 已同步: $TITLE"
    fi
  fi

  # risk 标签替换: 删除全部旧 risk-* 再添加新标签, 并同步 body 风险等级段
  for l in "$LABEL_RISK_LOW" "$LABEL_RISK_MEDIUM" "$LABEL_RISK_HIGH"; do
    gh pr edit "$PR_NUM" --remove-label "$l" >/dev/null 2>&1 || true
  done
  gh pr edit "$PR_NUM" --add-label "$RISK_LABEL" >/dev/null
  BODY_TMP="$(mktemp)"
  gh pr view "$PR_NUM" --json body --jq '.body' > "$BODY_TMP"
  if grep -q '^\*\*风险等级\*\*' "$BODY_TMP"; then
    sed -i.bak "s/^\*\*风险等级\*\*: .*$/**风险等级**: $RISK/" "$BODY_TMP" && rm -f "$BODY_TMP.bak"
    gh pr edit "$PR_NUM" --body-file "$BODY_TMP" >/dev/null
  fi
  rm -f "$BODY_TMP"
  echo "    risk 标签已同步: risk-$RISK (旧 risk-* 已清)"

  PR_URL=$(gh pr view "$PR_NUM" --json url --jq '.url')
fi

echo "==> 6/6 风险分级"
if [[ "$RISK" == "low" ]]; then
  PR_NUM=$(echo "$PR_URL" | grep -o '[0-9]*$')
  if gh pr merge "$PR_NUM" --auto --squash 2>/dev/null; then
    echo "    risk-low → 已启用 auto-merge(CI 绿自动合并)"
  else
    echo "    risk-low → auto-merge 不可用(仓库未启用)，CI 绿后合并: gh pr merge $PR_NUM --squash"
  fi
else
  echo "    risk-$RISK → 人工评审,等待确认"
fi

echo "==> 完成。分支: $BRANCH | PR: $PR_URL"