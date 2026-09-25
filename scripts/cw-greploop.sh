#!/usr/bin/env bash
# =============================================================================
# cw-greploop.sh — Greptile 审查闭环包装器（由工具包安装到 scripts/cw-greploop.sh）
#
# 用法:
#   ./scripts/cw-greploop.sh --pr 42                     # 打印 PR #42 的闭环协议
#   ./scripts/cw-greploop.sh --pr 42 --max-iterations 5  # 收紧迭代上限（默认 10）
#   ./scripts/cw-greploop.sh --pr 42 --vcs github        # 平台覆盖（缺省本地探测）
#   ./scripts/cw-greploop.sh --pr 42 --dry-run           # 只打印将执行的循环与退出条件
#   ./scripts/cw-greploop.sh --help                      # 本用法（退出码 0）
#
# 定位: G2（PR 创建后 → risk-medium/high 合并确认前）的审查闭环。
#   本脚本只做「能力检测 + 协议打印」，不复制 greploop skill 的 API/GraphQL 细节，
#   也不触发 Greptile 审查；真正的循环由 agent 依据 greploop skill 执行。
#
# 为什么退出条件必须是「满分（5/5）且零未解决评论」:
#   评分一旦允许「4/5 也算过」，agent 就会在临界分上停手；「差不多就行」
#   会沉淀成技术债并污染后续 PR 的审查基线。满分与零评论是合取条件，
#   同时堵住「评分满分但评论仍挂着」的假闭环。
#
# 为什么无 Greptile 时降级而不是硬失败:
#   本工具包对所有外部依赖（gh / openspec / skills）的姿态都是「缺失降级」。
#   审查的价值来自独立第二意见，Greptile 只是其中一种实现；缺失时硬失败
#   只会逼 agent 绕过整个审查环节。降级 = 本地审查闭环（code-review / review
#   + 人工清单），并在 PR 上显式标注「审查闭环降级为人工」。
#   评分绝不伪造: 没有评分来源就如实报告没有。
#
# 退出码: 0 = 能力检测通过、协议已打印（不代表审查通过）；
#         1 = 参数错误 / --pr <N> 无法通过 gh 解析；
#         3 = 降级（greploop skill 缺失或 gh 未认证）；--help 退出 0。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# --- 载入项目配置（只读白名单解析，绝不 source）-------------------------------
# 目标项目根放置 .change-workflow.conf（由 setup.sh 生成）；本脚本只取 SKILLS_DIR。
# 不 source conf：该文件提交进消费仓，恶意 PR 在其中追加 shell 后即被执行（RCE）。
# 白名单逐键解析（bash 3.2 兼容）：只取 KEY=value 字面值，不求值、不执行任何内容。
# cd 在读 conf 之前完成，候选路径均相对仓库根。
# 统一规范（F6+F8，与 lib/render.sh 的 cw_conf_get 及 cw-update.sh / pr-automation.sh 的
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
_sk=""
if [[ -f "$CONF" ]]; then
  _sk="$(conf_get SKILLS_DIR || true)"
fi
SKILLS_DIR="${_sk:-.opencode/skills}"
# SKILLS_DIR 只接受仓库内相对路径：绝对路径 / 含任一 .. 段 → 回退默认并警告。
# A8（R4）：旧模式 `..|../*|*/../*` 漏掉 `./..` 与 `a/..` 形态（./ 前缀不匹配 ../、
# 末尾 .. 无尾斜杠不匹配 */../*），conf="./.." 即可穿越到仓外读植入的 greploop skill
# （红证：✅ 找到（./../greploop））。改为「两侧补 / 再查 /../ 子串」：任何 .. 段
# （首段、末段、中段、./.. 形态）补斜杠后必以 /../ 出现；文件名里的点（a..b）不误伤。
_sk_bad=0
case "$SKILLS_DIR" in /*) _sk_bad=1 ;; esac
case "/$SKILLS_DIR/" in */../*) _sk_bad=1 ;; esac
if [[ "$_sk_bad" == "1" ]]; then
  echo "⚠️  conf 的 SKILLS_DIR 非法（${SKILLS_DIR}），回退 .opencode/skills"
  SKILLS_DIR=".opencode/skills"
fi

MAX_ITERATIONS="10"
PR=""
VCS=""
DRY_RUN=false

usage() {
  sed -n '3,/^# ===/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
  exit 0
}

die() {
  echo "❌ $1" >&2
  exit 1
}

# --- 参数解析（bash 3.2 兼容: 手写 while + case，不用 getopt）----------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr)
      [[ $# -ge 2 ]] || die "--pr 缺少参数值"
      PR="$2"
      shift 2
      ;;
    --max-iterations)
      [[ $# -ge 2 ]] || die "--max-iterations 缺少参数值"
      MAX_ITERATIONS="$2"
      shift 2
      ;;
    --vcs)
      [[ $# -ge 2 ]] || die "--vcs 缺少参数值"
      VCS="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      usage
      ;;
    *)
      die "未知参数: ${1}（--help 查看用法）"
      ;;
  esac
done

# --- 参数校验 ----------------------------------------------------------------
if [[ -n "$PR" ]]; then
  case "$PR" in
    *[!0-9]*) die "--pr 必须是数字: ${PR}" ;;
  esac
fi
case "$MAX_ITERATIONS" in
  ''|*[!0-9]*) die "--max-iterations 必须是正整数: ${MAX_ITERATIONS}" ;;
esac
if (( 10#$MAX_ITERATIONS < 1 )); then
  die "--max-iterations 必须大于 0: ${MAX_ITERATIONS}"
fi
if [[ -n "$VCS" ]]; then
  case "$VCS" in
    github|gitlab|perforce) : ;;
    *) die "--vcs 只支持 github|gitlab|perforce: ${VCS}" ;;
  esac
fi

# --- 平台探测（缺省本地探测，不发网络请求）-----------------------------------
# 上游 greploop 的检测顺序是 p4 → gitlab → github；p4 探测（p4 info）会连服务端，
# 本脚本改为本地 git remote 探测: 含 gitlab → gitlab，否则 github。
# Perforce 无法本地静默判定，需显式 --vcs perforce。
detect_vcs() {
  local url url_lc
  url="$(git remote get-url origin 2>/dev/null || true)"
  url_lc="$(printf '%s' "$url" | tr '[:upper:]' '[:lower:]')"
  case "$url_lc" in
    *gitlab*) echo "gitlab" ;;
    *) echo "github" ;;
  esac
}

VCS_SOURCE="--vcs 显式指定"
if [[ -z "$VCS" ]]; then
  VCS="$(detect_vcs)"
  VCS_SOURCE="本地探测（git remote origin）"
fi

# --- 能力检测 ----------------------------------------------------------------
# 候选路径（9 根，只探测、不执行）: HOME 级 3 根 → conf SKILLS_DIR → 仓库相对
# 3 根 → 脚本相对 2 根。与 cw-evidence.sh 的门控清单保持同序（其仓库相对项受
# CW_EVIDENCE_ALLOW_REPO=1 门控；本脚本只读探测，不设门控）。
# 只认含 greploop/SKILL.md 的目录，不猜能力、不伪造可用。
# 符号链接围栏（F1 围栏部分，移植 cw-evidence.sh probe_skill_dir 的防线；不改仓库级根的门控策略）：
#   1) 候选根 d 本身是符号链接 → 跳过 —— 红证：`.opencode/skills -> 仓外目录`（内含攻击者
#      greploop/SKILL.md）被报「✅ 找到（.opencode/skills/greploop）」，-f 会跟随链接取真文件；
#   2) 命中要求 SKILL.md 是普通文件（! -L）—— 只查 -f 挡不住文件级链接写穿；
#   3) pwd -P 归一包含校验 —— 中间层（greploop/ 目录）是符号链接逃到根外时，
#      围栏 1/2 都放行（根与文件各自都不是链接），归一后越界即拒。
detect_greploop_skill() {
  local d real_root real_dir
  for d in "$@"; do
    [[ -n "$d" && ! -L "$d" ]] || continue
    [[ -f "$d/greploop/SKILL.md" && ! -L "$d/greploop/SKILL.md" ]] || continue
    real_root="$(cd "$d" 2>/dev/null && pwd -P)" || continue
    real_dir="$(cd "$d/greploop" 2>/dev/null && pwd -P)" || continue
    case "$real_dir" in
      "$real_root"|"$real_root"/*) ;;
      *) continue ;;
    esac
    printf '%s\n' "$d/greploop"
    return 0
  done
  return 1
}

GREPLOOP_SKILL="$(detect_greploop_skill \
  "${HOME:-}/.claude/skills" \
  "${HOME:-}/.agents/skills" \
  "${HOME:-}/.config/opencode/skills" \
  "$SKILLS_DIR" \
  "$PWD/.opencode/skills" \
  "$PWD/.claude/skills" \
  "$PWD/.agents/skills" \
  "$SCRIPT_DIR/../.opencode/skills" \
  "$SCRIPT_DIR/../.claude/skills")" || GREPLOOP_SKILL=""

# 展示用候选清单: 与探测顺序一致；SKILLS_DIR 与固定相对项重复时不重复列出
# shellcheck disable=SC2088  # 展示字符串故意用 ~ 缩写（探测用 ${HOME:-}，此处仅给人看，展开反而泄露路径）
SKILL_CANDIDATES="~/.claude/skills / ~/.agents/skills / ~/.config/opencode/skills"
case "$SKILLS_DIR" in
  .opencode/skills|.claude/skills|.agents/skills) : ;;
  *) SKILL_CANDIDATES="${SKILL_CANDIDATES} / ${SKILLS_DIR}" ;;
esac
SKILL_CANDIDATES="${SKILL_CANDIDATES} / ./.opencode/skills / ./.claude/skills / ./.agents/skills / scripts/../.opencode/skills / scripts/../.claude/skills"

# gh 认证探测（只读检查；轮询与 resolve 依赖它）。未认证不报错，走降级。
GH_OK=false
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    GH_OK=true
  fi
fi

# --pr 可解析性校验（gh 可用时才做）: 参数错误优先于降级——无法解析直接退 1，
# 不降级。gh 不可用/未认证时跳过本检查（走后面的降级 → 3）。
if [[ -n "$PR" && "$GH_OK" = true ]]; then
  if ! gh pr view "$PR" --json number -q .number >/dev/null 2>&1; then
    die "--pr 无法通过 gh 解析: ${PR}"
  fi
fi

# --- PR 目标 ----------------------------------------------------------------
PR_LABEL=""
PR_NOTE=""
if [[ -n "$PR" ]]; then
  PR_LABEL="#${PR}"
elif [[ "$GH_OK" = true ]]; then
  PR_LABEL="（未指定，执行时自动检测当前分支）"
  PR_NOTE="gh pr view --json number -q .number"
else
  PR_LABEL="（未指定）"
fi

# --- 打印函数 ----------------------------------------------------------------
# 步骤 1/2 随平台变化（触发与轮询机制不同）；3-6 是平台无关的收敛循环。
print_loop_protocol() {
  case "$VCS" in
    gitlab)
      echo "    1. 触发    push 后触发 merge request 上的审查（GitLab 按 greploop skill 配置的机器人）"
      echo "    2. 轮询    轮询 MR pipeline / 审查线程，直到本轮评审完成"
      ;;
    perforce)
      echo "    1. 触发    按 greploop skill 在 Perforce 场景手动触发审查（无 push 自动触发）"
      echo "    2. 轮询    按 greploop skill 轮询评审结果，直到本轮评审完成"
      ;;
    *)
      echo "    1. 触发    push 最新提交后由 Greptile App 触发审查（GitHub）"
      echo "    2. 轮询    轮询评审 check-run，直到本轮评审完成"
      ;;
  esac
  echo "    3. 抓取    读取评分（x/5）与全部未解决评论"
  echo "    4. 修复    逐条修复可行动评论（不做「差不多就行」的取舍）"
  echo "    5. 收敛    resolve 已处理的 review thread"
  echo "    6. 重触发  提交并 push → 回到第 1 步"
}

print_exit_conditions() {
  echo "    - 评分 = 5/5 且 未解决评论 = 0 → 闭环成功"
  echo "    - 或 已达 --max-iterations 上限（本次: ${MAX_ITERATIONS}）→ 停止并报告当前状态（不得视为通过）"
}

print_apps_note() {
  echo "    由 greploop skill 文档化引用，本脚本不单列；要点:"
  echo "    - 普通触发被告知「文件数超限」→ 换触发身份重新触发"
  echo "    - check-run 不出现 → 改为轮询被编辑的 summary 评论"
}

print_degrade() {
  echo ""
  echo "==> 降级: 审查闭环转为本地人工（不伪造评分，不阻塞交付）"
  if [[ -z "$GREPLOOP_SKILL" ]]; then
    echo "    原因: 未找到 greploop skill"
  fi
  if [[ "$GH_OK" != true ]]; then
    echo "    原因: gh 未认证（轮询与 resolve 不可用）"
  fi
  echo "    本地审查闭环:"
  echo "      1. code-review（Standards + Spec 双轴自审）"
  echo "      2. review（pre-landing 结构审查）"
  echo "      3. 人工清单: 逐条走查 PR diff，记录未解决项并在 PR 中回复"
  echo ""
  echo "==> 硬性要求: 在 PR 上显式标注「审查闭环降级为人工」，再进入合并流程。"
  echo "==> risk-medium/high 的合并仍需人工确认；无 Greptile 不阻塞交付。"
}

# --- 输出 --------------------------------------------------------------------
echo "==> cw-greploop: Greptile 审查闭环包装器（G2 审查阶段）"
echo "==> 目标 PR: ${PR_LABEL}"
if [[ -n "$PR_NOTE" ]]; then
  echo "    自动检测命令: ${PR_NOTE}"
fi
if [[ -z "$PR" && "$GH_OK" != true ]]; then
  echo "⚠️  未提供 --pr 且 gh 不可用（无法自动检测）—— 执行前必须显式提供 --pr <N>"
fi
echo "==> 平台: ${VCS}（${VCS_SOURCE}）"
echo "==> 迭代上限: ${MAX_ITERATIONS}"
echo "==> 能力检测:"
if [[ -n "$GREPLOOP_SKILL" ]]; then
  echo "    ✅ greploop skill: 找到（${GREPLOOP_SKILL}）"
else
  echo "    ⚠️  greploop skill: 未找到（候选: ${SKILL_CANDIDATES}）"
fi
if [[ "$GH_OK" = true ]]; then
  echo "    ✅ gh 认证: 通过"
else
  echo "    ⚠️  gh 认证: 未通过（轮询与 resolve 不可用）"
fi

# dry-run 与实跑故意共用同一打印路径与退出码契约：两套协议文本必然漂移，
# 曾出现「dry-run 打印的循环与实跑不一致」的隐患。dry-run 不发网络请求、不改文件。
if [[ "$DRY_RUN" = true ]]; then
  echo ""
  echo "[dry-run] 未执行任何动作；以下为将执行的循环协议与退出条件"
  echo ""
  echo "==> 循环协议（由 agent 依据 greploop skill 执行；本脚本不复制其逻辑）:"
  print_loop_protocol
  echo ""
  echo "==> 退出条件:"
  print_exit_conditions
  echo ""
  echo "==> greploop-apps（超大 PR 变体）:"
  print_apps_note
  echo ""
  if [[ -n "$GREPLOOP_SKILL" && "$GH_OK" = true ]]; then
    echo "[dry-run] 能力检测通过 → 实际执行走 greploop skill 循环"
    echo "⚠️  本脚本不执行循环：退出码 0 仅表示协议已打印，不代表审查通过"
    exit 0
  else
    echo "[dry-run] 能力检测未通过 → 实际执行将走降级路径:"
    print_degrade
    exit 3
  fi
fi

if [[ -n "$GREPLOOP_SKILL" && "$GH_OK" = true ]]; then
  echo ""
  echo "==> 循环协议（由 agent 依据 greploop skill 执行；本脚本不复制其逻辑）:"
  print_loop_protocol
  echo ""
  echo "==> 退出条件:"
  print_exit_conditions
  echo ""
  echo "==> greploop-apps（超大 PR 变体）:"
  print_apps_note
  echo ""
  echo "==> 下一步: agent 依据 greploop skill 执行上述循环，直到退出条件满足。"
  echo "⚠️  本脚本不执行循环：退出码 0 仅表示协议已打印，不代表审查通过"
  exit 0
else
  print_degrade
  exit 3
fi
