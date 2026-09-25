#!/usr/bin/env bash
# =============================================================================
# cw-evidence.sh —— 证据录制包装器（由工具包安装到消费仓 scripts/cw-evidence.sh）
#
# 用法: ./scripts/cw-evidence.sh <子命令> [参数...]
#
#   doctor             检测证据工具链（python3 / ffmpeg / ffprobe / 屏幕捕获）并总结
#   start [<会话目录>]  开始录制；缺省输出 .artifacts/evidence-<时间戳>（调 evidence.py start）
#   stop [<会话路径>]   收尾录制（evidence.py stop: 烧录注释 → ffprobe 验证 → 写 report.md）
#   headless           无 GUI 时的降级指引: 脚本化截图 + assertions.md 文件协议
#   --skill-path <dir> 显式信任一个 skill 目录（先于九条候选根探测；--skill-path=<dir> 亦可）
#   --help, -h         本帮助（退出码 0）
#
# 设计说明（为什么 + 历史教训）:
#
#   1. 为什么包装，而不是让 agent 手敲 ffmpeg / python3 evidence.py:
#      捕获源选择（x11grab / avfoundation / gdigrab）、raw 以 MPEG-TS 落盘以保证
#      硬杀后仍能出证据、stop 时烧录注释并经 ffprobe 验证 —— 这些机制属于 skill 的
#      单一事实来源。手敲参数必然漂移成「录了但没验证」的半成品，而 QG-5 / DQ-5
#      只认原始证据，不认「已录制 / 已测试」的口头声称；参数正确性不该靠即兴发挥。
#
#   2. 为什么需要定位逻辑: skill 的安装位置随 harness 而异（~/.claude、~/.agents、
#      ~/.config/opencode、项目级 .opencode / .claude）。agent 不该每次试探九条
#      路径 —— 本脚本是唯一定位入口。九条根是共享清单（见 find_evidence 上方的
#      F2 注释），与 cw-greploop.sh 必须逐字一致。用户级三根恒探测；项目级六根
#      默认不探测（理由见 4），只在 CW_EVIDENCE_ALLOW_REPO=1 或 --skill-path 时进入。
#
#   3. 为什么缺 skill / 缺工具必须降级而不是硬失败: cw 对所有外部依赖保持
#      「可缺失、有降级路径」的姿态（openspec 如此，外置 skill 亦如此）。若这里
#      退 1，agent 会在「无法录制」时放弃证据纪律；正确行为是转入 headless 文件
#      协议（脚本化截图 + assertions.md），断言纪律（test_start / assertion / 结果）
#      原样保留。退出码契约（调用方脚本依赖，勿改）:
#        doctor 恒退 0（体检入口，缺什么都不阻断）；headless / --help 退 0；
#        空或未知子命令退 1；start / stop 真实 exec 透传 evidence.py 退出码；
#        start / stop 降级（只打指引、什么都没录）退 3。
#      降级必须与成功可区分 —— 否则 `if cw-evidence.sh start` 会把「没录」判成
#      「录了」，与 QG-5 只认原始证据直接冲突（A2 修正的真实缺陷: 降级曾退 0）。
#      evidence.py 自身的失败仍经 exec 透传，不在此列。
#
#   4. 为什么项目级根默认不探测（RCE 信任边界）: evidence.py 会被 `exec python3`
#      执行 —— 谁能往仓库 .opencode/skills/ 提交一个文件，谁就能让任何跑
#      doctor / start / stop 的 agent 执行任意代码（含 CI 里的 pull_request 任务）。
#      用户级三根不是仓库可控，故恒探测；项目级六根必须显式授权:
#        CW_EVIDENCE_ALLOW_REPO=1 ./scripts/cw-evidence.sh doctor
#      （环境变量；不读仓库内 conf —— conf 本身仓库可控，source 它等于自废边界）
#      或 --skill-path <dir>（逐次显式信任）。候选命中还要过 pwd -P 归一 +
#      非符号链接校验，防 symlink 从根内逃到根外（见 probe_skill_dir）。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_NAME="evidence-driven-testing"
SKILL_OPT_PATH=""   # --skill-path 显式点名的 skill 目录（main 解析；信任模型见头注 4）

log()  { echo "==> $*"; }
warn() { echo "⚠️  $*" >&2; }

# ---- skill 定位 -------------------------------------------------------------

# 【共享候选根清单 —— F2】以下 9 条根是本脚本与 scripts/cw-greploop.sh 的
# 共同规范，两处必须逐字一致；改任何一侧都要同步另一侧（历史教训: 两侧清单
# 已漂移过一次，doctor 找得到而 greploop 找不到的文件会静默漏扫）。
# 根 1-3（用户级，恒探测，非仓库可控）:
#   1. ${HOME:-}/.claude/skills
#   2. ${HOME:-}/.agents/skills
#   3. ${HOME:-}/.config/opencode/skills
# 根 4-9（仓库级，仅当 CW_EVIDENCE_ALLOW_REPO=1 才探测 —— 信任模型见头注 4；
#          SKILLS_DIR 只取环境变量，绝不 source 仓库内 conf）:
#   4. ${SKILLS_DIR:-.opencode/skills}
#   5. $PWD/.opencode/skills
#   6. $PWD/.claude/skills
#   7. $PWD/.agents/skills
#   8. $SCRIPT_DIR/../.opencode/skills
#   9. $SCRIPT_DIR/../.claude/skills
#
# 单候选校验: $1 = 技能根（前缀基准），$2 = skill 目录。
# 命中 → stdout 打印 evidence.py 路径并退 0；否则退 1。
# 为什么 pwd -P + ! -L 成对（A1 子防线，缺一不可）:
#   - pwd -P 归一目录链: skill 目录本身是指向根外的符号链接时，归一后必须
#     仍落在归一后的根前缀内，否则视为越界;
#   - ! -L 拦 evidence.py 自身是指向 ~/.bashrc 等任意文件的符号链接 ——
#     只查 -f 挡不住（-f 会跟随链接取到真文件）;
#   - scripts 中间层再归一一次: 它是符号链接时字符串前缀检查挡不住。
# 不用 nameref / 关联数组（bash 3.2 硬约束）；return 1 由调用方 if 捕获。
probe_skill_dir() {
  local root="$1" dir="$2"
  local real_root="" real_dir="" real_parent="" file=""
  real_root="$(cd "$root" 2>/dev/null && pwd -P)" || return 1
  real_dir="$(cd "$dir" 2>/dev/null && pwd -P)" || return 1
  case "$real_dir" in
    "$real_root"|"$real_root"/*) ;;
    *) return 1 ;;
  esac
  file="$real_dir/scripts/evidence.py"
  real_parent="$(cd "$(dirname "$file")" 2>/dev/null && pwd -P)" || return 1
  file="$real_parent/$(basename "$file")"
  case "$file" in
    "$real_root"/*) ;;
    *) return 1 ;;
  esac
  [[ -f "$file" && ! -L "$file" ]] || return 1
  printf '%s\n' "$file"
  return 0
}

# 定位 scripts/evidence.py: 找到 → stdout 打印路径并退 0；否则退 1。
# --skill-path 显式点名最优先（用户显式给的路径 = 显式授权）；随后根 1-3；
# 仓库级六根仅在 CW_EVIDENCE_ALLOW_REPO=1 时探测（A1，精确匹配见 find_evidence）。候选顺序与
# cw-greploop.sh 共享同一清单（见上方 F2 注释）。
# stdout 只出最终路径（调用方以 $( ) 捕获），过程提示不出现在这里。
find_evidence() {
  local root="" dir=""

  if [[ -n "${SKILL_OPT_PATH:-}" ]]; then
    if dir="$(probe_skill_dir "$SKILL_OPT_PATH" "$SKILL_OPT_PATH")"; then
      printf '%s\n' "$dir"
      return 0
    fi
  fi

  for root in \
    "${HOME:-}/.claude/skills" \
    "${HOME:-}/.agents/skills" \
    "${HOME:-}/.config/opencode/skills"
  do
    if dir="$(probe_skill_dir "$root" "$root/$SKILL_NAME")"; then
      printf '%s\n' "$dir"
      return 0
    fi
  done

  # 仓库级六根默认拒绝（A1）: 仓库可控路径 = PR 可植入 evidence.py = RCE 面。
  # 精确匹配 =1（A6/R2）: 旧「非空即开」让 CW_EVIDENCE_ALLOW_REPO=0 反而**启用**探测
  # （红证: =0 时仓内植入的 evidence.py 被 exec，marker 落地）—— 与「显式授权」语义相反。
  [[ "${CW_EVIDENCE_ALLOW_REPO:-}" == "1" ]] || return 1
  for root in \
    "${SKILLS_DIR:-.opencode/skills}" \
    "$PWD/.opencode/skills" \
    "$PWD/.claude/skills" \
    "$PWD/.agents/skills" \
    "$SCRIPT_DIR/../.opencode/skills" \
    "$SCRIPT_DIR/../.claude/skills"
  do
    if dir="$(probe_skill_dir "$root" "$root/$SKILL_NAME")"; then
      printf '%s\n' "$dir"
      return 0
    fi
  done
  return 1
}

# 降级提示（skill 缺失 / python3 不可用时统一入口）；纯打印，自身退 0 ——
# 降级语义由调用方 cmd_start / cmd_stop 的 return 3 承担（退出码契约见头注 3）。
# 只打印指引，不执行网络动作 —— 装不装由用户决定。
degrade_notice() {
  warn "${1:-未找到 evidence-driven-testing skill（候选路径均无 scripts/evidence.py）}"
  cat <<'EOF'

  录制路径暂不可用 —— 这是降级分支，不是错误。按优先级二选一:

    1) 安装 skill 后重试:
         npx skills add michaelshimeles/skills
       装完无需配置，本脚本自动探测用户级三根（~/.claude、~/.agents、
       ~/.config/opencode）；仓库内六根默认不探测（防 PR 植入可执行文件），
       需要时设 CW_EVIDENCE_ALLOW_REPO=1 或传 --skill-path <dir>。

    2) 无法安装或没有 GUI 时，走 headless 文件协议:
         ./scripts/cw-evidence.sh headless

EOF
}

# ---- 工具链检测 -------------------------------------------------------------

# ffmpeg 能力探测: 参数 = 列表开关（-encoders / -filters）、关键子串。
# 用 case 匹配整段输出而非 `| grep -q`: pipefail 下 grep -q 命中即关管道，
# 上游 ffmpeg 收 SIGPIPE(141) 会把「命中」误判为失败（本仓已踩过的坑）。
ffmpeg_has() {
  local listing="$1" needle="$2" out=""
  out="$(ffmpeg -hide_banner "$listing" 2>/dev/null || true)"
  case "$out" in
    *"$needle"*) return 0 ;;
    *) return 1 ;;
  esac
}

# 单命令检测: 命中打印 ✅ + 路径并退 0；缺失打印 ⚠️ 并退 1（doctor 据此计数）
dr_check() {
  local label="$1" bin="$2" path=""
  if path="$(command -v "$bin" 2>/dev/null)"; then
    printf '  ✅ %s\n' "${label}: ${path}"
    return 0
  fi
  printf '  ⚠️  %s\n' "${label}: 未安装"
  return 1
}

# doctor 是诊断命令: 无论缺什么，一律退 0（缺项以 ⚠️ 呈现并给降级指引）。
# 这与 evidence.py doctor「工具链缺失退非零」不同 —— 那是录制前的硬门；
# 这里是 agent 的体检入口，不能因缺 ffmpeg 就阻断它读到降级说明。
cmd_doctor() {
  local miss=0 cap_fail=0 screen_fail=0 skill_ok=0 evidence="" deep_out="" os=""
  log "证据工具链检测（doctor）"
  echo ""
  dr_check "python3" python3 || miss=$((miss + 1))
  dr_check "ffmpeg" ffmpeg || miss=$((miss + 1))
  dr_check "ffprobe" ffprobe || miss=$((miss + 1))

  if command -v ffmpeg >/dev/null 2>&1; then
    if ffmpeg_has -encoders libx264; then
      printf '  ✅ %s\n' "ffmpeg 能力: libx264 编码器"
    else
      printf '  ⚠️  %s\n' "ffmpeg 能力: 缺 libx264（stop 阶段渲染 evidence.mp4 会失败）"
      cap_fail=1
    fi
    if ffmpeg_has -filters " ass "; then
      printf '  ✅ %s\n' "ffmpeg 能力: ass 滤镜（注释烧录）"
    else
      printf '  ⚠️  %s\n' "ffmpeg 能力: 缺 ass 滤镜（注释无法烧录进视频）"
      cap_fail=1
    fi
  fi

  os="$(uname -s 2>/dev/null || echo unknown)"
  case "$os" in
    Darwin)
      printf '  ✅ %s\n' "屏幕捕获: macOS avfoundation（首次使用需授予终端「屏幕录制」权限）" ;;
    Linux)
      if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
        printf '  ✅ %s\n' "屏幕捕获: Wayland（需 wf-recorder；GNOME/KDE Wayland 不可录，见 headless）"
      elif [[ -n "${DISPLAY:-}" ]]; then
        printf '  ✅ %s\n' "屏幕捕获: X11 x11grab（DISPLAY=${DISPLAY}）"
      else
        printf '  ⚠️  %s\n' "屏幕捕获: 无 DISPLAY / WAYLAND_DISPLAY —— 无 GUI，走 headless"
        screen_fail=1
      fi ;;
    MINGW*|MSYS*|CYGWIN*)
      printf '  ✅ %s\n' "屏幕捕获: Windows gdigrab" ;;
    *)
      printf '  ⚠️  %s\n' "屏幕捕获: 未知平台 ${os} —— 走 headless"
      screen_fail=1 ;;
  esac

  if evidence="$(find_evidence)"; then
    skill_ok=1
    printf '  ✅ %s\n' "skill: ${evidence}"
  else
    printf '  ⚠️  %s\n' "skill: 未安装（候选路径均无 scripts/evidence.py）"
  fi
  # A1 可见性: 仓库级六根被跳过时必须明说，否则用户不知道还有六条路径没探测。
  # 判据与 find_evidence 同一精确匹配（A6/R2）: 非 =1（含 =0、空、未设）一律视为跳过。
  if [[ "${CW_EVIDENCE_ALLOW_REPO:-}" != "1" ]]; then
    printf '  ⚠️  %s\n' "仓库级候选根已跳过（6 条）: 设 CW_EVIDENCE_ALLOW_REPO=1 或 --skill-path <dir> 可信探测"
  fi

  # skill 在时以它自带的 doctor 为深度判据: capture_ready 只有它能实测
  if [[ "$skill_ok" == "1" ]] && command -v python3 >/dev/null 2>&1; then
    echo ""
    log "skill 自带 doctor（capture_ready 以它为准）"
    deep_out="$(python3 "$evidence" doctor 2>&1 || true)"
    printf '%s\n' "$deep_out" | sed 's/^/    /'
    case "$deep_out" in
      *"capture_ready: yes"*)
        printf '  ✅ %s\n' "capture_ready: yes —— 自动捕获源可用" ;;
      *)
        printf '  ⚠️  %s\n' "capture_ready 非 yes —— 按上方 skill 输出处理，或走 headless"
        screen_fail=1 ;;
    esac
  fi

  echo ""
  log "总结"
  # A3: screen_fail 与 cap_fail 同为布尔 but 不同维度（前者 = 捕获源/平台不可用，
  # 后者 = skill deep doctor 的 capture_ready 失败）；任一为 1 都不得进 ✅ 分支
  if [[ "$miss" -eq 0 && "$cap_fail" -eq 0 && "$screen_fail" -eq 0 && "$skill_ok" -eq 1 ]]; then
    echo "✅ 录制证据路径就绪: ./scripts/cw-evidence.sh start .artifacts/<task-name>"
  elif [[ "$skill_ok" -eq 1 ]]; then
    if [[ "$screen_fail" -eq 1 ]]; then
      echo "⚠️  skill 已装但屏幕捕获不可用（见上方 ⚠️ 项）: 走 headless 文件协议（./scripts/cw-evidence.sh headless）"
    else
      echo "⚠️  skill 已装但工具链不完整（见上方 ⚠️ 项）: 先补齐，或改走 headless"
    fi
  else
    echo "⚠️  录制路径不可用: skill 未安装，降级指引如下 ——"
    echo ""
    degrade_notice
  fi
  return 0
}

# ---- 录制路径 ---------------------------------------------------------------

# start: 首个位置参数（不以 - 开头）= 会话目录，映射到 evidence.py 的 --output。
# 未给目录且未显式传 --output 时用 .artifacts/evidence-<时间戳> 兜底 ——
# evidence.py start 的 --output 是必填项，兜底让 `cw-evidence.sh start` 开箱可用。
cmd_start() {
  local evidence="" out_dir="" have_output=0 arg=""
  # A2 契约: 降级 = 什么都没录 → 退 3，必须与成功可区分
  if ! command -v python3 >/dev/null 2>&1; then
    degrade_notice "python3 不可用 —— 无法驱动 evidence.py"
    return 3
  fi
  if ! evidence="$(find_evidence)"; then
    degrade_notice
    return 3
  fi
  if [[ $# -gt 0 && "$1" != -* ]]; then
    out_dir="$1"
    shift
  fi
  for arg in "$@"; do
    case "$arg" in
      --output|--output=*) have_output=1 ;;
    esac
  done
  if [[ -z "$out_dir" && "$have_output" -eq 0 ]]; then
    out_dir=".artifacts/evidence-$(date +%Y%m%d-%H%M%S)"
    warn "未给出会话目录，使用默认: ${out_dir}"
  fi
  log "使用 skill: ${evidence}"
  if [[ -n "$out_dir" && "$have_output" -eq 0 ]]; then
    exec python3 "$evidence" start --output "$out_dir" "$@"
  fi
  exec python3 "$evidence" start "$@"
}

cmd_stop() {
  local evidence=""
  # A2 契约: 降级退 3，理由同 cmd_start
  if ! command -v python3 >/dev/null 2>&1; then
    degrade_notice "python3 不可用 —— 无法驱动 evidence.py"
    return 3
  fi
  if ! evidence="$(find_evidence)"; then
    degrade_notice
    return 3
  fi
  log "使用 skill: ${evidence}"
  exec python3 "$evidence" stop "$@"
}

# ---- headless 降级协议 ------------------------------------------------------

# 无 GUI / 装不了 skill 时的等价路径: 换采集器，不换断言纪律。
# 只打印协议（不落文件、不联网）—— 具体采集由 agent 按其 harness 执行。
cmd_headless() {
  cat <<'EOF'
==> headless 降级协议（无 GUI / 无法录屏时）

录制路径不可用时，断言纪律原样保留，只替换采集器:

  1. 产物目录: .artifacts/<task-name>/ —— 必须 gitignore（证据只上传，不入库），
     采集脚本与产物放一起，保证这次运行可复现。

  2. 脚本化截图 / 录像（可并用）:
       npx --yes --package=playwright node record.mjs
       （一次性脚本，不写进项目依赖；容器里 Chrome 报 "No usable sandbox"
         时加 AGENT_BROWSER_ARGS="--no-sandbox"）
     纯截图则按测试顺序编号命名，断言写进文件名:
       01-precondition-signed-in.png
       02-it-saves-on-blur-passed.png

  3. assertions.md（与录制路径的注释协议同等效力）: 逐条列出
       test_start / assertion 与结果 passed | failed | untested（附原因）。
     无法执行的用例标 untested 并写原因，不许静默跳过。

  4. 非 UI 变更同样要证据: 数字对比（如 probe-output.txt 的请求数 / 延迟）、
     渲染帧 + 像素断言、agent 行为的 transcript 片段。

  5. 交付: 编号截图 + assertions.md 贴到 PR / issue；视频（若有）先确认能播放，
     再声称「已发布」—— 未复看过的媒体不算证据。

  底线（与录制路径共享）:
    - 先看屏幕 / 输出，再选 passed —— 时间戳记录的是「何时断言」，不是「是否成立」。
    - 一律注明被测 commit / 分支 / 部署 URL。
    - 证据补充仓库检查（typecheck / build / tests），绝不替代它们。
EOF
  return 0
}

# ---- 入口 -------------------------------------------------------------------

# 取头部注释的「用法」段（到 --help 行为止），剥掉注释前缀
cmd_help() {
  sed -n '3,/^#   --help, -h/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# --skill-path 是任意位置的全局标志，分派前先剥离；
# start / stop 显式 `|| exit $?` 接线: 降级 return 3 不依赖 set -e 的边角语义。
main() {
  local cmd="" a=""
  local -a argv=()
  while [[ $# -gt 0 ]]; do
    a="$1"
    case "$a" in
      --skill-path)
        shift
        if [[ $# -eq 0 || -z "$1" ]]; then
          echo "❌ --skill-path 需要非空目录参数" >&2
          exit 1
        fi
        SKILL_OPT_PATH="$1"
        shift
        ;;
      --skill-path=*)
        SKILL_OPT_PATH="${a#--skill-path=}"
        if [[ -z "$SKILL_OPT_PATH" ]]; then
          echo "❌ --skill-path 需要非空目录参数" >&2
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
  cmd="${1:-}"
  case "$cmd" in
    doctor)   shift; cmd_doctor "$@" ;;
    start)    shift; cmd_start "$@" || exit $? ;;
    stop)     shift; cmd_stop "$@" || exit $? ;;
    headless) shift; cmd_headless "$@" ;;
    --help|-h|help) cmd_help ;;
    "")
      echo "❌ 未指定子命令（可用: doctor / start / stop / headless）" >&2
      cmd_help >&2
      exit 1 ;;
    *)
      echo "❌ 未知子命令: ${cmd}" >&2
      echo "运行 ./scripts/cw-evidence.sh --help 查看用法" >&2
      exit 1 ;;
  esac
}

main "$@"
