#!/usr/bin/env bash
# cw-vision.sh —— 读图/抽帧的唯一入口（由工具包安装到消费仓 scripts/cw-vision.sh）
#
# 用法: ./scripts/cw-vision.sh <子命令> [参数...]
#
#   doctor                     列出识别到的视觉后端与能力（恒退 0）
#   describe <img>... [-p 提示]  让多模态模型描述图片（布局/配色/元素/文字）
#   analyze  <img>... [--crop fold|scroll1|scroll2]
#                              从像素算硬数字（主色板/留白率/亮度/纹理），JSON 输出
#   frame    <视频> <秒>        抽一帧存 <视频目录>/frame-<秒补零>.png 并打印路径
#   --help, -h                 本帮助（退 0）
#
# 设计说明（为什么 + 历史教训）:
#
#   1. 为什么要有这一层: 同一个读图能力在消费仓里已经存在 2-3 份副本
#      （scripts/vision/vision.py、scripts/vision.py、analyze.py / analyze_image.py），
#      每份脚本头都写着「同源副本，改动需同步两处」。副本必然漂移，而**漂移后的
#      读图结论看起来一样可信**——比没有能力更危险。本脚本不重新实现视觉，只做
#      「定位 + 参数归一 + 退出码契约」，是唯一定位入口（同 cw-evidence.sh 的定位思路）。
#
#   2. 为什么 describe 与 analyze 分开: 多模态模型会编造具体细节（按钮文字、精确
#      色值），而硬数字必须从像素算。两件事用两个后端，不许互相替代——把 analyze 的
#      JSON 当布局描述、或把 describe 的正文当色值证据，都属 QG-5 的「结论当证据」。
#
#   3. 为什么 frame 是本脚本的职责: 视频录了不等于看了。上一轮的优化落在用户级
#      skill（按断点时间戳抽帧核查），但 CW 侧没有任何可执行入口，于是「多步流程
#      证据」退化成「有一个 mp4 文件」。抽帧是纯 ffmpeg，没有模型风险，放这里最稳。
#
#   4. 退出码契约（调用方依赖，勿改）:
#        doctor / --help 恒退 0（体检入口，缺什么都不阻断，缺项以 ⚠️ 呈现）；
#        describe / analyze 成功 0，透传后端退出码；
#        后端缺失/不可用 → 退 3（降级）。**退 3 不等于放行**：须把「缺什么、
#        探测输出」记进票面（docs/agents/evidence-capture.md §六）。
#        参数错误退 1；frame 缺 ffmpeg 或视频不存在退 3 / 1。
#
#   5. 后端的信任边界: 视觉后端是仓库内文件（scripts/vision*），会被 `exec python3`。
#      谁能提交该文件，谁就能让任何跑本脚本的人执行任意代码。故候选路径**只认仓库根
#      下的 scripts/ 相对位置**（不接受 $PATH 里的同名命令、不接受任意目录），也不从
#      .change-workflow.conf 读后端路径（conf 仓库可控，source 它等于自废边界）。
#      CW_VISION_CMD 是环境变量（本人显式设置，非仓库可控），优先级最高。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log()  { echo "==> $*"; }
warn() { echo "⚠️  $*" >&2; }

# ---- 后端定位 ---------------------------------------------------------------

# describe 后端候选（顺序即优先级）：先多模态描述脚本，再通用 vision 入口。
# 只认仓库根 scripts/ 下的相对路径 —— 见头注 5。
describe_backend() {
  local c
  for c in \
    "$REPO_ROOT/scripts/vision/vision.py" \
    "$REPO_ROOT/scripts/vision.py" \
    "$REPO_ROOT/scripts/analyze.py"
  do
    [[ -f "$c" ]] || continue
    case "$c" in
      *vision.py) printf '%s\n' "$c"; return 0 ;;
    esac
  done
  return 1
}

# analyze 后端候选：像素级分析脚本（analyze.py / analyze_image.py）。
analyze_backend() {
  local c
  for c in \
    "$REPO_ROOT/scripts/vision/analyze.py" \
    "$REPO_ROOT/scripts/analyze_image.py"
  do
    [[ -f "$c" ]] && { printf '%s\n' "$c"; return 0; }
  done
  return 1
}

degrade_notice() {
  warn "${1:-未找到可用的视觉后端}"
  cat <<'EOF'

  读图能力暂不可用 —— 这是降级分支，不是错误。按优先级二选一:

    1) 环境变量点名后端（本人显式设置，非仓库可控）:
         CW_VISION_CMD="python3 /path/to/vision.py" ./scripts/cw-vision.sh describe shot.png

    2) 仓内放置视觉脚本（本脚本自动识别这两种位置）:
         scripts/vision.py              多模态描述
         scripts/vision/analyze.py      像素级分析

  仍无后端时的合规处置: 把本条降级说明与探测输出（./scripts/cw-vision.sh doctor）
  贴进票面 verification 段，视为「视觉探针降级」，不得写成「已复核无问题」。

EOF
}

need_python() {
  command -v python3 >/dev/null 2>&1 && return 0
  degrade_notice "缺 python3"
  return 3
}

# ---- 子命令 -----------------------------------------------------------------

cmd_doctor() {
  local d="" a="" miss=0
  log "视觉后端检测（doctor）"
  echo ""
  if command -v python3 >/dev/null 2>&1; then
    printf '  ✅ %s\n' "python3: $(command -v python3)"
  else
    printf '  ⚠️  %s\n' "python3: 未安装（describe/analyze 不可用）"
    miss=$((miss + 1))
  fi
  if command -v ffmpeg >/dev/null 2>&1; then
    printf '  ✅ %s\n' "ffmpeg: $(command -v ffmpeg)（frame 可用）"
  else
    printf '  ⚠️  %s\n' "ffmpeg: 未安装（frame 不可用）"
    miss=$((miss + 1))
  fi
  if [[ -n "${CW_VISION_CMD:-}" ]]; then
    printf '  ✅ %s\n' "CW_VISION_CMD: ${CW_VISION_CMD}"
  else
    printf '  ·  %s\n' "CW_VISION_CMD: 未设置（改用仓内探测）"
  fi
  if d="$(describe_backend)"; then
    printf '  ✅ %s\n' "describe 后端: ${d#$REPO_ROOT/}"
  else
    printf '  ⚠️  %s\n' "describe 后端: 未找到"
    miss=$((miss + 1))
  fi
  if a="$(analyze_backend)"; then
    printf '  ✅ %s\n' "analyze 后端: ${a#$REPO_ROOT/}"
  else
    printf '  ⚠️  %s\n' "analyze 后端: 未找到"
    miss=$((miss + 1))
  fi
  echo ""
  if [[ "$miss" -gt 0 ]]; then
    warn "缺 ${miss} 项 —— describe/analyze/frame 可能退 3；降级处置见下方"
    degrade_notice "部分后端缺失"
  else
    echo "  ✅ 读图链路完整"
  fi
  # doctor 恒退 0：体检入口不能因缺件就阻断 agent 读到降级说明（同 cw-evidence.sh）
  return 0
}

cmd_describe() {
  local -a imgs=()
  local prompt="" be="" rc=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -p|--prompt) prompt="${2:-}"; shift 2 ;;
      -p=*|--prompt=*) prompt="${1#*=}"; shift ;;
      -*) warn "describe 未知参数: $1"; return 1 ;;
      *) imgs+=("$1"); shift ;;
    esac
  done
  if [[ ${#imgs[@]} -eq 0 ]]; then
    warn "describe 需要至少一张图片"
    return 1
  fi
  local f
  for f in "${imgs[@]}"; do
    [[ -f "$f" ]] || { warn "图片不存在: $f"; return 1; }
  done

  if [[ -n "${CW_VISION_CMD:-}" ]]; then
    # CW_VISION_CMD 允许带前置参数（如 "python3 /path/x.py"），故不加引号展开
    log "describe（CW_VISION_CMD）"
    # shellcheck disable=SC2086  # 中文理由：CW_VISION_CMD 本就是「命令 + 参数」串，需按空格分词
    set +e
    if [[ -n "$prompt" ]]; then
      $CW_VISION_CMD "${imgs[@]}" -p "$prompt"
    else
      $CW_VISION_CMD "${imgs[@]}"
    fi
    rc=$?
    set -e
    return "$rc"
  fi

  if ! be="$(describe_backend)"; then
    degrade_notice
    return 3
  fi
  need_python || return 3

  log "describe（${be#$REPO_ROOT/}）"
  set +e
  if [[ -n "$prompt" ]]; then
    python3 "$be" "${imgs[@]}" -p "$prompt"
  else
    python3 "$be" "${imgs[@]}"
  fi
  rc=$?
  set -e
  return "$rc"
}

cmd_analyze() {
  local -a imgs=()
  local be="" rc=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --crop) imgs+=("--crop" "${2:-}"); shift 2 ;;
      --crop=*) imgs+=("$1"); shift ;;
      -*) warn "analyze 未知参数: $1"; return 1 ;;
      *) imgs+=("$1"); shift ;;
    esac
  done
  if [[ ${#imgs[@]} -eq 0 ]]; then
    warn "analyze 需要至少一张图片"
    return 1
  fi
  if ! be="$(analyze_backend)"; then
    degrade_notice "未找到像素分析后端（scripts/vision/analyze.py 或 scripts/analyze_image.py）"
    return 3
  fi
  need_python || return 3

  log "analyze（${be#$REPO_ROOT/}）"
  set +e
  python3 "$be" "${imgs[@]}"
  rc=$?
  set -e
  return "$rc"
}

cmd_frame() {
  local video="${1:-}" sec="${2:-}"
  if [[ -z "$video" || -z "$sec" ]]; then
    warn "frame 用法: ./scripts/cw-vision.sh frame <视频> <秒>"
    return 1
  fi
  [[ -f "$video" ]] || { warn "视频不存在: $video"; return 1; }
  case "$sec" in
    ''|*[!0-9]*) warn "秒须为非负整数（收到: ${sec}）"; return 1 ;;
  esac
  if ! command -v ffmpeg >/dev/null 2>&1; then
    degrade_notice "缺 ffmpeg（frame 无法抽帧）"
    return 3
  fi

  local dir out pad
  dir="$(cd "$(dirname "$video")" && pwd)"
  printf -v pad '%06d' "$sec"
  out="$dir/frame-${pad}.png"
  log "frame: ${video} @ ${sec}s → ${out}"
  # -ss 放在 -i 之前是快速定位（关键帧对齐，秒级完成）；帧内容由解码器后移纠正，
  # 对「看一眼当时渲染了什么」够用。需要帧级精确时用 -ss 在 -i 之后（慢但准）。
  ffmpeg -hide_banner -loglevel error -y -ss "$sec" -i "$video" -frames:v 1 "$out"
  printf '%s\n' "$out"
  return 0
}

usage() {
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

main() {
  if [[ $# -eq 0 ]]; then usage >&2; return 1; fi
  local cmd="$1"; shift
  case "$cmd" in
    doctor)   cmd_doctor ;;
    describe) cmd_describe "$@" ;;
    analyze)  cmd_analyze "$@" ;;
    frame)    cmd_frame "$@" ;;
    --help|-h|help) usage; return 0 ;;
    *) warn "未知子命令: $cmd"; usage >&2; return 1 ;;
  esac
}

main "$@"
