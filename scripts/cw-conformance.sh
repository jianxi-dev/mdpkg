#!/usr/bin/env bash
# =============================================================================
# cw-conformance.sh —— 一致性制品生成器（由工具包安装到消费仓 scripts/）
#
# 用法: ./scripts/cw-conformance.sh <子命令> <change目录> [--dir <路径>]
#
#   scaffold <change>    生成 anchors.md 骨架（含 1 注释示例行）；已存在→拒退 1
#   generate <change>    解析 anchors.md→四规则校验→原子写 conformance.json
#   lock <change>        对 conformance.json+baseline/*.png 逐文件 sha256 → 写 conformance.lock
#                        perceptual 锚点但 baseline/ 无 png→退 1
#   verify <change>      ①重投影 anchors.md 与 conformance.json 语义比对→漂移退 1
#                        ②lock 缺失→退 3；③重算哈希，篡改/缺失/多出→退 1 逐文件列出
#   --help, -h           本帮助（退出码 0）
#
# 可选全局标志: --dir <path> 覆盖 change 目录（e2e/非标布局用）
#
# 设计说明（为什么 + 历史教训）:
#
#   1. 为什么需要独立生成器，而不是让实现者手填 conformance.json:
#      v1.9.0 门禁「有定义、无机检、靠自证」→ md-bundle 实测约 20 处偏差。
#      根因: 实现者会把实现反填 baseline、把测试照实现写（投毒源）。
#      唯一能破此循环的机制: G0 从原型结构化表**程序化解析**出制品，实现阶段只消费、禁篡改。
#      本脚本是「规格双形态」机读层的 G0 生产者（设计见 cw-mechanized-quality-gates/design.md D1/D2）。
#
#   2. 为什么 anchors.md 是唯一解析面（人写一次、任意 markdown 查看器可读）:
#      JSON 永远是投影；人读层不可丢（quality-gates.md QG-1 前置定义）。
#      确定性文法: ^## (R-\d+) (.+)$ 开启 requirement；裸 markdown 表列名恰为 id|kind|claim|assert|source。
#      无 fenced block、不嵌 spec.md —— 对无 openspec 消费仓同样成立。
#
#   3. 为什么四规则（完备性/无孤儿/可断言性/来源非空）与 cw-tickets-check.sh:check_conformance 刻意重复:
#      checker 在消费仓运行（G0-POST 门禁），generator 在工具包源/消费仓 G0 运行。
#      两者**必须**同词汇报错、同序解析，否则「生成通过、检查失败」的静默漂移不可接受。
#      脚本头注与 checker 互指，标「语法/规则改动须 checker+generator+e2e 三处同步」。
#      仓库既有 `conf_get` 式「刻意重复」惯例（lib/render.sh 与三份消费侧副本）。
#
#   4. 为什么退出码分 0/1/3（对齐 cw-evidence.sh）:
#      0 = 成功；1 = 内容错（解析失败/四规则违规/篡改/缺文件/目录不存在/符号链接）；
#      3 = 环境缺（python3 缺失/未锁定/无制品）——「降级，调用方决定是否升级用户」。
#      内容错必须拦截（fail-closed），环境缺必须可区分（不静默当通过）。
#
#   5. 为什么 sha256 双实现（shasum -a 256 回退 sha256sum）:
#      与 lib/render.sh:cw_sha 同构，macOS/Linux 双平台兼容。
#
#   6. 为什么写盘用 mktemp+mv 原子替换、拒绝符号链接:
#      对齐 lib/render.sh:cw_refuse_symlink / cw_atomic_cp 的 C2 安全边界。
#      目标是符号链接→退 1（防穿透写穿）。
#
#   7. 为什么 lock 不含 anchors.md:
#      改 anchors.md 会被 verify 的投影比对（语义比对，非字节）抓住；lock 只锁「制品层」。
#
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

log()  { echo "==> $*"; }
warn() { echo "⚠️  $*" >&2; }
err()  { echo "❌ $*" >&2; }

# ---- 用法 -------------------------------------------------------------------
usage() {
  sed -n '3,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# ---- sha256（与 lib/render.sh:cw_sha 同构）-----------------------------------
cw_sha() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

# ---- 拒绝符号链接（与 lib/render.sh:cw_refuse_symlink 同语义）---------------
cw_refuse_symlink() {
  local path="$1" desc="$2" d
  if [[ -L "$path" ]]; then
    err "拒绝写入符号链接：${desc}（${path}）"
    err "   受管文件必须是普通文件；请先删除该符号链接或改回真实文件。"
    return 1
  fi
  case "$path" in
    /*) return 0 ;;
  esac
  d="$(dirname "$path")"
  while [[ "$d" != "." && "$d" != "/" && -n "$d" ]]; do
    if [[ -L "$d" ]]; then
      err "拒绝写入符号链接：${desc} 的父目录组件（${d}）"
      err "   受管文件必须是普通文件；请先删除该符号链接或改回真实目录。"
      return 1
    fi
    d="$(dirname "$d")"
  done
  return 0
}

# ---- 原子写入（mktemp + mv）---------------------------------------------------
atomic_write() {
  local dst="$1" content="$2" tmp
  cw_refuse_symlink "$dst" "原子写入目标" || return 1
  mkdir -p "$(dirname "$dst")"
  tmp="$(mktemp "$(dirname "$dst")/.cw-conformance-tmp.XXXXXX")"
  printf '%s' "$content" > "$tmp" || { rm -f "$tmp"; return 1; }
  # 保持目标模式（参考 lib/render.sh:cw_tmp_mode_for）
  local mode=""
  if [[ -e "$dst" ]]; then
    case "$(uname -s)" in
      Darwin) mode="$(stat -f %Lp "$dst" 2>/dev/null)" || mode="" ;;
      *)      mode="$(stat -c %a "$dst" 2>/dev/null)" || mode="" ;;
    esac
  fi
  chmod "${mode:-0644}" "$tmp" || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$dst" || { rm -f "$tmp"; return 1; }
}

# ---- 解析 change 目录（openspec 优先，回退 docs/requirements）-----------------
resolve_change_dir() {
  local change="$1" dir_override="${2:-}" cand
  if [[ -n "$dir_override" ]]; then
    [[ -d "$dir_override" ]] || { err "目录不存在: ${dir_override}"; return 1; }
    printf '%s\n' "$dir_override"
    return 0
  fi
  # 如果 change 本身是已存在的目录（绝对路径或相对路径），直接使用
  if [[ -d "$change" ]]; then
    printf '%s\n' "$change"
    return 0
  fi
  for cand in "openspec/changes/${change}" "docs/requirements/${change}"; do
    if [[ -d "${REPO_ROOT}/${cand}" ]]; then
      printf '%s\n' "${REPO_ROOT}/${cand}"
      return 0
    fi
  done
  err "change 目录不存在: openspec/changes/${change} 或 docs/requirements/${change}"
  return 1
}

# ---- 解析 anchors.md（内嵌 python3，返回 JSON 到 stdout）----------------------
# 返回: 成功→stdout 输出 JSON；失败→stderr 报错、退出码非 0
parse_anchors() {
  local anchors_file="$1" py_file=""
  if [[ ! -f "$anchors_file" ]]; then
    err "anchors.md 不存在: ${anchors_file}"
    return 1
  fi
  py_file="$(mktemp)"
  cat > "$py_file" <<'PY'
import json, re, sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as f:
        content = f.read()
except Exception as e:
    print(f"[parse] 读取失败: {e}", file=sys.stderr)
    sys.exit(1)

# 解析 requirement: ^## (R-\d+) (.+)$
# 其后至表头之间非空行 = text（合并为单段，折叠空白）
# 表列名与顺序恰为 id|kind|claim|assert|source
req_pattern = re.compile(r'^##\s+(R-(\d+))\s+(.+)$', re.MULTILINE)
table_pattern = re.compile(
    r'^\|(?:\s*id\s*\|\s*kind\s*\|\s*claim\s*\|\s*assert\s*\|\s*source\s*\|)\s*\n'
    r'\|(?:\s*[-:]+\s*\|\s*[-:]+\s*\|\s*[-:]+\s*\|\s*[-:]+\s*\|\s*[-:]+\s*\|)\s*\n'
    r'((?:\|.*\n)*)',
    re.MULTILINE
)

requirements = []
for m in req_pattern.finditer(content):
    rid, rnum, rtext = m.group(1), m.group(2), m.group(3).strip()
    # 找该 requirement 后的表格
    after = content[m.end():]
    tmatch = table_pattern.search(after)
    if not tmatch:
        print(f"[parse] requirement {rid} 缺少表格或表格格式非法（列名/顺序须为 id|kind|claim|assert|source）", file=sys.stderr)
        sys.exit(1)
    table_body = tmatch.group(1)
    anchors = []
    for line in table_body.strip().split('\n'):
        line = line.strip()
        if not line or not line.startswith('|'):
            continue
        parts = [p.strip() for p in line.split('|')[1:-1]]  # 去首尾空列
        if len(parts) != 5:
            print(f"[parse] requirement {rid} 表格行列数非 5: {line}", file=sys.stderr)
            sys.exit(1)
        aid, kind, claim, assert_val, source = parts
        # anchor id 校验: A-<n>.<m> 且 <n> == R-<n>
        m_aid = re.match(r'^A-(\d+)\.\d+$', aid)
        if not m_aid:
            print(f"[parse] anchor id 非法（须为 A-<n>.<m> 且 <n> 对应 requirement）: {aid}", file=sys.stderr)
            sys.exit(1)
        if m_aid.group(1) != rnum:
            print(f"[parse] anchor {aid} 的 <n>={m_aid.group(1)} 与 requirement {rid} 的 <n>={rnum} 不符", file=sys.stderr)
            sys.exit(1)
        if kind not in ('exact', 'state-machine', 'perceptual'):
            print(f"[parse] anchor {aid} kind 非法（须为 exact|state-machine|perceptual）: {kind}", file=sys.stderr)
            sys.exit(1)
        if not claim:
            print(f"[parse] anchor {aid} claim 为空", file=sys.stderr)
            sys.exit(1)
        if not assert_val:
            print(f"[parse] anchor {aid} assert 为空", file=sys.stderr)
            sys.exit(1)
        if not source or not source.strip():
            print(f"[parse] anchor {aid} source 为空", file=sys.stderr)
            sys.exit(1)
        anchors.append({
            "id": aid,
            "claim": claim,
            "kind": kind,
            "assert": assert_val,
            "source": source
        })
    if not anchors:
        print(f"[parse] requirement {rid} 无 anchor（每 requirement ≥1 anchor）", file=sys.stderr)
        sys.exit(1)
    requirements.append({
        "id": rid,
        "text": rtext,
        "anchors": anchors
    })

if not requirements:
    print("[parse] 未找到任何 requirement（需以 ## R-<n> 标题开启）", file=sys.stderr)
    sys.exit(1)

# 输出固定键序（IC-1）
output = {"change": "", "requirements": requirements}
json.dump(output, sys.stdout, ensure_ascii=False, indent=2)
sys.stdout.write("\n")
PY
  python3 "$py_file" "$anchors_file"
  local rc=$?
  rm -f "$py_file"
  return $rc
}

# ---- 子命令: scaffold ---------------------------------------------------------
cmd_scaffold() {
  local change_dir="$1"
  local anchors_file="$change_dir/anchors.md"
  if [[ -f "$anchors_file" ]]; then
    err "anchors.md 已存在: ${anchors_file}"
    return 1
  fi
  mkdir -p "$change_dir"
  cat > "$anchors_file" <<'EOF'
# 验收锚点 — <change>

## R-1 示例需求

示例验收叙述（替换为真实需求）。

# 示例：此行为注释示例行，供 generate 解析参考

| id | kind | claim | assert | source |
|---|---|---|---|---|
| A-1.1 | exact | 示例断言 | 具体期望值 | prototype#00-example |
EOF
  log "已生成 anchors.md 骨架: ${anchors_file}"
  return 0
}

# ---- 子命令: generate ---------------------------------------------------------
cmd_generate() {
  local change_dir="$1"
  local anchors_file="$change_dir/anchors.md"
  local json_out=""
  local conf_file="$change_dir/conformance.json"
  if ! command -v python3 >/dev/null 2>&1; then
    warn "降级：python3 不可用"
    return 3
  fi
  json_out="$(parse_anchors "$anchors_file")" || return 1
  # 注入 change 名
  local change_name
  change_name="$(basename "$change_dir")"
  json_out="$(printf '%s' "$json_out" | python3 -c "
import json, sys
data = json.load(sys.stdin)
data['change'] = sys.argv[1]
json.dump(data, sys.stdout, ensure_ascii=False, indent=2)
sys.stdout.write('\n')
" "$change_name")" || return 1
  atomic_write "$conf_file" "$json_out" || return 1
  log "已生成 conformance.json: ${conf_file}"
  return 0
}

# ---- 子命令: lock -------------------------------------------------------------
cmd_lock() {
  local change_dir="$1"
  local conf_file="$change_dir/conformance.json"
  local lock_file="$change_dir/conformance.lock"
  local baseline_dir="$change_dir/baseline"
  if ! command -v python3 >/dev/null 2>&1; then
    warn "降级：python3 不可用"
    return 3
  fi
  if [[ ! -f "$conf_file" ]]; then
    err "conformance.json 不存在: ${conf_file}"
    return 1
  fi
  # 检查 perceptual 锚点对应的 baseline png 是否存在
  local missing_png=0
  python3 - "$conf_file" <<'PY' || missing_png=$?
import json, sys, os
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
change_dir = os.path.dirname(sys.argv[1])
for r in data.get("requirements", []):
    for a in r.get("anchors", []):
        if a.get("kind") == "perceptual":
            # 从 source 或 assert 推断 baseline 文件名（约定：baseline/<source片段>.png）
            # 这里简化：要求 baseline/ 目录下至少有一个 .png
            pass
# 实际检查：baseline/ 目录是否存在且含 .png
baseline_dir = os.path.join(change_dir, "baseline")
has_png = False
if os.path.isdir(baseline_dir):
    for fn in os.listdir(baseline_dir):
        if fn.lower().endswith(".png"):
            has_png = True
            break
if not has_png:
    # 有 perceptual 锚点但无 png
    for r in data.get("requirements", []):
        for a in r.get("anchors", []):
            if a.get("kind") == "perceptual":
                print(f"[lock] perceptual 锚点 {a.get('id')} 存在但 baseline/ 目录无 .png 文件", file=sys.stderr)
                sys.exit(1)
PY
  if [[ $missing_png -ne 0 ]]; then
    return 1
  fi
  # 生成 lock 文件：conformance.json + baseline/*.png（排序稳定）
  local lock_content="# change-workflow 制品哈希锁 v1（cw-conformance.sh lock 生成；禁止手改）"
  local files=("$conf_file")
  if [[ -d "$baseline_dir" ]]; then
    local png
    for png in "$baseline_dir"/*.png; do
      [[ -f "$png" ]] && files+=("$png")
    done
  fi
  local f rel hash
  for f in "${files[@]}"; do
    rel="${f#$change_dir/}"
    hash="$(cw_sha "$f")"
    lock_content="${lock_content}
${hash}  ${rel}"
  done
  atomic_write "$lock_file" "$lock_content" || return 1
  log "已生成 conformance.lock: ${lock_file}"
  return 0
}

# ---- 子命令: verify -----------------------------------------------------------
cmd_verify() {
  local change_dir="$1"
  local conf_file="$change_dir/conformance.json"
  local lock_file="$change_dir/conformance.lock"
  local anchors_file="$change_dir/anchors.md"
  local baseline_dir="$change_dir/baseline"
  if ! command -v python3 >/dev/null 2>&1; then
    warn "降级：python3 不可用"
    return 3
  fi
  if [[ ! -f "$conf_file" ]]; then
    err "conformance.json 不存在: ${conf_file}"
    return 1
  fi
  if [[ ! -f "$lock_file" ]]; then
    err "conformance.lock 缺失（未锁定）"
    return 3
  fi
  if [[ ! -f "$anchors_file" ]]; then
    err "anchors.md 不存在: ${anchors_file}"
    return 1
  fi
  # ① 重投影 anchors.md 与 conformance.json 语义比对（JSON 相等，非字节）
  local projected_json=""
  local current_json=""
  projected_json="$(parse_anchors "$anchors_file")" || return 1
  local change_name
  change_name="$(basename "$change_dir")"
  projected_json="$(printf '%s' "$projected_json" | python3 -c "
import json, sys
data = json.load(sys.stdin)
data['change'] = sys.argv[1]
json.dump(data, sys.stdout, ensure_ascii=False, indent=2)
sys.stdout.write('\n')
" "$change_name")" || return 1
  current_json="$(cat "$conf_file")"
  if [[ "$projected_json" != "$current_json" ]]; then
    err "漂移：anchors.md 重投影与 conformance.json 不一致"
    # 可选：diff 输出
    diff -u <(printf '%s\n' "$current_json") <(printf '%s\n' "$projected_json") >&2 || true
    return 1
  fi
  # ② 重算哈希，逐文件比对
  local lock_content=""
  local expected_hash=""
  local expected_rel=""
  local actual_hash=""
  local violations=0
  lock_content="$(cat "$lock_file")"
  # 跳过首行注释，用数组收集避免 subshell 问题
  local lock_lines=()
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    lock_lines+=("$line")
  done < <(printf '%s\n' "$lock_content" | tail -n +2)
  for line in "${lock_lines[@]}"; do
    # sha256sum 格式: <hash>  <path>（两空格）
    expected_hash="${line%%  *}"
    expected_rel="${line#*  }"
    local abs_path="$change_dir/$expected_rel"
    if [[ ! -f "$abs_path" ]]; then
      err "lock 记录文件缺失: ${expected_rel}"
      violations=$((violations + 1))
      continue
    fi
    actual_hash="$(cw_sha "$abs_path")"
    if [[ "$actual_hash" != "$expected_hash" ]]; then
      err "lock 记录文件被篡改: ${expected_rel}（期望 ${expected_hash}，实际 ${actual_hash}）"
      violations=$((violations + 1))
    fi
  done
  # 检查多出的文件（当前目录下 conformance.json + baseline/*.png 不在 lock 中）
  local locked_files=()
  for line in "${lock_lines[@]}"; do
    locked_files+=("${line#*  }")
  done
  # 这里简化：只检查 conformance.json 和 baseline/*.png 是否都在 lock 中
  local current_files=("conformance.json")
  if [[ -d "$baseline_dir" ]]; then
    local png
    for png in "$baseline_dir"/*.png; do
      [[ -f "$png" ]] && current_files+=("baseline/$(basename "$png")")
    done
  fi
  for f in "${current_files[@]}"; do
    local found=0 lf
    for lf in "${locked_files[@]}"; do
      [[ "$lf" == "$f" ]] && { found=1; break; }
    done
    if [[ $found -eq 0 ]]; then
      err "lock 缺少记录: ${f}"
      violations=$((violations + 1))
    fi
  done
  if [[ $violations -gt 0 ]]; then
    return 1
  fi
  log "verify 通过: ${change_dir}"
  return 0
}

# ---- 入口 -------------------------------------------------------------------
main() {
  local cmd="" change="" dir_override="" a="" argv=()
  while [[ $# -gt 0 ]]; do
    a="$1"
    case "$a" in
      --dir)
        shift
        if [[ $# -eq 0 || -z "$1" ]]; then
          err "--dir 需要非空目录参数"
          usage >&2
          exit 1
        fi
        dir_override="$1"
        shift
        ;;
      --dir=*)
        dir_override="${a#--dir=}"
        if [[ -z "$dir_override" ]]; then
          err "--dir 需要非空目录参数"
          usage >&2
          exit 1
        fi
        shift
        ;;
      --help|-h|help)
        usage
        exit 0
        ;;
      *)
        argv+=("$a")
        shift
        ;;
    esac
  done
  set -- ${argv[@]+"${argv[@]}"}
  cmd="${1:-}"
  change="${2:-}"
  case "$cmd" in
    scaffold)
      [[ -z "$change" ]] && { err "scaffold 需要 <change> 参数"; usage >&2; exit 1; }
      change_dir="$(resolve_change_dir "$change" "$dir_override")" || exit 1
      cmd_scaffold "$change_dir" || exit $?
      ;;
    generate)
      [[ -z "$change" ]] && { err "generate 需要 <change> 参数"; usage >&2; exit 1; }
      change_dir="$(resolve_change_dir "$change" "$dir_override")" || exit 1
      cmd_generate "$change_dir" || exit $?
      ;;
    lock)
      [[ -z "$change" ]] && { err "lock 需要 <change> 参数"; usage >&2; exit 1; }
      change_dir="$(resolve_change_dir "$change" "$dir_override")" || exit 1
      cmd_lock "$change_dir" || exit $?
      ;;
    verify)
      [[ -z "$change" ]] && { err "verify 需要 <change> 参数"; usage >&2; exit 1; }
      change_dir="$(resolve_change_dir "$change" "$dir_override")" || exit 1
      cmd_verify "$change_dir" || exit $?
      ;;
    "")
      err "未指定子命令（可用: scaffold / generate / lock / verify）"
      usage >&2
      exit 1
      ;;
    *)
      err "未知子命令: ${cmd}"
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
