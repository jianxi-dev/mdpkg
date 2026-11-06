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
# auto-merge: risk-low/medium 尝试启用；risk-high 不自动合并（人工）；仓库未启用时 fail-open（提示手动合并，退出 0）
# --verified-sha: 仅 --resume-branch 模式；QG-5 验证时效检查——与分支 HEAD 不一致（rebase/追加提交后未重验）即拒收退 1，未提供仅警告
#
# 流程: 校验仓库干净 → 基于 origin/main 建分支 → 本地验证四件套硬门禁
#        → 显式 git add 白名单提交 → push → gh pr create(模板+风险标签)
#        → 按风险分级启用 auto-merge（low/medium 自动；high 人工）
#        → 打印 G3 三项补齐命令 + 下一 change 推荐（脚本止于命令提示，执行仍是 agent 的事）
#
# 白名单路径若被 .gitignore 匹配(如 force-tracked 的 .omo/notepads/**),
# git add 会失败,此时自动 fallback 到 git add -f(路径已由 --files 显式限定)。
#
# --resume-branch 模式 (change-workflow G2): 分支已由实施阶段创建(1 票 1 PR 模型),
#   跳过建分支; 支持未提交改动 + --files 白名单提交; PR 检测一致性校验
#   (head==branch && base==main && state==OPEN) 后 create/edit 同步 title/risk。
#
# 质量保证(2026-09-12 起): push 前强制跑本仓门禁命令(.change-workflow.conf 的 CMD_*),
#        任一失败即中止(防浪费 CI 轮次)。--skip-checks 为逃生舱,不推荐。
#
# 规则(见 docs/agents/):
#   - 1 分支 = 1 PR,绝不复用
#   - 分支名: feat/<slug> / fix/<slug>,基于 origin/main
#   - commit 引用 fixes #N → PR 合并自动关 issue
#   - 全风险 auto-merge（low/medium 尝试；high 人工合并门）
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- 载入项目配置（可选）-----------------------------------------------------
# 目标项目根放置 .change-workflow.conf（由 setup.sh 生成）；缺失则用内置默认值。
# 不 source conf（B1/RCE 边界）：conf 提交进消费仓且**不受管**（INSTALL.md:137），
# 恶意 PR 可在其中追加 shell（如 CMD_TEST="$(touch pwned)"），source 即执行。
# 白名单逐键解析（与 cw-update.sh 同款 conf_get），只取字面值、不求值。
# 统一规范（F6+F8，与 lib/render.sh 的 cw_conf_get 及 cw-update.sh / cw-greploop.sh 的
# conf_get 逐字同语义，改一处必同步四处，回归锁在 e2e 用例 22）：
#   1) `#` 开头的整行注释跳过；2) 原始值 = 首个 `=` 之后的全部文本；3) 去尾部 \r；
#   4) 值以 " 或 ' 开头且**后方存在同名闭引号** → 取首对引号之间的内值（内部 # 原样保留），
#      但闭引号之后只允许「空白」或「空白 + # 注释」（红证：`"val" # c` 旧「首尾同引号」
#      判定被尾注释破坏 → 引号存活返回 `"val"`）；引号后有杂质 → 整值按无引号处理；
#      无引号时仅在「空白 + #」处截断行内注释（`x # c` → `x`；无空白的 `r#frag` 保留）；
#   5) 去尾部空白；6) 输出。键不存在返回 1。
CONF="$REPO_ROOT/.change-workflow.conf"
conf_get() {
  local key="$1" line v q inner rest
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      \#*) continue ;;
    esac
    # 锚定行首（1.3.1 QA ISSUE-002）：子串匹配 *"$key="* 会被诱饵行误命中
    # （如 OLD_REPO= 在 REPO= 之前先子串命中 REPO=），故键必须位于行首。
    case "$line" in
      "$key"=*) v="${line#*=}" ;;
      *) continue ;;
    esac
    v="${v%$'\r'}"
    q="${v:0:1}"
    if [[ "$q" == '"' || "$q" == "'" ]] && [[ "${v:1}" == *"$q"* ]]; then
      # 同名闭引号存在 → 取首对引号之间的内值；但闭引号之后只允许「空白」或
      # 「空白 + # 注释」（红证：`"val" # c` 旧「首尾同引号」判定被尾注释破坏 →
      # 引号存活返回 `"val"`，统一前的旧实现返回 val）。引号后有杂质 → 按无引号处理。
      inner="${v#"$q"}"
      rest="${inner#*"$q"}"
      case "${rest#"${rest%%[![:space:]]*}"}" in
        ''|'#'*) v="${inner%%"$q"*}" ;;
        *) v="${v%%[[:space:]]#*}" ;;
      esac
    else
      v="${v%%[[:space:]]#*}"
    fi
    v="${v%"${v##*[![:space:]]}"}"
    printf '%s\n' "$v"
    return 0
  done < "$CONF"
  return 1
}
CMD_TYPECHECK="$(conf_get CMD_TYPECHECK || true)"
CMD_LINT="$(conf_get CMD_LINT || true)"
CMD_TEST="$(conf_get CMD_TEST || true)"
CMD_E2E="$(conf_get CMD_E2E || true)"
CMD_FIDELITY="$(conf_get CMD_FIDELITY || true)"
CMD_VISUAL_BASELINE="$(conf_get CMD_VISUAL_BASELINE || true)"
LABEL_RISK_LOW="$(conf_get LABEL_RISK_LOW || true)"
LABEL_RISK_MEDIUM="$(conf_get LABEL_RISK_MEDIUM || true)"
LABEL_RISK_HIGH="$(conf_get LABEL_RISK_HIGH || true)"
LABEL_SOURCE="$(conf_get LABEL_SOURCE || true)"
LABEL_READY="$(conf_get LABEL_READY || true)"
DEFAULT_BRANCH="$(conf_get DEFAULT_BRANCH || true)"
CMD_TYPECHECK="${CMD_TYPECHECK:-}"
CMD_LINT="${CMD_LINT:-}"
CMD_TEST="${CMD_TEST:-}"
CMD_E2E="${CMD_E2E:-}"
CMD_FIDELITY="${CMD_FIDELITY:-}"
CMD_VISUAL_BASELINE="${CMD_VISUAL_BASELINE:-}"
LABEL_RISK_LOW="${LABEL_RISK_LOW:-risk-low}"
LABEL_RISK_MEDIUM="${LABEL_RISK_MEDIUM:-risk-medium}"
LABEL_RISK_HIGH="${LABEL_RISK_HIGH:-risk-high}"
LABEL_SOURCE="${LABEL_SOURCE:-ai-generated}"
LABEL_READY="${LABEL_READY:-ready-for-agent}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"

usage() {
  sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
ROLE="" ISSUE="" TITLE="" RISK="medium" SLUG="" RESUME_BRANCH="" SKIP_CHECKS="0" REFS_ONLY="0" VERIFIED_SHA="" FILES=()

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
    --verified-sha) VERIFIED_SHA="$2"; shift 2 ;;
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

# --- QG-5 验证时效检查（rebase 检测）----------------------------------------
# 前置在 gh 校验之前：纯本地判定（git rev-parse），不依赖网络/凭证，越早拦截越省往返。
# --verified-sha = 票上「QG-5 验证基于」的 SHA（完整或 ≥7 位短前缀）。分支在验证后
# 发生 rebase/追加提交 → HEAD 被重写/前移 → 与记录不符 → 拒收：防止基于旧 SHA 的
# 验证结论被静默带进合并（restack 会一次性作废全部判定）。仅 resume 模式有效
# （fresh 模式尚无验证历史）；未提供 → 仅警告（降级不阻塞，risk-medium/high 应提供）。
if [[ -n "$VERIFIED_SHA" ]]; then
  if [[ -z "$RESUME_BRANCH" ]]; then
    echo "❌ --verified-sha 仅用于 --resume-branch 模式（QG-5 时效检查）" >&2
    exit 1
  fi
  VERIFIED_SHA="$(printf '%s' "$VERIFIED_SHA" | tr 'A-F' 'a-f')"
  case "$VERIFIED_SHA" in
    *[!0-9a-f]*)
      echo "❌ --verified-sha 必须是十六进制 SHA: ${VERIFIED_SHA}" >&2
      exit 1 ;;
  esac
  if [[ ${#VERIFIED_SHA} -lt 7 || ${#VERIFIED_SHA} -gt 40 ]]; then
    echo "❌ --verified-sha 长度须为 7-40（完整或短 SHA）: ${VERIFIED_SHA}" >&2
    exit 1
  fi
  CUR_SHA="$(git rev-parse --verify --quiet "refs/heads/${RESUME_BRANCH}" || true)"
  if [[ -n "$CUR_SHA" ]]; then
    case "$CUR_SHA" in
      "$VERIFIED_SHA"*) : ;;
      *)
        echo "❌ QG-5 验证已过期：验证基于 ${VERIFIED_SHA}，分支 HEAD 现为 ${CUR_SHA}" >&2
        echo "   （rebase/追加提交后未重验）→ 重跑 QG-5、更新票上「验证基于」SHA 后重新收口" >&2
        exit 1 ;;
    esac
  fi
elif [[ -n "$RESUME_BRANCH" ]]; then
  echo "⚠️  未提供 --verified-sha：跳过 QG-5 验证时效检查（risk-medium/high 应提供）" >&2
fi

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
    # 四件套 = typecheck/lint/test/e2e。CMD_E2E 曾漏调：脚本打印「[4/4] 完成」
    # 而实际只跑 3 个 gate —— 与 pr-automation「四件套硬门禁」的文档承诺不符，
    # 且 md-bundle 的 CMD_E2E 早已配上却从未在本地跑过（只在 CI 跑）。
    run_gate typecheck "$CMD_TYPECHECK"
    run_gate lint "$CMD_LINT"
    run_gate test "$CMD_TEST"
    run_gate e2e "$CMD_E2E"
    echo "    [4/4] 完成,本地验证全绿"

    # CMD_FIDELITY 不在四件套里，但必须在本地跑：它包含 Chrome 视觉基线等
    # 「只有开发机才有条件跑」的核验（CI 是 ubuntu 无 Chrome；基线是 macOS 采的）。
    # 此前它只在 CI 的 evidence-check 里引用，而 CI 无 Chrome → 那条路径对视觉层
    # 永远是空的。本机有 Chrome，这里是它唯一能真正执行的地方。
    # 失败即中止（不降级）：视觉漂移是一种真实回归，不该被「跳过」掉。
    run_gate fidelity "$CMD_FIDELITY"

    # 本地专属视觉基线（T2 感知层）。为什么与 CMD_FIDELITY 分开：
    # CMD_FIDELITY 同时被 CI（ubuntu，无 Chrome）执行，必须 Chrome-free；
    # 本键只在本机跑（macOS + Chrome = 基线采集环境），塞进 CMD_FIDELITY 会让 CI 红。
    # 语义同四件套：失败即中止。未配置的仓跳过（md-bundle/mdpkg/clairis 目前都没这键）。
    run_gate visual-baseline "$CMD_VISUAL_BASELINE"
  fi

  echo "==> 3/6 显式 add 白名单提交"
  if ! git add -- "${FILES[@]}" 2>/dev/null; then
    echo "    [add] 白名单含被 .gitignore 匹配的路径，改用 git add -f（路径已由 --files 显式限定）"
    git add -f -- "${FILES[@]}"
  fi
  git status --short
  git commit -m "$TITLE

$( [[ "$REFS_ONLY" == "1" ]] && echo "refs #$ISSUE" || echo "fixes #$ISSUE" )"
else
  echo "==> 跳过提交(无 --files 参数)。分支上已有 commit; 直接 push + PR 检测"
fi

# --- ui-surface 票证据 manifest 校验（IC-2/IC-5）------------------------------
# fail-open: gh 不可用/标签取不到/jq 不可用 → 跳过（不阻断既有流程）。
# ui-surface 判定: gh issue label 含 ui-surface（IC-5 label 通道）。
# 判据: .artifacts/<ISSUE>/state-coverage.json 缺失或态数 <4 → 退 1。
if command -v gh >/dev/null 2>&1; then
  ISSUE_LABELS="$(gh issue view "$ISSUE" --json labels --jq '.labels[].name' 2>/dev/null || true)"
  if [[ "$ISSUE_LABELS" == *"ui-surface"* ]]; then
    MANIFEST=".artifacts/${ISSUE}/state-coverage.json"
    if [[ ! -f "$MANIFEST" ]]; then
      echo "❌ ui-surface 票 #${ISSUE} 缺少证据 manifest: ${MANIFEST}（IC-2: ui-surface 票须提交 state-coverage.json，≥4 态）" >&2
      exit 1
    fi
    STATE_COUNT="$(jq '.states | length' "$MANIFEST" 2>/dev/null || true)"
    if [[ ! "$STATE_COUNT" =~ ^[0-9]+$ ]]; then
      echo "⚠️  无法解析态数（jq 不可用或 manifest 非法），跳过 ui-surface 校验（fail-open）" >&2
    elif [[ "$STATE_COUNT" -lt 4 ]]; then
      echo "❌ ui-surface 票 #${ISSUE} 证据 manifest 态数不足: ${STATE_COUNT} < 4（IC-2: 状态覆盖矩阵 ≥4 态）" >&2
      exit 1
    else
      echo "    [ui-surface] 证据 manifest 校验通过（${STATE_COUNT} 态）"
    fi
  fi
fi

echo "==> 4/6 推送分支"
git push -u origin "$BRANCH"

echo "==> 5/6 创建/检测 PR"
# 无匹配时 gh 2.95.0 的 `--jq '.[0]'` 输出**空串**（不是 `null`）——实测 `xxd` 仅 `0a`。
# 故 jq 替代运算符把 null/空归一为 `NO_PR` 哨兵；:338 的 `-z` 再兜一道（防其他 gh/jq 版本差异）。
# 教训（1.12.1 回归）：桩测试若假定 `jq '.[0]'` → `null`，就会漏掉真实 gh 的空输出行为。
PR_JSON=$(gh pr list --head "$BRANCH" --state all --limit 1 \
  --json number,headRefName,baseRefName,title,state --jq '.[0] // "NO_PR"' 2>/dev/null || echo "NO_PR")
if [[ -z "$PR_JSON" || "$PR_JSON" == "NO_PR" || "$PR_JSON" == "null" ]]; then
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

## 质量门禁引用
(逐条写 QG-x / DQ-x: <它改变了哪个具体决策>；只提编号 = 空引用。无应用/豁免写「无」)

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
PR_NUM=$(echo "$PR_URL" | grep -o '[0-9]*$')
# 风险分档：low/medium 尝试 auto-merge；high 必须人工合并（不可逆/高风险变更不静默落库）
if [[ "$RISK" == "high" ]]; then
  echo "    risk-high → 人工合并: gh pr merge ${PR_NUM} --squash（高风险不自动合并）"
elif gh pr merge "$PR_NUM" --auto --squash 2>/dev/null; then
  echo "    risk-${RISK} → 已启用 auto-merge(CI 绿自动合并)"
else
  echo "    risk-${RISK} → auto-merge 不可用(仓库未启用)，CI 绿后合并: gh pr merge ${PR_NUM} --squash"
fi

echo "==> 完成。分支: $BRANCH | PR: $PR_URL"

# --- G3 接续（push+PR 之后三步不能靠记性）-------------------------------
# 2026-10-26 事故：本脚本止于 push/PR/merge，之后一切（learn → sync-gbrain →
# decisions-log → frontier 下一票）只写在 SKILL.md 的 prompt 里。连续 5 个 change
# 走到这里就结束了，三项收尾全跳，而代理以为自己「在等用户确认」。
# 修法：脚本退出前把下一步的**可执行命令**打出来——提示语会把代理引向追问，
# 命令不会。均 fail-open（gh/gbrain 缺失不影响 PR 结果，也不改退出码）。
echo ""
echo "==> G3 收尾（必调三项，缺一不得进 G4）"
if [[ -x "$REPO_ROOT/scripts/cw-g3-check.sh" ]]; then
  "$REPO_ROOT/scripts/cw-g3-check.sh" 2>&1 | sed 's/^/    /' || true
else
  echo "    ⚠️ 缺 scripts/cw-g3-check.sh（未装机？）—— 手工核对 gbrain/decisions/learn"
fi
echo "    learn          : 经验写入 brain page（勿写 .omo/，那目录 gitignore，gbrain 读不到）"
echo "    sync-gbrain    : gbrain sync --repo . && gbrain embed --stale"
echo "    decisions-log  : ./scripts/decisions-log.sh add <阶段> <决策> <理由> <证据> <结果>"
echo ""
if [[ -x "$REPO_ROOT/scripts/cw-next-change.sh" ]]; then
  echo "==> 下一 change（队列非空即自动推进，不询问）"
  "$REPO_ROOT/scripts/cw-next-change.sh" 2>&1 | sed 's/^/    /' || true
fi
