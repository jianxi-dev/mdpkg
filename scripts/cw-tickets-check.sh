#!/usr/bin/env bash
# =============================================================================
# cw-tickets-check.sh —— 拆票自检（G0-POST 发布前门禁；由工具包安装到消费仓 scripts/）
#
# 用法:
#   ./scripts/cw-tickets-check.sh --change <name> [--drafts <dir>] [--tasks <file>] [--live]
#   ./scripts/cw-tickets-check.sh --help
#
# 模式:
#   草稿模式（默认）: 校验 .tickets-draft/<change>/ 下的票面草稿（每票一文件，
#                     首行标题 [change=<名>/<task号>]，正文七字段）
#   --live:           用 gh issue list 对账（仅 C1）；与 --drafts 互斥
#
# 退出码: 0 = 全部通过（含 --help）；1 = 违规或用法错误
#
# 设计说明（为什么 + 历史教训）:
#
#   1. 为什么脚本化门禁，而不是规范文档里的手工 grep 清单（quiz retirement）:
#      quality-gates.md 的「如何验证」曾是给人读的 grep 命令清单 —— 靠 agent 手敲
#      必然漂移（漏跑、错正则、看一眼就说通过）。QG-1..QG-7 的判据只有变成机械
#      门禁才可靠: 退 0 才允许发布子票，违规即拒收。本脚本是这些判据的唯一机器
#      实现；规则文本（docs/agents/quality-gates.md）仍是单一事实来源。
#
#   2. C1-C8 与规范源的映射（为什么是这八条）:
#      C1 对账双射 ← task-tracking 规范: tasks.md 与票一一对应，防「票丢了/幽灵票」
#      C2 六字段   ← task-tracking 规范: 票内容七字段齐全，防「AC 栏空着就拆票」
#      C3 QG-1 形态 ← QG-1 用户层 AC 强制: AC 必须含浏览器可观测陈述
#      C4 禁入信号  ← QG-1 + QG-3 接线归属: 库层断言冒充用户可见 / 导出新 API 无接线
#      C5 DAG      ← task-tracking 规范: Blocked by 不得越界/自环/成环
#      C6 豁免显式  ← quality-gates 豁免规则: no-ui-impact 必须由票作者在标签字段显式声明
#      C7 规模钩子  ← QG-6 集成 checkpoint: 票数 ≥6 必须有集成 checkpoint 声明
#      C8 粒度重叠  ← QG-7 纵向切片: 粒度角色声明 + 票间 What 不得重复切同一片
#
#   3. 为什么重叠阈值是 80（OVERLAP_THRESHOLD_PCT=80）:
#      字符二元组 Jaccard ≥80% 意味着两张票的「What to build」几乎逐字相同。
#      纵向切片要求每票有独立用户可见交付物；What 高度重叠 = 切了同一片（QG-7）。
#      80 是经验阈值: 低于它允许措辞相近的合法票（同主题不同切片），高于它几乎
#      必然是重复切票。阈值是常量而非配置 —— 门禁判据不该被票作者调松。
#
#   4. 为什么依赖 python3（fail-closed）:
#      live 对账要解析 gh 的 JSON 输出，C8 重叠要算字符二元组 Jaccard —— bash 3.2
#      无内建 JSON，集合运算用 shell 写既慢又脆。python3 是工具包的声明依赖（与
#      gh/git 同级，见 README「前置依赖」）。运行时若缺 python3: 打印 ❌ 并退 1
#      （fail-closed）—— 门禁不可用时不放行，而不是「跳过检查当通过」。
#
#   5. 退出码契约（调用方依赖，勿改）:
#      0 = 全部通过（含 --help）；1 = 有违规或用法错误。
#      用法错误（缺 --change / 格式非法 / 未知参数 / --live 与 --drafts 互斥）
#      打印 ❌ + 用法到 stderr 后退 1。
# =============================================================================
set -euo pipefail

# 重叠阈值（C8）: 字符二元组 Jaccard 百分比，≥ 此值判为重复切票。
# 为什么是常量: 见头注 3 —— 门禁判据不该被票作者调松。
OVERLAP_THRESHOLD_PCT=80

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---- 违规收集 ---------------------------------------------------------------
# 违规逐行写入临时文件（内容含中文与特殊字符，变量拼接易碎）；计数用 wc。
VIOL_FILE="$(mktemp)"
# 退出统一清理（含 set -e 中断与 usage 提前退出的路径）
trap 'rm -f "$VIOL_FILE"' EXIT
add_violation() {
  printf '%s\n' "$1" >> "$VIOL_FILE"
}

# ---- 用法 -------------------------------------------------------------------
usage() {
  sed -n '3,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# ---- 参数解析 ---------------------------------------------------------------
CHANGE="" DRAFTS="" TASKS="" LIVE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --change)
      if [[ $# -lt 2 || -z "$2" ]]; then
        echo "❌ --change 需要非空参数" >&2
        usage >&2
        exit 1
      fi
      CHANGE="$2"; shift 2 ;;
    --change=*)
      CHANGE="${1#--change=}"
      if [[ -z "$CHANGE" ]]; then
        echo "❌ --change 需要非空参数" >&2
        usage >&2
        exit 1
      fi
      shift ;;
    --drafts)
      if [[ $# -lt 2 || -z "$2" ]]; then
        echo "❌ --drafts 需要非空目录参数" >&2
        usage >&2
        exit 1
      fi
      DRAFTS="$2"; shift 2 ;;
    --drafts=*)
      DRAFTS="${1#--drafts=}"
      if [[ -z "$DRAFTS" ]]; then
        echo "❌ --drafts 需要非空目录参数" >&2
        usage >&2
        exit 1
      fi
      shift ;;
    --tasks)
      if [[ $# -lt 2 || -z "$2" ]]; then
        echo "❌ --tasks 需要非空文件参数" >&2
        usage >&2
        exit 1
      fi
      TASKS="$2"; shift 2 ;;
    --tasks=*)
      TASKS="${1#--tasks=}"
      if [[ -z "$TASKS" ]]; then
        echo "❌ --tasks 需要非空文件参数" >&2
        usage >&2
        exit 1
      fi
      shift ;;
    --live)
      LIVE=1; shift ;;
    --help|-h)
      usage
      exit 0 ;;
    *)
      echo "❌ 未知参数: $1" >&2
      usage >&2
      exit 1 ;;
  esac
done

if [[ -z "$CHANGE" ]]; then
  echo "❌ 缺少 --change" >&2
  usage >&2
  exit 1
fi
if [[ ! "$CHANGE" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "❌ --change 格式非法: ${CHANGE}（只允许字母数字开头，含 . _ -）" >&2
  usage >&2
  exit 1
fi
if [[ "$LIVE" == "1" && -n "$DRAFTS" ]]; then
  echo "❌ --live 与 --drafts 互斥" >&2
  usage >&2
  exit 1
fi

# 缺省值相对仓库根解析（REPO_ROOT 已 cd）
TASKS="${TASKS:-openspec/changes/${CHANGE}/tasks.md}"
DRAFTS="${DRAFTS:-.tickets-draft/${CHANGE}}"

# ---- 依赖与输入存在性（fail-closed）-----------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ python3 不可用（本脚本依赖 python3 解析 JSON 与计算相似度）" >&2
  exit 1
fi
if [[ ! -f "$TASKS" ]]; then
  echo "❌ tasks.md 不存在: ${TASKS}" >&2
  exit 1
fi

# ---- 小工具 -----------------------------------------------------------------
# 去首尾空白。命令替换会吃掉尾部换行，故块值先 trim 再用。
trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# 成员判定: $1 = 目标，其余 = 集合。bash 3.2 无关联数组，线性扫描即可（票数小）。
in_set() {
  local needle="$1" x
  shift
  for x in "$@"; do
    [[ "$x" == "$needle" ]] && return 0
  done
  return 1
}

# 编号 → 下标（C5 环检测用）。未找到返回 1，调用方置空。
num_to_idx() {
  local needle="$1" k
  for k in "${!DRAFT_FILES[@]}"; do
    if [[ "${D_NUM[$k]}" == "$needle" ]]; then
      printf '%s' "$k"
      return 0
    fi
  done
  return 1
}

# ---- tasks.md 解析 ----------------------------------------------------------
# 契约: 行匹配 ^[[:space:]]*-[[:space:]]*\[[ xX]\][[:space:]]+([0-9]+\.[0-9]+)
# 两段 grep: 第一段锚定复选框行，第二段从匹配段里取编号（描述文字在编号之后，
# 不能用 $ 锚定）。
TASKS_NUMS=()
while IFS= read -r n; do
  [[ -n "$n" ]] && TASKS_NUMS+=("$n")
done < <(grep -oE '^[[:space:]]*-[[:space:]]*\[[ xX]\][[:space:]]+[0-9]+\.[0-9]+' "$TASKS" 2>/dev/null \
         | grep -oE '[0-9]+\.[0-9]+' || true)

# ---- 草稿解析（仅草稿模式）--------------------------------------------------
# 每票一文件；解析结果写入并行数组（bash 3.2 无关联数组）:
#   D_NUM D_TITLE D_PARENT D_WHAT D_AC D_BLOCKED D_WIRING D_LABELS D_SIZE D_BODY
#   D_BAD_TITLE（1 = 首行不符 [change=<名>/<task号>] 前缀）
DRAFT_FILES=()
D_NUM=(); D_TITLE=(); D_PARENT=(); D_WHAT=(); D_AC=(); D_BLOCKED=()
D_WIRING=(); D_LABELS=(); D_SIZE=(); D_BODY=(); D_BAD_TITLE=()

parse_draft() {
  local file="$1" line cur="" rest=""
  PD_NUM=""; PD_TITLE=""; PD_BAD_TITLE=0
  PD_PARENT=""; PD_WHAT=""; PD_AC=""; PD_BLOCKED=""
  PD_WIRING=""; PD_LABELS=""; PD_SIZE=""
  PD_BODY=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    PD_BODY="${PD_BODY}${line}
"
    # 首个非空行 = 标题
    if [[ -z "$PD_TITLE" && -n "${line//[[:space:]]/}" ]]; then
      PD_TITLE="$line"
    fi
    case "$line" in
      \*\*Parent\*\*:*)
        cur="PARENT"
        rest="$(trim "${line#*\*\*Parent\*\*:}")"
        [[ -n "$rest" ]] && { PD_PARENT="$rest"; cur=""; } ;;
      \*\*What\ to\ build\*\*:*)
        cur="WHAT"
        rest="$(trim "${line#*\*\*What\ to\ build\*\*:}")"
        [[ -n "$rest" ]] && { PD_WHAT="$rest"; cur=""; } ;;
      \*\*Acceptance\ criteria\*\*:*)
        cur="AC"
        rest="$(trim "${line#*\*\*Acceptance\ criteria\*\*:}")"
        [[ -n "$rest" ]] && { PD_AC="$rest"; cur=""; } ;;
      \*\*Blocked\ by\*\*:*)
        cur="BLOCKED"
        rest="$(trim "${line#*\*\*Blocked\ by\*\*:}")"
        [[ -n "$rest" ]] && { PD_BLOCKED="$rest"; cur=""; } ;;
      \*\*接线归属\*\*:*)
        cur="WIRING"
        rest="$(trim "${line#*\*\*接线归属\*\*:}")"
        [[ -n "$rest" ]] && { PD_WIRING="$rest"; cur=""; } ;;
      \*\*标签\*\*:*)
        cur="LABELS"
        rest="$(trim "${line#*\*\*标签\*\*:}")"
        [[ -n "$rest" ]] && { PD_LABELS="$rest"; cur=""; } ;;
      \*\*粒度\*\*:*)
        cur="SIZE"
        rest="$(trim "${line#*\*\*粒度\*\*:}")"
        [[ -n "$rest" ]] && { PD_SIZE="$rest"; cur=""; } ;;
      \*\*)
        # 下一个 ** 行 = 新字段开始，当前字段块结束
        cur="" ;;
      *)
        # 块行: 追加到当前字段（inline 非空时 cur 已清空，单行字段不收块）
        case "$cur" in
          PARENT) PD_PARENT="${PD_PARENT}${line}
" ;;
          WHAT) PD_WHAT="${PD_WHAT}${line}
" ;;
          AC) PD_AC="${PD_AC}${line}
" ;;
          BLOCKED) PD_BLOCKED="${PD_BLOCKED}${line}
" ;;
          WIRING) PD_WIRING="${PD_WIRING}${line}
" ;;
          LABELS) PD_LABELS="${PD_LABELS}${line}
" ;;
          SIZE) PD_SIZE="${PD_SIZE}${line}
" ;;
        esac
        ;;
    esac
  done < "$file"
  # 任务号: 从标题前缀 [change=<名>/<task号>] 提取；不符则记违规并退回文件名主干
  local prefix="[change=${CHANGE}/" num=""
  if [[ "$PD_TITLE" == "$prefix"* ]]; then
    rest="${PD_TITLE#"$prefix"}"
    num="${rest%%]*}"
    [[ "$num" =~ ^[0-9]+\.[0-9]+$ ]] && PD_NUM="$num"
  fi
  if [[ -z "$PD_NUM" ]]; then
    PD_BAD_TITLE=1
    PD_NUM="$(basename "$file" .md)"
  fi
}

if [[ "$LIVE" != "1" ]]; then
  if [[ ! -d "$DRAFTS" ]]; then
    echo "❌ 草稿目录不存在: ${DRAFTS}" >&2
    exit 1
  fi
  for f in "$DRAFTS"/*.md; do
    [[ -f "$f" ]] && DRAFT_FILES+=("$f")
  done
  if [[ ${#DRAFT_FILES[@]} -eq 0 ]]; then
    echo "❌ 草稿目录为空: ${DRAFTS}" >&2
    exit 1
  fi
  for i in "${!DRAFT_FILES[@]}"; do
    parse_draft "${DRAFT_FILES[$i]}"
    D_NUM+=("$PD_NUM"); D_TITLE+=("$PD_TITLE"); D_BAD_TITLE+=("$PD_BAD_TITLE")
    D_PARENT+=("$PD_PARENT"); D_WHAT+=("$PD_WHAT"); D_AC+=("$PD_AC")
    D_BLOCKED+=("$PD_BLOCKED"); D_WIRING+=("$PD_WIRING")
    D_LABELS+=("$PD_LABELS"); D_SIZE+=("$PD_SIZE"); D_BODY+=("$PD_BODY")
  done
fi

# ---- C1 对账双射（草稿模式）-------------------------------------------------
check_c1_drafts() {
  echo "==> C1 对账双射（草稿 ↔ tasks.md）"
  local viol=0 n i j
  # 缺失: tasks.md 有、草稿无
  for n in "${TASKS_NUMS[@]}"; do
    if ! in_set "$n" "${D_NUM[@]}"; then
      add_violation "- [C1] 缺失: tasks.md 有 ${n} 但草稿目录无对应票"
      viol=$((viol + 1))
    fi
  done
  # 多余: 草稿有、tasks.md 无
  for i in "${!DRAFT_FILES[@]}"; do
    if ! in_set "${D_NUM[$i]}" "${TASKS_NUMS[@]}"; then
      add_violation "- [C1] 多余: 草稿 ${DRAFT_FILES[$i]} 的 ${D_NUM[$i]} 不在 tasks.md"
      viol=$((viol + 1))
    fi
  done
  # 重复: 同一编号出现在多个文件
  for i in "${!DRAFT_FILES[@]}"; do
    for j in "${!DRAFT_FILES[@]}"; do
      if [[ $i -lt $j && "${D_NUM[$i]}" == "${D_NUM[$j]}" ]]; then
        add_violation "- [C1] 重复: ${D_NUM[$i]} 同时出现在 ${DRAFT_FILES[$i]} 与 ${DRAFT_FILES[$j]}"
        viol=$((viol + 1))
      fi
    done
  done
  # 标题不符: 首行须以 [change=<名>/<task号>] 开头
  for i in "${!DRAFT_FILES[@]}"; do
    if [[ "${D_BAD_TITLE[$i]}" == "1" ]]; then
      add_violation "- [C1] 标题不符: ${DRAFT_FILES[$i]}（首行须以 [change=${CHANGE}/<task号>] 开头）"
      viol=$((viol + 1))
    fi
  done
  if [[ $viol -eq 0 ]]; then
    echo "  ✅ 草稿与 tasks.md 一一对应（${#DRAFT_FILES[@]} 张）"
  else
    echo "  ❌ ${viol} 项违规" >&2
  fi
}

# ---- C1 对账双射（live 模式）------------------------------------------------
# 数据源: gh issue list --state all --limit 200 --json number,title
# 只取标题以 [change=<名>/ 开头的 issue；gh 调用失败即违规（fail-closed）。
check_c1_live() {
  echo "==> C1 对账双射（live ↔ tasks.md）"
  local viol=0 gh_out="" gh_rc=0 n
  gh_out="$(gh issue list --state all --limit 200 --json number,title 2>/dev/null)" || gh_rc=$?
  if [[ $gh_rc -ne 0 ]]; then
    add_violation "- [C1] gh issue list 调用失败（无法对账 live 票）"
    echo "  ❌ 1 项违规" >&2
    return
  fi
  local live_nums=() py_file=""
  py_file="$(mktemp)"
  cat > "$py_file" <<'PY'
import json, re, sys
change = sys.argv[1]
prefix = "[change=%s/" % change
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for item in data:
    title = item.get("title") or ""
    if title.startswith(prefix):
        rest = title[len(prefix):]
        num = rest.split("]", 1)[0]
        if re.match(r"^[0-9]+\.[0-9]+$", num):
            print(num)
PY
  while IFS= read -r n; do
    [[ -n "$n" ]] && live_nums+=("$n")
  done < <(printf '%s' "$gh_out" | python3 "$py_file" "$CHANGE")
  rm -f "$py_file"
  for n in "${TASKS_NUMS[@]}"; do
    if ! in_set "$n" "${live_nums[@]}"; then
      add_violation "- [C1] 缺失: tasks.md 有 ${n} 但 live 票列表无对应 issue"
      viol=$((viol + 1))
    fi
  done
  for n in "${live_nums[@]}"; do
    if ! in_set "$n" "${TASKS_NUMS[@]}"; then
      add_violation "- [C1] 多余: live issue ${n} 不在 tasks.md（幽灵票）"
      viol=$((viol + 1))
    fi
  done
  # 重复: 同一编号出现在多个 issue
  for i in "${!live_nums[@]}"; do
    for j in "${!live_nums[@]}"; do
      if [[ $i -lt $j && "${live_nums[$i]}" == "${live_nums[$j]}" ]]; then
        add_violation "- [C1] 重复: live 列表里 ${live_nums[$i]} 出现多次"
        viol=$((viol + 1))
      fi
    done
  done
  if [[ $viol -eq 0 ]]; then
    echo "  ✅ live 票与 tasks.md 一一对应（${#live_nums[@]} 张）"
  else
    echo "  ❌ ${viol} 项违规" >&2
  fi
}

# ---- C2 六字段完整 -----------------------------------------------------------
check_c2() {
  echo "==> C2 六字段完整"
  local viol=0 i v missing
  for i in "${!DRAFT_FILES[@]}"; do
    missing=""
    v="$(trim "${D_PARENT[$i]}")"
    if [[ -z "$v" ]]; then missing="${missing} Parent"; fi
    v="$(trim "${D_WHAT[$i]}")"
    if [[ -z "$v" ]]; then missing="${missing} What to build"; fi
    v="$(trim "${D_AC[$i]}")"
    if [[ -z "$v" ]]; then missing="${missing} Acceptance criteria"; fi
    v="$(trim "${D_BLOCKED[$i]}")"
    if [[ -z "$v" ]]; then missing="${missing} Blocked by"; fi
    v="$(trim "${D_WIRING[$i]}")"
    if [[ -z "$v" ]]; then missing="${missing} 接线归属"; fi
    v="$(trim "${D_LABELS[$i]}")"
    if [[ -z "$v" ]]; then missing="${missing} 标签"; fi
    if [[ -n "$missing" ]]; then
      add_violation "- [C2] ${D_NUM[$i]} 缺少字段:${missing}"
      viol=$((viol + 1))
    fi
  done
  if [[ $viol -eq 0 ]]; then
    echo "  ✅ 六字段齐全（${#DRAFT_FILES[@]} 张）"
  else
    echo "  ❌ ${viol} 项违规" >&2
  fi
}

# ---- C3 QG-1 形态 ------------------------------------------------------------
# 未声明 no-ui-impact 的票，AC 块必须匹配 ERE 打开.*页面|dev server|\.spec\.ts
# （quality-gates.md §四 的 QG-1 谓词，逐字复用）。
# 三分类 AC 关键词：存在/生命周期/保真 → 必含 取消/残留/空态/严格等于/不含
check_c3() {
  echo "==> C3 QG-1 形态（AC 可观测 + 三分类）"
  local viol=0 i ac hits
  for i in "${!DRAFT_FILES[@]}"; do
    if [[ "${D_BODY[$i]}" != *"no-ui-impact"* ]]; then
      ac="${D_AC[$i]}"
      hits="$(printf '%s\n' "$ac" | grep -E '打开.*页面|dev server|\.spec\.ts' || true)"
      if [[ -z "$hits" ]]; then
        add_violation "- [C3] ${D_NUM[$i]} AC 无可观测形态（QG-1: 打开.*页面|dev server|.spec.ts）"
        viol=$((viol + 1))
      fi
      # 三分类关键词机检：生命周期（取消/残留/空态）+ 保真（严格等于/不含）
      hits="$(printf '%s\n' "$ac" | grep -E '取消|残留|空态|严格等于|不含' || true)"
      if [[ -z "$hits" ]]; then
        add_violation "- [C3] ${D_NUM[$i]} AC 缺三分类关键词（QG-1: 取消|残留|空态|严格等于|不含）"
        viol=$((viol + 1))
      fi
    fi
  done
  if [[ $viol -eq 0 ]]; then
    echo "  ✅ AC 形态符合 QG-1（含三分类）"
  else
    echo "  ❌ ${viol} 项违规" >&2
  fi
}

# ---- C4 禁入信号 -------------------------------------------------------------
# (a) 库层断言冒充用户可见: 未声明 no-ui-impact 时，AC 有 ≥1 条 bullet、
#     无一 bullet 可观测、且 ≥1 条命中 类型检查|单测|单元测试|返回|导出。
# (b) 导出新 API 却无接线归属（QG-3）: 正文任一行命中导出正则且该行未声明豁免，
#     则接线归属须非空且不是占位值（无/none/n/a/—/-/待定/tbd，大小写不敏感）。
# (c) 三分类 AC 缺失：未声明 no-ui-impact 时，AC 缺生命周期/保真关键词（取消/残留/空态/严格等于/不含）
check_c4() {
  echo "==> C4 禁入信号（库层断言 / 导出无接线 / 三分类缺失）"
  local viol=0 i ac bullets obs lib line hits wiring wiring_lc
  for i in "${!DRAFT_FILES[@]}"; do
    if [[ "${D_BODY[$i]}" != *"no-ui-impact"* ]]; then
      ac="${D_AC[$i]}"
      bullets="$(printf '%s\n' "$ac" | grep -E '^[[:space:]]*-' || true)"
      if [[ -n "$bullets" ]]; then
        obs="$(printf '%s\n' "$bullets" | grep -E '打开.*页面|dev server|\.spec\.ts' || true)"
        lib="$(printf '%s\n' "$bullets" | grep -E '类型检查|单测|单元测试|返回|导出' || true)"
        if [[ -z "$obs" && -n "$lib" ]]; then
          add_violation "- [C4] ${D_NUM[$i]} AC 全部为库层断言（未声明 no-ui-impact）"
          viol=$((viol + 1))
        fi
      fi
      # (c) 三分类 AC 缺失机检
      hits="$(printf '%s\n' "$ac" | grep -E '取消|残留|空态|严格等于|不含' || true)"
      if [[ -z "$hits" ]]; then
        add_violation "- [C4] ${D_NUM[$i]} AC 缺三分类关键词（生命周期/保真：取消|残留|空态|严格等于|不含）"
        viol=$((viol + 1))
      fi
    fi
    # (b) 导出正则扫描正文每行；豁免串来自 quality-gates.md QG-3 的「无新增导出」惯例
    while IFS= read -r line; do
      hits="$(printf '%s\n' "$line" | grep -E '导出新(的)?(API|接口)|新增(的)?(API|接口|导出)|export (function|const|class)' || true)"
      if [[ -n "$hits" ]]; then
        case "$line" in
          *无新增导出*|*不新增导出*|*无导出*|*不导出*|*无需接线*|*不适用*) ;;
          *)
            wiring="$(trim "${D_WIRING[$i]}")"
            wiring_lc="$(printf '%s' "$wiring" | tr '[:upper:]' '[:lower:]')"
            if [[ -z "$wiring" ]] || [[ "$wiring_lc" =~ ^(无|none|n/?a|—|-|待定|tbd)$ ]]; then
              add_violation "- [C4] ${D_NUM[$i]} 导出新 API 却无接线归属"
              viol=$((viol + 1))
            fi
            ;;
        esac
      fi
    done <<< "${D_BODY[$i]}"
  done
  if [[ $viol -eq 0 ]]; then
    echo "  ✅ 无禁入信号"
  else
    echo "  ❌ ${viol} 项违规" >&2
  fi
}

# ---- C3/C4 conformance.json 锚点机检（IC-1）-----------------------------------
# 规格双形态的机制层（design.md D1）: 人读 AC 之外，change 目录须有机读锚点
# conformance.json。本函数在 C3/C4 关键词检查之外补四项机检（IC-1 冻结契约）:
#   完备性    —— 每 requirement ≥1 anchor
#   无孤儿    —— anchor id（A-<n>.<m>）回指存在的 requirement（R-<n>）
#   可断言性  —— assert 非空且含具体值 token（数字 / 引号串 / #hex / 状态迁移关键词）
#   来源非空  —— source 非空
# conformance.json 不存在 → 跳过（不违规）；存在但解析失败 → 违规（fail-closed）。
# 路径: openspec/changes/<change>/conformance.json，无 openspec 的消费仓
#       回退 docs/requirements/<change>/conformance.json（IC-1）。
check_conformance() {
  echo "==> C3/C4 conformance.json 锚点机检（IC-1）"
  local conf_json="" cand py_file="" line viol=0
  for cand in "openspec/changes/${CHANGE}/conformance.json" "docs/requirements/${CHANGE}/conformance.json"; do
    if [[ -f "$cand" ]]; then conf_json="$cand"; break; fi
  done
  if [[ -z "$conf_json" ]]; then
    echo "  ⚠️  未找到 conformance.json（openspec/changes/${CHANGE}/ 或 docs/requirements/${CHANGE}/），跳过机检"
    return 0
  fi
  py_file="$(mktemp)"
  cat > "$py_file" <<'PY'
import json, re, sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
except Exception as e:
    print("[C3/C4] conformance.json 解析失败: %s（%s）" % (path, e))
    sys.exit(0)

reqs = data.get("requirements")
if not isinstance(reqs, list):
    print("[C3/C4] conformance.json 缺 requirements 数组: %s" % path)
    sys.exit(0)

# 无孤儿判定: anchor id 形如 A-<n>.<m>，<n> 必须对应存在的 requirement R-<n>
req_nums = set()
for r in reqs:
    rid = r.get("id") or ""
    m = re.match(r"^R-(\d+)$", rid)
    if m:
        req_nums.add(m.group(1))

# 可断言性: assert 须含具体值 token（数字 / 引号串 / #hex / 状态迁移关键词）
STATE_KEYWORDS = ("→", "->", "变为", "进入", "迁移到", "切换到", "回到", "恢复")

def has_token(s):
    if not s:
        return False
    if re.search(r"[0-9]", s):
        return True
    if '"' in s or "'" in s:
        return True
    if re.search(r"#[0-9a-fA-F]{3,8}", s):
        return True
    for kw in STATE_KEYWORDS:
        if kw in s:
            return True
    return False

for r in reqs:
    rid = r.get("id") or "(缺 id)"
    anchors = r.get("anchors")
    if not isinstance(anchors, list) or len(anchors) == 0:
        print("[C3/C4] 完备性: requirement %s 无 anchor（每 requirement ≥1 anchor）" % rid)
        continue
    for a in anchors:
        aid = a.get("id") or "(缺 id)"
        m = re.match(r"^A-(\d+)\.\d+$", aid)
        if not m:
            print("[C3/C4] 无孤儿: anchor %s id 非法（须为 A-<n>.<m>，且 <n> 对应存在的 requirement）" % aid)
        elif m.group(1) not in req_nums:
            print("[C3/C4] 无孤儿: anchor %s 回指不存在的 requirement R-%s" % (aid, m.group(1)))
        assert_val = a.get("assert")
        if not assert_val or not has_token(str(assert_val)):
            print("[C3/C4] 可断言性: anchor %s 的 assert 空或不含具体值 token（数字/引号串/#hex/状态迁移关键词）" % aid)
        source_val = a.get("source")
        if not source_val or not str(source_val).strip():
            print("[C3/C4] 来源非空: anchor %s 的 source 为空" % aid)
PY
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    add_violation "$line"
    viol=$((viol + 1))
  done < <(python3 "$py_file" "$conf_json" 2>/dev/null)
  rm -f "$py_file"
  if [[ $viol -eq 0 ]]; then
    echo "  ✅ conformance.json 锚点机检通过（完备/无孤儿/可断言/来源非空）"
  else
    echo "  ❌ ${viol} 项违规" >&2
  fi
}

# ---- C5 Blocked by DAG -------------------------------------------------------
# 值整体为 None/无/—/- 或含 can start immediately → 无依赖；否则提取
# [0-9]+\.[0-9]+ token。越界（不在票集）/自环（指向自己）逐条记违规；
# 环用 Kahn 消解后剩余节点报告（成员 + 剩余集内的一条走路径）。
check_c5() {
  echo "==> C5 Blocked by DAG"
  local viol=0 i blocked t idx
  DEPS=()
  for i in "${!DRAFT_FILES[@]}"; do
    blocked="$(trim "${D_BLOCKED[$i]}")"
    if [[ "$blocked" == "None" || "$blocked" == "无" || "$blocked" == "—" || "$blocked" == "-" || "$blocked" == *"can start immediately"* ]]; then
      DEPS+=("")
      continue
    fi
    local deps="" tok
    while IFS= read -r tok; do
      [[ -z "$tok" ]] && continue
      deps="${deps} ${tok}"
      if ! in_set "$tok" "${D_NUM[@]}"; then
        add_violation "- [C5] ${D_NUM[$i]} 引用越界: Blocked by 含 ${tok}（不在本 change 票集）"
        viol=$((viol + 1))
      elif [[ "$tok" == "${D_NUM[$i]}" ]]; then
        add_violation "- [C5] ${D_NUM[$i]} 自环: Blocked by 含自身编号 ${tok}"
        viol=$((viol + 1))
      fi
    done <<< "$(printf '%s\n' "$blocked" | grep -oE '[0-9]+\.[0-9]+' || true)"
    DEPS+=("${deps# }")
  done
  # Kahn 消解: 依赖全部已解析的节点可解析，循环标记；剩余即环成员
  local resolved=() changed=1 k all_resolved idx
  for i in "${!DRAFT_FILES[@]}"; do resolved+=(0); done
  while [[ "$changed" == "1" ]]; do
    changed=0
    for i in "${!DRAFT_FILES[@]}"; do
      if [[ "${resolved[$i]}" == "0" ]]; then
        all_resolved=1
        while IFS= read -r t; do
          [[ -z "$t" ]] && continue
          idx="$(num_to_idx "$t")" || idx=""
          if [[ -n "$idx" && "${resolved[$idx]}" == "0" ]]; then
            all_resolved=0
          fi
        done <<< "${DEPS[$i]}"
        if [[ "$all_resolved" == "1" ]]; then
          resolved[$i]=1
          changed=1
        fi
      fi
    done
  done
  # 剩余未解析节点 = 环成员；报告成员 + 剩余集内一条走路径
  local members="" start=-1
  for i in "${!DRAFT_FILES[@]}"; do
    if [[ "${resolved[$i]}" == "0" ]]; then
      members="${members} ${D_NUM[$i]}"
      [[ $start -lt 0 ]] && start=$i
    fi
  done
  if [[ $start -ge 0 ]]; then
    local visited="$start" path="${D_NUM[$start]}" cur="$start" next
    while true; do
      next=-1
      while IFS= read -r t; do
        [[ -z "$t" ]] && continue
        idx="$(num_to_idx "$t")" || idx=""
        if [[ -n "$idx" && "${resolved[$idx]}" == "0" ]]; then
          next=$idx
          break
        fi
      done <<< "${DEPS[$cur]}"
      [[ $next -lt 0 ]] && break
      path="${path} → ${D_NUM[$next]}"
      case " $visited " in
        *" $next "*) break ;;
      esac
      visited="${visited} ${next}"
      cur=$next
    done
    add_violation "- [C5] 环: 成员${members}；路径 ${path}"
    viol=$((viol + 1))
  fi
  if [[ $viol -eq 0 ]]; then
    echo "  ✅ Blocked by 无越界/自环/环"
  else
    echo "  ❌ ${viol} 项违规" >&2
  fi
}

# ---- C6 豁免显式 -------------------------------------------------------------
# no-ui-impact 出现在正文但不在 **标签** 值里 → 豁免未显式声明。
check_c6() {
  echo "==> C6 豁免显式"
  local viol=0 i
  for i in "${!DRAFT_FILES[@]}"; do
    if [[ "${D_BODY[$i]}" == *"no-ui-impact"* && "${D_LABELS[$i]}" != *"no-ui-impact"* ]]; then
      add_violation "- [C6] ${D_NUM[$i]} 豁免须在标签字段显式声明"
      viol=$((viol + 1))
    fi
  done
  if [[ $viol -eq 0 ]]; then
    echo "  ✅ 豁免声明显式"
  else
    echo "  ❌ ${viol} 项违规" >&2
  fi
}

# ---- C7 规模钩子 -------------------------------------------------------------
# 票数 ≥6 时，全部草稿正文拼接后须命中 集成 ?checkpoint|checkpoint 计划|QG-6
# （QG-6 集成 checkpoint 声明）。
check_c7() {
  echo "==> C7 规模钩子"
  local viol=0 all_bodies hits
  if [[ ${#DRAFT_FILES[@]} -ge 6 ]]; then
    all_bodies="$(printf '%s\n' "${D_BODY[@]}")"
    hits="$(printf '%s\n' "$all_bodies" | grep -E '集成 ?checkpoint|checkpoint 计划|QG-6' || true)"
    if [[ -z "$hits" ]]; then
      add_violation "- [C7] 票数 ≥6 但无集成 checkpoint 声明（QG-6）"
      viol=$((viol + 1))
    fi
  fi
  if [[ $viol -eq 0 ]]; then
    echo "  ✅ 规模钩子满足"
  else
    echo "  ❌ ${viol} 项违规" >&2
  fi
}

# ---- C8 粒度声明与重叠 -------------------------------------------------------
# (a) **粒度** 值（trim 后去尾部括号说明）须为 用户可见交付物 或
#     expand/migrate/contract/integrate-verify 之一。
# (b) 两两 What to build 的字符二元组 Jaccard ≥ 阈值 → 重复切票。
check_c8() {
  echo "==> C8 粒度声明与重叠"
  local viol=0 i size
  for i in "${!DRAFT_FILES[@]}"; do
    size="$(trim "${D_SIZE[$i]}")"
    case "$size" in
      *（*）) size="${size%%（*）}" ;;
      *\(*\)) size="${size%%\(*}" ;;
    esac
    size="$(trim "$size")"
    if [[ "$size" != "用户可见交付物" && "$size" != "expand" && "$size" != "migrate" && "$size" != "contract" && "$size" != "integrate-verify" ]]; then
      add_violation "- [C8] ${D_NUM[$i]} 粒度未声明或非法: ${size:-（空）}"
      viol=$((viol + 1))
    fi
  done
  # (b) 重叠: 每票 What 写独立文件，python3 算字符二元组 Jaccard
  local what_dir="" py_file="" a b pct
  what_dir="$(mktemp -d)"
  for i in "${!DRAFT_FILES[@]}"; do
    printf '%s' "${D_WHAT[$i]}" > "$what_dir/${D_NUM[$i]}.txt"
  done
  py_file="$(mktemp)"
  cat > "$py_file" <<'PY'
import itertools, pathlib, sys
d = {}
for p in pathlib.Path(sys.argv[1]).glob("*.txt"):
    d[p.stem] = p.read_text(encoding="utf-8").strip()
threshold = float(sys.argv[2])
def bigrams(s):
    if len(s) < 2:
        return {s} if s else set()
    return {s[i:i + 2] for i in range(len(s) - 1)}
for a, b in itertools.combinations(sorted(d), 2):
    sa, sb = bigrams(d[a]), bigrams(d[b])
    union = sa | sb
    if not union:
        continue
    j = len(sa & sb) / len(union) * 100
    if j >= threshold:
        print(f"{a}|{b}|{j:.0f}")
PY
  while IFS='|' read -r a b pct; do
    [[ -z "$a" ]] && continue
    add_violation "- [C8] ${a} ↔ ${b} What 重叠 ${pct}%（阈值 ${OVERLAP_THRESHOLD_PCT}%）"
    viol=$((viol + 1))
  done < <(python3 "$py_file" "$what_dir" "$OVERLAP_THRESHOLD_PCT")
  rm -f "$py_file"
  rm -rf "$what_dir"
  if [[ $viol -eq 0 ]]; then
    echo "  ✅ 粒度声明合法且无重叠"
  else
    echo "  ❌ ${viol} 项违规" >&2
  fi
}

# ---- 入口 -------------------------------------------------------------------
if [[ "$LIVE" == "1" ]]; then
  check_c1_live
else
  check_c1_drafts
  check_c2
  check_c3
  check_c4
  check_conformance
  check_c5
  check_c6
  check_c7
  check_c8
fi

VIOL_COUNT="$(wc -l < "$VIOL_FILE" | tr -d ' ')"
if [[ "$VIOL_COUNT" -eq 0 ]]; then
  if [[ "$LIVE" == "1" ]]; then
    echo "✅ 对账全部通过（C1）"
  else
    echo "✅ 拆票自检全部通过（C1-C8）"
  fi
  exit 0
fi

if [[ "$LIVE" == "1" ]]; then
  echo "❌ 对账未通过（${VIOL_COUNT} 项违规）"
else
  echo "❌ 拆票自检未通过（${VIOL_COUNT} 项违规）"
fi
cat "$VIOL_FILE" >&2
exit 1
