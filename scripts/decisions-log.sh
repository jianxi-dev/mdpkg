#!/usr/bin/env bash
# =============================================================================
# decisions-log.sh — 决策日志追加器（由工具包安装到消费仓 scripts/decisions-log.sh）
#
# 用法:
#   ./scripts/decisions-log.sh add <阶段> <决策> <理由> <证据指针> <结果>
#   ./scripts/decisions-log.sh show [N]     # 打印日志（可选只看最近 N 行）
#   ./scripts/decisions-log.sh path         # 打印日志文件路径
#   ./scripts/decisions-log.sh --help|-h    # 本用法（退出码 0）
#
# --file <路径> 为全局标志（可置于任意位置）；未给时读环境变量 DECISIONS_LOG；
# 均未给则默认 ./.artifacts/decisions.tsv（相对当前目录）。
#
# 设计说明（为什么 + 历史教训）:
#
#   1. 为什么需要决策日志: 隔夜/无人值守的 frontier 循环需要一个可审计轨迹——
#      「这一夜 agent 做了哪些决策、为什么」不能靠早上重读 issue 还原。每票收尾
#      追加一行（时间/阶段/决策/理由/证据指针/结果），以 TSV 落盘，人可读、
#      表格可开、评审者可用。
#
#   2. 为什么默认落 .artifacts/（本地、不入库）: 决策日志是运行记录不是交付物，
#      默认不提交；需要留档的项目用 --file docs/decisions.tsv 或 DECISIONS_LOG
#      改路径后自行纳入版本控制。
#
#   3. 为什么清洗字段 + 公式前缀（与上游 pstack show-me-your-work/log.sh 同语义，
#      保持跨工具可互换读取）: 字段来自 agent 生成的文本与 PR 标题等外部内容——
#      含 tab/换行会让一行裂成多行（TSV 结构毁掉）；首字符 =/+/-/@ 会被
#      Excel/Sheets 当公式执行（打开的评审者中招，即公式注入）。故：tab/换行/CR
#      折为空格；公式类首字符整格前缀单引号 '。
#
# 退出码: 0 = 成功（含 --help / show 无文件 / path）；
#         1 = 用法或参数错误（无子命令 / 未知子命令 / add 参数数量或空值 / --file 空值）。
# =============================================================================
set -euo pipefail

DEFAULT_FILE=".artifacts/decisions.tsv"
FILE_OPT=""
LOG_FILE=""

log()  { echo "==> $*"; }
warn() { echo "⚠️  $*" >&2; }

# 单元格清洗：tab/换行/CR 折为空格；首字符 =/+/-/@ 前缀 '（防表格公式注入）。
clean() {
  local v="$1"
  v="$(printf '%s' "$v" | tr '\t\n\r' '   ')"
  case "$v" in
    =*|+*|-*|@*) printf "'%s" "$v" ;;
    *) printf '%s' "$v" ;;
  esac
}

cmd_help() {
  sed -n '3,/^# ===/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

# add: 恰好 5 个非空参数；首写建 TSV 头；追加一行。
cmd_add() {
  if [[ $# -ne 5 ]]; then
    echo "❌ add 需要恰好 5 个参数（阶段 决策 理由 证据指针 结果），收到 $# 个" >&2
    cmd_help >&2
    exit 1
  fi
  local i=1 f=""
  for f in "$@"; do
    if [[ -z "$f" ]]; then
      echo "❌ add 第 ${i} 个参数为空（五个字段均不得为空，可用「—」占位）" >&2
      exit 1
    fi
    i=$((i + 1))
  done
  local dir=""
  dir="$(dirname "$LOG_FILE")"
  if [[ -n "$dir" && "$dir" != "." && ! -d "$dir" ]]; then
    mkdir -p "$dir"
  fi
  if [[ ! -f "$LOG_FILE" ]]; then
    printf 'ts\tphase\tdecision\twhy\tevidence\tresult\n' > "$LOG_FILE"
  fi
  local ts=""
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$ts" "$(clean "$1")" "$(clean "$2")" "$(clean "$3")" "$(clean "$4")" "$(clean "$5")" \
    >> "$LOG_FILE"
  log "已追加决策日志: ${LOG_FILE}"
}

# show: 无文件不是错误（还没写过日志而已）；N 只允许正整数。
cmd_show() {
  local n="${1:-}"
  if [[ ! -f "$LOG_FILE" ]]; then
    warn "决策日志尚未创建: ${LOG_FILE}（首次 add 时自动创建）"
    return 0
  fi
  if [[ -z "$n" ]]; then
    cat "$LOG_FILE"
    return 0
  fi
  case "$n" in
    *[!0-9]*) echo "❌ show 的可选参数必须是数字（最近 N 行）: ${n}" >&2; exit 1 ;;
  esac
  tail -n "$n" "$LOG_FILE"
}

cmd_path() {
  printf '%s\n' "$LOG_FILE"
}

main() {
  local cmd="" a=""
  local -a argv=()
  while [[ $# -gt 0 ]]; do
    a="$1"
    case "$a" in
      --file)
        shift
        if [[ $# -eq 0 || -z "$1" ]]; then
          echo "❌ --file 需要非空路径参数" >&2
          exit 1
        fi
        FILE_OPT="$1"
        shift
        ;;
      --file=*)
        FILE_OPT="${a#--file=}"
        if [[ -z "$FILE_OPT" ]]; then
          echo "❌ --file 需要非空路径参数" >&2
          exit 1
        fi
        shift
        ;;
      *)
        argv+=("$a")
        shift
        ;;
    esac
  done
  set -- ${argv[@]+"${argv[@]}"}
  LOG_FILE="${FILE_OPT:-${DECISIONS_LOG:-$DEFAULT_FILE}}"
  cmd="${1:-}"
  case "$cmd" in
    add)  shift; cmd_add "$@" ;;
    show) shift; cmd_show "$@" ;;
    path) cmd_path ;;
    --help|-h|help) cmd_help ;;
    "")
      echo "❌ 未指定子命令（可用: add / show / path）" >&2
      cmd_help >&2
      exit 1 ;;
    *)
      echo "❌ 未知子命令: ${cmd}" >&2
      echo "运行 ./scripts/decisions-log.sh --help 查看用法" >&2
      exit 1 ;;
  esac
}

main "$@"
